import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  buildIdentityPayload,
  getStoredIdentity,
  mergeIdentityFromParticipant,
  setIdentityFromAuthSuccess,
  setStoredIdentity,
  type AuthSuccessResponse,
  type StoredIdentity,
} from '../auth/identityStore';
import { API_BASE, TURNSTILE_SITE_KEY } from '../config';
import { renderTurnstile } from '../auth/turnstile';
import { formatDurationHms } from '../utils/formatDuration';
import { useHealthCheck } from '../utils/useHealthCheck';

type RoomColorOption = 'black' | 'white' | 'random';
type NextStartOption = 'same' | 'other' | 'random';
type ClockInput = {
  initialSeconds: number | '';
  bufferSeconds: number | '';
  incrementSeconds: number | '';
};

type ClockField = keyof ClockInput;

const DEFAULT_CLOCK: ClockInput = {
  initialSeconds: 300,
  bufferSeconds: 20,
  incrementSeconds: 0,
};

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const secondsToMs = (seconds: number) => Math.round(clampNumber(seconds, 0) * 1000);
const minutesToMs = (minutes: number) => Math.round(clampNumber(minutes, 0) * 60000);

const coerceSeconds = (value: number | ''): number => (value === '' ? 0 : clampNumber(value, 0));
const isClockNonZero = (clock: { initialSeconds: number | ''; bufferSeconds: number | '' }): boolean =>
  coerceSeconds(clock.initialSeconds) > 0 || coerceSeconds(clock.bufferSeconds) > 0;

const sectionLabelStyle = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '1.3px',
  textTransform: 'uppercase' as const,
  color: '#7a6543',
};

const fieldLabelStyle = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.1px',
  textTransform: 'uppercase' as const,
  color: '#6f5a38',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  border: '1px solid #ccb89b',
  borderRadius: '10px',
  background: '#fff9ef',
  color: '#1f1a13',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
};

const selectStyle = {
  ...inputStyle,
  appearance: 'none' as const,
};

const spinButtonReset = `
  input[type='number']::-webkit-outer-spin-button,
  input[type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type='number'] {
    -moz-appearance: textfield;
  }
`;

function ClockEditor(props: {
  title: string;
  clock: ClockInput;
  onChange: (field: ClockField, value: number | '') => void;
  tone?: 'light' | 'dark';
}) {
  const { title, clock, onChange, tone = 'light' } = props;
  const panelBg = tone === 'dark' ? '#f7ead6' : '#fffaf0';

  const renderRow = (label: string, field: ClockField) => (
    <div style={{ display: 'grid', gap: '7px' }}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
        <div>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={clock[field]}
            onChange={(event) => {
              if (event.target.value === '') {
                onChange(field, '');
                return;
              }
              onChange(field, clampNumber(Number(event.target.value), 0));
            }}
            placeholder="0 Seconds"
            style={inputStyle}
          />
        </div>
        <div
          style={{
            ...inputStyle,
            width: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '0.2px',
            color: '#2f2418',
            background: 'rgba(255, 255, 255, 0.6)',
            whiteSpace: 'nowrap',
          }}
          aria-label={`${label} preview`}
          title="Preview"
        >
          {formatDurationHms(coerceSeconds(clock[field]))}
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        padding: '14px',
        borderRadius: '12px',
        border: '1px solid #d7c5ab',
        background: panelBg,
        display: 'grid',
        gap: '10px',
      }}
    >
      <div style={{ fontWeight: 700, color: '#2f2418' }}>{title}</div>
      {renderRow('Initial Time', 'initialSeconds')}
      {renderRow('Buffer', 'bufferSeconds')}
      {renderRow('Increment', 'incrementSeconds')}
    </div>
  );
}

