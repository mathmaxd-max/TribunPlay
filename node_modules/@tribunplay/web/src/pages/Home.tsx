import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useHealthCheck } from '../utils/useHealthCheck';

type RoomColorOption = 'black' | 'white' | 'random';
type NextStartOption = 'same' | 'other' | 'random';
type ClockInput = {
  initialMinutes: number;
  bufferSeconds: number;
  incrementSeconds: number;
};

const DEFAULT_CLOCK: ClockInput = { initialMinutes: 5, bufferSeconds: 20, incrementSeconds: 0 };

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const toMs = (value: number, unit: 'minutes' | 'seconds') => {
  const factor = unit === 'minutes' ? 60000 : 1000;
  return Math.round(clampNumber(value, 0) * factor);
};

export default function Home() {
  const [code, setCode] = useState('');
  const [hostColor, setHostColor] = useState<RoomColorOption>('random');
  const [startColor, setStartColor] = useState<RoomColorOption>('random');
  const [nextStartColor, setNextStartColor] = useState<NextStartOption>('other');
  const [sameClockSettings, setSameClockSettings] = useState(true);
  const [sharedClock, setSharedClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [blackClock, setBlackClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [whiteClock, setWhiteClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [maxGameEnabled, setMaxGameEnabled] = useState(false);
  const [maxGameMinutes, setMaxGameMinutes] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  
  // Health check for API and WebSocket
  const { result: healthResult, checking: healthChecking } = useHealthCheck({
    autoCheck: true,
    timeout: 3000,
  });

  const handleSameClockToggle = (nextValue: boolean) => {
    setSameClockSettings(nextValue);
    if (nextValue) {
      setSharedClock(blackClock);
    } else {
      setBlackClock(sharedClock);
      setWhiteClock(sharedClock);
    }
  };

  const normalizeClockInput = (clock: ClockInput): ClockInput => ({
    initialMinutes: clampNumber(clock.initialMinutes, DEFAULT_CLOCK.initialMinutes),
    bufferSeconds: clampNumber(clock.bufferSeconds, DEFAULT_CLOCK.bufferSeconds),
    incrementSeconds: clampNumber(clock.incrementSeconds, DEFAULT_CLOCK.incrementSeconds),
  });

  const buildTimeControl = () => {
    const normalizedMaxMinutes = clampNumber(maxGameMinutes, 0);
    const maxGameMs = maxGameEnabled && normalizedMaxMinutes > 0 ? toMs(normalizedMaxMinutes, 'minutes') : null;
    if (sameClockSettings) {
      const normalized = normalizeClockInput(sharedClock);
      return {
        initialMs: toMs(normalized.initialMinutes, 'minutes'),
        bufferMs: toMs(normalized.bufferSeconds, 'seconds'),
        incrementMs: toMs(normalized.incrementSeconds, 'seconds'),
        maxGameMs,
      };
    }
    const normalizedBlack = normalizeClockInput(blackClock);
    const normalizedWhite = normalizeClockInput(whiteClock);
    return {
      initialMs: {
        black: toMs(normalizedBlack.initialMinutes, 'minutes'),
        white: toMs(normalizedWhite.initialMinutes, 'minutes'),
      },
      bufferMs: {
        black: toMs(normalizedBlack.bufferSeconds, 'seconds'),
        white: toMs(normalizedWhite.bufferSeconds, 'seconds'),
      },
      incrementMs: {
        black: toMs(normalizedBlack.incrementSeconds, 'seconds'),
        white: toMs(normalizedWhite.incrementSeconds, 'seconds'),
      },
      maxGameMs,
    };
  };

  const fieldLabelStyle = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase' as const,
    color: '#5f564a',
    marginBottom: '6px',
  };
  const inputStyle = {
    width: '100%',
    padding: '10px',
    fontSize: '14px',
    border: '1px solid #d9d0c2',
    borderRadius: '6px',
    background: 'white',
  };
  const selectStyle = {
    ...inputStyle,
    padding: '10px 12px',
  };

  const handleCreateGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const timeControl = buildTimeControl();
      const roomSettings = {
        hostColor,
        startColor,
        nextStartColor,
      };
      const response = await fetch(`${API_BASE}/api/game/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeControl, roomSettings }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create game');
      }
      
      const data = await response.json();
      // Store token and gameId for the creator
      localStorage.setItem(`game_token_${data.code}`, data.token);
      localStorage.setItem(`game_id_${data.code}`, data.gameId);
      localStorage.setItem(`game_seat_${data.code}`, 'black');
      navigate(`/game/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!code.trim()) {
      setError('Please enter a game code');
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/game/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Failed to join game' }));
        throw new Error(errData.error || 'Failed to join game');
      }
      
      const data = await response.json();
      // Store token and gameId for the joiner
      const gameCode = code.trim().toUpperCase();
      localStorage.setItem(`game_token_${gameCode}`, data.token);
      localStorage.setItem(`game_id_${gameCode}`, data.gameId);
      localStorage.setItem(`game_seat_${gameCode}`, data.seat);
      navigate(`/game/${gameCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px' }}>
      <h1 style={{ marginBottom: '30px', textAlign: 'center' }}>Tribun Play</h1>
      
      {/* Health Check Status */}
      {healthResult && (
        <div style={{
          marginBottom: '20px',
          padding: '12px',
          background: healthResult.api.reachable && healthResult.websocket.reachable 
            ? '#d4edda' 
            : '#f8d7da',
          color: healthResult.api.reachable && healthResult.websocket.reachable 
            ? '#155724' 
            : '#721c24',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
            Connection Status:
          </div>
          <div>
            API: {healthResult.api.reachable ? (
              <span style={{ color: '#28a745' }}>✓ Reachable</span>
            ) : (
              <span style={{ color: '#dc3545' }}>✗ Unreachable {healthResult.api.error ? `(${healthResult.api.error})` : ''}</span>
            )}
            {healthResult.api.responseTime && ` (${healthResult.api.responseTime}ms)`}
          </div>
          <div>
            WebSocket: {healthResult.websocket.reachable ? (
              <span style={{ color: '#28a745' }}>✓ Reachable</span>
            ) : (
              <span style={{ color: '#dc3545' }}>✗ Unreachable {healthResult.websocket.error ? `(${healthResult.websocket.error})` : ''}</span>
            )}
            {healthResult.websocket.responseTime && ` (${healthResult.websocket.responseTime}ms)`}
          </div>
        </div>
      )}
      
      {healthChecking && !healthResult && (
        <div style={{
          marginBottom: '20px',
          padding: '12px',
          background: '#fff3cd',
          color: '#856404',
          borderRadius: '4px',
          fontSize: '14px',
        }}>
          Checking connection status...
        </div>
      )}
      
      <div style={{ 
        background: 'white', 
        padding: '30px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)' 
      }}>
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Create Room</h2>
          <div style={{ display: 'grid', gap: '18px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '12px',
            }}>
              <div>
                <div style={fieldLabelStyle}>Host Color</div>
                <select
                  value={hostColor}
                  onChange={(e) => setHostColor(e.target.value as RoomColorOption)}
                  style={selectStyle}
                >
                  <option value="random">Random</option>
                  <option value="black">Black</option>
                  <option value="white">White</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>Start Color</div>
                <select
                  value={startColor}
                  onChange={(e) => setStartColor(e.target.value as RoomColorOption)}
                  style={selectStyle}
                >
                  <option value="random">Random</option>
                  <option value="black">Black</option>
                  <option value="white">White</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>Next Start</div>
                <select
                  value={nextStartColor}
                  onChange={(e) => setNextStartColor(e.target.value as NextStartOption)}
                  style={selectStyle}
                >
                  <option value="other">Other</option>
                  <option value="same">Same</option>
                  <option value="random">Random</option>
                </select>
              </div>
            </div>

            <div style={{
              padding: '14px',
              border: '1px solid #e7dfd2',
              borderRadius: '10px',
              background: '#f8f4ec',
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: '#6b5f4d',
                marginBottom: '10px',
              }}>
                Clock Settings
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                <input
                  type="checkbox"
                  checked={sameClockSettings}
                  onChange={(e) => handleSameClockToggle(e.target.checked)}
                />
                Same for both colors
              </label>

              {sameClockSettings ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginTop: '12px' }}>
                  <div>
                    <div style={fieldLabelStyle}>Initial (min)</div>
                    <input
                      type="number"
                      min={0}
                      value={sharedClock.initialMinutes}
                      onChange={(e) =>
                        setSharedClock((prev) => ({ ...prev, initialMinutes: Number(e.target.value) }))
                      }
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={fieldLabelStyle}>Buffer (sec)</div>
                    <input
                      type="number"
                      min={0}
                      value={sharedClock.bufferSeconds}
                      onChange={(e) =>
                        setSharedClock((prev) => ({ ...prev, bufferSeconds: Number(e.target.value) }))
                      }
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={fieldLabelStyle}>Increment (sec)</div>
                    <input
                      type="number"
                      min={0}
                      value={sharedClock.incrementSeconds}
                      onChange={(e) =>
                        setSharedClock((prev) => ({ ...prev, incrementSeconds: Number(e.target.value) }))
                      }
                      style={inputStyle}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '12px' }}>
                  <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #e2d8c9', background: 'white' }}>
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>Black</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                      <div>
                        <div style={fieldLabelStyle}>Initial (min)</div>
                        <input
                          type="number"
                          min={0}
                          value={blackClock.initialMinutes}
                          onChange={(e) =>
                            setBlackClock((prev) => ({ ...prev, initialMinutes: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Buffer (sec)</div>
                        <input
                          type="number"
                          min={0}
                          value={blackClock.bufferSeconds}
                          onChange={(e) =>
                            setBlackClock((prev) => ({ ...prev, bufferSeconds: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Increment (sec)</div>
                        <input
                          type="number"
                          min={0}
                          value={blackClock.incrementSeconds}
                          onChange={(e) =>
                            setBlackClock((prev) => ({ ...prev, incrementSeconds: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #e2d8c9', background: 'white' }}>
                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>White</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
                      <div>
                        <div style={fieldLabelStyle}>Initial (min)</div>
                        <input
                          type="number"
                          min={0}
                          value={whiteClock.initialMinutes}
                          onChange={(e) =>
                            setWhiteClock((prev) => ({ ...prev, initialMinutes: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Buffer (sec)</div>
                        <input
                          type="number"
                          min={0}
                          value={whiteClock.bufferSeconds}
                          onChange={(e) =>
                            setWhiteClock((prev) => ({ ...prev, bufferSeconds: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <div style={fieldLabelStyle}>Increment (sec)</div>
                        <input
                          type="number"
                          min={0}
                          value={whiteClock.incrementSeconds}
                          onChange={(e) =>
                            setWhiteClock((prev) => ({ ...prev, incrementSeconds: Number(e.target.value) }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              border: '1px solid #e7dfd2',
              borderRadius: '10px',
              background: '#fdfbf7',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={maxGameEnabled}
                  onChange={(e) => setMaxGameEnabled(e.target.checked)}
                />
                Max game time
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="number"
                  min={1}
                  value={maxGameMinutes}
                  disabled={!maxGameEnabled}
                  onChange={(e) => setMaxGameMinutes(Number(e.target.value))}
                  style={{
                    ...inputStyle,
                    background: maxGameEnabled ? 'white' : '#f2ece1',
                    cursor: maxGameEnabled ? 'text' : 'not-allowed',
                  }}
                />
                <span style={{ fontSize: '13px', color: '#6b5f4d' }}>minutes</span>
              </div>
            </div>

            <button
              onClick={handleCreateGame}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                background: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Creating...' : 'Create Game'}
            </button>
          </div>
        </div>
        
        <div style={{ 
          borderTop: '1px solid #eee', 
          paddingTop: '30px',
          marginTop: '30px'
        }}>
          <h2 style={{ marginBottom: '15px', fontSize: '18px' }}>Join Game</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Enter game code"
              maxLength={6}
              style={{
                flex: 1,
                padding: '10px',
                fontSize: '16px',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleJoinGame();
                }
              }}
            />
            <button
              onClick={handleJoinGame}
              disabled={loading}
              style={{
                padding: '10px 20px',
                fontSize: '16px',
                background: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              Join
            </button>
          </div>
        </div>
        
        {error && (
          <div style={{
            marginTop: '20px',
            padding: '10px',
            background: '#f8d7da',
            color: '#721c24',
            borderRadius: '4px',
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
