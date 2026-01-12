import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as engine from '@tribunplay/engine';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
type Role = 'black' | 'white' | 'spectator';

interface GameSnapshot {
  boardB64: string;
  turn: engine.Color;
  ply: number;
  drawOfferBy: engine.Color | null;
}

export default function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [gameState, setGameState] = useState<engine.State | null>(null);
  const [legalActions, setLegalActions] = useState<Uint32Array>(new Uint32Array());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      navigate('/');
      return;
    }

    let mounted = true;

    const connect = async () => {
      try {
        // Check if we already have a token for this game (from create or previous join)
        const storedToken = localStorage.getItem(`game_token_${code}`);
        const storedGameId = localStorage.getItem(`game_id_${code}`);
        const storedSeat = localStorage.getItem(`game_seat_${code}`) as Role | null;

        let gameId: string;
        let token: string;
        let seat: Role;

        if (storedToken && storedGameId && storedSeat) {
          // Use stored credentials (creator or previous joiner)
          gameId = storedGameId;
          token = storedToken;
          seat = storedSeat;
          setRole(seat);
        } else {
          // First time joining this game - call join API
          const joinResponse = await fetch('/api/game/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });

          if (!joinResponse.ok) {
            throw new Error('Failed to join game');
          }

          const joinData = await joinResponse.json();
          gameId = joinData.gameId;
          token = joinData.token;
          seat = joinData.seat;
          setRole(seat);

          // Store for future use
          localStorage.setItem(`game_token_${code}`, token);
          localStorage.setItem(`game_id_${code}`, gameId);
          localStorage.setItem(`game_seat_${code}`, seat);
        }

        // Connect WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/game/${gameId}?token=${token}`;
        const ws = new WebSocket(wsUrl);

        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          if (mounted) {
            setConnectionState('connected');
          }
        };

        ws.onmessage = (event) => {
          if (!mounted) return;

          if (typeof event.data === 'string') {
            // JSON message
            const message = JSON.parse(event.data);
            if (message.t === 'start') {
              // Initial sync
              const snapshot: GameSnapshot = message.snapshot;
              const board = engine.unpackBoard(snapshot.boardB64);
              const state: engine.State = {
                board,
                turn: snapshot.turn,
                ply: snapshot.ply,
                drawOfferBy: snapshot.drawOfferBy,
              };

              // Replay actions
              let currentState = state;
              const actions = message.actions || [];
              for (const action of actions) {
                currentState = engine.applyAction(currentState, action);
              }

              setGameState(currentState);
              const legal = engine.generateLegalActions(currentState);
              setLegalActions(legal);
            } else if (message.t === 'error') {
              setError(message.message);
            }
          } else if (event.data instanceof ArrayBuffer && event.data.byteLength === 4) {
            // Binary action word
            const view = new DataView(event.data);
            const actionWord = view.getUint32(0, true);

            setGameState((prevState) => {
              if (!prevState) return prevState;
              const newState = engine.applyAction(prevState, actionWord);
              const legal = engine.generateLegalActions(newState);
              setLegalActions(legal);
              return newState;
            });
          }
        };

        ws.onerror = () => {
          if (mounted) {
            setConnectionState('error');
            setError('WebSocket error');
          }
        };

        ws.onclose = () => {
          if (mounted) {
            setConnectionState('disconnected');
          }
        };

        wsRef.current = ws;
      } catch (err) {
        if (mounted) {
          setConnectionState('error');
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [code, navigate]);

  const sendAction = (action: number) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }

    if (role === 'spectator') {
      setError('Spectators cannot play');
      return;
    }

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, action, true);
    wsRef.current.send(buffer);
  };

  const renderBoard = () => {
    if (!gameState) return null;

    const hexSize = 45; // Size of hexagon (distance from center to vertex)
    const hexWidth = Math.sqrt(3) * hexSize;
    const hexHeight = 2 * hexSize;

    // Calculate board bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    const validTiles: Array<{ cid: number; x: number; y: number }> = [];

    for (let cid = 0; cid < 121; cid++) {
      if (engine.isValidTile(cid)) {
        const { x, y } = engine.decodeCoord(cid);
        validTiles.push({ cid, x, y });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    // Calculate offset to center the board
    const offsetX = -minX;
    const offsetY = -minY;

    const tiles: JSX.Element[] = validTiles.map(({ cid, x, y }) => {
      const unit = engine.unitByteToUnit(gameState.board[cid]);
      const isActive = gameState.turn === (role === 'black' ? 0 : 1);
      const isLegal = Array.from(legalActions).some((action) => {
        const decoded = engine.decodeAction(action);
        return decoded.opcode === 0 && decoded.fields.fromCid === cid;
      });

      // Hexagon positioning using axial coordinate system
      // Convert axial (x, y) to pixel coordinates
      const displayX = x + offsetX;
      const displayY = y + offsetY;
      const hexX = hexSize * (Math.sqrt(3) * displayX + Math.sqrt(3) / 2 * displayY);
      const hexY = hexSize * (3 / 2 * displayY);

      // Determine tile color based on board coloring
      // Center (0,0) is gray, (1,1) is black, (-1,-1) is white
      const z = -x - y;
      let tileColor = '#d0d0d0'; // gray default
      if (x === 0 && y === 0) {
        tileColor = '#a0a0a0'; // gray
      } else {
        // Check if tile is black or white colored
        const isBlackTile = (x + y) % 2 === 0;
        tileColor = isBlackTile ? '#e8e8e8' : '#f5f5f5';
      }

      return (
        <div
          key={cid}
          style={{
            position: 'absolute',
            left: `${hexX}px`,
            top: `${hexY}px`,
            width: `${hexWidth}px`,
            height: `${hexHeight}px`,
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            background: unit ? (unit.color === 0 ? '#2c2c2c' : '#ffffff') : tileColor,
            border: '2px solid #888',
            cursor: isActive && isLegal && unit ? 'pointer' : 'default',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            boxSizing: 'border-box',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (isActive && isLegal && unit) {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.zIndex = '10';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.zIndex = '1';
          }}
          onClick={() => {
            if (isActive && isLegal && unit) {
              // For MVP, just show the first legal move from this tile
              const moveAction = Array.from(legalActions).find((action) => {
                const decoded = engine.decodeAction(action);
                return decoded.opcode === 0 && decoded.fields.fromCid === cid;
              });
              if (moveAction) {
                sendAction(moveAction);
              }
            }
          }}
        >
          {unit && (
            <div style={{
              fontSize: '14px',
              fontWeight: 'bold',
              color: unit.color === 0 ? '#fff' : '#000',
              marginBottom: '2px',
            }}>
              {unit.p}
              {unit.tribun && 'T'}
            </div>
          )}
          <div style={{
            fontSize: '9px',
            color: unit ? (unit.color === 0 ? '#aaa' : '#666') : '#999',
            fontWeight: '500',
          }}>
            {cid}
          </div>
        </div>
      );
    });

    // Calculate board container size based on actual hex positions
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const boardWidth = hexSize * (Math.sqrt(3) * (rangeX + 1) + Math.sqrt(3) / 2 * (rangeY + 1)) + hexWidth;
    const boardHeight = hexSize * (3 / 2 * (rangeY + 1)) + hexHeight;

    return (
      <div style={{
        position: 'relative',
        width: `${boardWidth}px`,
        height: `${boardHeight}px`,
        margin: '20px auto',
        padding: '10px',
      }}>
        {tiles}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: '800px', margin: '20px auto', padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Game: {code}</h1>
        <button onClick={() => navigate('/')} style={{ padding: '8px 16px' }}>
          Home
        </button>
      </div>

      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '20px',
      }}>
        <div style={{ marginBottom: '10px' }}>
          <strong>Connection:</strong> {connectionState}
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong>Role:</strong> {role || '...'}
        </div>
        {gameState && (
          <>
            <div style={{ marginBottom: '10px' }}>
              <strong>Turn:</strong> {gameState.turn === 0 ? 'Black' : 'White'}
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Ply:</strong> {gameState.ply}
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Legal Actions:</strong> {legalActions.length}
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{
          padding: '10px',
          background: '#f8d7da',
          color: '#721c24',
          borderRadius: '4px',
          marginBottom: '20px',
        }}>
          {error}
        </div>
      )}

      <div style={{
        background: 'white',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      }}>
        <h2 style={{ marginBottom: '15px' }}>Board</h2>
        {renderBoard()}
      </div>

      {legalActions.length > 0 && (
        <div style={{
          background: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginTop: '20px',
        }}>
          <h2 style={{ marginBottom: '15px' }}>Legal Actions</h2>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {Array.from(legalActions).slice(0, 20).map((action, idx) => {
              const decoded = engine.decodeAction(action);
              return (
                <div
                  key={idx}
                  style={{
                    padding: '5px',
                    margin: '2px 0',
                    background: '#f0f0f0',
                    borderRadius: '4px',
                    cursor: role !== 'spectator' ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (role !== 'spectator') {
                      sendAction(action);
                    }
                  }}
                >
                  Opcode {decoded.opcode}: {JSON.stringify(decoded.fields)}
                </div>
              );
            })}
            {legalActions.length > 20 && <div>... and {legalActions.length - 20} more</div>}
          </div>
        </div>
      )}
    </div>
  );
}
