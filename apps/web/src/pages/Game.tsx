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
        // First, join the game via HTTP API
        const joinResponse = await fetch('/api/game/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!joinResponse.ok) {
          throw new Error('Failed to join game');
        }

        const joinData = await joinResponse.json();
        setRole(joinData.seat);

        // Connect WebSocket
        // Use the wsUrl from the server, or construct it
        let wsUrl = joinData.wsUrl;
        if (wsUrl.startsWith('http://')) {
          wsUrl = wsUrl.replace('http://', 'ws://');
        }
        if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
          // Fallback: construct from current location
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.host}/ws/game/${joinData.gameId}?token=${joinData.token}`;
        }
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

    const tiles: JSX.Element[] = [];
    for (let cid = 0; cid < 121; cid++) {
      try {
        const { x, y } = engine.decodeCoord(cid);
        const unit = engine.unitByteToUnit(gameState.board[cid]);
        const isActive = gameState.turn === (role === 'black' ? 0 : 1);
        const isLegal = Array.from(legalActions).some((action) => {
          const decoded = engine.decodeAction(action);
          return decoded.opcode === 0 && decoded.fields.fromCid === cid;
        });

        tiles.push(
          <div
            key={cid}
            style={{
              width: '40px',
              height: '40px',
              border: '1px solid #ccc',
              display: 'inline-block',
              margin: '2px',
              background: unit ? (unit.color === 0 ? '#333' : '#fff') : '#f0f0f0',
              cursor: isActive && isLegal && unit ? 'pointer' : 'default',
              position: 'relative',
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
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '12px',
              }}>
                {unit.p}
                {unit.tribun && 'T'}
              </div>
            )}
            <div style={{
              position: 'absolute',
              bottom: '2px',
              right: '2px',
              fontSize: '8px',
              color: '#666',
            }}>
              {x},{y}
            </div>
          </div>
        );
      } catch {
        // Invalid tile, skip
      }
    }

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', maxWidth: '600px' }}>
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
