import { type Dispatch, type SetStateAction, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useHealthCheck } from '../utils/useHealthCheck';

type RoomColorOption = 'black' | 'white' | 'random';
type NextStartOption = 'same' | 'other' | 'random';
type ClockInput = {
  initialMinutes: number;
  initialSeconds: number;
  bufferMinutes: number;
  bufferSeconds: number;
  incrementMinutes: number;
  incrementSeconds: number;
};

type ClockField = keyof ClockInput;

const DEFAULT_CLOCK: ClockInput = {
  initialMinutes: 5,
  initialSeconds: 0,
  bufferMinutes: 0,
  bufferSeconds: 20,
  incrementMinutes: 0,
  incrementSeconds: 0,
};

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const toMs = (value: number, unit: 'minutes' | 'seconds') => {
  const factor = unit === 'minutes' ? 60000 : 1000;
  return Math.round(clampNumber(value, 0) * factor);
};

const sectionLabelStyle = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '1.3px',
  textTransform: 'uppercase' as const,
  color: '#7a6543',
};

const fieldLabelStyle = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.1px',
  textTransform: 'uppercase' as const,
  color: '#6f5a38',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  border: '1px solid #ccb89b',
  borderRadius: '10px',
  background: '#fff9ef',
  color: '#1f1a13',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
};

const selectStyle = {
  ...inputStyle,
  appearance: 'none' as const,
};

const spinButtonReset = `
  input[type='number']::-webkit-outer-spin-button,
  input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type='number'] {
    -moz-appearance: textfield;
  }
`;

