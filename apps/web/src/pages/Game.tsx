import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as engine from '@tribunplay/engine';
import { getHexagonColor, getBaseColor, type HexagonState } from '../hexagonColors';
import { LegalBloomValidator, type LegalValidatorMessage } from '../net/LegalBloom';
import { buildCache } from '../ui/cache/buildCache';
import type { UiMoveCache } from '../ui/cache/UiMoveCache';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
type Role = 'black' | 'white' | 'spectator';
type EmptyCache = UiMoveCache['empty'] extends Map<any, infer T> ? T : never;

type EmptySymmetryState = {
  mode: 'sym3+' | 'sym3-' | 'sym6';
  donate: number;
  savedDonors: Map<number, number>;
  donorCids: number[];
};

type UIState =
  | { type: 'idle' }
  | { type: 'enemy'; targetCid: number; optionIndex: number }
  | { type: 'empty'; centerCid: number; donors: Map<number, number>; optionIndex: number; symmetry?: EmptySymmetryState }
  | { type: 'own_primary'; originCid: number; targetCid: number | null; optionIndex: number }
  | { type: 'own_secondary'; originCid: number; allocations: number[] };

interface GameSnapshot {
  boardB64: string;
  turn: engine.Color;
  ply: number;
  drawOfferBy: engine.Color | null;
}

const NEIGHBOR_VECTORS = [
  [1, 1],
  [1, 0],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [0, -1],
] as const;

const VALID_HEIGHTS = new Set([0, 1, 2, 3, 4, 6, 8]);
const VALID_SPLIT_HEIGHTS = new Set([0, 1, 2, 3, 4, 6]);

