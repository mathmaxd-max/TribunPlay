import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as engine from '@tribunplay/engine';
import { getHexagonColor, getBaseColor, type HexagonState } from '../hexagonColors';
import { buildCache } from '../ui/cache/buildCache';
import type { UiMoveCache } from '../ui/cache/UiMoveCache';
import { SplitUnitGlyph, UnitGlyph } from '../ui/UnitGlyph';
import { PageHeaderBrand } from '../ui/PageHeaderBrand';
import { useBoardSfx } from '../audio/boardSfx';
import { preloadBoardAssets } from '../audio/boardSfx';
import { areAllUnitIconsReady, preloadAllUnitIcons } from '../ui/unitIcons';
import { formatClockTime as formatTime } from '../clock/formatClockTime';
import { lobbyPayloadToTimeControl, opponentOf, resolveNextStartColor } from '../clock/buildTimeControl';
import { applyTurnEnd } from '../clock/endTurn';
import type { ColorClock, PlayerColor, TimeControl } from '../clock/types';
import { deserializeEngineState, toPlayerColor } from '../navigation';
import { loadLocalLobbyPayload, saveLocalLobbyPayload } from '../play/localLobbySession';
import type { LocalLobbyPayload } from '../play/types';
import { PlayerControlCluster } from '../ui/PlayerControlCluster';

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

type PreviewOverlayUnit = { p: number; s: number; color: engine.Color; tribun: boolean };
type PreviewOverlay = { units: Map<number, PreviewOverlayUnit>; empty: Set<number> };

type TilePixelData = {
  cid: number;
  x: number;
  y: number;
  displayX: number;
  displayY: number;
  centerX: number;
  centerY: number;
  hexX: number;
  hexY: number;
};

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

const isUiStateEqual = (a: UIState, b: UIState): boolean => {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'idle':
      return true;
    case 'enemy':
      return b.type === 'enemy' && a.targetCid === b.targetCid && a.optionIndex === b.optionIndex;
    case 'own_primary':
      return b.type === 'own_primary' && a.originCid === b.originCid && a.targetCid === b.targetCid && a.optionIndex === b.optionIndex;
    case 'own_secondary':
      return b.type === 'own_secondary' && a.originCid === b.originCid && a.allocations.every((value, index) => value === b.allocations[index]);
    case 'empty':
      if (b.type !== 'empty') return false;
      if (a.centerCid !== b.centerCid || a.optionIndex !== b.optionIndex || a.donors.size !== b.donors.size) return false;
      for (const [cid, value] of a.donors.entries()) {
        if (b.donors.get(cid) !== value) return false;
      }
      if (!a.symmetry && !b.symmetry) return true;
      if (!a.symmetry || !b.symmetry) return false;
      if (a.symmetry.mode !== b.symmetry.mode || a.symmetry.donate !== b.symmetry.donate) return false;
      if (a.symmetry.donorCids.length !== b.symmetry.donorCids.length) return false;
      for (let i = 0; i < a.symmetry.donorCids.length; i += 1) {
        if (a.symmetry.donorCids[i] !== b.symmetry.donorCids[i]) return false;
      }
      return true;
  }
};

const formatColorName = (color: engine.Color | null | undefined): string => {
  if (color === 0) return 'Black';
  if (color === 1) return 'White';
  return 'Tie';
};

const toClockColor = (color: engine.Color): PlayerColor => (color === 0 ? 'black' : 'white');
const toEngineColor = (color: PlayerColor): engine.Color => (color === 'black' ? 0 : 1);
const clockColorFromStateTurn = (state: engine.State): PlayerColor => toClockColor(state.turn);

const hasTurnActions = (state: engine.State): boolean => {
  const legal = engine.generateLegalActions(state);
  for (const action of legal) {
    const decoded = engine.decodeAction(action);
    if (decoded.opcode >= 0 && decoded.opcode <= 9) {
      return true;
    }
  }
  return false;
};

const buildInitialLocalState = (payload: LocalLobbyPayload): { state: engine.State; timeControl: TimeControl } => {
  const timeControl = lobbyPayloadToTimeControl(payload.timeControl);
  if (payload.initialState) {
    return {
      timeControl,
      state: deserializeEngineState(payload.initialState),
    };
  }
  const { roomSettings } = payload;
  const board =
    roomSettings.setupConfig.enabled
      ? (() => {
          const built = engine.buildBoardFromSetups({
            config: roomSettings.setupConfig,
            freeSelections: roomSettings.setupSelections,
          });
          if (!built.ok) {
            throw new Error(built.issues[0]?.message ?? 'Unable to build local setup board.');
          }
          return built.board;
        })()
      : engine.createInitialBoard();

  return {
    timeControl,
    state: {
      board,
      turn: toEngineColor(payload.resolvedStartColor),
      ply: 0,
      drawOfferBy: null,
      drawOfferBlocked: null,
      status: 'active',
      winner: null,
    },
  };
};