function ClockEditor(props: {
  title: string;
  clock: ClockInput;
  onChange: (field: ClockField, value: number) => void;
  tone?: 'light' | 'dark';
}) {
  const { title, clock, onChange, tone = 'light' } = props;
  const panelBg = tone === 'dark' ? '#f7ead6' : '#fffaf0';

  const renderRow = (
    label: string,
    minuteField: ClockField,
    secondField: ClockField,
    secondMax?: number,
  ) => (
    <div style={{ display: 'grid', gap: '7px' }}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={clock[minuteField] || 0}
          onChange={(event) => onChange(minuteField, event.target.value === '' ? 0 : Number(event.target.value))}
          placeholder="Min"
          style={inputStyle}
        />
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={secondMax}
          step={1}
          value={clock[secondField] || 0}
          onChange={(event) => onChange(secondField, event.target.value === '' ? 0 : Number(event.target.value))}
          placeholder="Sec"
          style={inputStyle}
        />
      </div>
    </div>
  );

  return (
    <div
      style={{
        padding: '14px',
        borderRadius: '12px',
        border: '1px solid #d7c5ab',
        background: panelBg,
        display: 'grid',
        gap: '10px',
      }}
    >
      <div style={{ fontWeight: 700, color: '#2f2418' }}>{title}</div>
      {renderRow('Initial Time', 'initialMinutes', 'initialSeconds', 59)}
      {renderRow('Buffer', 'bufferMinutes', 'bufferSeconds', 59)}
      {renderRow('Increment', 'incrementMinutes', 'incrementSeconds', 59)}
    </div>
  );
}

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
  const [maxGameHours, setMaxGameHours] = useState(1);
  const [maxGameMinutes, setMaxGameMinutes] = useState(0);
  const [loadingAction, setLoadingAction] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { result: healthResult, checking: healthChecking } = useHealthCheck({
    autoCheck: true,
    timeout: 3000,
  });

  const isLoading = loadingAction !== null;

  const setClockValue = (
    setter: Dispatch<SetStateAction<ClockInput>>,
    field: ClockField,
    value: number,
  ) => {
    setter((prev) => ({ ...prev, [field]: value }));
  };

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
    initialSeconds: clampNumber(clock.initialSeconds, DEFAULT_CLOCK.initialSeconds),
    bufferMinutes: clampNumber(clock.bufferMinutes, DEFAULT_CLOCK.bufferMinutes),
    bufferSeconds: clampNumber(clock.bufferSeconds, DEFAULT_CLOCK.bufferSeconds),
    incrementMinutes: clampNumber(clock.incrementMinutes, DEFAULT_CLOCK.incrementMinutes),
    incrementSeconds: clampNumber(clock.incrementSeconds, DEFAULT_CLOCK.incrementSeconds),
  });

  const buildTimeControl = () => {
    const normalizedMaxHours = clampNumber(maxGameHours, 0);
    const normalizedMaxMinutes = clampNumber(maxGameMinutes, 0);
    const totalMaxMinutes = normalizedMaxHours * 60 + normalizedMaxMinutes;
    const maxGameMs = maxGameEnabled && totalMaxMinutes > 0 ? toMs(totalMaxMinutes, 'minutes') : null;

    if (sameClockSettings) {
      const normalized = normalizeClockInput(sharedClock);
      const totalInitialMinutes = normalized.initialMinutes + normalized.initialSeconds / 60;
      const totalBufferSeconds = normalized.bufferMinutes * 60 + normalized.bufferSeconds;
      const totalIncrementSeconds = normalized.incrementMinutes * 60 + normalized.incrementSeconds;

      return {
        initialMs: toMs(totalInitialMinutes, 'minutes'),
        bufferMs: toMs(totalBufferSeconds, 'seconds'),
        incrementMs: toMs(totalIncrementSeconds, 'seconds'),
        maxGameMs,
      };
    }

    const normalizedBlack = normalizeClockInput(blackClock);
    const normalizedWhite = normalizeClockInput(whiteClock);
    const totalBlackInitialMinutes = normalizedBlack.initialMinutes + normalizedBlack.initialSeconds / 60;
    const totalWhiteInitialMinutes = normalizedWhite.initialMinutes + normalizedWhite.initialSeconds / 60;
    const totalBlackBufferSeconds = normalizedBlack.bufferMinutes * 60 + normalizedBlack.bufferSeconds;
    const totalWhiteBufferSeconds = normalizedWhite.bufferMinutes * 60 + normalizedWhite.bufferSeconds;
    const totalBlackIncrementSeconds = normalizedBlack.incrementMinutes * 60 + normalizedBlack.incrementSeconds;
    const totalWhiteIncrementSeconds = normalizedWhite.incrementMinutes * 60 + normalizedWhite.incrementSeconds;

    return {
      initialMs: {
        black: toMs(totalBlackInitialMinutes, 'minutes'),
        white: toMs(totalWhiteInitialMinutes, 'minutes'),
      },
      bufferMs: {
        black: toMs(totalBlackBufferSeconds, 'seconds'),
        white: toMs(totalWhiteBufferSeconds, 'seconds'),
      },
      incrementMs: {
        black: toMs(totalBlackIncrementSeconds, 'seconds'),
        white: toMs(totalWhiteIncrementSeconds, 'seconds'),
      },
      maxGameMs,
    };
  };

  const handleCreateGame = async () => {
    setLoadingAction('create');
    setError(null);
    try {
      const timeControl = buildTimeControl();
      const roomSettings = { hostColor, startColor, nextStartColor };
      const response = await fetch(`${API_BASE}/api/game/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeControl, roomSettings }),
      });

      if (!response.ok) {
        throw new Error('Failed to create game');
      }

      const data = await response.json();
      localStorage.setItem(`game_token_${data.code}`, data.token);
      localStorage.setItem(`game_id_${data.code}`, data.gameId);
      localStorage.setItem(`game_seat_${data.code}`, 'black');
      navigate(`/game/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleJoinGame = async () => {
    if (!code.trim()) {
      setError('Please enter a game code');
      return;
    }

    setLoadingAction('join');
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
      const gameCode = code.trim().toUpperCase();
      localStorage.setItem(`game_token_${gameCode}`, data.token);
      localStorage.setItem(`game_id_${gameCode}`, data.gameId);
      localStorage.setItem(`game_seat_${gameCode}`, data.seat);
      navigate(`/game/${gameCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingAction(null);
    }
  };

  const healthOk = Boolean(healthResult?.api.reachable && healthResult?.websocket.reachable);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)',
        color: '#1d1a14',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');${spinButtonReset}`}
      </style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
          padding: '12px 20px',
          background: 'rgba(26, 21, 15, 0.92)',
          color: '#f8f1e7',
          borderBottom: '2px solid #3a2f22',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '10px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#ccb896',
              fontWeight: 700,
            }}
          >
            Tribun Play
          </div>
          <div style={{ fontSize: '20px', fontWeight: 400 }}>Lobby & Match Setup</div>
        </div>

        <div
          style={{
            padding: '6px 12px',
            borderRadius: '999px',
            border: '1px solid #5f4a2d',
            background: healthOk ? '#244d34' : '#4f3720',
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '1px',
            textTransform: 'uppercase',
          }}
        >
          {healthChecking && !healthResult ? 'Checking Connection' : healthOk ? 'Server Reachable' : 'Connection Issues'}
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: '1160px', margin: '0 auto', padding: '20px 14px 24px', display: 'grid', gap: '16px' }}>
        {import.meta.env.DEV && healthResult && (
          <div
            style={{
              borderRadius: '12px',
              border: `2px solid ${healthOk ? '#2f6b3f' : '#8b3b3b'}`,
              background: healthOk ? 'rgba(236, 247, 239, 0.85)' : 'rgba(250, 231, 227, 0.85)',
              padding: '12px 14px',
              fontSize: '13px',
              display: 'grid',
              gap: '4px',
            }}
          >
            <div style={{ fontWeight: 700 }}>Development Connection Status</div>
            <div>
              API: {healthResult.api.reachable ? 'Reachable' : `Unreachable${healthResult.api.error ? ` (${healthResult.api.error})` : ''}`}
              {healthResult.api.responseTime ? ` (${healthResult.api.responseTime}ms)` : ''}
            </div>
            <div>
              WebSocket:{' '}
              {healthResult.websocket.reachable
                ? 'Reachable'
                : `Unreachable${healthResult.websocket.error ? ` (${healthResult.websocket.error})` : ''}`}
              {healthResult.websocket.responseTime ? ` (${healthResult.websocket.responseTime}ms)` : ''}
            </div>
          </div>
        )}

        {import.meta.env.DEV && healthChecking && !healthResult && (
          <div
            style={{
              borderRadius: '12px',
              border: '2px solid #a68043',
              background: 'rgba(255, 243, 214, 0.9)',
              color: '#5c441c',
              padding: '12px 14px',
              fontWeight: 600,
            }}
          >
            Checking connection status...
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '16px',
            alignItems: 'start',
            maxWidth: '780px',
            width: '100%',
            margin: '0 auto',
          }}
        >
          <section
            style={{
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.84)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ ...sectionLabelStyle, color: '#7a6543' }}>Quick Join</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>Join Game</div>

            <div style={{ display: 'grid', gap: '9px' }}>
              <div style={fieldLabelStyle}>Game Code</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px' }}>
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="Enter game code"
                  maxLength={6}
                  style={{
                    ...inputStyle,
                    fontFamily: '"JetBrains Mono", monospace',
                    letterSpacing: '2px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleJoinGame();
                    }
                  }}
                />
                <button
                  onClick={handleJoinGame}
                  disabled={isLoading}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '999px',
                    border: '2px solid #1f4d2f',
                    background: isLoading ? '#8ea593' : '#2f6b3f',
                    color: '#f7f3eb',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loadingAction === 'join' ? 'Joining...' : 'Join'}
                </button>
              </div>
            </div>

            <div
              style={{
                borderRadius: '12px',
                border: '1px solid #d8cbb8',
                background: '#fffaf0',
                padding: '12px',
                color: '#5a4630',
                fontSize: '13px',
                lineHeight: 1.45,
              }}
            >
              Tip: share the 6-character code with your opponent, then both players meet in the same match lobby.
            </div>
          </section>

          <section
            style={{
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.84)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={sectionLabelStyle}>Room Configuration</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>Create Room</div>

            <button
              onClick={handleCreateGame}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '999px',
                border: '2px solid #6f5a38',
                background: isLoading ? '#d8c8ab' : '#f2d9b2',
                color: '#2a2218',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingAction === 'create' ? 'Creating...' : 'Create Game'}
            </button>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <div style={fieldLabelStyle}>Host Color</div>
                <select
                  value={hostColor}
                  onChange={(event) => setHostColor(event.target.value as RoomColorOption)}
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
                  onChange={(event) => setStartColor(event.target.value as RoomColorOption)}
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
                  onChange={(event) => setNextStartColor(event.target.value as NextStartOption)}
                  style={selectStyle}
                >
                  <option value="other">Other</option>
                  <option value="same">Same</option>
                  <option value="random">Random</option>
                </select>
              </div>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #d7c5ab',
                background: '#f8f0e2',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={sectionLabelStyle}>Clock Settings</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={sameClockSettings}
                  onChange={(event) => handleSameClockToggle(event.target.checked)}
                />
                Same for both colors
              </label>

              {sameClockSettings ? (
                <ClockEditor
                  title="Both Colors"
                  clock={sharedClock}
                  onChange={(field, value) => setClockValue(setSharedClock, field, value)}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <ClockEditor
                    title="Black"
                    clock={blackClock}
                    onChange={(field, value) => setClockValue(setBlackClock, field, value)}
                    tone="dark"
                  />
                  <ClockEditor
                    title="White"
                    clock={whiteClock}
                    onChange={(field, value) => setClockValue(setWhiteClock, field, value)}
                    tone="dark"
                  />
                </div>
              )}
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #d7c5ab',
                background: '#fff7ea',
                display: 'grid',
                gap: '10px',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={maxGameEnabled}
                  onChange={(event) => setMaxGameEnabled(event.target.checked)}
                />
                Max Game Time
              </label>

              {maxGameEnabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <div style={fieldLabelStyle}>Hours</div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={maxGameHours || 0}
                      onChange={(event) => setMaxGameHours(event.target.value === '' ? 0 : Number(event.target.value))}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <div style={fieldLabelStyle}>Minutes</div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={59}
                      step={1}
                      value={maxGameMinutes || 0}
                      onChange={(event) => setMaxGameMinutes(event.target.value === '' ? 0 : Number(event.target.value))}
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {error && (
          <div
            style={{
              borderRadius: '12px',
              border: '2px solid #8b3b3b',
              background: '#f7d7d5',
              color: '#5c1c16',
              padding: '10px 14px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <footer
          style={{
            borderRadius: '12px',
            border: '1px solid #d8cbb8',
            background: 'rgba(255, 250, 242, 0.7)',
            padding: '12px',
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            fontSize: '13px',
          }}
        >
          <Link to="/datenschutz" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Datenschutz
          </Link>
          <span style={{ color: '#b59d7c' }}>|</span>
          <Link to="/disclaimer" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Disclaimer
          </Link>
          <span style={{ color: '#b59d7c' }}>|</span>
          <Link to="/impressum" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Impressum
          </Link>
        </footer>
      </div>
    </div>
  );
}
