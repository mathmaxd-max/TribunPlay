import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClockTime } from './formatClockTime';
import {
  lobbyPayloadToTimeControl,
  opponentOf,
  resolveStartColor,
  settingsToLobbyPayload,
} from './buildTimeControl';
import { applyTurnEnd } from './endTurn';
import { loadStandaloneClockSettings, saveStandaloneClockSettings } from './clockStorage';
import type {
  ColorClock,
  PlayerColor,
  StandaloneClockSettings,
  StandaloneClockStatus,
  StandaloneEndReason,
  TimeControl,
} from './types';

const initialClocksFromControl = (tc: TimeControl): ColorClock => ({ ...tc.initialMs });
const initialBuffersFromControl = (tc: TimeControl): ColorClock => ({ ...tc.bufferMs });

export function useStandaloneClock() {
  const [settings, setSettings] = useState<StandaloneClockSettings>(() => loadStandaloneClockSettings());
  const [timeControl, setTimeControl] = useState<TimeControl>(() =>
    lobbyPayloadToTimeControl(settingsToLobbyPayload(loadStandaloneClockSettings())),
  );
  const [clocksMs, setClocksMs] = useState<ColorClock>(() => initialClocksFromControl(timeControl));
  const [bufferMsRemaining, setBufferMsRemaining] = useState<ColorClock>(() =>
    initialBuffersFromControl(timeControl),
  );
  const [activeColor, setActiveColor] = useState<PlayerColor>(() =>
    resolveStartColor(loadStandaloneClockSettings().startColor),
  );
  const [clockRunning, setClockRunning] = useState(false);
  const [status, setStatus] = useState<StandaloneClockStatus>('active');
  const [gameStarted, setGameStarted] = useState(false);
  const [gameStartTimeMs, setGameStartTimeMs] = useState<number | null>(null);
  const [totalGameTimeMs, setTotalGameTimeMs] = useState(0);
  const [endReason, setEndReason] = useState<StandaloneEndReason | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const clocksRef = useRef(clocksMs);
  const bufferRef = useRef(bufferMsRemaining);
  const activeColorRef = useRef(activeColor);
  const turnStartTimeRef = useRef<number | null>(null);
  const turnStartClockRef = useRef<number | null>(null);
  const turnStartBufferRef = useRef<number | null>(null);
  const hintTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    clocksRef.current = clocksMs;
  }, [clocksMs]);

  useEffect(() => {
    bufferRef.current = bufferMsRemaining;
  }, [bufferMsRemaining]);

  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);

  const clearHintSoon = useCallback((message: string) => {
    if (hintTimeoutRef.current !== null) {
      window.clearTimeout(hintTimeoutRef.current);
    }
    setHint(message);
    hintTimeoutRef.current = window.setTimeout(() => {
      setHint(null);
      hintTimeoutRef.current = null;
    }, 2200);
  }, []);

  const applyEndedPlayerTimeout = useCallback((loser: PlayerColor) => {
    setStatus('ended');
    setClockRunning(false);
    turnStartTimeRef.current = null;
    turnStartClockRef.current = null;
    turnStartBufferRef.current = null;
    setEndReason({ kind: 'timeout-player', loser, winner: opponentOf(loser) });
  }, []);

  const applyEndedGameTie = useCallback(() => {
    setStatus('ended');
    setClockRunning(false);
    turnStartTimeRef.current = null;
    turnStartClockRef.current = null;
    turnStartBufferRef.current = null;
    setEndReason({ kind: 'timeout-game-tie' });
  }, []);

  const resetInternal = useCallback(
    (nextSettings?: StandaloneClockSettings) => {
      const effectiveSettings = nextSettings ?? settings;
      const tc = lobbyPayloadToTimeControl(settingsToLobbyPayload(effectiveSettings));
      const start = resolveStartColor(effectiveSettings.startColor);
      setTimeControl(tc);
      const initialClocks = initialClocksFromControl(tc);
      const initialBuffers = initialBuffersFromControl(tc);
      setClocksMs(initialClocks);
      setBufferMsRemaining(initialBuffers);
      clocksRef.current = initialClocks;
      bufferRef.current = initialBuffers;
      setActiveColor(start);
      activeColorRef.current = start;
      setClockRunning(false);
      setStatus('active');
      setGameStarted(false);
      setGameStartTimeMs(null);
      setTotalGameTimeMs(0);
      setEndReason(null);
      setHint(null);
      turnStartTimeRef.current = null;
      turnStartClockRef.current = null;
      turnStartBufferRef.current = null;
    },
    [settings],
  );

  const reset = useCallback(() => {
    resetInternal();
  }, [resetInternal]);

  const pause = useCallback(() => {
    if (status === 'ended') return;
    setStatus('paused');
    setClockRunning(false);
    turnStartTimeRef.current = null;
    turnStartClockRef.current = null;
    turnStartBufferRef.current = null;
  }, [status]);

  const reconfigure = useCallback(
    (nextSettings: StandaloneClockSettings) => {
      saveStandaloneClockSettings(nextSettings);
      setSettings(nextSettings);
      resetInternal(nextSettings);
    },
    [resetInternal],
  );

  const startClockFor = useCallback((color: PlayerColor) => {
    const now = Date.now();
    if (!gameStarted) {
      setGameStarted(true);
      setGameStartTimeMs(now);
    }
    turnStartTimeRef.current = now;
    turnStartClockRef.current = clocksRef.current[color];
    turnStartBufferRef.current = bufferRef.current[color];
    setClockRunning(true);
  }, [gameStarted]);

  const endTurnForMover = useCallback(
    (mover: PlayerColor): boolean => {
      if (turnStartTimeRef.current === null) return false;
      const elapsed = Math.max(0, Date.now() - turnStartTimeRef.current);
      const result = applyTurnEnd({
        clocksMs: clocksRef.current,
        buffersMs: bufferRef.current,
        timeControl,
        mover,
        elapsedMs: elapsed,
      });

      clocksRef.current = result.clocksMs;
      bufferRef.current = result.buffersMs;
      setClocksMs(result.clocksMs);
      setBufferMsRemaining(result.buffersMs);

      if (result.timedOut) {
        applyEndedPlayerTimeout(mover);
        return false;
      }

      const next = opponentOf(mover);
      setActiveColor(next);
      activeColorRef.current = next;
      startClockFor(next);
      return true;
    },
    [timeControl, applyEndedPlayerTimeout, startClockFor],
  );

  const handlePanelClick = useCallback(
    (color: PlayerColor) => {
      if (status === 'ended') return;

      if (color !== activeColorRef.current) {
        clearHintSoon(`Wait for ${activeColorRef.current === 'black' ? 'Black' : 'White'} to move.`);
        return;
      }

      if (status === 'paused') {
        setStatus('active');
        startClockFor(color);
        return;
      }

      if (!gameStarted) {
        startClockFor(color);
        return;
      }

      if (clockRunning) {
        endTurnForMover(color);
      }
    },
    [status, gameStarted, clockRunning, startClockFor, endTurnForMover, clearHintSoon],
  );

  useEffect(() => {
    if (!clockRunning || status !== 'active') return;

    const tick = () => {
      const runningColor = activeColorRef.current;
      if (
        turnStartTimeRef.current === null ||
        turnStartClockRef.current === null ||
        turnStartBufferRef.current === null
      ) {
        return;
      }

      const elapsed = Math.max(0, Date.now() - turnStartTimeRef.current);
      const bufferStart = turnStartBufferRef.current;
      const clockStart = turnStartClockRef.current;
      const remainingBuffer = Math.max(0, bufferStart - elapsed);
      const timeOverBuffer = Math.max(0, elapsed - bufferStart);
      const remainingClock = Math.max(0, clockStart - timeOverBuffer);

      if (bufferRef.current[runningColor] !== remainingBuffer) {
        const nextBuffers = { ...bufferRef.current, [runningColor]: remainingBuffer };
        bufferRef.current = nextBuffers;
        setBufferMsRemaining(nextBuffers);
      }

      if (clocksRef.current[runningColor] !== remainingClock) {
        const nextClocks = { ...clocksRef.current, [runningColor]: remainingClock };
        clocksRef.current = nextClocks;
        setClocksMs(nextClocks);
      }

      if (remainingClock <= 0) {
        clocksRef.current = { ...clocksRef.current, [runningColor]: 0 };
        setClocksMs({ ...clocksRef.current, [runningColor]: 0 });
        applyEndedPlayerTimeout(runningColor);
      }
    };

    const interval = window.setInterval(tick, 100);
    tick();
    return () => window.clearInterval(interval);
  }, [clockRunning, status, activeColor, applyEndedPlayerTimeout]);

  useEffect(() => {
    if (!gameStarted || gameStartTimeMs === null) return;
    if (status === 'ended') {
      setTotalGameTimeMs(Math.max(0, Date.now() - gameStartTimeMs));
      return;
    }

    const maxGameMs = timeControl.maxGameMs;
    if (maxGameMs == null || !Number.isFinite(maxGameMs) || maxGameMs <= 0) {
      if (status === 'active' && clockRunning) {
        const interval = window.setInterval(() => {
          setTotalGameTimeMs(Math.max(0, Date.now() - gameStartTimeMs));
        }, 500);
        return () => window.clearInterval(interval);
      }
      return;
    }

    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Date.now() - gameStartTimeMs);
      setTotalGameTimeMs(elapsed);
      if (status === 'active' && elapsed >= maxGameMs) {
        applyEndedGameTie();
      }
    }, 200);

    return () => window.clearInterval(interval);
  }, [gameStarted, gameStartTimeMs, timeControl.maxGameMs, status, clockRunning, applyEndedGameTie]);

  const panelHint = useCallback(
    (color: PlayerColor): string => {
      if (status === 'ended') {
        if (endReason?.kind === 'timeout-player' && endReason.loser === color) {
          return 'Out of time';
        }
        return '';
      }
      if (color !== activeColor) return '';
      if (status === 'paused') return 'Tap to resume';
      if (!gameStarted) return 'Tap to start';
      if (clockRunning) return 'Tap to end turn';
      return '';
    },
    [status, activeColor, clockRunning, gameStarted, endReason],
  );

  const endOverlay = (() => {
    if (!endReason) return null;
    if (endReason.kind === 'timeout-player') {
      const loserLabel = endReason.loser === 'black' ? 'Black' : 'White';
      const winnerLabel = endReason.winner === 'black' ? 'Black' : 'White';
      return {
        title: "Time's up",
        reason: `${loserLabel} ran out of time (clock ${formatClockTime(0)})`,
        result: `${winnerLabel} wins on time`,
      };
    }
    const maxGameMs = timeControl.maxGameMs;
    const reason =
      maxGameMs != null && Number.isFinite(maxGameMs)
        ? `Time limit reached (${formatClockTime(totalGameTimeMs)} / ${formatClockTime(maxGameMs)})`
        : `Time limit reached (${formatClockTime(totalGameTimeMs)})`;
    return { title: "Time's up", reason, result: 'Tie' };
  })();

  const showPauseButton = status === 'active' && clockRunning;

  return {
    settings,
    timeControl,
    clocksMs,
    bufferMsRemaining,
    activeColor,
    clockRunning,
    status,
    gameStarted,
    totalGameTimeMs,
    endReason,
    hint,
    panelHint,
    endOverlay,
    showPauseButton,
    handlePanelClick,
    reset,
    pause,
    reconfigure,
  };
};