export default function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [gameState, setGameState] = useState<engine.State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  
  // UI State Machine
  const [uiState, setUiState] = useState<UIState>({ type: 'idle' });
  const [validator, setValidator] = useState<LegalBloomValidator | null>(null);
  
  const cache = useMemo(() => {
    if (!gameState || !validator) return null;
    return buildCache(gameState, validator);
  }, [gameState, validator]);

  useEffect(() => {
    if (!gameState || !cache) {
      if (uiState.type !== 'idle') {
        setUiState({ type: 'idle' });
      }
      return;
    }

    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    if (!isActive && uiState.type !== 'idle') {
      setUiState({ type: 'idle' });
      return;
    }

    setUiState((prevState) => {
      switch (prevState.type) {
        case 'idle':
          return prevState;
        case 'enemy': {
          const enemyCache = cache.enemy.get(prevState.targetCid);
          if (!enemyCache) return { type: 'idle' };
          if (enemyCache.options.length === 0) return { type: 'idle' };
          const optionIndex = Math.min(prevState.optionIndex, enemyCache.options.length - 1);
          if (optionIndex === prevState.optionIndex) return prevState;
          return { ...prevState, optionIndex };
        }
        case 'empty': {
          const emptyCache = cache.empty.get(prevState.centerCid);
          if (!emptyCache) return { type: 'idle' };
          const donors = new Map<number, number>();
          for (const [cid, display] of prevState.donors.entries()) {
            if (emptyCache.donorRules.has(cid)) {
              donors.set(cid, display);
            }
          }
          let symmetry = prevState.symmetry;
          if (symmetry) {
            const allowed = emptyCache.allowedSymmetricDonations(symmetry.mode);
            const donorSet = new Set(symmetry.donorCids);
            const donorsValid = symmetry.donorCids.every((cid) => emptyCache.donorRules.has(cid));
            const donorCountValid =
              (symmetry.mode === 'sym6' && symmetry.donorCids.length === 6) ||
              (symmetry.mode !== 'sym6' && symmetry.donorCids.length === 3);
            if (!donorsValid || !donorCountValid || !allowed.includes(symmetry.donate)) {
              symmetry = undefined;
            } else {
              symmetry = {
                ...symmetry,
                donorCids: Array.from(donorSet),
              };
            }
          }
          if (donors.size === prevState.donors.size && symmetry === prevState.symmetry) {
            return prevState;
          }
          return {
            type: 'empty',
            centerCid: prevState.centerCid,
            donors,
            optionIndex: 0,
            symmetry,
          };
        }
        case 'own_primary': {
          const primaryCache = cache.ownPrimary.get(prevState.originCid);
          if (!primaryCache) return { type: 'idle' };
          if (prevState.targetCid === null) {
            return prevState.optionIndex === 0 ? prevState : { ...prevState, optionIndex: 0 };
          }
          const targetOptions = primaryCache.targets.get(prevState.targetCid);
          if (!targetOptions || targetOptions.options.length === 0) {
            return { ...prevState, targetCid: null, optionIndex: 0 };
          }
          const optionIndex = Math.min(prevState.optionIndex, targetOptions.options.length - 1);
          if (optionIndex === prevState.optionIndex) return prevState;
          return { ...prevState, optionIndex };
        }
        case 'own_secondary': {
          const secondaryCache = cache.ownSecondary.get(prevState.originCid);
          if (!secondaryCache) return { type: 'idle' };
          if (secondaryCache.split.emptyAdjDirs.length === 0) return { type: 'idle' };
          return prevState;
        }
      }
    });
  }, [gameState, cache, role, uiState.type]);
  
  const baseTileStates = useMemo(() => {
    const baseStates: Array<'default' | 'selectable'> = new Array(121).fill('default');
    if (!gameState || !cache) return baseStates;
    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    if (!isActive) return baseStates;
    
    // Build idle clickable from cache - only include tiles that actually have moves
    const idleClickable: number[] = [];
    
    // Enemy tiles with attack options
    for (const cid of cache.enemy.keys()) {
      idleClickable.push(cid);
    }
    
    // Empty tiles with combine options
    for (const cid of cache.empty.keys()) {
      idleClickable.push(cid);
    }
    
    // Own tiles with primary moves (must have targets)
    for (const cid of cache.ownPrimary.keys()) {
      const primaryCache = cache.ownPrimary.get(cid);
      if (primaryCache && primaryCache.targets.size > 0) {
        idleClickable.push(cid);
      }
    }
    
    // Own tiles with secondary moves (must have empty adjacent tiles)
    for (const cid of cache.ownSecondary.keys()) {
      const secondaryCache = cache.ownSecondary.get(cid);
      if (secondaryCache && secondaryCache.split.emptyAdjDirs.length > 0) {
        // Only add if not already added as primary (avoid duplicates)
        if (!idleClickable.includes(cid)) {
          idleClickable.push(cid);
        }
      }
    }
    
    for (const cid of idleClickable) {
      baseStates[cid] = 'selectable';
    }
    return baseStates;
  }, [gameState, cache, role]);
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

    const requestSync = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ t: 'sync_req' }));
      }
    };

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
              try {
                for (const action of actions) {
                  currentState = engine.applyAction(currentState, action);
                }
                setGameState(currentState);
                setUiState({ type: 'idle' });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to apply actions');
                setGameState(state);
                setUiState({ type: 'idle' });
              }
            } else if (message.t === 'legal') {
              // Bloom filter validator update
              const legalMsg = message as LegalValidatorMessage;
              const newValidator = new LegalBloomValidator(legalMsg.bloom, legalMsg.ply);
              setValidator(newValidator);
            } else if (message.t === 'error') {
              setError(message.message);
              setUiState({ type: 'idle' });
            }
          } else if (event.data instanceof ArrayBuffer && event.data.byteLength === 4) {
            // Binary action word
            const view = new DataView(event.data);
            const actionWord = view.getUint32(0, true);

            try {
              setGameState((prevState) => {
                if (!prevState) return prevState;
                return engine.applyAction(prevState, actionWord);
              });
              setUiState({ type: 'idle' });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to apply action');
              setUiState({ type: 'idle' });
              requestSync();
            }
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

    if (!validator || (validator.getPly() === gameState?.ply && !validator.isProbablyLegal(action))) {
      setError('Action is not legal');
      return;
    }

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, action, true);
    wsRef.current.send(buffer);
    
    // UI state will be reset when action is applied via WebSocket
  };

  const cycleIndex = (currentIndex: number, delta: number, length: number) => {
    if (length <= 0) return 0;
    return ((currentIndex + delta) % length + length) % length;
  };

  const getNeighborDirection = (centerCid: number, neighborCid: number): number | null => {
    try {
      const { x: cx, y: cy } = engine.decodeCoord(centerCid);
      const { x: nx, y: ny } = engine.decodeCoord(neighborCid);
      const dx = nx - cx;
      const dy = ny - cy;
      for (let dir = 0; dir < NEIGHBOR_VECTORS.length; dir++) {
        const [vx, vy] = NEIGHBOR_VECTORS[dir];
        if (vx === dx && vy === dy) return dir;
      }
    } catch {
      return null;
    }
    return null;
  };

  const isValidHeight = (value: number): boolean => VALID_HEIGHTS.has(value);

  const isValidSplitHeight = (value: number): boolean => VALID_SPLIT_HEIGHTS.has(value);

  const isSlavePropertySatisfied = (primary: number, secondary: number): boolean => {
    if (secondary <= 0 || primary <= 0) return true;
    return primary <= 4 && 2 * primary >= secondary;
  };

  const isDonationResultValid = (unit: engine.Unit, donate: number): boolean => {
    if (donate <= 0 || donate > unit.p) return false;
    if (unit.tribun && donate !== unit.p) return false;
    const remaining = unit.p - donate;
    if (!isValidHeight(remaining)) return false;
    if (!isSlavePropertySatisfied(remaining, unit.s)) return false;
    return true;
  };

  const getDonorDisplayHeight = (
    emptyCache: EmptyCache,
    donors: Map<number, number>,
    donorCid: number,
    symmetry?: EmptySymmetryState
  ): number | null => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    if (symmetry && symmetry.donorCids.includes(donorCid)) {
      return rule.actualPrimary - symmetry.donate;
    }
    return donors.get(donorCid) ?? rule.actualPrimary;
  };

  const getDonorDonation = (
    emptyCache: EmptyCache,
    donors: Map<number, number>,
    donorCid: number,
    symmetry?: EmptySymmetryState
  ): number | null => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    const displayHeight = getDonorDisplayHeight(emptyCache, donors, donorCid, symmetry);
    if (displayHeight === null) return null;
    return rule.actualPrimary - displayHeight;
  };

  const getParticipatingDonors = (
    emptyCache: EmptyCache,
    donors: Map<number, number>,
    symmetry?: EmptySymmetryState
  ): Array<{ cid: number; donate: number }> => {
    const participating: Array<{ cid: number; donate: number }> = [];
    for (const donorCid of emptyCache.donorCids) {
      const donate = getDonorDonation(emptyCache, donors, donorCid, symmetry);
      if (donate && donate > 0) {
        participating.push({ cid: donorCid, donate });
      }
    }
    return participating;
  };

  const getDonationOptions = (
    emptyCache: EmptyCache,
    donorCid: number
  ): number[] => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return [];
    const options: number[] = [];
    for (const displayHeight of rule.allowedDisplayedHeights) {
      const donate = rule.actualPrimary - displayHeight;
      if (donate > 0) {
        options.push(donate);
      }
    }
    return options;
  };

  const canPairWithAnyDonations = (
    emptyCache: EmptyCache,
    donorCidA: number,
    donorCidB: number
  ): boolean => {
    const optionsA = getDonationOptions(emptyCache, donorCidA);
    const optionsB = getDonationOptions(emptyCache, donorCidB);
    if (optionsA.length === 0 || optionsB.length === 0) return false;
    for (const donateA of optionsA) {
      for (const donateB of optionsB) {
        if (emptyCache.canPair(donorCidA, donorCidB, donateA, donateB)) {
          return true;
        }
      }
    }
    return false;
  };

  const applySymmetryDonations = (
    emptyCache: EmptyCache,
    baseDonors: Map<number, number>,
    donorCids: number[],
    donate: number
  ): Map<number, number> => {
    const next = new Map(baseDonors);
    for (const donorCid of donorCids) {
      const rule = emptyCache.donorRules.get(donorCid);
      if (!rule) continue;
      next.set(donorCid, rule.actualPrimary - donate);
    }
    return next;
  };

  const handleTileClick = (cid: number, d: number = 1) => {
    if (!gameState || !cache) return;
    
    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    if (!isActive) return;

    setUiState((prevState) => {
      switch (prevState.type) {
        case 'idle': {
          // Check cache to determine which state to enter
          if (cache.enemy.has(cid)) {
            const enemyCache = cache.enemy.get(cid)!;
            return { type: 'enemy', targetCid: cid, optionIndex: 0 };
          }
          if (cache.empty.has(cid)) {
            return { type: 'empty', centerCid: cid, donors: new Map(), optionIndex: 0 };
          }
          
          // For own units, check which state has moves and prefer that one
          const ownPrimaryCache = cache.ownPrimary.get(cid);
          const ownSecondaryCache = cache.ownSecondary.get(cid);
          
          // Check if primary has actual moves (targets)
          const hasPrimaryMoves = ownPrimaryCache && ownPrimaryCache.targets.size > 0;
          // Check if secondary has moves (empty adjacent tiles for split/backstabb)
          const hasSecondaryMoves = ownSecondaryCache && ownSecondaryCache.split.emptyAdjDirs.length > 0;
          
          if (hasPrimaryMoves) {
            return { type: 'own_primary', originCid: cid, targetCid: null, optionIndex: 0 };
          }
          if (hasSecondaryMoves) {
            return { type: 'own_secondary', originCid: cid, allocations: [0, 0, 0, 0, 0, 0] };
          }
          
          return prevState;
        }
        
        case 'enemy': {
          if (cid !== prevState.targetCid) {
            return { type: 'idle' };
          }
          const enemyCache = cache.enemy.get(prevState.targetCid);
          if (!enemyCache || enemyCache.options.length === 0) return prevState;
          const newIndex = cycleIndex(prevState.optionIndex, d, enemyCache.options.length);
          return { ...prevState, optionIndex: newIndex };
        }
        
        case 'empty': {
          if (cid === prevState.centerCid) {
            return { ...prevState, donors: new Map(), optionIndex: 0, symmetry: undefined };
          }
          const emptyCache = cache.empty.get(prevState.centerCid);
          if (!emptyCache) return { type: 'idle' };
          
          const donorRule = emptyCache.donorRules.get(cid);
          if (!donorRule) return { type: 'idle' };

          if (prevState.symmetry) {
            if (!prevState.symmetry.donorCids.includes(cid)) {
              return { type: 'idle' };
            }
            const allowed = emptyCache.allowedSymmetricDonations(prevState.symmetry.mode);
            const currentIndex = allowed.indexOf(prevState.symmetry.donate);
            const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, d, allowed.length);
            const nextDonate = allowed[nextIndex];

            if (nextDonate === 0) {
              return {
                type: 'empty',
                centerCid: prevState.centerCid,
                donors: new Map(prevState.symmetry.savedDonors),
                optionIndex: 0,
              };
            }

            const nextDonors = applySymmetryDonations(
              emptyCache,
              prevState.symmetry.savedDonors,
              prevState.symmetry.donorCids,
              nextDonate
            );

            return {
              ...prevState,
              donors: nextDonors,
              optionIndex: 0,
              symmetry: { ...prevState.symmetry, donate: nextDonate },
            };
          }
          
          const validValues = donorRule.allowedDisplayedHeights;
          const currentDisp = prevState.donors.get(cid) ?? donorRule.actualPrimary;
          const currentIndex = validValues.indexOf(currentDisp);
          const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, d, validValues.length);
          const newDisp = validValues[nextIndex];
          const currentDonate = donorRule.actualPrimary - currentDisp;
          const nextDonate = donorRule.actualPrimary - newDisp;
          const participating = getParticipatingDonors(emptyCache, prevState.donors, prevState.symmetry);
          const otherParticipating = participating.filter((entry) => entry.cid !== cid);
          const isCurrentlyParticipating = currentDonate > 0;
          
          if (!isCurrentlyParticipating && nextDonate > 0) {
            if (otherParticipating.length === 1) {
              if (!canPairWithAnyDonations(emptyCache, otherParticipating[0].cid, cid)) {
                return { type: 'idle' };
              }
            } else if (otherParticipating.length === 2) {
              const symmetryMode = emptyCache.symmetryModeForThird([
                otherParticipating[0].cid,
                otherParticipating[1].cid,
                cid,
              ]);
              if (symmetryMode === null) {
                return { type: 'idle' };
              }
              const symmetryDonorCids =
                symmetryMode === 'sym6' ? [...emptyCache.donorCids] : [
                  otherParticipating[0].cid,
                  otherParticipating[1].cid,
                  cid,
                ];
              const allowed = emptyCache.allowedSymmetricDonations(symmetryMode);
              const defaultDonate = allowed.includes(nextDonate)
                ? nextDonate
                : (allowed.find((value) => value > 0) ?? 0);
              if (defaultDonate <= 0) {
                return { type: 'idle' };
              }
              const savedDonors = new Map(prevState.donors);
              const nextDonors = applySymmetryDonations(
                emptyCache,
                savedDonors,
                symmetryDonorCids,
                defaultDonate
              );
              return {
                type: 'empty',
                centerCid: prevState.centerCid,
                donors: nextDonors,
                optionIndex: 0,
                symmetry: {
                  mode: symmetryMode,
                  donate: defaultDonate,
                  savedDonors,
                  donorCids: symmetryDonorCids,
                },
              };
            } else if (otherParticipating.length >= 3) {
              return { type: 'idle' };
            }
          }

          const newDonors = new Map(prevState.donors);
          newDonors.set(cid, newDisp);
          return { ...prevState, donors: newDonors, optionIndex: 0 };
        }
        
        case 'own_primary': {
          if (cid === prevState.originCid) {
            if (prevState.targetCid !== null) {
              return { ...prevState, targetCid: null, optionIndex: 0 };
            }
            const primaryCache = cache.ownPrimary.get(prevState.originCid);
            const secondaryCache = cache.ownSecondary.get(prevState.originCid);
            const hasSecondaryMoves = secondaryCache && secondaryCache.split.emptyAdjDirs.length > 0;
            
            if (hasSecondaryMoves && primaryCache?.canEnterSecondary) {
              return { type: 'own_secondary', originCid: prevState.originCid, allocations: [0, 0, 0, 0, 0, 0] };
            }
            return prevState;
          }
          const primaryCache = cache.ownPrimary.get(prevState.originCid);
          if (!primaryCache || !primaryCache.highlighted.has(cid)) {
            return { type: 'idle' };
          }
          const targetOptions = primaryCache.targets.get(cid);
          if (!targetOptions || targetOptions.options.length === 0) return prevState;
          if (prevState.targetCid === cid) {
            if (targetOptions.options.length <= 1) return prevState;
            const newIndex = cycleIndex(prevState.optionIndex, d, targetOptions.options.length);
            return { ...prevState, optionIndex: newIndex };
          }
          const initialIndex = d === -1 ? targetOptions.options.length - 1 : 0;
          return { ...prevState, targetCid: cid, optionIndex: initialIndex };
        }
        
        case 'own_secondary': {
          if (cid === prevState.originCid) {
            const hasAllocations = prevState.allocations.some(value => value > 0);
            if (hasAllocations) {
              return { ...prevState, allocations: [0, 0, 0, 0, 0, 0] };
            }
            const primaryCache = cache.ownPrimary.get(prevState.originCid);
            const hasPrimaryMoves = primaryCache && primaryCache.targets.size > 0;
            if (!hasPrimaryMoves) {
              return prevState;
            }
            return { type: 'own_primary', originCid: prevState.originCid, targetCid: null, optionIndex: 0 };
          }
          const dir = getNeighborDirection(prevState.originCid, cid);
          if (dir === null) {
            return { type: 'idle' };
          }
          const secondaryCache = cache.ownSecondary.get(prevState.originCid);
          if (!secondaryCache || !secondaryCache.split.emptyAdjDirs.includes(dir)) {
            return { type: 'idle' };
          }
          const allowed = secondaryCache.split.allowedAllocValues(dir, prevState.allocations);
          const current = prevState.allocations[dir];
          const currentIndex = allowed.indexOf(current);
          const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, d, allowed.length);
          const newValue = allowed[nextIndex];
          const newAllocations = [...prevState.allocations];
          newAllocations[dir] = newValue;
          return { ...prevState, allocations: newAllocations };
        }
      }
    });
  };

  const getEmptyStateAction = (): number | null => {
    if (!gameState || !cache || uiState.type !== 'empty') return null;
    
    const centerCid = uiState.centerCid;
    const emptyCache = cache.empty.get(centerCid);
    if (!emptyCache) return null;

    if (uiState.symmetry) {
      if (uiState.symmetry.donate <= 0) return null;
      const totalDonation = uiState.symmetry.donate * uiState.symmetry.donorCids.length;
      if (!isValidHeight(totalDonation) || totalDonation <= 0) return null;
      let baseUnit: engine.Unit | null = null;
      for (const donorCid of uiState.symmetry.donorCids) {
        const unit = engine.unitByteToUnit(gameState.board[donorCid]);
        if (!unit || unit.color !== gameState.turn) return null;
        if (unit.tribun) return null;
        if (!isDonationResultValid(unit, uiState.symmetry.donate)) return null;
        if (!baseUnit) {
          baseUnit = unit;
        } else if (unit.p !== baseUnit.p || unit.s !== baseUnit.s || unit.color !== baseUnit.color) {
          return null;
        }
      }
      return emptyCache.constructSymCombineAction(uiState.symmetry.mode, uiState.symmetry.donate);
    }

    const participating = getParticipatingDonors(emptyCache, uiState.donors, uiState.symmetry);

    if (participating.length === 2) {
      const [a, b] = participating;
      const unitA = engine.unitByteToUnit(gameState.board[a.cid]);
      const unitB = engine.unitByteToUnit(gameState.board[b.cid]);
      if (!unitA || !unitB) return null;
      if (!isDonationResultValid(unitA, a.donate)) return null;
      if (!isDonationResultValid(unitB, b.donate)) return null;
      const totalDonation = a.donate + b.donate;
      if (!isValidHeight(totalDonation) || totalDonation <= 0) return null;
      return emptyCache.constructCombineAction(a.cid, b.cid, a.donate, b.donate);
    }

    if (participating.length === 3) {
      const donors = participating.map(p => p.cid);
      const mode = emptyCache.symmetryModeForThird(donors);
      if (mode === null || mode === 'sym6') return null;
      const donate = participating[0].donate;
      if (!participating.every(entry => entry.donate === donate)) return null;
      return emptyCache.constructSymCombineAction(mode, donate);
    }

    if (participating.length === 6) {
      const donate = participating[0].donate;
      if (!participating.every(entry => entry.donate === donate)) return null;
      return emptyCache.constructSymCombineAction('sym6', donate);
    }

    return null;
  };

  const getOwnSecondaryAction = (): number | null => {
    if (!gameState || !cache || uiState.type !== 'own_secondary') return null;

    const originCid = uiState.originCid;
    const secondaryCache = cache.ownSecondary.get(originCid);
    if (!secondaryCache) return null;

    const allocations = uiState.allocations;
    
    // Check if remaining is valid
    if (!secondaryCache.split.isRemainingValid(allocations)) {
      return null;
    }

    // Check for backstabb first
    const backstabbAction = secondaryCache.split.deriveBackstabbAction(allocations);
    if (backstabbAction !== null) {
      return backstabbAction;
    }

    if (allocations.some(value => value > 0 && value >= originUnit.p)) {
      return null;
    }

    if (allocations.some(value => !isValidSplitHeight(value))) {
      return null;
    }

    const totalAllocated = allocations.reduce((a, b) => a + b, 0);
    const remainder = originUnit.p - totalAllocated;
    if (remainder < 0 || !isValidHeight(remainder)) {
      return null;
    }

    const unitCount = allocations.filter((value) => value > 0).length + (remainder > 0 ? 1 : 0);
    if (unitCount < 2) {
      return null;
    }

    // Otherwise construct split action
    return secondaryCache.split.constructSplitAction(allocations);
  };

  const getPendingAction = (): number | null => {
    if (!gameState || !cache) return null;
    
    let action: number | null = null;
    
    switch (uiState.type) {
      case 'enemy': {
        const enemyCache = cache.enemy.get(uiState.targetCid);
        if (enemyCache && enemyCache.options.length > 0 && uiState.optionIndex < enemyCache.options.length) {
          action = enemyCache.options[uiState.optionIndex];
        }
        break;
      }
      
      case 'empty': {
        action = getEmptyStateAction();
        break;
      }
      
      case 'own_primary': {
        if (uiState.targetCid !== null) {
          const primaryCache = cache.ownPrimary.get(uiState.originCid);
          if (primaryCache) {
            const targetOptions = primaryCache.targets.get(uiState.targetCid);
            if (targetOptions && targetOptions.options.length > 0 && uiState.optionIndex < targetOptions.options.length) {
              action = targetOptions.options[uiState.optionIndex];
            }
          }
        }
        break;
      }
      
      case 'own_secondary': {
        action = getOwnSecondaryAction();
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

  type PreviewOverlayUnit = { p: number; color: engine.Color; tribun: boolean };
  type PreviewOverlay = { units: Map<number, PreviewOverlayUnit>; empty: Set<number> };

  const getPreviewOverlay = (): PreviewOverlay | null => {
    if (!gameState) return null;
    
    if (uiState.type === 'empty') {
      const centerCid = uiState.centerCid;
      if (!cache) return null;
      const emptyCache = cache.empty.get(centerCid);
      if (!emptyCache) return null;
      const donors = emptyCache.donorCids;
      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      let totalDonation = 0;
      let tribunTransferred = false;
      let hasParticipation = false;

      for (const cid of donors) {
        const donorRule = emptyCache.donorRules.get(cid);
        if (!donorRule) continue;
        const hDisp = getDonorDisplayHeight(emptyCache, uiState.donors, cid, uiState.symmetry);
        if (hDisp === null) continue;
        const donate = donorRule.actualPrimary - hDisp;
        if (donate > 0) {
          const unit = engine.unitByteToUnit(gameState.board[cid]);
          if (!unit) continue;
          hasParticipation = true;
          totalDonation += donate;
          const remaining = unit.p - donate;
          if (remaining > 0) {
            overlay.units.set(cid, {
              p: remaining,
              color: unit.color,
              tribun: unit.tribun,
            });
          } else {
            overlay.empty.add(cid);
          }
          if (unit.tribun && donate === unit.p) {
            tribunTransferred = true;
          }
        }
      }

      if (!hasParticipation) return null;

      if (totalDonation > 0) {
        overlay.units.set(centerCid, {
          p: totalDonation,
          color: gameState.turn,
          tribun: tribunTransferred,
        });
      }

      return overlay;
    }

    if (uiState.type === 'own_secondary') {
      const originCid = uiState.originCid;
      const originUnit = engine.unitByteToUnit(gameState.board[originCid]);
      if (!originUnit) return null;

      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      const allocations = uiState.allocations;
      const totalAllocated = allocations.reduce((a, b) => a + b, 0);
      const remainder = originUnit.p - totalAllocated;

      if (totalAllocated === originUnit.p && originUnit.s > 0) {
        const nonzeroCount = allocations.filter((a) => a > 0).length;
        if (nonzeroCount === 1) {
          const dir = allocations.findIndex((a) => a > 0);
          const { x: ox, y: oy } = engine.decodeCoord(originCid);
          const [dx, dy] = NEIGHBOR_VECTORS[dir];
          try {
            const targetCid = engine.encodeCoord(ox + dx, oy + dy);
            overlay.units.set(targetCid, {
              p: originUnit.p,
              color: originUnit.color,
              tribun: originUnit.tribun,
            });
            overlay.empty.add(originCid);
            return overlay;
          } catch {
            return null;
          }
        }
      }

      const { x: ox, y: oy } = engine.decodeCoord(originCid);
      for (let dir = 0; dir < 6; dir++) {
        if (allocations[dir] > 0) {
          const [dx, dy] = NEIGHBOR_VECTORS[dir];
          try {
            const targetCid = engine.encodeCoord(ox + dx, oy + dy);
            overlay.units.set(targetCid, {
              p: allocations[dir],
              color: originUnit.color,
              tribun: false,
            });
          } catch {
            // Invalid coordinate, skip
          }
        }
      }

      if (remainder > 0) {
        overlay.units.set(originCid, {
          p: remainder,
          color: originUnit.color,
          tribun: originUnit.tribun,
        });
      } else {
        overlay.empty.add(originCid);
      }

      return overlay;
    }

    return null;
  };

  // Get preview state by applying pending action
  const getPreviewState = (): engine.State | null => {
    if (!gameState) return null;
    
    if (!cache) return null;
    
    // For other states, use existing getPendingAction logic
    const pendingAction = getPendingAction();
    if (pendingAction === null) return null;
    
    try {
      // Apply the action to get preview state
      const previewState = engine.applyAction(gameState, pendingAction);
      return previewState;
    } catch (error) {
      // If action can't be applied, return null
      return null;
    }
  };

  const renderBoard = () => {
    if (!gameState) return null;

    const previewOverlay = getPreviewOverlay();
    const previewState = previewOverlay ? null : getPreviewState();
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
    
    // Always recalculate from scratch on every render to ensure no stale state
    // This ensures interactable tiles are properly cleaned up on state transitions
    // Initialize arrays fresh on every render - never reuse previous values
    // This guarantees that interactable tiles are recalculated based on current uiState
    const selectedTiles: number[] = [];
    const interactableTiles: number[] = [];
    
    if (isActive && cache) {
      switch (uiState.type) {
        case 'idle':
          break;
          
        case 'enemy':
          // Selected: the target enemy tile
          selectedTiles.push(uiState.targetCid);
          break;
          
        case 'empty':
          // Selected: the center tile
          selectedTiles.push(uiState.centerCid);
          // Interactable: donor tiles (tiles that can donate to center)
          const emptyCache = cache.empty.get(uiState.centerCid);
          if (emptyCache) {
            const participating = getParticipatingDonors(emptyCache, uiState.donors, uiState.symmetry);
            const interactableSet = new Set<number>();

            if (uiState.symmetry) {
              for (const donorCid of uiState.symmetry.donorCids) {
                interactableSet.add(donorCid);
              }
            } else {
              for (const entry of participating) {
                interactableSet.add(entry.cid);
              }

              if (participating.length === 0) {
                for (const donorCid of emptyCache.donorCids) {
                  interactableSet.add(donorCid);
                }
              } else if (participating.length === 1) {
                const participant = participating[0];
                for (const donorCid of emptyCache.donorCids) {
                  if (donorCid === participant.cid) {
                    interactableSet.add(donorCid);
                    continue;
                  }
                  if (canPairWithAnyDonations(emptyCache, participant.cid, donorCid)) {
                    interactableSet.add(donorCid);
                  }
                }
              } else if (participating.length === 2) {
                const [first, second] = participating;
                for (const donorCid of emptyCache.donorCids) {
                  if (donorCid === first.cid || donorCid === second.cid) {
                    interactableSet.add(donorCid);
                    continue;
                  }
                  const symmetryMode = emptyCache.symmetryModeForThird([
                    first.cid,
                    second.cid,
                    donorCid,
                  ]);
                  if (symmetryMode !== null) {
                    interactableSet.add(donorCid);
                  }
                }
              }
            }

            interactableTiles.push(...Array.from(interactableSet));
          }
          break;
          
        case 'own_primary':
          // Selected: origin tile, and target if selected
          selectedTiles.push(uiState.originCid);
          if (uiState.targetCid !== null) {
            selectedTiles.push(uiState.targetCid);
          }
          // Interactable: highlighted targets (move/kill/enslave/tribun targets), excluding origin
          const primaryCache = cache.ownPrimary.get(uiState.originCid);
          if (primaryCache) {
            const highlightedFiltered = Array.from(primaryCache.highlighted).filter(cid => cid !== uiState.originCid);
            interactableTiles.push(...highlightedFiltered);
          }
          break;
          
        case 'own_secondary':
          // Selected: origin tile
          selectedTiles.push(uiState.originCid);
          // Interactable: adjacent empty tiles (for split/backstabb targets)
          const secondaryCache = cache.ownSecondary.get(uiState.originCid);
          if (secondaryCache) {
            const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
            for (const dir of secondaryCache.split.emptyAdjDirs) {
              const [dx, dy] = NEIGHBOR_VECTORS[dir];
              try {
                const neighborCid = engine.encodeCoord(ox + dx, oy + dy);
                interactableTiles.push(neighborCid);
              } catch {
                // Invalid coordinate, skip
              }
            }
          }
          break;
      }
    }

    const selectedSet = new Set(selectedTiles);
    const interactableSet = new Set(interactableTiles);

    const splitOffsetX = 12;
    const splitOffsetY = 15;

    const tiles: JSX.Element[] = validTiles.map(({ cid, x, y }) => {
      const overlayUnit = previewOverlay?.units.get(cid);
      const unit: { p: number; color: engine.Color; tribun: boolean } | null = overlayUnit
        ? overlayUnit
        : previewOverlay?.empty.has(cid)
        ? null
        : engine.unitByteToUnit(displayState.board[cid]);

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
      // Explicitly determine state for each tile to ensure correctness
      const baseColor = getBaseColor(x, y);
      let hexagonState: HexagonState = baseTileStates[cid] ?? 'default';
      
      // Apply priority: selected > interactable > selectable > default
      if (selectedSet.has(cid)) {
        hexagonState = 'selected';
      } else if (interactableSet.has(cid)) {
        hexagonState = 'interactable';
      } else {
        hexagonState = baseTileStates[cid] ?? 'default';
      }
      
      const tileColor = getHexagonColor(baseColor, hexagonState);
      // Tile is clickable if it's selectable or interactable or selected (and we're in an active state)
      const isClickable = isActive && (
        selectedSet.has(cid) ||
        interactableSet.has(cid) ||
        (uiState.type === 'idle' && baseTileStates[cid] === 'selectable')
      );

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
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.zIndex = '1';
          }}
          onClick={() => {
            if (isClickable || (isActive && uiState.type === 'idle')) {
              // Left click: d = +1
              handleTileClick(cid, 1);
            } else if (uiState.type !== 'idle') {
              // Click unselectable tile when not in idle - reset to idle
              setUiState({ type: 'idle' });
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isClickable || (isActive && uiState.type === 'idle')) {
              // Right click: d = -1
              handleTileClick(cid, -1);
            } else if (uiState.type !== 'idle') {
              // Right click unselectable tile when not in idle - reset to idle
              setUiState({ type: 'idle' });
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
          {unit && (() => {
            const textColor = unit.tribun
              ? (unit.color === 0 ? '#AE0000' : '#00B4FF')
              : (unit.color === 0 ? '#000' : '#fff');
            const strokeColor = unit.tribun
            ? (unit.color === 0 ? '#000' : '#fff')
            : (unit.color === 0 ? '#fff' : '#000');
            const mainFontSize = unit.tribun ? 65 : 55;
            const splitFontSize = unit.tribun ? 50 : 45;

            if (unit.s > 0) {
              const primaryOffset = { x: -splitOffsetX, y: splitOffsetY };
              const secondaryOffset = { x: splitOffsetX, y: -splitOffsetY };
              const centerTransform = 'translate(-50%, -50%)';
              return (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `${centerTransform} translate(${primaryOffset.x}px, ${-primaryOffset.y}px)`,
                    transformOrigin: 'center',
                    fontSize: `${splitFontSize}px`,
                    fontWeight: 'bold',
                    color: textColor,
                    WebkitTextStroke: `1px ${strokeColor}`,
                    textStroke: `1px ${strokeColor}`,
                  }}>
                    {unit.p}
                  </div>
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `${centerTransform} translate(${secondaryOffset.x}px, ${-secondaryOffset.y}px)`,
                    transformOrigin: 'center',
                    fontSize: `${splitFontSize}px`,
                    fontWeight: 'bold',
                    color: strokeColor,
                    WebkitTextStroke: `1px ${textColor}`,
                    textStroke: `1px ${textColor}`,
                  }}>
                    {unit.s}
                  </div>
                </div>
              );
            }

            return (
              <div style={{
                fontSize: `${mainFontSize}px`,
                fontWeight: 'bold',
                color: textColor,
                WebkitTextStroke: `1px ${strokeColor}`,
                textStroke: `1px ${strokeColor}`,
              }}>
                {unit.p}
              </div>
            );
          })()}
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
              <strong>Validator Ply:</strong> {validator?.getPly() ?? 'none'}
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>UI State:</strong> {uiState.type}
              {uiState.type === 'enemy' && ` (target: ${uiState.targetCid}, option: ${uiState.optionIndex})`}
              {uiState.type === 'empty' && ` (center: ${uiState.centerCid}, donors: ${uiState.donors.size})`}
              {uiState.type === 'own_primary' && ` (origin: ${uiState.originCid}, target: ${uiState.targetCid ?? 'none'}, option: ${uiState.optionIndex})`}
              {uiState.type === 'own_secondary' && ` (origin: ${uiState.originCid}, allocations: [${uiState.allocations.join(',')}])`}
            </div>
            {(() => {
              const pendingAction = getPendingAction();
              const validatorAllows =
                validator &&
                (validator.getPly() !== gameState.ply || validator.isProbablyLegal(pendingAction ?? 0));
              const canSubmit = pendingAction !== null && validatorAllows && role !== 'spectator';
              
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

    </div>
  );
}
