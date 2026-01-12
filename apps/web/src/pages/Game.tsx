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
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);

  useEffect(() => {
    if (!boardViewportRef.current) return;

    const element = boardViewportRef.current;
    const updateWidth = () => {
      setBoardViewportWidth(element.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(element);

    return () => observer.disconnect();
  }, [gameState]);

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

    // Edge length of a tile is 1 unit, distance to center of edge is sqrt(3)/2 = d
    // innerHexSize represents the edge length (distance from center to vertex)
    const innerHexSize = 45;
    const borderWidth = 2;
    const spacingMultiplier = 0.98; // Add spacing between hexagons to prevent overlaps
    const outerHexSize = innerHexSize + borderWidth;
    const centerSize = outerHexSize * spacingMultiplier;
    const d = Math.sqrt(3) / 2 * centerSize; // d = sqrt(3)/2 * size (scaled distance)
    // For vertices (±1, 0), (±1/2, ±d) scaled by hexSize:
    // Width: from -innerHexSize to +innerHexSize = 2*innerHexSize
    // Height: from -d to +d = 2d = sqrt(3)*innerHexSize
    const outerHexWidth = 2 * outerHexSize;
    const outerHexHeight = Math.sqrt(3) * outerHexSize;
    const innerHexWidth = 2 * innerHexSize;
    const innerHexHeight = Math.sqrt(3) * innerHexSize;
    const innerOffsetX = (outerHexWidth - innerHexWidth) / 2;
    const innerOffsetY = (outerHexHeight - innerHexHeight) / 2;

    // Collect valid tiles
    const validTiles: Array<{ cid: number; x: number; y: number }> = [];

    for (let cid = 0; cid < 121; cid++) {
      if (engine.isValidTile(cid)) {
        const { x, y } = engine.decodeCoord(cid);
        validTiles.push({ cid, x, y });
      }
    }

    // Calculate actual pixel bounds using correct coordinate conversion
    // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = -x - y
    // Position of (0,0) is at (0,0)
    let minPixelX = Infinity, maxPixelX = -Infinity;
    let minPixelY = Infinity, maxPixelY = -Infinity;

    validTiles.forEach(({ x, y }) => {
      // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = y - x
      // Apply spacing multiplier to add gaps between hexagons
      const z = y - x;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (x + y) * d; // d = sqrt(3)/2 * size (already scaled)
      // Calculate actual left/top position of hexagon (outer div with border)
      const leftX = centerX - outerHexWidth / 2;
      const topY = centerY - outerHexHeight / 2;
      const rightX = centerX + outerHexWidth / 2;
      const bottomY = centerY + outerHexHeight / 2;
      // Track bounds based on actual positions
      minPixelX = Math.min(minPixelX, leftX);
      maxPixelX = Math.max(maxPixelX, rightX);
      minPixelY = Math.min(minPixelY, topY);
      maxPixelY = Math.max(maxPixelY, bottomY);
    });

    const tiles: JSX.Element[] = validTiles.map(({ cid, x, y }) => {
      const unit = engine.unitByteToUnit(gameState.board[cid]);
      const isActive = gameState.turn === (role === 'black' ? 0 : 1);
      const isLegal = Array.from(legalActions).some((action) => {
        const decoded = engine.decodeAction(action);
        return decoded.opcode === 0 && decoded.fields.fromCid === cid;
      });

      // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = y - x
      // Position of (0,0) is at (0,0)
      // Apply spacing multiplier to add gaps between hexagons
      const z = y - x;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (x + y) * d; // d = sqrt(3)/2 * size (already scaled)
      // Calculate actual left/top position relative to container
      const hexX = centerX - outerHexWidth / 2 - minPixelX;
      const hexY = centerY - outerHexHeight / 2 - minPixelY;

      // Determine tile color based on board coloring
      // (0,0) is gray, (1,1) is black, (-1,-1) is white
      // No two tiles of the same color touch (3-coloring of hex grid)
      // Using pattern: colorIndex = ((2*x - y) % 3 + 3) % 3
      const colorIndex = ((2 * x - y) % 3 + 3) % 3;
      let tileColor: string;
      if (colorIndex === 0) {
        tileColor = '#9460FC'; // gray
      } else if (colorIndex === 1) {
        tileColor = '#55369E'; // black
      } else {
        tileColor = '#E7AFFF'; // white
      }

      const hexClipPath = 'polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)';
      
      return (
        <div
          key={cid}
          style={{
            position: 'absolute',
            left: `${hexX}px`,
            top: `${hexY}px`,
            width: `${outerHexWidth}px`,
            height: `${outerHexHeight}px`,
            clipPath: hexClipPath,
            background: '#222',
            cursor: isActive && isLegal && unit ? 'pointer' : 'default',
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
          <div style={{
            position: 'absolute',
            left: `${innerOffsetX}px`,
            top: `${innerOffsetY}px`,
            width: `${innerHexWidth}px`,
            height: `${innerHexHeight}px`,
            clipPath: hexClipPath,
            background: tileColor,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
          }}>
          {unit && (
            <div style={{
              fontSize: '42px',
              fontWeight: 'bold',
              color: unit.color === 0 ? '#000' : '#fff',
              WebkitTextStroke: unit.color === 0 ? '1px #fff' : '1px #000',
              textStroke: unit.color === 0 ? '1px #fff' : '1px #000',
            }}>
              {unit.p}
              {unit.tribun && 'T'}
            </div>
          )}
          <div style={{
            position: 'absolute',
            bottom: '4px',
            fontSize: '9px',
            color: '#222',
            fontWeight: '500',
          }}>
            {cid}
          </div>
          </div>
        </div>
      );
    });

    // Calculate board container size based on actual pixel bounds
    // Account for full hexagon dimensions and borders
    // Add small safety margin to ensure all hexagons fit (accounts for rounding and spacing)
    const safetyMargin = 2;
    const boardWidth = maxPixelX - minPixelX + safetyMargin;
    const boardHeight = maxPixelY - minPixelY + safetyMargin;

    const availableWidth = boardViewportWidth || boardWidth;
    const scale = Math.min(1, availableWidth / boardWidth);
    const scaledBoardHeight = boardHeight * scale;

    return (
      <div
        ref={boardViewportRef}
        style={{
          position: 'relative',
          width: '100%',
          height: `${scaledBoardHeight}px`,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: `${boardWidth}px`,
          height: `${boardHeight}px`,
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'top center',
        }}>
          {tiles}
        </div>
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
