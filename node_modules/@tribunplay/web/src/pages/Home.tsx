import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleCreateGame = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/game/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create game');
      }
      
      const data = await response.json();
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
      const response = await fetch('/api/game/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Failed to join game' }));
        throw new Error(errData.error || 'Failed to join game');
      }
      
      const data = await response.json();
      navigate(`/game/${code.trim().toUpperCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '50px auto', padding: '20px' }}>
      <h1 style={{ marginBottom: '30px', textAlign: 'center' }}>Tribun Play</h1>
      
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
