import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccountPreferences, patchAccountPreferences } from '../settings/accountSettings';
import { preloadBoardVisualAssets } from './preloadBoardAssets';

export type BoardSfxEvent =
  | 'moveReceived'
  | 'drawReceived'
  | 'gameEnded'
  | 'boardInteract'
  | 'tileClick'
  | 'resetToIdle';

export type BoardSfxSettings = {
  muted: boolean;
  volume: number;
};

type PlaySfxOptions = {
  when?: number;
};

const DEFAULT_SETTINGS: BoardSfxSettings = {
  muted: false,
  volume: 1,
};

const EVENT_COOLDOWN_MS: Record<BoardSfxEvent, number> = {
  moveReceived: 220,
  drawReceived: 240,
  gameEnded: 800,
  boardInteract: 70,
  tileClick: 36,
  resetToIdle: 100,
};

const SFX_URLS: Record<BoardSfxEvent, string> = {
  moveReceived: new URL('../assets/audio/sfx/move_received.wav', import.meta.url).href,
  drawReceived: new URL('../assets/audio/sfx/draw_received.wav', import.meta.url).href,
  gameEnded: new URL('../assets/audio/sfx/game_ended.wav', import.meta.url).href,
  boardInteract: new URL('../assets/audio/sfx/tile_click.wav', import.meta.url).href,
  tileClick: new URL('../assets/audio/sfx/tile_click.wav', import.meta.url).href,
  resetToIdle: new URL('../assets/audio/sfx/reset_idle.wav', import.meta.url).href,
};

const canUseWebAudio = (): boolean => typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
const isContextRunning = (state: AudioContextState): boolean => state === 'running';

const clampVolume = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.volume;
  return Math.max(0, Math.min(2, value));
};

const readSettings = (): BoardSfxSettings => {
  const boardSfx = getAccountPreferences().boardSfx;
  return {
    muted: boardSfx.muted,
    volume: clampVolume(boardSfx.volume),
  };
};

let sharedAudioContext: AudioContext | null = null;
let sharedMasterGain: GainNode | null = null;
let preloadSfxPromise: Promise<void> | null = null;
let unlockPromise: Promise<void> | null = null;
let preloadHtmlSfxPromise: Promise<void> | null = null;
const sfxBuffers: Partial<Record<BoardSfxEvent, AudioBuffer>> = {};
const decodePromises: Partial<Record<BoardSfxEvent, Promise<void>>> = {};
const htmlAudioPrototypes: Partial<Record<BoardSfxEvent, HTMLAudioElement>> = {};

const ensureAudioGraph = (): { context: AudioContext; masterGain: GainNode } | null => {
  if (!canUseWebAudio()) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new window.AudioContext();
  }
  if (!sharedMasterGain) {
    sharedMasterGain = sharedAudioContext.createGain();
    sharedMasterGain.gain.value = 1;
    sharedMasterGain.connect(sharedAudioContext.destination);
  }
  return { context: sharedAudioContext, masterGain: sharedMasterGain };
};

const decodeSfxBuffer = async (context: AudioContext, event: BoardSfxEvent): Promise<void> => {
  if (sfxBuffers[event]) return;
  if (decodePromises[event]) {
    await decodePromises[event];
    return;
  }
  decodePromises[event] = (async () => {
    const response = await fetch(SFX_URLS[event], { cache: 'force-cache' });
    if (!response.ok) return;
    const data = await response.arrayBuffer();
    const decoded = await context.decodeAudioData(data.slice(0));
    sfxBuffers[event] = decoded;
  })().finally(() => {
    delete decodePromises[event];
  });
  await decodePromises[event];
};

export const preloadSfx = async (): Promise<void> => {
  if (preloadSfxPromise) return preloadSfxPromise;
  const graph = ensureAudioGraph();
  if (!graph) {
    preloadSfxPromise = Promise.resolve();
    return preloadSfxPromise;
  }
  preloadSfxPromise = Promise.all((Object.keys(SFX_URLS) as BoardSfxEvent[]).map((event) => decodeSfxBuffer(graph.context, event))).then(
    () => undefined,
  );
  return preloadSfxPromise;
};

const preloadHtmlSfx = async (): Promise<void> => {
  if (preloadHtmlSfxPromise) return preloadHtmlSfxPromise;
  if (typeof Audio === 'undefined') {
    preloadHtmlSfxPromise = Promise.resolve();
    return preloadHtmlSfxPromise;
  }

  preloadHtmlSfxPromise = Promise.all(
    (Object.keys(SFX_URLS) as BoardSfxEvent[]).map(
      (event) =>
        new Promise<void>((resolve) => {
          const audio = new Audio(SFX_URLS[event]);
          audio.preload = 'auto';
          const done = () => resolve();
          audio.oncanplaythrough = done;
          audio.onloadeddata = done;
          audio.onerror = done;
          try {
            audio.load();
          } catch {
            resolve();
          }
          htmlAudioPrototypes[event] = audio;
        }),
    ),
  ).then(() => undefined);

  return preloadHtmlSfxPromise;
};

export const preloadBoardAssets = async (): Promise<void> => {
  await Promise.all([preloadSfx(), preloadHtmlSfx(), preloadBoardVisualAssets()]);
};

const unlockAudioContext = async (): Promise<boolean> => {
  const graph = ensureAudioGraph();
  if (!graph) return false;
  if (isContextRunning(graph.context.state)) return true;
  if (unlockPromise) {
    await unlockPromise;
    return isContextRunning(graph.context.state);
  }

  unlockPromise = (async () => {
    try {
      await graph.context.resume();
      const source = graph.context.createBufferSource();
      source.buffer = graph.context.createBuffer(1, 1, graph.context.sampleRate);
      source.connect(graph.masterGain);
      source.start();
    } catch {
      // Ignore unlock failures; next gesture will retry.
    } finally {
      unlockPromise = null;
    }
  })();

  await unlockPromise;
  return isContextRunning(graph.context.state);
};

