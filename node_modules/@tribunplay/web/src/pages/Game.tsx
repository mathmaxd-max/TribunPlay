import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as engine from '@tribunplay/engine';
import { getHexagonColor, getBaseColor, type HexagonState } from '../hexagonColors';
import { LegalBloomValidator, type LegalValidatorMessage } from '../net/LegalBloom';
import { buildCache } from '../ui/cache/buildCache';
import type { UiMoveCache } from '../ui/cache/UiMoveCache';
import { API_BASE, WS_BASE } from '../config';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
type Role = 'black' | 'white' | 'spectator';
type EmptyCache = UiMoveCache['empty'] extends Map<any, infer T> ? T : never;
type ColorClock = { black: number; white: number };
type RoomStatus = 'lobby' | 'active' | 'ended';
type RoomSettings = {
  hostColor: 'black' | 'white' | 'random';
  startColor: 'black' | 'white' | 'random';
  nextStartColor: 'same' | 'other' | 'random';
};
type RoomPresence = {
  players: { black: number; white: number };
  spectators: number;
  canStart?: boolean;
  rematch?: { black: boolean; white: boolean };
  rematchReady?: boolean;
};
type TimeControl = {
  initialMs: ColorClock;
  bufferMs: ColorClock;
  incrementMs: ColorClock;
  maxGameMs?: number | null;
};
type RawTimeControl = {
  initialMs?: number | ColorClock;
  bufferMs?: number | ColorClock;
  incrementMs?: number | ColorClock;
  maxGameMs?: number | null;
};
type GameEndInfo = {
  reason: string;
  winnerLabel: string;
};
type EndActionInfo =
  | { kind: 'resign'; loserColor: engine.Color; winnerColor: engine.Color }
  | { kind: 'no-legal-moves'; loserColor: engine.Color; winnerColor: engine.Color }
  | { kind: 'timeout-player'; loserColor: engine.Color; winnerColor: engine.Color }
  | { kind: 'timeout-game-tie'; winnerColor: null }
  | { kind: 'draw-accept'; winnerColor: null }
  | { kind: 'tribun'; winnerColor: engine.Color };

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
  drawOfferBlocked?: engine.Color | null;
  clocksMs?: { black: number; white: number };
  buffersMs?: { black: number; white: number };
  timeControl?: RawTimeControl;
  serverTimeMs?: number;
  turnStartTimeMs?: number | null;
  gameStartTimeMs?: number | null;
  status?: 'active' | 'ended';
  winner?: engine.Color | null;
  roomStatus?: RoomStatus;
  roomSettings?: RoomSettings;
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

const DEFAULT_TIME_CONTROL: TimeControl = {
  initialMs: { black: 300000, white: 300000 },
  bufferMs: { black: 20000, white: 20000 },
  incrementMs: { black: 0, white: 0 },
  maxGameMs: null,
};
const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  hostColor: 'random',
  startColor: 'random',
  nextStartColor: 'other',
};

const readColorClock = (raw: number | ColorClock | undefined, fallback: ColorClock): ColorClock => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { black: raw, white: raw };
  }
  if (raw && typeof raw === 'object') {
    return {
      black: Number.isFinite(raw.black) ? raw.black : fallback.black,
      white: Number.isFinite(raw.white) ? raw.white : fallback.white,
    };
  }
  return fallback;
};

const normalizeTimeControl = (raw?: RawTimeControl | null): TimeControl => {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TIME_CONTROL };
  }
  const initialMs = readColorClock(raw.initialMs, DEFAULT_TIME_CONTROL.initialMs);
  const bufferMs = readColorClock(raw.bufferMs, DEFAULT_TIME_CONTROL.bufferMs);
  const incrementMs = readColorClock(raw.incrementMs, DEFAULT_TIME_CONTROL.incrementMs);
  const maxGameMs =
    raw.maxGameMs === null || Number.isFinite(raw.maxGameMs)
      ? raw.maxGameMs
      : DEFAULT_TIME_CONTROL.maxGameMs ?? null;
  return { initialMs, bufferMs, incrementMs, maxGameMs };
};

const resolveActiveColor = (
  turn: engine.Color | string | undefined | null,
  fallback: 'black' | 'white',
): 'black' | 'white' => {
  if (turn === 0 || turn === 'black') return 'black';
  if (turn === 1 || turn === 'white') return 'white';
  return fallback;
};

const formatColorName = (color?: number | null): string => {
  if (color === 0) return 'Black';
  if (color === 1) return 'White';
  return 'Unknown';
};

const colorToClockKey = (color: engine.Color): keyof ColorClock => (color === 0 ? 'black' : 'white');

const getEndInfoFromAction = (actionWord: number): EndActionInfo | null => {
  const decoded = engine.decodeAction(actionWord);
  switch (decoded.opcode) {
    case 11: {
      const endReason = decoded.fields.endReason;
      const loserColor = decoded.fields.loserColor as engine.Color;
      if (endReason === 0) {
        return { kind: 'resign', loserColor, winnerColor: (loserColor ^ 1) as engine.Color };
      }
      if (endReason === 1) {
        return { kind: 'no-legal-moves', loserColor, winnerColor: (loserColor ^ 1) as engine.Color };
      }
      if (endReason === 2) {
        return { kind: 'timeout-player', loserColor, winnerColor: (loserColor ^ 1) as engine.Color };
      }
      if (endReason === 3) {
        return { kind: 'timeout-game-tie', winnerColor: null };
      }
      return null;
    }
    case 10: {
      const drawAction = decoded.fields.drawAction;
      if (drawAction === 2) {
        return { kind: 'draw-accept', winnerColor: null };
      }
      return null;
    }
    case 9: {
      const winnerColor = decoded.fields.winnerColor as engine.Color;
      return { kind: 'tribun', winnerColor };
    }
    default:
      return null;
  }
};