export default function LocalGame() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationPayload = (location.state ?? null) as LocalLobbyPayload | null;
  const payload = useMemo(() => locationPayload ?? loadLocalLobbyPayload(), [locationPayload]);
  const boot = useMemo(() => {
    if (!payload) return null;
    try {
      return buildInitialLocalState(payload);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unable to initialize local game.' };
    }
  }, [payload]);

  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!payload) {
      navigate('/local', { replace: true });
      return;
    }
    if (boot && 'error' in boot) {
      setBootError(boot.error);
    }
  }, [payload, boot, navigate]);

  const [gameState, setGameState] = useState<engine.State | null>(() => (boot && !('error' in boot) ? boot.state : null));
  const [timeControl] = useState<TimeControl>(() => (boot && !('error' in boot) ? boot.timeControl : lobbyPayloadToTimeControl(payload?.timeControl ?? { initialMs: 300000, bufferMs: 20000, incrementMs: 0, maxGameMs: null })));
  const [clocksMs, setClocksMs] = useState<ColorClock>(() => ({ ...(timeControl.initialMs ?? { black: 300000, white: 300000 }) }));
  const [bufferMsRemaining, setBufferMsRemaining] = useState<ColorClock>(() => ({ ...(timeControl.bufferMs ?? { black: 20000, white: 20000 }) }));
  const [activeClockColor, setActiveClockColor] = useState<PlayerColor>(() => (
    boot && !('error' in boot) ? clockColorFromStateTurn(boot.state) : payload?.resolvedStartColor ?? 'black'
  ));
  const [clockRunning, setClockRunning] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [pendingClockTapColor, setPendingClockTapColor] = useState<PlayerColor | null>(null);
  const [gameStartTimeMs, setGameStartTimeMs] = useState<number | null>(null);
  const [totalGameTimeMs, setTotalGameTimeMs] = useState(0);
  const [lastActionWord, setLastActionWord] = useState<number | null>(null);
  const [messageText, setMessageText] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'hint' | 'error'>('hint');
  const [showEndModal, setShowEndModal] = useState(false);
  const [confirmSurrenderColor, setConfirmSurrenderColor] = useState<PlayerColor | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(typeof window !== 'undefined' ? window.innerWidth >= 980 : false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [autoFlipEnabled, setAutoFlipEnabled] = useState(true);
  const [uiState, setUiState] = useState<UIState>({ type: 'idle' });
  const [unitIconsReady, setUnitIconsReady] = useState(() => areAllUnitIconsReady());
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [boardViewportHeight, setBoardViewportHeight] = useState(0);
  const [hoveredBoardCid, setHoveredBoardCid] = useState<number | null>(null);
  const [drawOfferPlyByColor, setDrawOfferPlyByColor] = useState<{ black: number | null; white: number | null }>({
    black: null,
    white: null,
  });
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const initialOrientationAppliedRef = useRef(false);
  const uiStateRef = useRef<UIState>({ type: 'idle' });
  const messageTimeoutRef = useRef<number | null>(null);
  const clocksRef = useRef(clocksMs);
  const bufferRef = useRef(bufferMsRemaining);
  const turnStartTimeRef = useRef<number | null>(null);
  const turnStartClockRef = useRef<number | null>(null);
  const turnStartBufferRef = useRef<number | null>(null);
  const playedEndRef = useRef(false);
  const { playSfx } = useBoardSfx();

  useEffect(() => {
    if (!gameState) return;
    const expected = clockColorFromStateTurn(gameState);
    setActiveClockColor(expected);
    if (import.meta.env.DEV && activeClockColor !== expected) {
      console.assert(
        activeClockColor === expected,
        `Clock/turn mismatch at boot: active=${activeClockColor}, turn=${expected}`,
      );
    }
  }, [gameState?.turn]);

  useEffect(() => {
    if (!gameState || !isWideLayout || !autoFlipEnabled || initialOrientationAppliedRef.current) return;
    // Keep the side to move at the bottom when booting imported local positions.
    setIsFlipped(gameState.turn === 0);
    initialOrientationAppliedRef.current = true;
  }, [gameState, isWideLayout, autoFlipEnabled]);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    clocksRef.current = clocksMs;
  }, [clocksMs]);

  useEffect(() => {
    bufferRef.current = bufferMsRemaining;
  }, [bufferMsRemaining]);

  useEffect(() => {
    void preloadBoardAssets();
    if (areAllUnitIconsReady()) {
      setUnitIconsReady(true);
      return;
    }
    void preloadAllUnitIcons().then(() => setUnitIconsReady(true));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateLayout = () => setIsWideLayout(window.innerWidth >= 980);
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  useEffect(() => {
    const element = boardViewportRef.current;
    if (!element) return;
    const updateSize = () => {
      setBoardViewportWidth(element.clientWidth);
      setBoardViewportHeight(element.clientHeight);
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [gameState, isWideLayout]);

  useLayoutEffect(() => {
    if (isWideLayout) return;
    const element = boardViewportRef.current;
    if (!element) return;
    setBoardViewportWidth(element.clientWidth);
    setBoardViewportHeight(element.clientHeight);
  }, [isWideLayout, gameState]);

  useEffect(() => {
    if (gameState?.status === 'ended' && !playedEndRef.current) {
      playedEndRef.current = true;
      playSfx('gameEnded');
      setShowEndModal(true);
    }
    if (gameState?.status !== 'ended') {
      playedEndRef.current = false;
    }
  }, [gameState?.status, playSfx]);

  const cache = useMemo(() => {
    if (!gameState) return null;
    return buildCache(gameState, {} as never);
  }, [gameState]);

  const currentTurnColor = gameState ? toClockColor(gameState.turn) : 'black';
  const canInteractAsPlayer =
    Boolean(gameState) &&
    gameState?.status !== 'ended' &&
    gameStarted &&
    pendingClockTapColor === null &&
    activeClockColor === currentTurnColor;

  const setTransientMessage = (message: string, tone: 'hint' | 'error' = 'hint', durationMs = 2200) => {
    if (messageTimeoutRef.current !== null) {
      window.clearTimeout(messageTimeoutRef.current);
    }
    setMessageText(message);
    setMessageTone(tone);
    messageTimeoutRef.current = window.setTimeout(() => {
      setMessageText(null);
      messageTimeoutRef.current = null;
    }, durationMs);
  };

  const commitUiState = (nextState: UIState) => {
    const previous = uiStateRef.current;
    if (isUiStateEqual(previous, nextState)) return;
    uiStateRef.current = nextState;
    setUiState(nextState);
  };

  const startClockFor = (color: PlayerColor) => {
    const now = Date.now();
    if (!gameStarted) {
      setGameStarted(true);
      setGameStartTimeMs(now);
    }
    turnStartTimeRef.current = now;
    turnStartClockRef.current = clocksRef.current[color];
    turnStartBufferRef.current = bufferRef.current[color];
    setClockRunning(true);
  };

  const applyFinalAction = (action: number) => {
    if (!gameState) return;
    let nextState = engine.applyAction(gameState, action);
    let finalAction = action;
    if (nextState.status !== 'ended' && !hasTurnActions(nextState)) {
      finalAction = engine.encodeEnd(1, nextState.turn);
      nextState = engine.applyAction(nextState, finalAction);
    }
    setGameState(nextState);
    setLastActionWord(finalAction);
    if (nextState.status === 'ended') {
      setClockRunning(false);
      setPendingClockTapColor(null);
    }
  };

  const applyTimeoutLoss = (loser: PlayerColor) => {
    if (!gameState) return;
    const action = engine.encodeEnd(2, toEngineColor(loser));
    const nextState = engine.applyAction(gameState, action);
    setGameState(nextState);
    setLastActionWord(action);
    setClockRunning(false);
    setPendingClockTapColor(null);
  };

  const applyGameTie = () => {
    if (!gameState) return;
    const action = engine.encodeEnd(3);
    const nextState = engine.applyAction(gameState, action);
    setGameState(nextState);
    setLastActionWord(action);
    setClockRunning(false);
    setPendingClockTapColor(null);
  };

  useEffect(() => {
    if (!clockRunning || !gameState || gameState.status === 'ended') return;
    const interval = window.setInterval(() => {
      const color = activeClockColor;
      if (
        turnStartTimeRef.current === null ||
        turnStartClockRef.current === null ||
        turnStartBufferRef.current === null
      ) {
        return;
      }
      const elapsed = Math.max(0, Date.now() - turnStartTimeRef.current);
      const remainingBuffer = Math.max(0, turnStartBufferRef.current - elapsed);
      const timeOverBuffer = Math.max(0, elapsed - turnStartBufferRef.current);
      const remainingClock = Math.max(0, turnStartClockRef.current - timeOverBuffer);

      if (bufferRef.current[color] !== remainingBuffer) {
        const nextBuffers = { ...bufferRef.current, [color]: remainingBuffer };
        bufferRef.current = nextBuffers;
        setBufferMsRemaining(nextBuffers);
      }
      if (clocksRef.current[color] !== remainingClock) {
        const nextClocks = { ...clocksRef.current, [color]: remainingClock };
        clocksRef.current = nextClocks;
        setClocksMs(nextClocks);
      }
      if (remainingClock <= 0) {
        applyTimeoutLoss(color);
      }
    }, 100);
    return () => window.clearInterval(interval);
  }, [clockRunning, activeClockColor, gameState?.status]);

  useEffect(() => {
    if (!gameStarted || gameStartTimeMs === null) return;
    if (gameState?.status === 'ended') {
      setTotalGameTimeMs(Math.max(0, Date.now() - gameStartTimeMs));
      return;
    }
    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Date.now() - gameStartTimeMs);
      setTotalGameTimeMs(elapsed);
      if (timeControl.maxGameMs != null && elapsed >= timeControl.maxGameMs) {
        applyGameTie();
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [gameStarted, gameStartTimeMs, gameState?.status, timeControl.maxGameMs]);

  useEffect(() => {
    if (!gameState || !cache || gameState.status === 'ended' || !canInteractAsPlayer) {
      commitUiState({ type: 'idle' });
      return;
    }
    const state = uiStateRef.current;
    if (state.type === 'enemy') {
      const enemyCache = cache.enemy.get(state.targetCid);
      if (!enemyCache || enemyCache.options.length === 0) {
        commitUiState({ type: 'idle' });
      }
    }
  }, [gameState, cache, canInteractAsPlayer]);

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
      for (let dir = 0; dir < NEIGHBOR_VECTORS.length; dir += 1) {
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
  const getDonorDisplayHeight = (emptyCache: EmptyCache, donors: Map<number, number>, donorCid: number, symmetry?: EmptySymmetryState): number | null => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    if (symmetry && symmetry.donorCids.includes(donorCid)) {
      return rule.actualPrimary - symmetry.donate;
    }
    return donors.get(donorCid) ?? rule.actualPrimary;
  };

  const getDonorDonation = (emptyCache: EmptyCache, donors: Map<number, number>, donorCid: number, symmetry?: EmptySymmetryState): number | null => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    const displayHeight = getDonorDisplayHeight(emptyCache, donors, donorCid, symmetry);
    if (displayHeight === null) return null;
    return rule.actualPrimary - displayHeight;
  };

  const getParticipatingDonors = (emptyCache: EmptyCache, donors: Map<number, number>, symmetry?: EmptySymmetryState): Array<{ cid: number; donate: number }> => {
    const participating: Array<{ cid: number; donate: number }> = [];
    for (const donorCid of emptyCache.donorCids) {
      const donate = getDonorDonation(emptyCache, donors, donorCid, symmetry);
      if (donate && donate > 0) {
        participating.push({ cid: donorCid, donate });
      }
    }
    return participating;
  };

  const getDonationOptions = (emptyCache: EmptyCache, donorCid: number): number[] => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return [];
    const options: number[] = [];
    for (const displayHeight of rule.allowedDisplayedHeights) {
      const donate = rule.actualPrimary - displayHeight;
      if (donate > 0) options.push(donate);
    }
    return options;
  };

  const canPairWithAnyDonations = (emptyCache: EmptyCache, donorCidA: number, donorCidB: number): boolean => {
    const optionsA = getDonationOptions(emptyCache, donorCidA);
    const optionsB = getDonationOptions(emptyCache, donorCidB);
    for (const donateA of optionsA) {
      for (const donateB of optionsB) {
        if (emptyCache.canPair(donorCidA, donorCidB, donateA, donateB)) return true;
      }
    }
    return false;
  };

  const applySymmetryDonations = (emptyCache: EmptyCache, baseDonors: Map<number, number>, donorCids: number[], donate: number): Map<number, number> => {
    const next = new Map(baseDonors);
    for (const donorCid of donorCids) {
      const rule = emptyCache.donorRules.get(donorCid);
      if (rule) next.set(donorCid, rule.actualPrimary - donate);
    }
    return next;
  };

  const getIdleSelectionState = (cid: number): UIState | null => {
    if (!gameState || !cache || gameState.status === 'ended' || !canInteractAsPlayer) return null;
    if (cache.enemy.has(cid)) return { type: 'enemy', targetCid: cid, optionIndex: 0 };
    if (cache.empty.has(cid)) return { type: 'empty', centerCid: cid, donors: new Map(), optionIndex: 0 };
    const ownPrimaryCache = cache.ownPrimary.get(cid);
    const ownSecondaryCache = cache.ownSecondary.get(cid);
    const hasPrimaryMoves = Boolean(ownPrimaryCache && ownPrimaryCache.targets.size > 0);
    const hasSecondaryMoves = Boolean(ownSecondaryCache && ownSecondaryCache.split.emptyAdjDirs.length > 0);
    if (hasPrimaryMoves) return { type: 'own_primary', originCid: cid, targetCid: null, optionIndex: 0 };
    if (hasSecondaryMoves) return { type: 'own_secondary', originCid: cid, allocations: [0, 0, 0, 0, 0, 0] };
    return null;
  };

  const handleTileClick = (cid: number, d = 1) => {
    if (!gameState || !cache || gameState.status === 'ended') return;
    const startedClockThisClick = !gameStarted && isWideLayout;
    if (startedClockThisClick) {
      startClockFor(activeClockColor);
    }
    if (!canInteractAsPlayer && !startedClockThisClick) return;
    const prevState = uiStateRef.current;
    let nextState: UIState = prevState;

    switch (prevState.type) {
      case 'idle':
        nextState = getIdleSelectionState(cid) ?? prevState;
        break;
      case 'enemy': {
        if (cid !== prevState.targetCid) {
          nextState = { type: 'idle' };
          break;
        }
        const enemyCache = cache.enemy.get(prevState.targetCid);
        if (!enemyCache || enemyCache.options.length === 0) break;
        nextState = { ...prevState, optionIndex: cycleIndex(prevState.optionIndex, d, enemyCache.options.length) };
        break;
      }
      case 'empty': {
        const delta = -d;
        if (cid === prevState.centerCid) {
          nextState = { ...prevState, donors: new Map(), optionIndex: 0, symmetry: undefined };
          break;
        }
        const emptyCache = cache.empty.get(prevState.centerCid);
        if (!emptyCache) {
          nextState = { type: 'idle' };
          break;
        }
        const donorRule = emptyCache.donorRules.get(cid);
        if (!donorRule) {
          nextState = { type: 'idle' };
          break;
        }
        if (prevState.symmetry) {
          if (!prevState.symmetry.donorCids.includes(cid)) {
            nextState = { type: 'idle' };
            break;
          }
          const allowed = emptyCache.allowedSymmetricDonations(prevState.symmetry.mode);
          const currentIndex = allowed.indexOf(prevState.symmetry.donate);
          const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, d, allowed.length);
          const nextDonate = allowed[nextIndex];
          if (nextDonate === 0) {
            nextState = { type: 'empty', centerCid: prevState.centerCid, donors: new Map(prevState.symmetry.savedDonors), optionIndex: 0 };
            break;
          }
          nextState = {
            ...prevState,
            donors: applySymmetryDonations(emptyCache, prevState.symmetry.savedDonors, prevState.symmetry.donorCids, nextDonate),
            optionIndex: 0,
            symmetry: { ...prevState.symmetry, donate: nextDonate },
          };
          break;
        }
        const validValues = donorRule.allowedDisplayedHeights;
        const currentDisp = prevState.donors.get(cid) ?? donorRule.actualPrimary;
        const currentIndex = validValues.indexOf(currentDisp);
        const newDisp = validValues[cycleIndex(currentIndex >= 0 ? currentIndex : 0, delta, validValues.length)];
        const currentDonate = donorRule.actualPrimary - currentDisp;
        const nextDonate = donorRule.actualPrimary - newDisp;
        const participating = getParticipatingDonors(emptyCache, prevState.donors, prevState.symmetry);
        const otherParticipating = participating.filter((entry) => entry.cid !== cid);
        const isCurrentlyParticipating = currentDonate > 0;
        if (!isCurrentlyParticipating && nextDonate > 0) {
          if (otherParticipating.length === 1 && !canPairWithAnyDonations(emptyCache, otherParticipating[0].cid, cid)) {
            nextState = { type: 'idle' };
            break;
          }
          if (otherParticipating.length === 2) {
            const symmetryMode = emptyCache.symmetryModeForThird([otherParticipating[0].cid, otherParticipating[1].cid, cid]);
            if (symmetryMode === null) {
              nextState = { type: 'idle' };
              break;
            }
            const symmetryDonorCids = symmetryMode === 'sym6' ? [...emptyCache.donorCids] : [otherParticipating[0].cid, otherParticipating[1].cid, cid];
            const allowed = emptyCache.allowedSymmetricDonations(symmetryMode);
            const defaultDonate = allowed.includes(nextDonate) ? nextDonate : allowed.find((value) => value > 0) ?? 0;
            if (defaultDonate <= 0) {
              nextState = { type: 'idle' };
              break;
            }
            const savedDonors = new Map(prevState.donors);
            nextState = {
              type: 'empty',
              centerCid: prevState.centerCid,
              donors: applySymmetryDonations(emptyCache, savedDonors, symmetryDonorCids, defaultDonate),
              optionIndex: 0,
              symmetry: { mode: symmetryMode, donate: defaultDonate, savedDonors, donorCids: symmetryDonorCids },
            };
            break;
          }
          if (otherParticipating.length >= 3) {
            nextState = { type: 'idle' };
            break;
          }
        }
        const newDonors = new Map(prevState.donors);
        newDonors.set(cid, newDisp);
        nextState = { ...prevState, donors: newDonors, optionIndex: 0 };
        break;
      }
      case 'own_primary': {
        if (cid === prevState.originCid) {
          if (prevState.targetCid !== null) {
            nextState = { ...prevState, targetCid: null, optionIndex: 0 };
            break;
          }
          const primaryCache = cache.ownPrimary.get(prevState.originCid);
          const secondaryCache = cache.ownSecondary.get(prevState.originCid);
          if (secondaryCache && secondaryCache.split.emptyAdjDirs.length > 0 && primaryCache?.canEnterSecondary) {
            nextState = { type: 'own_secondary', originCid: prevState.originCid, allocations: [0, 0, 0, 0, 0, 0] };
          }
          break;
        }
        const primaryCache = cache.ownPrimary.get(prevState.originCid);
        if (!primaryCache || !primaryCache.highlighted.has(cid)) {
          nextState = { type: 'idle' };
          break;
        }
        const targetOptions = primaryCache.targets.get(cid);
        if (!targetOptions || targetOptions.options.length === 0) break;
        if (prevState.targetCid === cid) {
          nextState = targetOptions.options.length <= 1 ? prevState : { ...prevState, optionIndex: cycleIndex(prevState.optionIndex, d, targetOptions.options.length) };
          break;
        }
        nextState = { ...prevState, targetCid: cid, optionIndex: d === -1 ? targetOptions.options.length - 1 : 0 };
        break;
      }
      case 'own_secondary': {
        if (cid === prevState.originCid) {
          const hasAllocations = prevState.allocations.some((value) => value > 0);
          if (hasAllocations) {
            nextState = { ...prevState, allocations: [0, 0, 0, 0, 0, 0] };
            break;
          }
          nextState = { type: 'own_primary', originCid: prevState.originCid, targetCid: null, optionIndex: 0 };
          break;
        }
        const dir = getNeighborDirection(prevState.originCid, cid);
        const secondaryCache = dir === null ? null : cache.ownSecondary.get(prevState.originCid);
        if (dir === null || !secondaryCache || !secondaryCache.split.emptyAdjDirs.includes(dir)) {
          nextState = { type: 'idle' };
          break;
        }
        const allowed = secondaryCache.split.allowedAllocValues(dir, prevState.allocations);
        const current = prevState.allocations[dir];
        const currentIndex = allowed.indexOf(current);
        const nextIndex = cycleIndex(currentIndex >= 0 ? currentIndex : 0, d, allowed.length);
        const newAllocations = [...prevState.allocations];
        newAllocations[dir] = allowed[nextIndex];
        nextState = { ...prevState, allocations: newAllocations };
        break;
      }
    }

    commitUiState(nextState);
  };

  const getEmptyStateAction = (): number | null => {
    if (!gameState || !cache || uiState.type !== 'empty') return null;
    const emptyCache = cache.empty.get(uiState.centerCid);
    if (!emptyCache) return null;
    if (uiState.symmetry) {
      if (uiState.symmetry.donate <= 0) return null;
      return emptyCache.constructSymCombineAction(uiState.symmetry.mode, uiState.symmetry.donate);
    }
    const participating = getParticipatingDonors(emptyCache, uiState.donors, uiState.symmetry);
    if (participating.length === 2) {
      const [a, b] = participating;
      return emptyCache.constructCombineAction(a.cid, b.cid, a.donate, b.donate);
    }
    if (participating.length === 3) {
      const mode = emptyCache.symmetryModeForThird(participating.map((entry) => entry.cid));
      if (!mode || mode === 'sym6') return null;
      return emptyCache.constructSymCombineAction(mode, participating[0].donate);
    }
    if (participating.length === 6) {
      return emptyCache.constructSymCombineAction('sym6', participating[0].donate);
    }
    return null;
  };

  const getOwnSecondaryAction = (): number | null => {
    if (!gameState || !cache || uiState.type !== 'own_secondary') return null;
    const secondaryCache = cache.ownSecondary.get(uiState.originCid);
    const originUnit = engine.unitByteToUnit(gameState.board[uiState.originCid]);
    if (!secondaryCache || !originUnit) return null;
    const allocations = uiState.allocations;
    if (!secondaryCache.split.isRemainingValid(allocations)) return null;
    const backstabbAction = secondaryCache.split.deriveBackstabbAction(allocations);
    if (backstabbAction !== null) return backstabbAction;
    if (allocations.some((value) => value > 0 && value >= originUnit.p) || allocations.some((value) => !isValidSplitHeight(value))) return null;
    const totalAllocated = allocations.reduce((a, b) => a + b, 0);
    const remainder = originUnit.p - totalAllocated;
    if (remainder < 0 || !isValidHeight(remainder)) return null;
    const unitCount = allocations.filter((value) => value > 0).length + (remainder > 0 ? 1 : 0);
    if (unitCount < 2) return null;
    return secondaryCache.split.constructSplitAction(allocations);
  };

  const getPendingAction = (): number | null => {
    if (!cache) return null;
    switch (uiState.type) {
      case 'enemy': {
        const enemyCache = cache.enemy.get(uiState.targetCid);
        return enemyCache?.options[uiState.optionIndex] ?? null;
      }
      case 'empty':
        return getEmptyStateAction();
      case 'own_primary': {
        if (uiState.targetCid === null) return null;
        return cache.ownPrimary.get(uiState.originCid)?.targets.get(uiState.targetCid)?.options[uiState.optionIndex] ?? null;
      }
      case 'own_secondary':
        return getOwnSecondaryAction();
      default:
        return null;
    }
  };

  const finishTurn = (color: PlayerColor) => {
    if (!gameState || gameState.status === 'ended') return;
    if (turnStartTimeRef.current === null) {
      startClockFor(color);
      return;
    }
    const elapsed = Math.max(0, Date.now() - turnStartTimeRef.current);
    const result = applyTurnEnd({
      clocksMs: clocksRef.current,
      buffersMs: bufferRef.current,
      timeControl,
      mover: color,
      elapsedMs: elapsed,
    });
    clocksRef.current = result.clocksMs;
    bufferRef.current = result.buffersMs;
    setClocksMs(result.clocksMs);
    setBufferMsRemaining(result.buffersMs);
    if (result.timedOut) {
      applyTimeoutLoss(color);
      return;
    }
    const nextColor = opponentOf(color);
    setActiveClockColor(nextColor);
    setPendingClockTapColor(null);
    setMessageText(null);
    startClockFor(nextColor);
  };

  const submitCurrentAction = (options?: { endTurn?: boolean }): engine.State | null => {
    if (!gameState) return null;
    const action = getPendingAction();
    if (action === null || !cache?.legalSet.has(action >>> 0)) return null;
    const moverColor = toClockColor(gameState.turn);
    let nextState = engine.applyAction(gameState, action);
    let finalAction = action;
    if (nextState.status !== 'ended' && !hasTurnActions(nextState)) {
      finalAction = engine.encodeEnd(1, nextState.turn);
      nextState = engine.applyAction(nextState, finalAction);
    }
    setGameState(nextState);
    setLastActionWord(finalAction);
    commitUiState({ type: 'idle' });
    if (nextState.status === 'ended') {
      setClockRunning(false);
      setPendingClockTapColor(null);
    } else if (options?.endTurn) {
      if (isWideLayout && autoFlipEnabled) {
        setIsFlipped(nextState.turn === 0);
      }
      finishTurn(moverColor);
    } else {
      setPendingClockTapColor(moverColor);
      if (isWideLayout && autoFlipEnabled) {
        setIsFlipped(nextState.turn === 0);
      }
    }
    return nextState;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && uiStateRef.current.type !== 'idle') {
        event.preventDefault();
        commitUiState({ type: 'idle' });
        return;
      }
      if (event.key !== ' ') return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      const action = getPendingAction();
      const canSubmitNow = Boolean(
        gameStarted &&
          pendingClockTapColor === null &&
          action !== null &&
          cache?.legalSet.has(action >>> 0) &&
          gameState?.status !== 'ended',
      );
      const canStartNow = Boolean(gameState?.status !== 'ended' && !gameStarted);
      if (isWideLayout && (canStartNow || canSubmitNow)) {
        event.preventDefault();
        if (!gameStarted) {
          startClockFor(activeClockColor);
          setMessageText(null);
          return;
        }
        submitCurrentAction({ endTurn: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameStarted, pendingClockTapColor, cache, uiState, gameState, activeClockColor, autoFlipEnabled, isWideLayout]);

  const getPreviewOverlay = (): PreviewOverlay | null => {
    if (!gameState || !cache) return null;
    if (uiState.type === 'empty') {
      const emptyCache = cache.empty.get(uiState.centerCid);
      if (!emptyCache) return null;
      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      let totalDonation = 0;
      let tribunTransferred = false;
      let hasParticipation = false;
      for (const cid of emptyCache.donorCids) {
        const donorRule = emptyCache.donorRules.get(cid);
        if (!donorRule) continue;
        const display = getDonorDisplayHeight(emptyCache, uiState.donors, cid, uiState.symmetry);
        if (display === null) continue;
        const donate = donorRule.actualPrimary - display;
        if (donate <= 0) continue;
        const unit = engine.unitByteToUnit(gameState.board[cid]);
        if (!unit) continue;
        hasParticipation = true;
        totalDonation += donate;
        const remaining = unit.p - donate;
        if (remaining > 0) {
          overlay.units.set(cid, { p: remaining, s: unit.s, color: unit.color, tribun: unit.tribun });
        } else if (unit.s > 0) {
          overlay.units.set(cid, { p: 0, s: unit.s, color: unit.color, tribun: false });
        } else {
          overlay.empty.add(cid);
        }
        if (unit.tribun && donate === unit.p) tribunTransferred = true;
      }
      if (!hasParticipation) return null;
      if (totalDonation > 0) {
        overlay.units.set(uiState.centerCid, { p: totalDonation, s: 0, color: gameState.turn, tribun: tribunTransferred });
      }
      return overlay;
    }
    if (uiState.type === 'own_secondary') {
      const originUnit = engine.unitByteToUnit(gameState.board[uiState.originCid]);
      if (!originUnit) return null;
      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      const totalAllocated = uiState.allocations.reduce((a, b) => a + b, 0);
      const remainder = originUnit.p - totalAllocated;
      const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
      for (let dir = 0; dir < 6; dir += 1) {
        if (uiState.allocations[dir] > 0) {
          const [dx, dy] = NEIGHBOR_VECTORS[dir];
          try {
            overlay.units.set(engine.encodeCoord(ox + dx, oy + dy), { p: uiState.allocations[dir], s: 0, color: originUnit.color, tribun: false });
          } catch {
            // ignore invalid edge
          }
        }
      }
      if (remainder > 0) {
        overlay.units.set(uiState.originCid, { p: remainder, s: originUnit.s, color: originUnit.color, tribun: originUnit.tribun });
      } else if (originUnit.s > 0) {
        overlay.units.set(uiState.originCid, { p: 0, s: originUnit.s, color: originUnit.color, tribun: originUnit.tribun });
      } else {
        overlay.empty.add(uiState.originCid);
      }
      return overlay;
    }
    return null;
  };

  const getPreviewState = (): engine.State | null => {
    if (!gameState) return null;
    const pendingAction = getPendingAction();
    if (pendingAction === null) return null;
    try {
      return engine.applyAction(gameState, pendingAction);
    } catch {
      return null;
    }
  };

  const pendingAction = getPendingAction();
  const canSubmit = Boolean(
    gameStarted &&
      pendingClockTapColor === null &&
      pendingAction !== null &&
      cache?.legalSet.has(pendingAction >>> 0) &&
      gameState?.status !== 'ended',
  );
  const canStartGame = Boolean(gameState?.status !== 'ended' && !gameStarted);
  const canPressSubmit = canStartGame || canSubmit;
  const submitButtonLabel = !gameStarted ? 'Start Game' : 'Submit Move';

  const baseTileStates = useMemo(() => {
    const baseStates: Array<'default' | 'selectable'> = new Array(121).fill('default');
    if (!gameState || !cache || !canInteractAsPlayer) return baseStates;
    for (const cid of cache.enemy.keys()) baseStates[cid] = 'selectable';
    for (const cid of cache.empty.keys()) baseStates[cid] = 'selectable';
    for (const cid of cache.ownPrimary.keys()) {
      if ((cache.ownPrimary.get(cid)?.targets.size ?? 0) > 0) baseStates[cid] = 'selectable';
    }
    for (const cid of cache.ownSecondary.keys()) {
      if ((cache.ownSecondary.get(cid)?.split.emptyAdjDirs.length ?? 0) > 0) baseStates[cid] = 'selectable';
    }
    return baseStates;
  }, [gameState, cache, canInteractAsPlayer]);

  const drawOfferBy = gameState?.drawOfferBy ?? null;
  const drawOfferBlocked = gameState?.drawOfferBlocked ?? null;

  const getClusterControls = (color: PlayerColor) => {
    const actor = toEngineColor(color);
    const hasOffer = drawOfferBy !== null;
    const isOfferer = hasOffer && drawOfferBy === actor;
    const isReceiver = hasOffer && drawOfferBy !== actor;
    const isBlocked = drawOfferBlocked === actor;
    const drawAction =
      gameState?.status === 'ended'
        ? null
        : hasOffer
        ? isOfferer
          ? engine.encodeDraw(1, actor)
          : isReceiver
          ? engine.encodeDraw(2, actor)
          : null
        : isBlocked
        ? null
        : engine.encodeDraw(0, actor);
    const surrenderAction =
      gameState?.status === 'ended' ? null : isReceiver ? engine.encodeDraw(3, actor) : engine.encodeEnd(0, actor);
    const drawOfferLockedThisPly = drawAction === engine.encodeDraw(0, actor) && drawOfferPlyByColor[color] === gameState?.ply;
    return {
      drawAction,
      surrenderAction,
      drawLabel: hasOffer ? (isOfferer ? 'Withdraw' : 'Accept') : isBlocked ? 'Rejected' : 'Draw',
      surrenderLabel: isReceiver ? 'Decline' : 'Surrender',
      canDraw: Boolean(drawAction !== null && cache?.legalSet.has(drawAction >>> 0) && !drawOfferLockedThisPly),
      canSurrender: Boolean(surrenderAction !== null && cache?.legalSet.has(surrenderAction >>> 0)),
      isOfferer,
    };
  };

  const handleAuxAction = (action: number | null, color: PlayerColor) => {
    if (!action || !cache?.legalSet.has(action >>> 0)) return;
    const decoded = engine.decodeAction(action);
    if (decoded.opcode === 10 && decoded.fields.drawAction === 0) {
      setDrawOfferPlyByColor((prev) => ({ ...prev, [color]: gameState?.ply ?? prev[color] }));
    }
    applyFinalAction(action);
  };

  const handleClockClick = (color: PlayerColor) => {
    if (!gameState || gameState.status === 'ended') return;
    if (isWideLayout) return;
    if (color !== activeClockColor) {
      setTransientMessage(`Wait for ${activeClockColor === 'black' ? 'Black' : 'White'} clock.`);
      return;
    }
    if (!gameStarted) {
      startClockFor(color);
      setMessageText(null);
      return;
    }
    if (canSubmit) {
      const nextState = submitCurrentAction({ endTurn: true });
      if (!nextState) {
        setTransientMessage('Select a legal move first.', 'error');
      }
      return;
    }
    if (pendingClockTapColor !== color) {
      return;
    }
    finishTurn(color);
  };

  const endInfo = useMemo(() => {
    if (!gameState || gameState.status !== 'ended') return null;
    if (lastActionWord === null) {
      return { reason: 'Game ended', winnerLabel: formatColorName(gameState.winner ?? null) };
    }
    const decoded = engine.decodeAction(lastActionWord);
    if (decoded.opcode === 11) {
      const endReason = decoded.fields.endReason;
      if (endReason === 0) {
        return { reason: `${formatColorName(decoded.fields.loserColor as engine.Color)} resigned`, winnerLabel: formatColorName(gameState.winner ?? null) };
      }
      if (endReason === 1) {
        return { reason: `${formatColorName(decoded.fields.loserColor as engine.Color)} has no legal moves`, winnerLabel: formatColorName(gameState.winner ?? null) };
      }
      if (endReason === 2) {
        return { reason: `${formatColorName(decoded.fields.loserColor as engine.Color)} ran out of time`, winnerLabel: formatColorName(gameState.winner ?? null) };
      }
      return {
        reason:
          timeControl.maxGameMs != null
            ? `Time limit reached (${formatTime(totalGameTimeMs)} / ${formatTime(timeControl.maxGameMs)})`
            : `Time limit reached (${formatTime(totalGameTimeMs)})`,
        winnerLabel: 'Tie',
      };
    }
    if (decoded.opcode === 10 && decoded.fields.drawAction === 2) {
      return { reason: 'Draw agreed', winnerLabel: 'Tie' };
    }
    if (decoded.opcode === 9) {
      return { reason: `Tribun captured by ${formatColorName(decoded.fields.winnerColor as engine.Color)}`, winnerLabel: formatColorName(gameState.winner ?? null) };
    }
    return { reason: 'Game ended', winnerLabel: formatColorName(gameState.winner ?? null) };
  }, [gameState, lastActionWord, timeControl.maxGameMs, totalGameTimeMs]);

  const renderBoard = () => {
    if (!gameState) return null;
    const previewOverlay = getPreviewOverlay();
    const previewState = previewOverlay ? null : getPreviewState();
    const displayState = previewState ?? gameState;
    const innerHexSize = 45;
    const borderWidth = 2;
    const spacingMultiplier = 0.98;
    const outerHexSize = innerHexSize + borderWidth;
    const centerSize = outerHexSize * spacingMultiplier;
    const d = (Math.sqrt(3) / 2) * centerSize;
    const outerHexWidth = 2 * outerHexSize;
    const outerHexHeight = Math.sqrt(3) * outerHexSize;
    const validTiles: Array<{ cid: number; x: number; y: number; displayX: number; displayY: number }> = [];
    for (let cid = 0; cid < 121; cid += 1) {
      if (engine.isValidTile(cid)) {
        const { x, y } = engine.decodeCoord(cid);
        const displayX = isFlipped ? -x : x;
        const displayY = isFlipped ? -y : y;
        validTiles.push({ cid, x, y, displayX, displayY });
      }
    }
    let minPixelX = Infinity, maxPixelX = -Infinity, minPixelY = Infinity, maxPixelY = -Infinity;
    validTiles.forEach(({ displayX, displayY }) => {
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      minPixelX = Math.min(minPixelX, centerX - outerHexWidth / 2);
      maxPixelX = Math.max(maxPixelX, centerX + outerHexWidth / 2);
      minPixelY = Math.min(minPixelY, centerY - outerHexHeight / 2);
      maxPixelY = Math.max(maxPixelY, centerY + outerHexHeight / 2);
    });
    const tilePixels: TilePixelData[] = validTiles.map(({ cid, x, y, displayX, displayY }) => {
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      return {
        cid,
        x,
        y,
        displayX,
        displayY,
        centerX: centerX - minPixelX,
        centerY: centerY - minPixelY,
        hexX: centerX - outerHexWidth / 2 - minPixelX,
        hexY: centerY - outerHexHeight / 2 - minPixelY,
      };
    });
    const selectedTiles: number[] = [];
    const interactableTiles: number[] = [];
    if (cache) {
      switch (uiState.type) {
        case 'enemy':
          selectedTiles.push(uiState.targetCid);
          interactableTiles.push(uiState.targetCid);
          break;
        case 'empty': {
          selectedTiles.push(uiState.centerCid);
          const emptyCache = cache.empty.get(uiState.centerCid);
          if (emptyCache) {
            interactableTiles.push(...emptyCache.donorCids);
          }
          break;
        }
        case 'own_primary': {
          selectedTiles.push(uiState.originCid);
          if (uiState.targetCid !== null) selectedTiles.push(uiState.targetCid);
          const primaryCache = cache.ownPrimary.get(uiState.originCid);
          if (primaryCache) interactableTiles.push(...Array.from(primaryCache.highlighted).filter((cid) => cid !== uiState.originCid));
          break;
        }
        case 'own_secondary': {
          selectedTiles.push(uiState.originCid);
          const secondaryCache = cache.ownSecondary.get(uiState.originCid);
          if (secondaryCache) {
            const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
            for (const dir of secondaryCache.split.emptyAdjDirs) {
              const [dx, dy] = NEIGHBOR_VECTORS[dir];
              try {
                interactableTiles.push(engine.encodeCoord(ox + dx, oy + dy));
              } catch {
                // ignore off-board
              }
            }
          }
          break;
        }
      }
    }
    const selectedSet = new Set(selectedTiles);
    const interactableSet = new Set(interactableTiles);
    const previewStateBoard = displayState.board;
    const splitOffsetX = 12;
    const splitOffsetY = 15;
    const renderVisualUnit = (unit: PreviewOverlayUnit, mode: 'icon' | 'number' = 'icon') => {
      if (unit.p <= 0 && unit.s <= 0) return null;
      const effectiveMode = unitIconsReady && mode === 'icon' ? 'icon' : 'number';
      const textColor = unit.tribun ? (unit.color === 0 ? '#AE0000' : '#00B4FF') : unit.color === 0 ? '#000' : '#fff';
      const textColorSecondary = unit.color === 0 ? '#fff' : '#000';
      const strokeColor = unit.tribun ? (unit.color === 0 ? '#000' : '#fff') : unit.color === 0 ? '#fff' : '#000';
      const strokeColorSecondary = unit.color === 0 ? '#000' : '#fff';
      const sizePx = unit.tribun ? 72 : 64;
      const content =
        unit.s > 0 ? (
          <SplitUnitGlyph
            mode={effectiveMode}
            primary={{ height: unit.s, tribun: false }}
            secondary={{ height: unit.p, tribun: unit.tribun }}
            sizePx={sizePx}
            offsetPx={{ x: splitOffsetX, y: splitOffsetY }}
            numberColors={{
              primary: { fill: textColorSecondary, stroke: strokeColorSecondary },
              secondary: { fill: textColor, stroke: strokeColor },
            }}
          />
        ) : (
          <UnitGlyph
            mode={effectiveMode}
            unit={{ height: unit.p, tribun: unit.tribun }}
            sizePx={sizePx}
            numberColor={{ fill: textColor, stroke: strokeColor }}
          />
        );
      return content;
    };
    const tileFills: JSX.Element[] = [];
    const tileRings: JSX.Element[] = [];
    const tileUnits: JSX.Element[] = [];
    const tileHits: JSX.Element[] = [];
    const hexClipPath = 'polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)';
    const BOARD_Z_FILL = 2;
    const BOARD_Z_RING = 5;
    const BOARD_Z_UNIT = 7;
    const BOARD_Z_HIT = 9;
    const hoverBoardSurfaceZOffset = 10;
    const hoverBoardFillZBump = 1;
    const rotateUnitsMobile = !isWideLayout && gameState.turn === 0;
    tilePixels.forEach(({ cid, x, y, hexX, hexY }) => {
      const overlayUnit = previewOverlay?.units.get(cid);
      const staticUnit = overlayUnit ? overlayUnit : previewOverlay?.empty.has(cid) ? null : engine.unitByteToUnit(previewStateBoard[cid]);
      const baseColor = getBaseColor(x, y);
      const isSelectedTile = selectedSet.has(cid);
      const isInteractableTile = interactableSet.has(cid);
      let hexagonState: HexagonState = baseTileStates[cid] ?? 'default';
      if (isSelectedTile) hexagonState = 'selected';
      else if (isInteractableTile) hexagonState = 'interactable';
      const tileColor = getHexagonColor(baseColor, hexagonState);
      const tileBorderWidth = isSelectedTile || isInteractableTile ? 2 : 2;
      const tileInnerOffsetX = tileBorderWidth;
      const tileInnerOffsetY = (Math.sqrt(3) / 2) * tileBorderWidth;
      const tileInnerWidth = outerHexWidth - tileBorderWidth * 2;
      const tileInnerHeight = outerHexHeight - Math.sqrt(3) * tileBorderWidth;
      const isClickable = canInteractAsPlayer && (isSelectedTile || isInteractableTile || (uiState.type === 'idle' && baseTileStates[cid] === 'selectable'));
      const isHoveredTile = hoveredBoardCid === cid && isClickable;
      const tileHoverScale = isHoveredTile ? 'scale(1.1)' : 'scale(1)';
      const zFill = isHoveredTile ? BOARD_Z_FILL + hoverBoardFillZBump : BOARD_Z_FILL;
      const zRing = BOARD_Z_RING + (isHoveredTile ? hoverBoardSurfaceZOffset : 0);
      const zUnit = BOARD_Z_UNIT + (isHoveredTile ? hoverBoardSurfaceZOffset : 0);
      const zHit = BOARD_Z_HIT + (isHoveredTile ? hoverBoardSurfaceZOffset : 0);
      const unitLayerTransform = rotateUnitsMobile ? `rotate(180deg) ${tileHoverScale}` : tileHoverScale;
      const fillLeft = hexX + tileInnerOffsetX;
      const fillTop = hexY + tileInnerOffsetY;
      tileFills.push(
        <div
          key={`fill-${cid}`}
          style={{
            position: 'absolute',
            left: `${fillLeft}px`,
            top: `${fillTop}px`,
            width: `${tileInnerWidth}px`,
            height: `${tileInnerHeight}px`,
            clipPath: hexClipPath,
            background: tileColor,
            zIndex: zFill,
            pointerEvents: 'none',
            transform: tileHoverScale,
            transformOrigin: 'center',
            transition: 'transform 0.2s ease',
          }}
        />,
      );
      tileRings.push(
        <div key={`ring-${cid}`} style={{ position: 'absolute', left: `${hexX}px`, top: `${hexY}px`, width: `${outerHexWidth}px`, height: `${outerHexHeight}px`, zIndex: zRing, pointerEvents: 'none', transform: tileHoverScale, transformOrigin: 'center', transition: 'transform 0.2s ease' }}>
          <div style={{ position: 'absolute', inset: 0, clipPath: hexClipPath, background: '#222' }} />
          <div style={{ position: 'absolute', left: `${tileInnerOffsetX}px`, top: `${tileInnerOffsetY}px`, width: `${tileInnerWidth}px`, height: `${tileInnerHeight}px`, clipPath: hexClipPath, background: tileColor }} />
        </div>,
      );
      tileUnits.push(
        <div
          key={`unit-${cid}`}
          style={{
            position: 'absolute',
            left: `${fillLeft}px`,
            top: `${fillTop}px`,
            width: `${tileInnerWidth}px`,
            height: `${tileInnerHeight}px`,
            clipPath: hexClipPath,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: zUnit,
            pointerEvents: 'none',
            transform: unitLayerTransform,
            transformOrigin: 'center',
            transition: 'transform 0.2s ease',
          }}
        >
          {staticUnit ? renderVisualUnit(staticUnit, uiState.type === 'empty' || uiState.type === 'own_secondary' ? 'number' : 'icon') : null}
        </div>,
      );
      tileHits.push(
        <div
          key={`hit-${cid}`}
          style={{
            position: 'absolute',
            left: `${hexX}px`,
            top: `${hexY}px`,
            width: `${outerHexWidth}px`,
            height: `${outerHexHeight}px`,
            clipPath: hexClipPath,
            background: 'transparent',
            zIndex: zHit,
            cursor: isClickable ? 'pointer' : 'default',
            transform: tileHoverScale,
            transformOrigin: 'center',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={() => isClickable && setHoveredBoardCid(cid)}
          onMouseLeave={() => setHoveredBoardCid((prev) => (prev === cid ? null : prev))}
          onClick={() => {
            if (isClickable) {
              playSfx('tileClick');
              handleTileClick(cid, 1);
            } else if (uiState.type !== 'idle') {
              commitUiState({ type: 'idle' });
            }
          }}
          onContextMenu={(event: ReactPointerEvent<HTMLDivElement>) => {
            event.preventDefault();
            if (isClickable) {
              playSfx('tileClick');
              handleTileClick(cid, -1);
            } else if (uiState.type !== 'idle') {
              commitUiState({ type: 'idle' });
            }
          }}
        />,
      );
    });
    const boardWidth = maxPixelX - minPixelX + 2;
    const boardHeight = maxPixelY - minPixelY + 2;
    const availableWidth = boardViewportWidth || boardWidth;
    const availableHeight = boardViewportHeight || boardHeight;
    const scale = Math.min(1, availableWidth / boardWidth, availableHeight / boardHeight);
    return (
      <div
        ref={boardViewportRef}
        style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `${boardWidth}px`,
            height: `${boardHeight}px`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center',
          }}
        >
          {tileFills}
          {tileRings}
          {tileUnits}
          {tileHits}
        </div>
      </div>
    );
  };

  if (!payload || !boot || 'error' in boot || !gameState) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f7f0e5', padding: '24px' }}>
        <div style={{ maxWidth: '480px', borderRadius: '18px', border: '2px solid #3c3226', background: '#fff7ea', padding: '20px', display: 'grid', gap: '12px' }}>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>Local game unavailable</div>
          <div style={{ color: '#5a4630', lineHeight: 1.45 }}>{bootError ?? 'The local lobby payload is missing or invalid.'}</div>
          <button type="button" onClick={() => navigate('/local', { replace: true })} style={{ padding: '10px 16px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#f2d9b2', color: '#2a2218', fontWeight: 700, cursor: 'pointer' }}>
            Back to Local Lobby
          </button>
        </div>
      </div>
    );
  }

  const topColor: PlayerColor = 'black';
  const bottomColor: PlayerColor = 'white';
  const topControls = getClusterControls(topColor);
  const bottomControls = getClusterControls(bottomColor);
  const contentPadding = isWideLayout ? '16px 20px 20px' : '8px 8px 14px';
  const topLostOnTime = Boolean(
    lastActionWord !== null &&
      engine.decodeAction(lastActionWord).opcode === 11 &&
      engine.decodeAction(lastActionWord).fields.endReason === 2 &&
      engine.decodeAction(lastActionWord).fields.loserColor === toEngineColor(topColor),
  );
  const bottomLostOnTime = Boolean(
    lastActionWord !== null &&
      engine.decodeAction(lastActionWord).opcode === 11 &&
      engine.decodeAction(lastActionWord).fields.endReason === 2 &&
      engine.decodeAction(lastActionWord).fields.loserColor === toEngineColor(bottomColor),
  );
  const statusStripTone = messageTone;

  const applyManualFlip = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleSubmitMove = () => {
    if (!gameStarted) {
      startClockFor(activeClockColor);
      setMessageText(null);
      return;
    }
    const nextState = submitCurrentAction({ endTurn: true });
    if (!nextState) {
      setTransientMessage('Select a legal move first.', 'error');
      return;
    }
    setMessageText(null);
  };

  const handleRevanche = () => {
    if (!payload) return;
    const nextStart = payload.initialState
      ? toPlayerColor(payload.initialState.turn)
      : resolveNextStartColor(payload.roomSettings.nextStartColor, payload.resolvedStartColor);
    const newPayload: LocalLobbyPayload = {
      ...payload,
      createdAtMs: Date.now(),
      resolvedStartColor: nextStart,
    };
    saveLocalLobbyPayload(newPayload);
    setShowEndModal(false);
    navigate('/local/play', { state: newPayload, replace: true });
  };

  const actionButtonStyle = {
    width: '100%',
    padding: '12px',
    borderRadius: '12px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  };

  const renderDesktopClock = (color: PlayerColor, lostOnTime: boolean) => {
    const isActive = gameState.status !== 'ended' && activeClockColor === color;
    const isRunning = isActive && clockRunning;
    const showBuffer = Boolean(isRunning && bufferMsRemaining[color] > 0);
    const clockValue = formatTime(clocksMs[color]);
    const bufferValue = formatTime(bufferMsRemaining[color]);
    const tone = color === 'black' ? '#f4efe6' : '#1c1b19';
    const surface = color === 'black' ? '#2b2620' : '#f6eddf';
    const borderColor = lostOnTime ? '#a63d32' : isActive ? '#b9833b' : '#3b3327';

    return (
      <div
        aria-hidden
          style={{
            position: 'relative',
            width: '100%',
            height: '72px',
            borderRadius: '12px',
            border: `2px solid ${borderColor}`,
            background: surface,
            color: tone,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
            letterSpacing: '1px',
            boxShadow: '0 8px 16px rgba(20, 15, 10, 0.12)',
            cursor: 'default',
            pointerEvents: 'none',
            padding: 0,
          }}
        >
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

  const renderDesktopActions = (
    color: PlayerColor,
    controls: ReturnType<typeof getClusterControls>,
    order: 'surrender-draw' | 'draw-surrender',
  ) => {
    const surrenderButton = (
      <button
        key="surrender"
        type="button"
        onClick={() => {
          if (controls.surrenderAction === null) return;
          if (engine.decodeAction(controls.surrenderAction).opcode === 11) {
            setConfirmSurrenderColor(color);
            return;
          }
          handleAuxAction(controls.surrenderAction, color);
        }}
        disabled={!controls.canSurrender}
        style={{
          ...actionButtonStyle,
          border: '2px solid #5b2a2a',
          background: controls.canSurrender ? '#8b3b3b' : '#b9a2a2',
          color: '#f8f1e7',
          cursor: controls.canSurrender ? 'pointer' : 'not-allowed',
        }}
      >
        {controls.surrenderLabel}
      </button>
    );
    const drawButton = (
      <button
        key="draw"
        type="button"
        onClick={() => handleAuxAction(controls.drawAction, color)}
        disabled={!controls.canDraw}
        style={{
          ...actionButtonStyle,
          border: '2px solid #5a4a2f',
          background: controls.canDraw ? '#c9a565' : '#d8c8ab',
          color: '#2a2218',
          cursor: controls.canDraw ? 'pointer' : 'not-allowed',
        }}
      >
        {controls.drawLabel}
      </button>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {order === 'surrender-draw' ? (
          <>
            {surrenderButton}
            {drawButton}
          </>
        ) : (
          <>
            {drawButton}
            {surrenderButton}
          </>
        )}
      </div>
    );
  };

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
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');`}</style>
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isWideLayout ? '12px 20px' : '10px 12px',
          gap: '12px',
          background: 'rgba(26, 21, 15, 0.92)',
          color: '#f8f1e7',
          borderBottom: '2px solid #3a2f22',
          flexWrap: 'wrap',
        }}
      >
        <PageHeaderBrand kicker="Local Match" title={`${formatColorName(gameState.turn)} to move`} textColumnStyle={{ minWidth: '150px' }} />
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => navigate('/local')} style={{ padding: '8px 14px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#f2d9b2', color: '#2a2218', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}>
            Lobby
          </button>
          <button type="button" onClick={() => navigate('/hub')} style={{ padding: '8px 14px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#f2d9b2', color: '#2a2218', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}>
            Home
          </button>
        </div>
      </div>

      <div
        style={{
          padding: contentPadding,
          display: 'flex',
          flexDirection: 'column',
          gap: isWideLayout ? '16px' : '12px',
          minHeight: 0,
          flex: 1,
        }}
      >
        {messageText ? (
          <div
            style={{
              flexShrink: 0,
              minHeight: isWideLayout ? '40px' : '48px',
              maxHeight: isWideLayout ? '40px' : '48px',
              borderRadius: '12px',
              border: `2px solid ${statusStripTone === 'error' ? '#8b3b3b' : '#d7c5ab'}`,
              background: statusStripTone === 'error' ? '#f7d7d5' : '#fff7ea',
              color: statusStripTone === 'error' ? '#5c1c16' : '#5a4630',
              padding: '10px 14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
                width: '100%',
              }}
            >
              {messageText}
            </span>
          </div>
        ) : null}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: isWideLayout ? 'grid' : 'flex',
            flexDirection: isWideLayout ? undefined : 'column',
            gridTemplateColumns: isWideLayout ? 'minmax(0, 1fr) 220px' : undefined,
            gap: '14px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              minHeight: 0,
              flex: isWideLayout ? undefined : 1,
              height: isWideLayout ? '100%' : undefined,
              overflow: 'hidden',
            }}
          >
            {!isWideLayout ? (
              <div style={{ flexShrink: 0 }}>
              <PlayerControlCluster
                color={topColor}
                clocksMs={clocksMs}
                bufferMsRemaining={bufferMsRemaining}
                activeColor={activeClockColor}
                clockRunning={clockRunning}
                ended={gameState.status === 'ended'}
                lostOnTime={topLostOnTime}
                layoutVariant="mobile-top"
                hint=""
                drawLabel={topControls.drawLabel}
                surrenderLabel={topControls.surrenderLabel}
                canDraw={topControls.canDraw}
                canSurrender={topControls.canSurrender}
                onClockClick={() => handleClockClick(topColor)}
                onDraw={() => handleAuxAction(topControls.drawAction, topColor)}
                onSurrender={() => {
                  if (topControls.surrenderAction === null) return;
                  if (engine.decodeAction(topControls.surrenderAction).opcode === 11) {
                    setConfirmSurrenderColor(topColor);
                    return;
                  }
                  handleAuxAction(topControls.surrenderAction, topColor);
                }}
              />
              </div>
            ) : null}

            <div
              style={{
                flex: 1,
                minHeight: 0,
                borderRadius: '20px',
                border: '2px solid #3c3226',
                background: 'rgba(255, 250, 242, 0.7)',
                boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
                padding: isWideLayout ? '12px' : '8px',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: 'stretch',
                overflow: 'hidden',
              }}
            >
              {isWideLayout ? (
                <button
                  type="button"
                  onClick={() => setAutoFlipEnabled((prev) => !prev)}
                  aria-pressed={autoFlipEnabled}
                  aria-label={autoFlipEnabled ? 'Disable auto flip' : 'Enable auto flip'}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    left: '8px',
                    zIndex: 3,
                    padding: '6px 12px',
                    borderRadius: '10px',
                    border: '2px solid #6f5a38',
                    background: autoFlipEnabled ? '#f2d9b2' : '#fff6e8',
                    color: '#2a2218',
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    cursor: 'pointer',
                  }}
                >
                  Auto flip
                </button>
              ) : null}
              <button
                type="button"
                onClick={applyManualFlip}
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
                  zIndex: 3,
                }}
              />
              {renderBoard()}
            </div>

            {!isWideLayout ? (
              <div style={{ flexShrink: 0 }}>
              <PlayerControlCluster
                color={bottomColor}
                clocksMs={clocksMs}
                bufferMsRemaining={bufferMsRemaining}
                activeColor={activeClockColor}
                clockRunning={clockRunning}
                ended={gameState.status === 'ended'}
                lostOnTime={bottomLostOnTime}
                layoutVariant="mobile-bottom"
                hint=""
                drawLabel={bottomControls.drawLabel}
                surrenderLabel={bottomControls.surrenderLabel}
                canDraw={bottomControls.canDraw}
                canSurrender={bottomControls.canSurrender}
                onClockClick={() => handleClockClick(bottomColor)}
                onDraw={() => handleAuxAction(bottomControls.drawAction, bottomColor)}
                onSurrender={() => {
                  if (bottomControls.surrenderAction === null) return;
                  if (engine.decodeAction(bottomControls.surrenderAction).opcode === 11) {
                    setConfirmSurrenderColor(bottomColor);
                    return;
                  }
                  handleAuxAction(bottomControls.surrenderAction, bottomColor);
                }}
              />
              </div>
            ) : null}
          </div>

          {isWideLayout ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                minHeight: 0,
                height: '100%',
                overflow: 'hidden',
              }}
            >
              <div style={{ flexShrink: 0 }}>{renderDesktopActions(topColor, topControls, 'surrender-draw')}</div>
              <div style={{ flexShrink: 0 }}>{renderDesktopClock(topColor, topLostOnTime)}</div>
              <div style={{ flex: 1, minHeight: 0 }} aria-hidden />
              <div style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={handleSubmitMove}
                  disabled={!canPressSubmit}
                  style={{
                    width: '100%',
                    padding: '24px 12px',
                    borderRadius: '12px',
                    border: '2px solid #183628',
                    background: canPressSubmit ? '#2f6b3f' : '#8ea593',
                    color: '#f7f3eb',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: canPressSubmit ? 'pointer' : 'not-allowed',
                    boxShadow: canPressSubmit ? '0 10px 18px rgba(24, 54, 40, 0.22)' : 'none',
                  }}
                >
                  {submitButtonLabel}
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }} aria-hidden />
              <div style={{ flexShrink: 0 }}>{renderDesktopClock(bottomColor, bottomLostOnTime)}</div>
              <div style={{ flexShrink: 0 }}>{renderDesktopActions(bottomColor, bottomControls, 'draw-surrender')}</div>
            </div>
          ) : null}
        </div>
      </div>

      {confirmSurrenderColor ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(20, 15, 10, 0.55)', display: 'grid', placeItems: 'center', padding: '20px', zIndex: 60 }}
          onClick={() => setConfirmSurrenderColor(null)}
        >
          <div
            style={{ width: 'min(420px, 96vw)', background: '#fff7ea', borderRadius: '18px', border: '2px solid #3c3226', padding: '20px', display: 'grid', gap: '12px', color: '#1d1a14' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#2c2318' }}>Confirm surrender</div>
            <div style={{ color: '#5a4630', lineHeight: 1.45 }}>{confirmSurrenderColor === 'black' ? 'Black' : 'White'} will resign immediately.</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmSurrenderColor(null)} style={{ padding: '10px 14px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#fff7ea', color: '#2a2218', fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const color = confirmSurrenderColor;
                  setConfirmSurrenderColor(null);
                  handleAuxAction(engine.encodeEnd(0, toEngineColor(color)), color);
                }}
                style={{ padding: '10px 14px', borderRadius: '999px', border: '2px solid #5b2a2a', background: '#8b3b3b', color: '#f8f1e7', fontWeight: 700, cursor: 'pointer' }}
              >
                Surrender
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEndModal && endInfo ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(20, 15, 10, 0.55)', display: 'grid', placeItems: 'center', padding: '20px', zIndex: 55 }}
          onClick={() => setShowEndModal(false)}
        >
          <div
            style={{ width: 'min(460px, 96vw)', background: '#fff7ea', borderRadius: '18px', border: '2px solid #3c3226', padding: '20px', display: 'grid', gap: '12px', color: '#1d1a14' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#2c2318' }}>Game ended</div>
            <div style={{ color: '#5a4630', lineHeight: 1.45 }}>{endInfo.reason}</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#2c2318' }}>{endInfo.winnerLabel}</div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setShowEndModal(false)} style={{ padding: '10px 14px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#fff7ea', color: '#2a2218', fontWeight: 700, cursor: 'pointer' }}>
                Close
              </button>
              <button type="button" onClick={() => navigate('/clock')} style={{ padding: '10px 14px', borderRadius: '999px', border: '2px solid #6f5a38', background: '#f2d9b2', color: '#2a2218', fontWeight: 700, cursor: 'pointer' }}>
                Clock
              </button>
              <button
                type="button"
                onClick={handleRevanche}
                style={{ padding: '10px 14px', borderRadius: '999px', border: '2px solid #183628', background: '#2f6b3f', color: '#f7f3eb', fontWeight: 700, cursor: 'pointer' }}
              >
                Revanche
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