const setMasterGain = (settings: BoardSfxSettings): void => {
  const graph = ensureAudioGraph();
  if (!graph) return;
  graph.masterGain.gain.value = settings.muted ? 0 : settings.volume;
};

const playViaHtmlAudio = (event: BoardSfxEvent, volume: number, delayMs: number): void => {
  if (typeof Audio === 'undefined') return;
  const source = htmlAudioPrototypes[event] ?? new Audio(SFX_URLS[event]);
  htmlAudioPrototypes[event] = source;

  const fire = () => {
    const instance = source.cloneNode(true) as HTMLAudioElement;
    instance.preload = 'auto';
    instance.volume = Math.max(0, Math.min(1, volume));
    instance.muted = false;
    try {
      instance.currentTime = 0;
    } catch {
      // Ignore seek failures.
    }
    const maybePromise = instance.play();
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => undefined);
    }
  };

  if (delayMs <= 0) {
    fire();
    return;
  }
  window.setTimeout(fire, delayMs);
};

export type BoardSfxApi = {
  muted: boolean;
  volume: number;
  playSfx: (event: BoardSfxEvent, options?: PlaySfxOptions) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
  getAudioTime: () => number | null;
};

export const useBoardSfx = (): BoardSfxApi => {
  const [settings, setSettings] = useState<BoardSfxSettings>(() => readSettings());
  const settingsRef = useRef(settings);
  const lastPlayedAtRef = useRef<Partial<Record<BoardSfxEvent, number>>>({});
  const persistTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    setMasterGain(settings);
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = window.setTimeout(() => {
      void patchAccountPreferences({ boardSfx: settings });
    }, 300);
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [settings]);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const graph = ensureAudioGraph();
      if (!graph || !active) return;
      setMasterGain(settingsRef.current);
      await preloadBoardAssets();
    };
    void init();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Capture phase ensures audio is unlocked before React onClick handlers fire.
    const onFirstGesture = () => {
      void unlockAudioContext();
    };

    window.addEventListener('pointerdown', onFirstGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onFirstGesture, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      window.removeEventListener('keydown', onFirstGesture, { capture: true });
    };
  }, []);

  const getAudioTime = useCallback((): number | null => {
    const graph = ensureAudioGraph();
    if (!graph) return null;
    return graph.context.currentTime;
  }, []);

  const playSfx = useCallback((event: BoardSfxEvent, options?: PlaySfxOptions) => {
    const graph = ensureAudioGraph();
    if (!graph) return;
    if (settingsRef.current.muted || settingsRef.current.volume <= 0) return;

    const nowWallClock = Date.now();
    const cooldownMs = EVENT_COOLDOWN_MS[event];
    const previousWallClock = lastPlayedAtRef.current[event] ?? 0;
    if (nowWallClock - previousWallClock < cooldownMs) return;

    const buffer = sfxBuffers[event];
    const now = graph.context.currentTime;
    const scheduledWhen = options?.when ?? now;
    const playAt = Math.max(now, scheduledWhen);
    if (!isContextRunning(graph.context.state)) {
      void (async () => {
        const unlocked = await unlockAudioContext();
        if (settingsRef.current.muted || settingsRef.current.volume <= 0) return;

        if (unlocked) {
          const readyBuffer = sfxBuffers[event];
          if (!readyBuffer) {
            void preloadSfx();
            return;
          }
          const resumedNow = graph.context.currentTime;
          const resumedScheduledWhen = options?.when ?? resumedNow;
          const resumedPlayAt = Math.max(resumedNow, resumedScheduledWhen);
          const source = graph.context.createBufferSource();
          source.buffer = readyBuffer;
          source.connect(graph.masterGain);
          source.start(resumedPlayAt);
          lastPlayedAtRef.current[event] = Date.now();
          return;
        }

        // Asset-only fallback path if WebAudio is still blocked after an explicit resume attempt.
        const fallbackNow = graph.context.currentTime;
        const fallbackScheduledWhen = options?.when ?? fallbackNow;
        const fallbackDelayMs = Math.max(0, (Math.max(fallbackNow, fallbackScheduledWhen) - fallbackNow) * 1000);
        playViaHtmlAudio(event, settingsRef.current.volume, fallbackDelayMs);
        lastPlayedAtRef.current[event] = Date.now();
      })();
      return;
    }

    if (!buffer) {
      // Strict mode: never queue delayed playback. If not decoded yet, stay silent.
      void preloadSfx();
      return;
    }

    const source = graph.context.createBufferSource();
    source.buffer = buffer;
    source.connect(graph.masterGain);
    source.start(playAt);
    lastPlayedAtRef.current[event] = nowWallClock;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setSettings((previous) => ({ ...previous, muted }));
  }, []);

  const setVolume = useCallback((volume: number) => {
    const normalized = Math.round(clampVolume(volume) * 100) / 100;
    setSettings((previous) => ({ ...previous, volume: normalized }));
  }, []);

  const toggleMuted = useCallback(() => {
    setSettings((previous) => ({ ...previous, muted: !previous.muted }));
  }, []);

  return {
    muted: settings.muted,
    volume: settings.volume,
    playSfx,
    setMuted,
    setVolume,
    toggleMuted,
    getAudioTime,
  };
};