const resolveEndInfo = (params: {
  state: engine.State | null;
  lastActionWord: number | null;
  clocksMs: ColorClock;
  totalGameTimeMs: number;
  timeControl: TimeControl;
}): GameEndInfo | null => {
  const { state, lastActionWord, clocksMs, totalGameTimeMs, timeControl } = params;
  if (!state || state.status !== 'ended') return null;
  let reason = 'Game ended';
  let winnerLabel = state.winner === null ? 'Tie' : formatColorName(state.winner);

  if (lastActionWord !== null) {
    const fromAction = getEndInfoFromAction(lastActionWord);
    if (fromAction) {
      switch (fromAction.kind) {
        case 'resign':
          reason = `${formatColorName(fromAction.loserColor)} resigned`;
          winnerLabel = formatColorName(fromAction.winnerColor);
          break;
        case 'no-legal-moves':
          reason = `${formatColorName(fromAction.loserColor)} has no legal moves`;
          winnerLabel = formatColorName(fromAction.winnerColor);
          break;
        case 'timeout-player': {
          const clockKey = colorToClockKey(fromAction.loserColor);
          const clockDetail = Number.isFinite(clocksMs[clockKey])
            ? ` (clock ${formatTime(clocksMs[clockKey])})`
            : '';
          reason = `${formatColorName(fromAction.loserColor)} ran out of time${clockDetail}`;
          winnerLabel = formatColorName(fromAction.winnerColor);
          break;
        }
        case 'timeout-game-tie': {
          const maxGameMs = timeControl.maxGameMs;
          if (maxGameMs != null && Number.isFinite(maxGameMs)) {
            reason = `Time limit reached (${formatTime(totalGameTimeMs)} / ${formatTime(maxGameMs)})`;
          } else {
            reason = `Time limit reached (${formatTime(totalGameTimeMs)})`;
          }
          winnerLabel = 'Tie';
          break;
        }
        case 'draw-accept':
          reason = 'Draw agreed';
          winnerLabel = 'Tie';
          break;
        case 'tribun':
          reason = `Tribun captured by ${formatColorName(fromAction.winnerColor)}`;
          winnerLabel = formatColorName(fromAction.winnerColor);
          break;
      }
    }
  }

  return { reason, winnerLabel };
};

const advanceClockSnapshot = (
  clocks: ColorClock,
  buffers: ColorClock,
  activeColor: 'black' | 'white',
  elapsedMs: number,
): { clocksMs: ColorClock; buffersMs: ColorClock } => {
  const elapsed = Math.max(0, elapsedMs);
  const bufferStart = buffers[activeColor];
  const bufferRemaining = Math.max(0, bufferStart - elapsed);
  const clockDeduction = Math.max(0, elapsed - bufferStart);
  const clockRemaining = Math.max(0, clocks[activeColor] - clockDeduction);

  return {
    clocksMs: { ...clocks, [activeColor]: clockRemaining },
    buffersMs: { ...buffers, [activeColor]: bufferRemaining },
  };
};

