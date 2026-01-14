import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useHealthCheck } from '../utils/useHealthCheck';

export default function Home() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  
  // Health check for API and WebSocket
  const { result: healthResult, checking: healthChecking } = useHealthCheck({
    autoCheck: true,
    timeout: 3000,
  });

  const handleCreateGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/game/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
