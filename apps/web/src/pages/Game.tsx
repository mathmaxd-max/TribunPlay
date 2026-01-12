import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as engine from '@tribunplay/engine';
import { getHexagonColor, getBaseColor, type HexagonState } from '../hexagonColors';

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
  const [hoveredCid, setHoveredCid] = useState<number | null>(null);
  
  // UI State Machine
  const [uiState, setUiState] = useState<engine.UIState>({ type: 'idle' });
  const [groupedMoves, setGroupedMoves] = useState<engine.GroupedLegalMoves | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [emptyDonors, setEmptyDonors] = useState<Map<number, number>>(new Map()); // cid -> displayed primary
  const [secondaryAllocations, setSecondaryAllocations] = useState<number[]>([0, 0, 0, 0, 0, 0]);

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

  // Build grouped legal moves when gameState changes
  useEffect(() => {
    if (gameState) {
      const grouped = engine.buildGroupedLegalMoves(gameState);
      setGroupedMoves(grouped);
      // Reset UI state to idle when game state changes (new turn)
      setUiState({ type: 'idle' });
      setOptionIndex(0);
      setEmptyDonors(new Map());
      setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
    }
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
              // Grouped moves will be built by useEffect
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
              // Reset UI state after action is applied
              setUiState({ type: 'idle' });
              setOptionIndex(0);
              setEmptyDonors(new Map());
              setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
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

    if (!groupedMoves || !engine.isActionLegal(action, groupedMoves)) {
      setError('Action is not legal');
      return;
    }

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, action, true);
    wsRef.current.send(buffer);
    
    // UI state will be reset when action is applied via WebSocket
  };

  const handleTileClick = (cid: number, d: number = 1) => {
    if (!gameState || !groupedMoves) return;
    
    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    if (!isActive) return;

    switch (uiState.type) {
      case 'idle': {
        // Determine which state to enter
        const newState = engine.getTileClickState(cid, gameState, groupedMoves);
        if (newState) {
          setUiState(newState);
          setOptionIndex(0);
        }
        break;
      }
      
      case 'enemy': {
        if (cid === uiState.targetCid) {
          // Cycle options
          const options = engine.getEnemyOptions(uiState.targetCid, groupedMoves);
          if (options.length > 0) {
            const newIndex = ((uiState.optionIndex + d) % options.length + options.length) % options.length;
            setOptionIndex(newIndex);
            setUiState({ ...uiState, optionIndex: newIndex });
          }
        } else {
          // Clicked non-clickable tile - reset to idle
          setUiState({ type: 'idle' });
          setOptionIndex(0);
          setEmptyDonors(new Map());
          setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
        }
        break;
      }
      
      case 'empty': {
        if (cid === uiState.centerCid) {
          // Click center - reset donors
          setEmptyDonors(new Map());
          setOptionIndex(0);
        } else {
          // Click donor - cycle donation
          const donors = engine.getEmptyStateDonors(uiState.centerCid, gameState);
          const donorInfo = donors.get(cid);
          if (donorInfo) {
            const validValues = engine.getValidDonationValues(cid, gameState);
            // Initialize with actual primary if not already set
            const currentDisp = emptyDonors.has(cid) ? emptyDonors.get(cid)! : donorInfo.actualPrimary;
            const currentIndex = validValues.indexOf(currentDisp);
            const nextIndex = ((currentIndex + d) % validValues.length + validValues.length) % validValues.length;
            const newDisp = validValues[nextIndex];
            
            const newDonors = new Map(emptyDonors);
            newDonors.set(cid, newDisp);
            setEmptyDonors(newDonors);
            
            // Check for valid action
            const options = engine.getEmptyStateOptions(uiState.centerCid, newDonors, gameState, groupedMoves);
            if (options.length > 0) {
              setOptionIndex(0);
            }
          } else {
            // Clicked non-clickable tile - reset to idle
            setUiState({ type: 'idle' });
            setOptionIndex(0);
            setEmptyDonors(new Map());
            setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
          }
        }
        break;
      }
      
      case 'own_primary': {
        if (cid === uiState.originCid) {
          // Click origin
          if (uiState.targetCid !== null) {
            // Clear target selection
            setUiState({ ...uiState, targetCid: null, optionIndex: 0 });
          } else {
            // Toggle to Secondary if available
            const secondaryOpts = groupedMoves.ownSecondaryOptions.get(uiState.originCid);
            if (secondaryOpts && (secondaryOpts.splits.length > 0 || secondaryOpts.backstabbs.length > 0)) {
              setUiState({ type: 'own_secondary', originCid: uiState.originCid, allocations: [0, 0, 0, 0, 0, 0] });
              setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
            }
          }
        } else {
          // Click target
          const highlighted = engine.getOwnPrimaryHighlightedTiles(uiState.originCid, groupedMoves);
          if (highlighted.includes(cid)) {
            if (uiState.targetCid === cid) {
              // Cycle options for same target
              const options = engine.getOwnPrimaryOptions(uiState.originCid, cid, groupedMoves);
              if (options.length > 1) {
                const newIndex = ((uiState.optionIndex + d) % options.length + options.length) % options.length;
                setOptionIndex(newIndex);
                setUiState({ ...uiState, optionIndex: newIndex });
              }
            } else {
              // Select new target
              const options = engine.getOwnPrimaryOptions(uiState.originCid, cid, groupedMoves);
              if (options.length > 0) {
                setUiState({ ...uiState, targetCid: cid, optionIndex: 0 });
                setOptionIndex(0);
              }
            }
          } else {
            // Clicked non-clickable tile - reset to idle
            setUiState({ type: 'idle' });
            setOptionIndex(0);
            setEmptyDonors(new Map());
            setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
          }
        }
        break;
      }
      
      case 'own_secondary': {
        if (cid === uiState.originCid) {
          // Click origin
          const hasAllocations = secondaryAllocations.some(a => a > 0);
          if (hasAllocations) {
            // Clear allocations
            setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
          } else {
            // Toggle back to Primary
            const primaryOpts = groupedMoves.ownPrimaryOptions.get(uiState.originCid);
            if (primaryOpts && (primaryOpts.moves.length > 0 || primaryOpts.kills.length > 0 || 
                primaryOpts.enslaves.length > 0 || primaryOpts.tribunAttack.length > 0)) {
              setUiState({ type: 'own_primary', originCid: uiState.originCid, targetCid: null, optionIndex: 0 });
            }
          }
        } else {
          // Click neighbor - cycle allocation
          // Find direction from origin to neighbor
          let dir = -1;
          const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
          const { x: nx, y: ny } = engine.decodeCoord(cid);
          const dx = nx - ox;
          const dy = ny - oy;
          
          // Check against neighbor vectors: [1,1], [1,0], [0,1], [-1,-1], [-1,0], [0,-1]
          if (dx === 1 && dy === 1) dir = 0;
          else if (dx === 1 && dy === 0) dir = 1;
          else if (dx === 0 && dy === 1) dir = 2;
          else if (dx === -1 && dy === -1) dir = 3;
          else if (dx === -1 && dy === 0) dir = 4;
          else if (dx === 0 && dy === -1) dir = 5;
          
          if (dir >= 0) {
            const allowed = engine.getAllowedAllocationValues(uiState.originCid, dir, secondaryAllocations, gameState);
            const current = secondaryAllocations[dir];
            const currentIndex = allowed.indexOf(current);
            const nextIndex = ((currentIndex + d) % allowed.length + allowed.length) % allowed.length;
            const newValue = allowed[nextIndex];
            
            const newAllocations = [...secondaryAllocations];
            newAllocations[dir] = newValue;
            setSecondaryAllocations(newAllocations);
          } else {
            // Clicked non-clickable tile - reset to idle
            setUiState({ type: 'idle' });
            setOptionIndex(0);
            setEmptyDonors(new Map());
            setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
          }
        }
        break;
      }
    }
  };

  const getPendingAction = (): number | null => {
    if (!gameState || !groupedMoves) return null;
    
    let action: number | null = null;
    
    switch (uiState.type) {
      case 'enemy': {
        const options = engine.getEnemyOptions(uiState.targetCid, groupedMoves);
        if (options.length > 0 && uiState.optionIndex < options.length) {
          action = options[uiState.optionIndex];
        }
        break;
      }
      
      case 'empty': {
        const options = engine.getEmptyStateOptions(uiState.centerCid, emptyDonors, gameState, groupedMoves);
        if (options.length > 0 && optionIndex < options.length) {
          action = options[optionIndex];
        }
        break;
      }
      
      case 'own_primary': {
        if (uiState.targetCid !== null) {
          const options = engine.getOwnPrimaryOptions(uiState.originCid, uiState.targetCid, groupedMoves);
          if (options.length > 0 && uiState.optionIndex < options.length) {
            action = options[uiState.optionIndex];
          }
        }
        break;
      }
      
      case 'own_secondary': {
        action = engine.getOwnSecondaryPendingAction(uiState.originCid, secondaryAllocations, groupedMoves, gameState);
        break;
      }
    }
    
    return action;
  };

  const submitCurrentAction = () => {
    const action = getPendingAction();
    if (action !== null) {
      sendAction(action);
    }
  };

  // Get preview state by applying pending action
  const getPreviewState = (): engine.State | null => {
    if (!gameState || !groupedMoves) return null;
    
    const pendingAction = getPendingAction();
    if (pendingAction === null) return null;
    
    try {
      // Apply the action to get preview state
      const previewState = engine.applyAction(gameState, pendingAction);
      return previewState;
    } catch (error) {
      // If action can't be applied (shouldn't happen for valid pending actions), return null
      return null;
    }
  };

  const renderBoard = () => {
    if (!gameState) return null;

    // Get preview state if there's a pending action
    const previewState = getPreviewState();
    const displayState = previewState || gameState;

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

    // Determine clickable and highlighted tiles using UI backend
    // Use actual gameState for UI logic, not preview state
    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    let clickableTiles: number[] = [];
    let highlightedTiles: number[] = [];
    let selectedTiles: number[] = [];
    
    if (isActive && groupedMoves) {
      clickableTiles = engine.getClickableTiles(gameState, uiState, groupedMoves);
      
      // Determine selected tiles based on UI state
      switch (uiState.type) {
        case 'enemy':
          selectedTiles = [uiState.targetCid];
          break;
        case 'empty':
          selectedTiles = [uiState.centerCid];
          break;
        case 'own_primary':
          selectedTiles = [uiState.originCid];
          if (uiState.targetCid !== null) {
            selectedTiles.push(uiState.targetCid);
          }
          highlightedTiles = engine.getOwnPrimaryHighlightedTiles(uiState.originCid, groupedMoves);
          break;
        case 'own_secondary':
          selectedTiles = [uiState.originCid];
          break;
      }
    }

    const tiles: JSX.Element[] = validTiles.map(({ cid, x, y }) => {
      const unit = engine.unitByteToUnit(displayState.board[cid]);

      // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = y - x
      // Position of (0,0) is at (0,0)
      // Apply spacing multiplier to add gaps between hexagons
      const z = y - x;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (x + y) * d; // d = sqrt(3)/2 * size (already scaled)
      // Calculate actual left/top position relative to container
      const hexX = centerX - outerHexWidth / 2 - minPixelX;
      const hexY = centerY - outerHexHeight / 2 - minPixelY;

      // Determine hexagon state and color using UI backend
      const baseColor = getBaseColor(x, y);
      let hexagonState: HexagonState = 'default';
      
      if (isActive && groupedMoves) {
        const isClickable = clickableTiles.includes(cid);
        const isHighlighted = highlightedTiles.includes(cid);
        const isSelected = selectedTiles.includes(cid);
        
        // Priority: selected > highlighted > clickable > default
        if (isSelected) {
          hexagonState = 'selected';
        } else if (isHighlighted) {
          hexagonState = 'interactable';
        } else if (isClickable) {
          hexagonState = 'selectable';
        }
      }
      
      const tileColor = getHexagonColor(baseColor, hexagonState);
      const isClickable = isActive && groupedMoves && clickableTiles.includes(cid);

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
            cursor: isClickable ? 'pointer' : 'default',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (isClickable) {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.zIndex = '10';
              setHoveredCid(cid);
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.zIndex = '1';
            setHoveredCid(null);
          }}
          onClick={(e) => {
            if (groupedMoves) {
              if (isClickable) {
                // Left click: d = +1
                handleTileClick(cid, 1);
              } else if (uiState.type !== 'idle') {
                // Click unselectable tile when not in idle - reset to idle
                setUiState({ type: 'idle' });
                setOptionIndex(0);
                setEmptyDonors(new Map());
                setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (groupedMoves) {
              if (isClickable) {
                // Right click: d = -1
                handleTileClick(cid, -1);
              } else if (uiState.type !== 'idle') {
                // Right click unselectable tile when not in idle - reset to idle
                setUiState({ type: 'idle' });
                setOptionIndex(0);
                setEmptyDonors(new Map());
                setSecondaryAllocations([0, 0, 0, 0, 0, 0]);
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
            <div style={{ marginBottom: '10px' }}>
              <strong>UI State:</strong> {uiState.type}
              {uiState.type === 'enemy' && ` (target: ${uiState.targetCid}, option: ${uiState.optionIndex})`}
              {uiState.type === 'empty' && ` (center: ${uiState.centerCid}, donors: ${emptyDonors.size})`}
              {uiState.type === 'own_primary' && ` (origin: ${uiState.originCid}, target: ${uiState.targetCid ?? 'none'}, option: ${uiState.optionIndex})`}
              {uiState.type === 'own_secondary' && ` (origin: ${uiState.originCid}, allocations: [${secondaryAllocations.join(',')}])`}
            </div>
            {(() => {
              const pendingAction = getPendingAction();
              const canSubmit = pendingAction !== null && role !== 'spectator';
              
              if (canSubmit) {
                return (
                  <button
                    onClick={() => submitCurrentAction()}
                    style={{
                      padding: '8px 16px',
                      background: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold',
                    }}
                  >
                    Submit Action
                  </button>
                );
              }
              return null;
            })()}
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