export default function Game() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('lobby');
  const [roomSettings, setRoomSettings] = useState<RoomSettings>({ ...DEFAULT_ROOM_SETTINGS });
  const [roomPresence, setRoomPresence] = useState<RoomPresence>({
    players: { black: 0, white: 0 },
    spectators: 0,
  });
  const [showEndModal, setShowEndModal] = useState(false);
  const [gameState, setGameState] = useState<engine.State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [boardViewportHeight, setBoardViewportHeight] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const autoFlipRef = useRef(true);
  const [isWideLayout, setIsWideLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 980 : false,
  );
  const [isReady, setIsReady] = useState(false);
  
  // Clock state
  const [clocksMs, setClocksMs] = useState<ColorClock>({ black: 300000, white: 300000 });
  const [bufferMsRemaining, setBufferMsRemaining] = useState<ColorClock>({ black: 20000, white: 20000 });
  const [timeControl, setTimeControl] = useState<TimeControl>({ ...DEFAULT_TIME_CONTROL });
  const [gameStartTimeMs, setGameStartTimeMs] = useState<number | null>(null);
  const [gameEndInfo, setGameEndInfo] = useState<GameEndInfo | null>(null);
  const [lastActionWord, setLastActionWord] = useState<number | null>(null);
  const turnStartTimeRef = useRef<number | null>(null);
  const turnStartClockRef = useRef<number | null>(null);
  const turnStartBufferRef = useRef<number | null>(null);
  const lastTurnRef = useRef<engine.Color | null>(null);
  const clocksRef = useRef<{ black: number; white: number }>(clocksMs);
  const bufferRef = useRef<{ black: number; white: number }>(bufferMsRemaining);
  const lastClockUpdateRef = useRef<{ black: number; white: number }>(clocksMs);
  const timeControlRef = useRef<TimeControl>(timeControl);
  const serverOffsetMsRef = useRef<number | null>(null);
  const bestRttMsRef = useRef<number | null>(null);
  const [totalGameTimeMs, setTotalGameTimeMs] = useState<number>(0);
  
  // UI State Machine
  const [uiState, setUiState] = useState<UIState>({ type: 'idle' });
  const [validator, setValidator] = useState<LegalBloomValidator | null>(null);
  
  const cache = useMemo(() => {
    if (!gameState || !validator) return null;
    return buildCache(gameState, validator);
  }, [gameState, validator]);

  const getServerNowMs = () => {
    const offset = serverOffsetMsRef.current;
    return offset === null ? Date.now() : Date.now() + offset;
  };

  const updateServerOffsetFromSync = (clientSentMs: number, serverTimeMs: number) => {
    if (!Number.isFinite(clientSentMs) || !Number.isFinite(serverTimeMs)) return;
    const nowMs = Date.now();
    const rttMs = nowMs - clientSentMs;
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    const offsetMs = serverTimeMs - (clientSentMs + rttMs / 2);
    if (bestRttMsRef.current === null || rttMs < bestRttMsRef.current) {
      bestRttMsRef.current = rttMs;
      serverOffsetMsRef.current = offsetMs;
    }
  };

  const primeServerOffset = (serverTimeMs?: number) => {
    if (typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs)) return;
    if (serverOffsetMsRef.current === null) {
      serverOffsetMsRef.current = serverTimeMs - Date.now();
    }
  };

  const applyServerClockSnapshot = (params: {
    clocksMs: ColorClock;
    buffersMs: ColorClock;
    activeColor: 'black' | 'white';
    serverTimeMs?: number;
  }) => {
    primeServerOffset(params.serverTimeMs);
    const nowServerMs = getServerNowMs();
    const snapshotTimeMs =
      typeof params.serverTimeMs === 'number' && Number.isFinite(params.serverTimeMs)
        ? params.serverTimeMs
        : nowServerMs;
    const elapsedMs = Math.max(0, nowServerMs - snapshotTimeMs);
    const adjusted = advanceClockSnapshot(
      params.clocksMs,
      params.buffersMs,
      params.activeColor,
      elapsedMs,
    );

    setClocksMs(adjusted.clocksMs);
    setBufferMsRemaining(adjusted.buffersMs);
    clocksRef.current = adjusted.clocksMs;
    bufferRef.current = adjusted.buffersMs;
    lastClockUpdateRef.current = adjusted.clocksMs;

    turnStartTimeRef.current = snapshotTimeMs;
    turnStartClockRef.current = params.clocksMs[params.activeColor];
    turnStartBufferRef.current = params.buffersMs[params.activeColor];
    lastTurnRef.current = params.activeColor === 'black' ? 0 : 1;
  };

  const applyLobbyClockSnapshot = (params: {
    clocksMs: ColorClock;
    buffersMs: ColorClock;
    activeColor: 'black' | 'white';
  }) => {
    setClocksMs(params.clocksMs);
    setBufferMsRemaining(params.buffersMs);
    clocksRef.current = params.clocksMs;
    bufferRef.current = params.buffersMs;
    lastClockUpdateRef.current = params.clocksMs;
    turnStartTimeRef.current = null;
    turnStartClockRef.current = null;
    turnStartBufferRef.current = null;
    lastTurnRef.current = params.activeColor === 'black' ? 0 : 1;
  };

  useEffect(() => {
    if (!gameState || !cache) {
      if (uiState.type !== 'idle') {
        setUiState({ type: 'idle' });
      }
      return;
    }
    if (gameState.status === 'ended') {
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
    if (!gameState || !cache || gameState.status === 'ended') return baseStates;
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
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateLayout = () => {
      setIsWideLayout(window.innerWidth >= 980);
    };
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  useEffect(() => {
    if (!autoFlipRef.current) return;
    if (role === 'black') {
      setIsFlipped(true);
      autoFlipRef.current = false;
    } else if (role === 'white') {
      setIsFlipped(false);
      autoFlipRef.current = false;
    }
  }, [role]);

  // Keep refs in sync with state
  useEffect(() => {
    clocksRef.current = clocksMs;
    bufferRef.current = bufferMsRemaining;
    lastClockUpdateRef.current = clocksMs;
  }, [clocksMs, bufferMsRemaining]);

  useEffect(() => {
    timeControlRef.current = timeControl;
  }, [timeControl]);

  useEffect(() => {
    const info = resolveEndInfo({
      state: gameState,
      lastActionWord,
      clocksMs,
      totalGameTimeMs,
      timeControl,
    });
    setGameEndInfo(info);
  }, [gameState?.status, gameState?.winner, lastActionWord, clocksMs, totalGameTimeMs, timeControl]);

  useEffect(() => {
    if (gameState?.status === 'ended') {
      setShowEndModal(true);
    } else if (gameState?.status === 'active') {
      setShowEndModal(false);
    }
  }, [gameState?.status]);

  // Track total game time and check for max game time tie
  useEffect(() => {
    if (!gameState || roomStatus !== 'active' || gameStartTimeMs === null || gameState.status === 'ended') return;
    
    const maxGameMs = timeControl.maxGameMs;
    
    const interval = setInterval(() => {
      if (gameStartTimeMs === null) return;
      const elapsed = Math.max(0, getServerNowMs() - gameStartTimeMs);
      setTotalGameTimeMs(elapsed);
      
      // Check if max game time is reached - force tie (only if maxGameMs is set)
      if (maxGameMs != null && elapsed >= maxGameMs) {
        // Server is authoritative, but we can show the condition and the server will emit END(timeout-game-tie)
        // For now, we just track it - the server will handle the actual tie action
        clearInterval(interval);
      }
    }, 1000); // Update every second
    
    return () => clearInterval(interval);
  }, [gameState, roomStatus, timeControl.maxGameMs, gameStartTimeMs]);

  useEffect(() => {
    if (!gameState || gameStartTimeMs === null) return;
    if (gameState.status === 'ended') {
      setTotalGameTimeMs(Math.max(0, getServerNowMs() - gameStartTimeMs));
    }
  }, [gameState?.status, gameStartTimeMs]);

  // Clock countdown effect with separate buffer tracking (server-time based)
  useEffect(() => {
    if (!gameState || roomStatus !== 'active' || gameState.status === 'ended') return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (!gameState) return;

      const currentColor = gameState.turn === 0 ? 'black' : 'white';
      const nowServerMs = getServerNowMs();

      // Reset anchor if turn changed or missing
      if (
        lastTurnRef.current !== gameState.turn ||
        turnStartTimeRef.current === null ||
        turnStartClockRef.current === null ||
        turnStartBufferRef.current === null
      ) {
        turnStartTimeRef.current = nowServerMs;
        turnStartClockRef.current = clocksRef.current[currentColor];
        turnStartBufferRef.current = bufferRef.current[currentColor];
        lastTurnRef.current = gameState.turn;
      }

      if (
        turnStartTimeRef.current === null ||
        turnStartClockRef.current === null ||
        turnStartBufferRef.current === null
      ) {
        return;
      }

      const elapsed = Math.max(0, nowServerMs - turnStartTimeRef.current);
      const bufferStart = turnStartBufferRef.current;
      const clockStart = turnStartClockRef.current;
      const remainingBuffer = Math.max(0, bufferStart - elapsed);
      const timeOverBuffer = Math.max(0, elapsed - bufferStart);
      const remainingClock = Math.max(0, clockStart - timeOverBuffer);

      if (bufferRef.current[currentColor] !== remainingBuffer) {
        const nextBuffers = { ...bufferRef.current, [currentColor]: remainingBuffer };
        bufferRef.current = nextBuffers;
        setBufferMsRemaining(nextBuffers);
      }

      if (clocksRef.current[currentColor] !== remainingClock) {
        const nextClocks = { ...clocksRef.current, [currentColor]: remainingClock };
        clocksRef.current = nextClocks;
        setClocksMs(nextClocks);
      }

      if (remainingClock <= 0 && interval) {
        clearInterval(interval);
      }
    };

    interval = setInterval(tick, 100);
    tick();

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [gameState?.turn, gameState?.ply, roomStatus]);

  useEffect(() => {
    if (!boardViewportRef.current) return;

    const element = boardViewportRef.current;
    const updateSize = () => {
      setBoardViewportWidth(element.clientWidth);
      setBoardViewportHeight(element.clientHeight);
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, [gameState]);

  useEffect(() => {
    if (!code) {
      navigate('/');
      return;
    }

    let mounted = true;
    let timeSyncInterval: ReturnType<typeof setInterval> | null = null;

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
          const joinResponse = await fetch(`${API_BASE}/api/game/join`, {
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
        const wsUrl = `${WS_BASE}/ws/game/${gameId}?token=${token}`;
        serverOffsetMsRef.current = null;
        bestRttMsRef.current = null;
        const ws = new WebSocket(wsUrl);

        ws.binaryType = 'arraybuffer';

        const sendTimeSync = () => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const clientTimeMs = Date.now();
          ws.send(JSON.stringify({ t: 'time_sync', clientTimeMs }));
        };

        ws.onopen = () => {
          if (mounted) {
            setConnectionState('connected');
          }
          sendTimeSync();
          timeSyncInterval = setInterval(sendTimeSync, 15000);
        };

        ws.onmessage = (event) => {
          if (!mounted) return;

          if (typeof event.data === 'string') {
            // JSON message
            const message = JSON.parse(event.data);
            if (message.t === 'time_sync') {
              updateServerOffsetFromSync(message.clientTimeMs, message.serverTimeMs);
            } else if (message.t === 'room') {
              const players = message.players ?? { black: 0, white: 0 };
              const spectators = Number.isFinite(message.spectators) ? message.spectators : 0;
              setRoomPresence({
                players,
                spectators,
                canStart: message.canStart,
                rematch: message.rematch,
                rematchReady: message.rematchReady,
              });
              if (message.roomStatus === 'lobby' || message.roomStatus === 'active' || message.roomStatus === 'ended') {
                setRoomStatus(message.roomStatus);
              }
            } else if (message.t === 'start') {
              // Initial sync
              const snapshot: GameSnapshot = message.snapshot;
              const nextRoomStatus = snapshot.roomStatus ?? 'active';
              const nextRoomSettings = snapshot.roomSettings ?? DEFAULT_ROOM_SETTINGS;
              const board = engine.unpackBoard(snapshot.boardB64);
              const lastAction =
                Array.isArray(message.actions) && message.actions.length > 0
                  ? (message.actions[message.actions.length - 1] as number)
                  : null;
              if (lastAction !== null) {
                setLastActionWord(lastAction);
              } else {
                setLastActionWord(null);
              }
              const endFromAction = lastAction !== null ? getEndInfoFromAction(lastAction) : null;
              const statusFromAction = endFromAction ? 'ended' : undefined;
              const winnerFromAction = endFromAction ? endFromAction.winnerColor : undefined;
              const state: engine.State = {
                board,
                turn: snapshot.turn,
                ply: snapshot.ply,
                drawOfferBy: snapshot.drawOfferBy,
                drawOfferBlocked: snapshot.drawOfferBlocked ?? null,
                status: snapshot.status ?? statusFromAction,
                winner: snapshot.winner ?? winnerFromAction,
              };

              setGameState(state);
              setUiState({ type: 'idle' });
              lastTurnRef.current = snapshot.turn;
              setRoomStatus(nextRoomStatus);
              setRoomSettings(nextRoomSettings);

              const normalizedTimeControl = normalizeTimeControl(snapshot.timeControl);
              setTimeControl(normalizedTimeControl);

              const baseClocks = snapshot.clocksMs ?? {
                black: normalizedTimeControl.initialMs.black,
                white: normalizedTimeControl.initialMs.white,
              };
              const baseBuffers = snapshot.buffersMs ?? {
                black: normalizedTimeControl.bufferMs.black,
                white: normalizedTimeControl.bufferMs.white,
              };
              const activeColor = snapshot.turn === 0 ? 'black' : 'white';
              if (nextRoomStatus === 'active') {
                applyServerClockSnapshot({
                  clocksMs: baseClocks,
                  buffersMs: baseBuffers,
                  activeColor,
                  serverTimeMs: snapshot.serverTimeMs,
                });
                if (typeof snapshot.gameStartTimeMs === 'number' && Number.isFinite(snapshot.gameStartTimeMs)) {
                  setGameStartTimeMs(snapshot.gameStartTimeMs);
                  setTotalGameTimeMs(Math.max(0, getServerNowMs() - snapshot.gameStartTimeMs));
                } else {
                  setGameStartTimeMs(null);
                  setTotalGameTimeMs(0);
                }
              } else {
                applyLobbyClockSnapshot({
                  clocksMs: baseClocks,
                  buffersMs: baseBuffers,
                  activeColor,
                });
                setGameStartTimeMs(null);
                setTotalGameTimeMs(0);
              }
            } else if (message.t === 'clock') {
              // Clock update from server - this is authoritative
              // Server sends this after each move with the correct clock and buffer values
              const baseClocks: ColorClock | null = message.clocksMs ?? null;
              if (baseClocks) {
                const fallbackActive =
                  lastTurnRef.current === null ? 'black' : lastTurnRef.current === 0 ? 'black' : 'white';
                const activeColor = resolveActiveColor(message.turn, fallbackActive);
                const baseBuffers: ColorClock = message.buffersMs ?? {
                  black: timeControlRef.current.bufferMs.black,
                  white: timeControlRef.current.bufferMs.white,
                };

                applyServerClockSnapshot({
                  clocksMs: baseClocks,
                  buffersMs: baseBuffers,
                  activeColor,
                  serverTimeMs: message.serverTimeMs,
                });

                if (typeof message.gameStartTimeMs === 'number' && Number.isFinite(message.gameStartTimeMs)) {
                  setGameStartTimeMs(message.gameStartTimeMs);
                }
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
            setLastActionWord(actionWord);

            try {
              setGameState((prevState) => {
                if (!prevState) return prevState;
                const newState = engine.applyAction(prevState, actionWord);
                
                // Don't update clocks locally - wait for server clock update
                // The server will send a clock update message with the correct values
                // after applying buffer/increment logic
                
                return newState;
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
          if (timeSyncInterval) {
            clearInterval(timeSyncInterval);
            timeSyncInterval = null;
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
      if (timeSyncInterval) {
        clearInterval(timeSyncInterval);
        timeSyncInterval = null;
      }
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
    if (roomStatus !== 'active') {
      setError('Game has not started');
      return;
    }
    if (gameState?.status === 'ended') {
      setError('Game has ended');
      return;
    }

    if (role === 'spectator') {
      setError('Spectators cannot play');
      return;
    }

    if (!cache || !cache.legalSet.has(action >>> 0)) {
      setError('Action is not legal');
      return;
    }

    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, action, true);
    wsRef.current.send(buffer);
    
    // UI state will be reset when action is applied via WebSocket
  };

  const sendRoomCommand = (type: 'start_game' | 'rematch_offer' | 'rematch_start') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected');
      return;
    }
    wsRef.current.send(JSON.stringify({ t: type }));
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
    if (!gameState || !cache || gameState.status === 'ended') return;
    
    const isActive = gameState.turn === (role === 'black' ? 0 : 1);
    if (!isActive) return;

    setUiState((prevState) => {
      switch (prevState.type) {
        case 'idle': {
          // Check cache to determine which state to enter
          if (cache.enemy.has(cid)) {
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
          const delta = -d;
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
          const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, delta, validValues.length);
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
    const originUnit = engine.unitByteToUnit(gameState.board[originCid]);
    if (!originUnit || originUnit.color !== gameState.turn) return null;

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

  type PreviewOverlayUnit = { p: number; s: number; color: engine.Color; tribun: boolean };
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
              s: unit.s,
              color: unit.color,
              tribun: unit.tribun,
            });
          } else if (unit.s > 0) {
            overlay.units.set(cid, {
              p: 0,
              s: unit.s,
              color: unit.color,
              tribun: false,
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
          s: 0,
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
              s: 0,
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
              s: 0,
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
          s: originUnit.s,
          color: originUnit.color,
          tribun: originUnit.tribun,
        });
      } else if (originUnit.s > 0) {
        overlay.units.set(originCid, {
          p: 0,
          s: originUnit.s,
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
    const validTiles: Array<{ cid: number; x: number; y: number; displayX: number; displayY: number }> = [];

    for (let cid = 0; cid < 121; cid++) {
      if (engine.isValidTile(cid)) {
        const { x, y } = engine.decodeCoord(cid);
        const displayX = isFlipped ? -x : x;
        const displayY = isFlipped ? -y : y;
        validTiles.push({ cid, x, y, displayX, displayY });
      }
    }

    // Calculate actual pixel bounds using correct coordinate conversion
    // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = -x - y
    // Position of (0,0) is at (0,0)
    let minPixelX = Infinity, maxPixelX = -Infinity;
    let minPixelY = Infinity, maxPixelY = -Infinity;

    validTiles.forEach(({ displayX, displayY }) => {
      // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = y - x
      // Apply spacing multiplier to add gaps between hexagons
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d; // d = sqrt(3)/2 * size (already scaled)
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

    const tiles: JSX.Element[] = validTiles.map(({ cid, x, y, displayX, displayY }) => {
      const overlayUnit = previewOverlay?.units.get(cid);
      const unit: { p: number; s: number; color: engine.Color; tribun: boolean } | null = overlayUnit
        ? overlayUnit
        : previewOverlay?.empty.has(cid)
        ? null
        : engine.unitByteToUnit(displayState.board[cid]);

      // Position of coordinate (x,y) is: (3z/2, (x+y)*d) where z = y - x
      // Position of (0,0) is at (0,0)
      // Apply spacing multiplier to add gaps between hexagons
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d; // d = sqrt(3)/2 * size (already scaled)
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
            const textColorSecondary = unit.color === 0 ? '#fff' : '#000';
            const strokeColor = unit.tribun
            ? (unit.color === 0 ? '#000' : '#fff')
            : (unit.color === 0 ? '#fff' : '#000');
            const strokeColorSecondary = unit.color === 0 ? '#000' : '#fff';
            const mainFontSize = unit.tribun ? 65 : 55;
            const splitFontSize = unit.tribun ? 50 : 45;

            if (unit.s > 0) {
              const primaryOffset = { x: -splitOffsetX, y: splitOffsetY };
              const secondaryOffset = { x: splitOffsetX, y: -splitOffsetY };
              const centerTransform = 'translate(-50%, -50%)';
              return (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  {unit.p > 0 && (
                    <div style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      transform: `${centerTransform} translate(${primaryOffset.x}px, ${-primaryOffset.y}px)`,
                      transformOrigin: 'center',
                      fontSize: `${splitFontSize}px`,
                      fontFamily: '"Segoe UI", "Arial", sans-serif',
                      fontWeight: 'bold',
                      color: textColor,
                      WebkitTextStroke: `1px ${strokeColor}`,
                    }}>
                      {unit.p}
                    </div>
                  )}
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `${centerTransform} translate(${secondaryOffset.x}px, ${-secondaryOffset.y}px)`,
                    transformOrigin: 'center',
                    fontSize: `${splitFontSize}px`,
                    fontFamily: '"Segoe UI", "Arial", sans-serif',
                    fontWeight: 'bold',
                    color: textColorSecondary,
                    WebkitTextStroke: `1px ${strokeColorSecondary}`,
                  }}>
                    {unit.s}
                  </div>
                </div>
              );
            }

            return (
              <div style={{
                fontSize: `${mainFontSize}px`,
                fontFamily: '"Segoe UI", "Arial", sans-serif',
                fontWeight: 'bold',
                color: textColor,
                WebkitTextStroke: `1px ${strokeColor}`,
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
    const availableHeight = boardViewportHeight || boardHeight;
    const scale = Math.min(1, availableWidth / boardWidth, availableHeight / boardHeight);

    return (
      <div
        ref={boardViewportRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${boardWidth}px`,
          height: `${boardHeight}px`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center',
        }}>
          {tiles}
        </div>
      </div>
    );
  };

  const pendingAction = getPendingAction();
  const pendingActionIsLegal = pendingAction !== null && cache?.legalSet.has(pendingAction >>> 0);
  const canSubmit =
    pendingAction !== null &&
    pendingActionIsLegal &&
    role !== 'spectator' &&
    roomStatus === 'active' &&
    gameState?.status !== 'ended' &&
    connectionState === 'connected';

  const playerColor = role === 'black' ? 0 : role === 'white' ? 1 : null;
  const drawOfferBy = gameState?.drawOfferBy ?? null;
  const drawOfferBlocked = gameState?.drawOfferBlocked ?? null;
  const hasDrawOffer = drawOfferBy !== null;
  const isOfferer = hasDrawOffer && playerColor !== null && drawOfferBy === playerColor;
  const isReceiver = hasDrawOffer && playerColor !== null && drawOfferBy !== playerColor;
  const isBlocked = playerColor !== null && drawOfferBlocked === playerColor;
  const drawButtonLabel = hasDrawOffer
    ? isOfferer
      ? 'Withdraw Offer'
      : 'Decline Draw'
    : isBlocked
    ? 'Rejected'
    : 'Offer Draw';
  const surrenderButtonLabel = isReceiver ? 'Accept Draw' : 'Surrender';

  const drawAction =
    gameState && playerColor !== null
      ? hasDrawOffer
        ? isOfferer
          ? engine.encodeDraw(1, playerColor)
          : isReceiver
          ? engine.encodeDraw(3, playerColor)
          : null
        : isBlocked
        ? null
        : engine.encodeDraw(0, playerColor)
      : null;

  const surrenderAction =
    gameState && playerColor !== null
      ? isReceiver
        ? engine.encodeDraw(2, playerColor)
        : engine.encodeEnd(0, playerColor)
      : null;

  const canSendAction = (action: number | null) => {
    if (!action || !cache || !gameState) return false;
    if (roomStatus !== 'active') return false;
    if (gameState.status === 'ended') return false;
    if (role === 'spectator') return false;
    if (connectionState !== 'connected') return false;
    return cache.legalSet.has(action >>> 0);
  };

  const renderClockBox = (color: 'black' | 'white') => {
    const isActive =
      gameState?.status !== 'ended' && gameState?.turn === (color === 'black' ? 0 : 1);
    const showBuffer = Boolean(isActive && bufferMsRemaining[color] > 0);
    const clockValue = formatTime(clocksMs[color]);
    const bufferValue = formatTime(bufferMsRemaining[color]);
    const tone = color === 'black' ? '#f4efe6' : '#1c1b19';
    const surface = color === 'black' ? '#2b2620' : '#f6eddf';

    return (
      <div
        style={{
          position: 'relative',
          height: '72px',
          borderRadius: '12px',
          border: `2px solid ${isActive ? '#b9833b' : '#3b3327'}`,
          background: surface,
          color: tone,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
          letterSpacing: '1px',
          boxShadow: '0 8px 16px rgba(20, 15, 10, 0.12)',
        }}
      >
        {role === color && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '8px',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              padding: '2px 6px',
              borderRadius: '999px',
              background: color === 'black' ? '#17130f' : '#e8ddcc',
              color: color === 'black' ? '#f3e8d6' : '#2a241c',
            }}
          >
            You
          </div>
        )}
        {showBuffer ? (
          <>
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '10px',
                fontSize: '12px',
                fontWeight: 700,
                color: color === 'black' ? '#9fd8b6' : '#2f6b3f',
              }}
            >
              {bufferValue}
            </div>
            <div
              style={{
                position: 'absolute',
                right: '10px',
                bottom: '8px',
                fontSize: '18px',
                fontWeight: 700,
              }}
            >
              {clockValue}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '22px', fontWeight: 700 }}>{clockValue}</div>
        )}
      </div>
    );
  };

  const playersReady = roomPresence.players.black > 0 && roomPresence.players.white > 0;
  const canHostStart = roomStatus === 'lobby' && role === 'black' && playersReady;
  const rematchOffers = roomPresence.rematch ?? { black: false, white: false };
  const rematchReady = Boolean(roomPresence.rematchReady ?? (rematchOffers.black && rematchOffers.white));
  const rematchOfferedByMe =
    role === 'black' ? rematchOffers.black : role === 'white' ? rematchOffers.white : false;
  const canOfferRematch =
    roomStatus === 'ended' && role !== 'spectator' && playersReady && !rematchOfferedByMe;

  const formatOption = (value?: string) => {
    if (!value) return 'Unknown';
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  };
  const formatNextStart = (value?: RoomSettings['nextStartColor']) => {
    if (value === 'same') return 'Same';
    if (value === 'other') return 'Other';
    if (value === 'random') return 'Random';
    return 'Unknown';
  };
  const formatClockPair = (clock: ColorClock) => {
    if (clock.black === clock.white) {
      return formatTime(clock.black);
    }
    return `Black ${formatTime(clock.black)} / White ${formatTime(clock.white)}`;
  };
  const maxGameLabel =
    timeControl.maxGameMs != null && Number.isFinite(timeControl.maxGameMs)
      ? formatTime(timeControl.maxGameMs)
      : 'Infinite';
  const nextGameHint = rematchReady
    ? null
    : role === 'spectator'
    ? 'Waiting for players to offer a rematch.'
    : rematchOfferedByMe
    ? 'Waiting for opponent to offer a rematch.'
    : playersReady
    ? 'Offer a rematch to continue.'
    : 'Both players must be connected to offer a rematch.';
  const rematchButtonLabel = rematchReady ? 'Rematch' : 'Offer Rematch';
  const rematchButtonDisabled = rematchReady
    ? !(roomStatus === 'ended' && role !== 'spectator' && playersReady)
    : !canOfferRematch;
  const lobbyActionLabel =
    role === 'black'
      ? playersReady
        ? 'Start Game'
        : 'Waiting for opponent'
      : 'Waiting for host';

  const contentPadding = isWideLayout ? '16px 20px 20px' : '8px 6px 10px';
  const boardCardPadding = isWideLayout ? '12px' : '6px';
  const navPadding = isWideLayout ? '12px 20px' : '8px 10px';
  const errorMargin = isWideLayout ? '12px 20px 0' : '8px 8px 0';
  const contentGap = isWideLayout ? '16px' : '10px';

  return (
    <div
      style={{
        minHeight: '100vh',
        maxHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)',
        color: '#1d1a14',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
        overflow: 'hidden',
        opacity: isReady ? 1 : 0,
        transform: isReady ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');
        `}
      </style>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: navPadding,
          gap: '16px',
          background: 'rgba(26, 21, 15, 0.92)',
          color: '#f8f1e7',
          borderBottom: '2px solid #3a2f22',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: '140px' }}>
          <div
            style={{
              fontSize: '10px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: '#ccb896',
              fontWeight: 700,
            }}
          >
            Game Code
          </div>
          <div style={{ fontSize: '20px', fontWeight: 400 }}>{code}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              borderRadius: '999px',
              background: '#2d2418',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                background:
                  connectionState === 'connected'
                    ? '#58d68d'
                    : connectionState === 'connecting'
                    ? '#f5c26b'
                    : '#e57373',
              }}
            />
            {connectionState}
          </div>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 14px',
              borderRadius: '999px',
              background: '#f2d9b2',
              border: '2px solid #6f5a38',
              color: '#2a2218',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Home
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            margin: errorMargin,
            padding: '10px 14px',
            borderRadius: '10px',
            background: '#f7d7d5',
            color: '#5c1c16',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {gameEndInfo && gameState?.status === 'ended' && !showEndModal && (
        <div
          style={{
            margin: errorMargin,
            padding: '10px 14px',
            borderRadius: '10px',
            background: '#f1ddc2',
            color: '#3c2b18',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>Game ended · {gameEndInfo.winnerLabel}</div>
          <button
            onClick={() => setShowEndModal(true)}
            style={{
              padding: '6px 12px',
              borderRadius: '999px',
              border: '2px solid #6f5a38',
              background: '#f2d9b2',
              color: '#2a2218',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              cursor: 'pointer',
            }}
          >
            View Summary
          </button>
        </div>
      )}

      {gameEndInfo && gameState?.status === 'ended' && showEndModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 15, 10, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 'min(520px, 92vw)',
              background: '#fff7ea',
              borderRadius: '18px',
              border: '2px solid #b9833b',
              padding: '24px',
              boxShadow: '0 24px 40px rgba(39, 30, 20, 0.25)',
              textAlign: 'center',
              position: 'relative',
            }}
          >
            <button
              onClick={() => setShowEndModal(false)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                border: '1px solid #d4c3a5',
                background: '#f7ecd8',
                color: '#5a4630',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color: '#7a6543',
                marginBottom: '12px',
              }}
            >
              Game Over
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: '#3c2b18' }}>
              {gameEndInfo.reason}
            </div>
            <div style={{ fontSize: '16px', marginBottom: '18px', color: '#5a4630' }}>
              Result: {gameEndInfo.winnerLabel}
            </div>
            <button
              onClick={() => sendRoomCommand(rematchReady ? 'rematch_start' : 'rematch_offer')}
              disabled={rematchButtonDisabled}
              style={{
                padding: '12px 18px',
                borderRadius: '999px',
                border: '2px solid #6f5a38',
                background: !rematchButtonDisabled ? '#f2d9b2' : '#e6dccf',
                color: '#2a2218',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: !rematchButtonDisabled ? 'pointer' : 'not-allowed',
              }}
            >
              {rematchButtonLabel}
            </button>
            {nextGameHint && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: '#7a6543' }}>{nextGameHint}</div>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isWideLayout ? '220px minmax(0, 1fr) 220px' : 'minmax(0, 1fr)',
          gap: contentGap,
          padding: contentPadding,
        }}
      >
        {roomStatus === 'lobby' ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: isWideLayout ? '24px' : '16px',
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.85)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              display: 'grid',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: '2px solid #b9833b',
                  background: 'linear-gradient(135deg, #f1ddc2 0%, #e8d0a8 100%)',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    color: '#7a6543',
                    marginBottom: '8px',
                  }}
                >
                  Game Code
                </div>
                <div
                  style={{
                    fontSize: '36px',
                    fontWeight: 900,
                    letterSpacing: '4px',
                    color: '#2c2318',
                    fontFamily: 'monospace',
                  }}
                >
                  {code}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      color: '#7a6543',
                    }}
                  >
                    Waiting Room
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#2c2318' }}>
                    {playersReady ? 'Players connected' : 'Waiting for opponent'}
                  </div>
                </div>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '999px',
                    border: '2px solid #b9833b',
                    background: '#f1ddc2',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    color: '#4a3720',
                    height: 'fit-content',
                    alignSelf: 'flex-start',
                  }}
                >
                  Players: {roomPresence.players.black + roomPresence.players.white}/2
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isWideLayout ? 'minmax(0, 1fr) minmax(0, 1fr)' : '1fr',
                gap: '16px',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid #d8cbb8',
                  background: '#fffaf0',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#3a2c1b' }}>Players & Spectators</div>
                <div style={{ display: 'grid', gap: '6px', color: '#5a4630' }}>
                  <div>Black: {roomPresence.players.black > 0 ? 'Connected' : 'Waiting'}</div>
                  <div>White: {roomPresence.players.white > 0 ? 'Connected' : 'Waiting'}</div>
                  <div>Spectators: {roomPresence.spectators}</div>
                </div>
                <button
                  onClick={() => sendRoomCommand('start_game')}
                  disabled={!canHostStart}
                  style={{
                    marginTop: '6px',
                    padding: '12px 18px',
                    borderRadius: '999px',
                    border: '2px solid #6f5a38',
                    background: canHostStart ? '#f2d9b2' : '#e6dccf',
                    color: '#2a2218',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: canHostStart ? 'pointer' : 'not-allowed',
                  }}
                >
                  {lobbyActionLabel}
                </button>
                {!canHostStart && (
                  <div style={{ fontSize: '12px', color: '#7a6543' }}>
                    {role === 'black' ? 'Both players must connect before starting.' : 'Waiting for the host to start.'}
                  </div>
                )}
              </div>
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid #d8cbb8',
                  background: '#fffaf0',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#3a2c1b' }}>Room Settings</div>
                <div style={{ display: 'grid', gap: '6px', color: '#5a4630' }}>
                  <div>Host color: {formatOption(roomSettings.hostColor)}</div>
                  <div>Start color: {formatOption(roomSettings.startColor)}</div>
                  <div>Next start: {formatNextStart(roomSettings.nextStartColor)}</div>
                  <div>Initial: {formatClockPair(timeControl.initialMs)}</div>
                  <div>Buffer: {formatClockPair(timeControl.bufferMs)}</div>
                  <div>Increment: {formatClockPair(timeControl.incrementMs)}</div>
                  <div>Max game time: {maxGameLabel}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
        {isWideLayout && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              minHeight: 0,
            }}
          >
            <button
              onClick={() => submitCurrentAction()}
              disabled={!canSubmit}
              style={{
                padding: '12px',
                borderRadius: '12px',
                border: '2px solid #183628',
                background: canSubmit ? '#2f6b3f' : '#8ea593',
                color: '#f7f3eb',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                boxShadow: canSubmit ? '0 10px 18px rgba(24, 54, 40, 0.22)' : 'none',
              }}
            >
              Submit Move
            </button>
            <button
              onClick={() => surrenderAction && sendAction(surrenderAction)}
              disabled={!canSendAction(surrenderAction)}
              style={{
                padding: '12px',
                borderRadius: '12px',
                border: '2px solid #5b2a2a',
                background: canSendAction(surrenderAction) ? '#8b3b3b' : '#b9a2a2',
                color: '#f8f1e7',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: canSendAction(surrenderAction) ? 'pointer' : 'not-allowed',
              }}
            >
              {surrenderButtonLabel}
            </button>
            <div style={{ marginTop: 'auto' }}>{renderClockBox('black')}</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: '12px' }}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.7)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              padding: boardCardPadding,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              onClick={() => {
                autoFlipRef.current = false;
                setIsFlipped((prev) => !prev);
              }}
              title="Flip board"
              aria-label="Flip board"
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                border: `2px solid ${isFlipped ? '#111' : '#1c1a16'}`,
                background: isFlipped ? '#111' : '#f6f0e6',
                color: isFlipped ? '#f6f0e6' : '#1c1a16',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.5px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 12px rgba(20, 15, 10, 0.18)',
                zIndex: 2,
              }}
            ></button>
            {gameState ? (
              <div style={{ width: '100%', height: '100%', minHeight: 0 }}>{renderBoard()}</div>
            ) : (
              <div style={{ fontWeight: 700, letterSpacing: '1px' }}>Loading board...</div>
            )}
          </div>

          {!isWideLayout && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => submitCurrentAction()}
                disabled={!canSubmit}
                style={{
                  padding: '12px',
                  borderRadius: '12px',
                  border: '2px solid #183628',
                  background: canSubmit ? '#2f6b3f' : '#8ea593',
                  color: '#f7f3eb',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                }}
              >
                Submit Move
              </button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={() => surrenderAction && sendAction(surrenderAction)}
                  disabled={!canSendAction(surrenderAction)}
                  style={{
                    padding: '10px',
                    borderRadius: '10px',
                    border: '2px solid #5b2a2a',
                    background: canSendAction(surrenderAction) ? '#8b3b3b' : '#b9a2a2',
                    color: '#f8f1e7',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: canSendAction(surrenderAction) ? 'pointer' : 'not-allowed',
                  }}
                >
                  {surrenderButtonLabel}
                </button>
                <button
                  onClick={() => drawAction && sendAction(drawAction)}
                  disabled={!canSendAction(drawAction)}
                  style={{
                    padding: '10px',
                    borderRadius: '10px',
                    border: '2px solid #5a4a2f',
                    background: canSendAction(drawAction) ? '#c9a565' : '#d8c8ab',
                    color: '#2a2218',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: canSendAction(drawAction) ? 'pointer' : 'not-allowed',
                  }}
                >
                  {drawButtonLabel}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {renderClockBox('black')}
                {renderClockBox('white')}
              </div>
            </div>
          )}
        </div>

        {isWideLayout && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              minHeight: 0,
            }}
          >
            <button
              onClick={() => submitCurrentAction()}
              disabled={!canSubmit}
              style={{
                padding: '12px',
                borderRadius: '12px',
                border: '2px solid #183628',
                background: canSubmit ? '#2f6b3f' : '#8ea593',
                color: '#f7f3eb',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              Submit Move
            </button>
            <button
              onClick={() => drawAction && sendAction(drawAction)}
              disabled={!canSendAction(drawAction)}
              style={{
                padding: '12px',
                borderRadius: '12px',
                border: '2px solid #5a4a2f',
                background: canSendAction(drawAction) ? '#c9a565' : '#d8c8ab',
                color: '#2a2218',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: canSendAction(drawAction) ? 'pointer' : 'not-allowed',
              }}
            >
              {drawButtonLabel}
            </button>
            <div style={{ marginTop: 'auto' }}>{renderClockBox('white')}</div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );

}

// Helper function to format time in MM:SS format
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