export default function Home() {
  const initialIdentity = getStoredIdentity();
  const [code, setCode] = useState('');
  const [identity, setIdentity] = useState<StoredIdentity | null>(initialIdentity);
  const [hostColor, setHostColor] = useState<RoomColorOption>('random');
  const [startColor, setStartColor] = useState<RoomColorOption>('random');
  const [nextStartColor, setNextStartColor] = useState<NextStartOption>('other');
  const [sameClockSettings, setSameClockSettings] = useState(true);
  const [sharedClock, setSharedClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [blackClock, setBlackClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [whiteClock, setWhiteClock] = useState<ClockInput>({ ...DEFAULT_CLOCK });
  const [maxGameEnabled, setMaxGameEnabled] = useState(false);
  const [maxGameMinutesTotal, setMaxGameMinutesTotal] = useState<number | ''>(60);
  const [loadingAction, setLoadingAction] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { result: healthResult, checking: healthChecking } = useHealthCheck({
    autoCheck: true,
    timeout: 3000,
  });

  const isLoading = loadingAction !== null;
  const turnstileEnabled = useMemo(() => Boolean(TURNSTILE_SITE_KEY), []);
  const guestTurnstileRequired = Boolean(turnstileEnabled && identity?.mode === 'guest');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const turnstileResetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!guestTurnstileRequired) {
      setTurnstileToken(null);
      turnstileResetRef.current = null;
      return;
    }
    if (!TURNSTILE_SITE_KEY) return;
    const host = turnstileHostRef.current;
    if (!host) return;

    let cancelled = false;

    (async () => {
      try {
        host.innerHTML = '';
        setTurnstileToken(null);

        const { reset } = await renderTurnstile(host, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          callback: (token) => {
            if (!cancelled) setTurnstileToken(token);
          },
          'expired-callback': () => {
            if (!cancelled) setTurnstileToken(null);
          },
          'error-callback': () => {
            if (!cancelled) setTurnstileToken(null);
          },
        });

        if (!cancelled) {
          turnstileResetRef.current = () => reset();
        }
      } catch (err) {
        if (!cancelled) {
          setTurnstileToken(null);
          setError(err instanceof Error ? err.message : 'CAPTCHA is unavailable.');
        }
      }
    })();

    return () => {
      cancelled = true;
      turnstileResetRef.current = null;
    };
  }, [guestTurnstileRequired]);

  const getCaptchaTokenOrThrow = (): string | null => {
    if (!guestTurnstileRequired) return null;
    if (!turnstileToken) {
      throw new Error('Please complete the CAPTCHA to continue.');
    }
    return turnstileToken;
  };

  const resetCaptchaAfterSubmit = () => {
    if (!guestTurnstileRequired) return;
    setTurnstileToken(null);
    turnstileResetRef.current?.();
  };

  const setClockValue = (
    setter: Dispatch<SetStateAction<ClockInput>>,
    field: ClockField,
    value: number | '',
  ) => {
    setter((prev) => ({ ...prev, [field]: value }));
  };

  const handleSameClockToggle = (nextValue: boolean) => {
    setSameClockSettings(nextValue);
    if (nextValue) {
      setSharedClock(blackClock);
    } else {
      setBlackClock(sharedClock);
      setWhiteClock(sharedClock);
    }
  };

  const normalizeClockInput = (clock: ClockInput) => ({
    initialSeconds: coerceSeconds(clock.initialSeconds),
    bufferSeconds: coerceSeconds(clock.bufferSeconds),
    incrementSeconds: coerceSeconds(clock.incrementSeconds),
  });

  const buildTimeControl = () => {
    const normalizedMaxMinutesTotal =
      maxGameMinutesTotal === '' ? 0 : clampNumber(maxGameMinutesTotal, 0);
    const maxGameMs =
      maxGameEnabled && normalizedMaxMinutesTotal > 0 ? minutesToMs(normalizedMaxMinutesTotal) : null;

    if (sameClockSettings) {
      const normalized = normalizeClockInput(sharedClock);
      return {
        initialMs: secondsToMs(normalized.initialSeconds),
        bufferMs: secondsToMs(normalized.bufferSeconds),
        incrementMs: secondsToMs(normalized.incrementSeconds),
        maxGameMs,
      };
    }

    const normalizedBlack = normalizeClockInput(blackClock);
    const normalizedWhite = normalizeClockInput(whiteClock);

    return {
      initialMs: {
        black: secondsToMs(normalizedBlack.initialSeconds),
        white: secondsToMs(normalizedWhite.initialSeconds),
      },
      bufferMs: {
        black: secondsToMs(normalizedBlack.bufferSeconds),
        white: secondsToMs(normalizedWhite.bufferSeconds),
      },
      incrementMs: {
        black: secondsToMs(normalizedBlack.incrementSeconds),
        white: secondsToMs(normalizedWhite.incrementSeconds),
      },
      maxGameMs,
    };
  };

  const requireIdentityPayload = () => {
    const current = getStoredIdentity();
    if (!current) {
      throw new Error('Identity missing. Return to the landing page and choose an identity.');
    }
    return {
      current,
      payload: buildIdentityPayload(current),
    };
  };

  const syncIdentityFromParticipant = (participant: {
    accountId: string;
    name: string;
    email: string | null;
    mode: 'guest' | 'token';
  }) => {
    const current = getStoredIdentity();
    const merged = mergeIdentityFromParticipant(current, participant);
    setStoredIdentity(merged);
    setIdentity(merged);
  };

  const refreshSessionOrThrow = async (current: StoredIdentity): Promise<StoredIdentity> => {
    if (current.mode !== 'token') return current;
    const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.session.refreshToken }),
    });
    if (!refreshResponse.ok) {
      throw new Error('Session expired. Please log in again.');
    }
    const refreshed = (await refreshResponse.json()) as AuthSuccessResponse;
    const nextIdentity = setIdentityFromAuthSuccess(refreshed);
    setIdentity(nextIdentity);
    return nextIdentity;
  };

  const findActivePlayerGame = async (): Promise<string | null> => {
    const { current, payload: identityPayload } = requireIdentityPayload();
    const doLookup = async (payload: unknown) =>
      fetch(`${API_BASE}/api/game/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: payload }),
      });

    let response = await doLookup(identityPayload);
    if (!response.ok && response.status === 401) {
      const nextIdentity = await refreshSessionOrThrow(current);
      response = await doLookup(buildIdentityPayload(nextIdentity));
    }
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { code?: string | null };
    return typeof data.code === 'string' && data.code.trim() ? data.code.trim().toUpperCase() : null;
  };

  const redirectToActiveGameIfAny = async (): Promise<boolean> => {
    const activeCode = await findActivePlayerGame();
    if (!activeCode) return false;
    navigate(`/game/${activeCode}`, { replace: true });
    return true;
  };

  useEffect(() => {
    let cancelled = false;

    const checkActivePlayerGame = async () => {
      try {
        const activeCode = await findActivePlayerGame();
        if (!cancelled && activeCode) {
          navigate(`/game/${activeCode}`, { replace: true });
        }
      } catch {
        // Ignore lookup failures and keep the play screen usable.
      }
    };

    void checkActivePlayerGame();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleCreateGame = async () => {
    const canStartGame = sameClockSettings
      ? isClockNonZero(sharedClock)
      : isClockNonZero(blackClock) && isClockNonZero(whiteClock);
    if (!canStartGame) {
      setError(
        sameClockSettings
          ? 'Clock invalid: initial time and buffer cannot both be 0.'
          : 'Clock invalid: both players must have either initial time or buffer greater than 0.'
      );
      return;
    }

    setLoadingAction('create');
    setError(null);
    try {
      if (await redirectToActiveGameIfAny()) {
        return;
      }
      const { current, payload: identityPayload } = requireIdentityPayload();
      const captchaToken = getCaptchaTokenOrThrow();
      const timeControl = buildTimeControl();
      const roomSettings = { hostColor, startColor, nextStartColor };
      const turnstilePart = captchaToken ? { turnstileToken: captchaToken } : {};
      const doCreate = async (payload: unknown) =>
        fetch(`${API_BASE}/api/game/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeControl, roomSettings, identity: payload, ...turnstilePart }),
        });

      let response = await doCreate(identityPayload);

      if (!response.ok) {
        if (response.status === 401) {
          const nextIdentity = await refreshSessionOrThrow(current);
          response = await doCreate(buildIdentityPayload(nextIdentity));
        }
        if (response.status === 409) {
          const errData = await response.json().catch(() => ({ error: 'Already in an ongoing game', code: null }));
          const redirectCode = typeof errData.code === 'string' ? errData.code : null;
          if (redirectCode) {
            navigate(`/game/${redirectCode}`, { replace: true });
            return;
          }
        }
        const errData = await response.json().catch(() => ({ error: 'Failed to create game' }));
        throw new Error(errData.error || 'Failed to create game');
      }

      const data = await response.json();
      if (data.participant) {
        syncIdentityFromParticipant(data.participant);
      }
      localStorage.setItem(`game_token_${data.code}`, data.token);
      localStorage.setItem(`game_id_${data.code}`, data.gameId);
      localStorage.setItem(`game_seat_${data.code}`, 'black');
      navigate(`/game/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingAction(null);
    }
  };

  const handleJoinGame = async () => {
    if (!code.trim()) {
      setError('Please enter a game code');
      return;
    }

    setLoadingAction('join');
    setError(null);
    try {
      if (await redirectToActiveGameIfAny()) {
        return;
      }
      const { current, payload: identityPayload } = requireIdentityPayload();
      const captchaToken = getCaptchaTokenOrThrow();
      const turnstilePart = captchaToken ? { turnstileToken: captchaToken } : {};
      const doJoin = async (payload: unknown) =>
        fetch(`${API_BASE}/api/game/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.trim().toUpperCase(), identity: payload, ...turnstilePart }),
        });

      let response = await doJoin(identityPayload);

      if (!response.ok) {
        if (response.status === 401) {
          const nextIdentity = await refreshSessionOrThrow(current);
          response = await doJoin(buildIdentityPayload(nextIdentity));
        }
        const errData = await response.json().catch(() => ({ error: 'Failed to join game' }));
        throw new Error(errData.error || 'Failed to join game');
      }

      const data = await response.json();
      if (data.participant) {
        syncIdentityFromParticipant(data.participant);
      }
      const gameCode = code.trim().toUpperCase();
      localStorage.setItem(`game_token_${gameCode}`, data.token);
      localStorage.setItem(`game_id_${gameCode}`, data.gameId);
      localStorage.setItem(`game_seat_${gameCode}`, data.seat);
      navigate(`/game/${gameCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingAction(null);
    }
  };

  const healthOk = Boolean(healthResult?.api.reachable && healthResult?.websocket.reachable);
  const hasIdentity = Boolean(identity);
  const canStartGame = sameClockSettings
    ? isClockNonZero(sharedClock)
    : isClockNonZero(blackClock) && isClockNonZero(whiteClock);
  const clockInvalid = !canStartGame;
  const createDisabled =
    isLoading ||
    clockInvalid ||
    !hasIdentity ||
    (guestTurnstileRequired && !turnstileToken);
  const createButtonLabel =
    loadingAction === 'create'
      ? 'Creating...'
      : clockInvalid
        ? 'Create Game (Invalid clock time)'
        : 'Create Game';

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)',
        color: '#1d1a14',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>
        {`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap');${spinButtonReset}`}
      </style>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
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
            Tribun Play
          </div>
          <div style={{ fontSize: '20px', fontWeight: 400 }}>Play with a Friend</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: '999px',
              border: '1px solid #5f4a2d',
              background: healthOk ? '#244d34' : '#4f3720',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}
          >
            {healthChecking && !healthResult ? 'Checking Connection' : healthOk ? 'Server Reachable' : 'Connection Issues'}
          </div>
          <button
            type="button"
            onClick={() => navigate('/hub')}
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

      <div style={{ width: '100%', maxWidth: '1160px', margin: '0 auto', padding: '20px 14px 24px', display: 'grid', gap: '16px' }}>
        {import.meta.env.DEV && healthResult && (
          <div
            style={{
              borderRadius: '12px',
              border: `2px solid ${healthOk ? '#2f6b3f' : '#8b3b3b'}`,
              background: healthOk ? 'rgba(236, 247, 239, 0.85)' : 'rgba(250, 231, 227, 0.85)',
              padding: '12px 14px',
              fontSize: '13px',
              display: 'grid',
              gap: '4px',
            }}
          >
            <div style={{ fontWeight: 700 }}>Development Connection Status</div>
            <div>
              API: {healthResult.api.reachable ? 'Reachable' : `Unreachable${healthResult.api.error ? ` (${healthResult.api.error})` : ''}`}
              {healthResult.api.responseTime ? ` (${healthResult.api.responseTime}ms)` : ''}
            </div>
            <div>
              WebSocket:{' '}
              {healthResult.websocket.reachable
                ? 'Reachable'
                : `Unreachable${healthResult.websocket.error ? ` (${healthResult.websocket.error})` : ''}`}
              {healthResult.websocket.responseTime ? ` (${healthResult.websocket.responseTime}ms)` : ''}
            </div>
          </div>
        )}

        {import.meta.env.DEV && healthChecking && !healthResult && (
          <div
            style={{
              borderRadius: '12px',
              border: '2px solid #a68043',
              background: 'rgba(255, 243, 214, 0.9)',
              color: '#5c441c',
              padding: '12px 14px',
              fontWeight: 600,
            }}
          >
            Checking connection status...
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '16px',
            alignItems: 'start',
            maxWidth: '780px',
            width: '100%',
            margin: '0 auto',
          }}
        >
          <section
            style={{
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.84)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={{ ...sectionLabelStyle, color: '#7a6543' }}>Quick Join</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>Join Game</div>

            {guestTurnstileRequired && (
              <div style={{ display: 'grid', gap: '8px' }}>
                <div style={fieldLabelStyle}>CAPTCHA</div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '10px',
                    borderRadius: '14px',
                    background: 'rgba(255, 249, 239, 0.55)',
                    boxShadow: 'inset 0 0 0 1px rgba(204, 184, 155, 0.65)',
                  }}
                >
                  <div
                    ref={turnstileHostRef}
                    style={{
                      minHeight: '66px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      background: 'transparent',
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gap: '9px' }}>
              <div style={fieldLabelStyle}>Game Code</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px' }}>
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="Enter game code"
                  maxLength={6}
                  style={{
                    ...inputStyle,
                    fontFamily: '"JetBrains Mono", monospace',
                    letterSpacing: '2px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleJoinGame();
                    }
                  }}
                />
                <button
                  onClick={handleJoinGame}
                  disabled={isLoading || !hasIdentity || (guestTurnstileRequired && !turnstileToken)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '999px',
                    border: '2px solid #1f4d2f',
                    background: isLoading || !hasIdentity ? '#8ea593' : '#2f6b3f',
                    color: '#f7f3eb',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: isLoading || !hasIdentity ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loadingAction === 'join' ? 'Joining...' : 'Join'}
                </button>
              </div>
            </div>

            <div
              style={{
                borderRadius: '12px',
                border: '1px solid #d8cbb8',
                background: '#fffaf0',
                padding: '12px',
                color: '#5a4630',
                fontSize: '13px',
                lineHeight: 1.45,
              }}
            >
              Tip: share the 6-character code with your opponent, then both players meet in the same match lobby.
            </div>
          </section>

          <section
            style={{
              borderRadius: '18px',
              border: '2px solid #3c3226',
              background: 'rgba(255, 250, 242, 0.84)',
              boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
              padding: '18px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <div style={sectionLabelStyle}>Room Configuration</div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>Create Room</div>

            <button
              onClick={handleCreateGame}
              disabled={createDisabled}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '999px',
                border: '2px solid #6f5a38',
                background: createDisabled ? '#d8c8ab' : '#f2d9b2',
                color: '#2a2218',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: createDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {createButtonLabel}
            </button>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
              }}
            >
              <div>
                <div style={fieldLabelStyle}>Host Color</div>
                <select
                  value={hostColor}
                  onChange={(event) => setHostColor(event.target.value as RoomColorOption)}
                  style={selectStyle}
                >
                  <option value="random">Random</option>
                  <option value="black">Black</option>
                  <option value="white">White</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>Start Color</div>
                <select
                  value={startColor}
                  onChange={(event) => setStartColor(event.target.value as RoomColorOption)}
                  style={selectStyle}
                >
                  <option value="random">Random</option>
                  <option value="black">Black</option>
                  <option value="white">White</option>
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>Next Start</div>
                <select
                  value={nextStartColor}
                  onChange={(event) => setNextStartColor(event.target.value as NextStartOption)}
                  style={selectStyle}
                >
                  <option value="other">Other</option>
                  <option value="same">Same</option>
                  <option value="random">Random</option>
                </select>
              </div>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #d7c5ab',
                background: '#f8f0e2',
                display: 'grid',
                gap: '10px',
              }}
            >
              <div style={sectionLabelStyle}>Clock Settings</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={sameClockSettings}
                  onChange={(event) => handleSameClockToggle(event.target.checked)}
                />
                Same for both colors
              </label>

              {sameClockSettings ? (
                <ClockEditor
                  title="Both Colors"
                  clock={sharedClock}
                  onChange={(field, value) => setClockValue(setSharedClock, field, value)}
                />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <ClockEditor
                    title="Black"
                    clock={blackClock}
                    onChange={(field, value) => setClockValue(setBlackClock, field, value)}
                    tone="dark"
                  />
                  <ClockEditor
                    title="White"
                    clock={whiteClock}
                    onChange={(field, value) => setClockValue(setWhiteClock, field, value)}
                    tone="dark"
                  />
                </div>
              )}
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '12px',
                border: '1px solid #d7c5ab',
                background: '#fff7ea',
                display: 'grid',
                gap: '10px',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={maxGameEnabled}
                  onChange={(event) => setMaxGameEnabled(event.target.checked)}
                />
                Max Game Time
              </label>

              {maxGameEnabled && (
                <div style={{ display: 'grid', gap: '7px' }}>
                  <div style={fieldLabelStyle}>Minutes</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center' }}>
                    <div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={maxGameMinutesTotal}
                        onChange={(event) => {
                          if (event.target.value === '') {
                            setMaxGameMinutesTotal('');
                            return;
                          }
                          setMaxGameMinutesTotal(clampNumber(Number(event.target.value), 0));
                        }}
                        placeholder="0 Minutes"
                        style={inputStyle}
                      />
                    </div>
                    <div
                      style={{
                        ...inputStyle,
                        width: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: '14px',
                        fontWeight: 700,
                        letterSpacing: '0.2px',
                        color: '#2f2418',
                        background: 'rgba(255, 255, 255, 0.6)',
                        whiteSpace: 'nowrap',
                      }}
                      aria-label="Max Game Time preview"
                      title="Preview"
                    >
                      {(() => {
                        const minutes = maxGameMinutesTotal === '' ? 0 : maxGameMinutesTotal || 0;
                        if (minutes === 0) return '0m';
                        return formatDurationHms(minutes * 60);
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {error && (
          <div
            style={{
              borderRadius: '12px',
              border: '2px solid #8b3b3b',
              background: '#f7d7d5',
              color: '#5c1c16',
              padding: '10px 14px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <footer
          style={{
            borderRadius: '12px',
            border: '1px solid #d8cbb8',
            background: 'rgba(255, 250, 242, 0.7)',
            padding: '12px',
            display: 'flex',
            justifyContent: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            fontSize: '13px',
          }}
        >
          <Link to="/datenschutz" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Datenschutz
          </Link>
          <span style={{ color: '#b59d7c' }}>|</span>
          <Link to="/disclaimer" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Disclaimer
          </Link>
          <span style={{ color: '#b59d7c' }}>|</span>
          <Link to="/impressum" style={{ color: '#5a4630', textDecoration: 'none' }}>
            Impressum
          </Link>
        </footer>
      </div>
    </div>
  );
}
