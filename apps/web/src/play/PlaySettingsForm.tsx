import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';
import * as engine from '@tribunplay/engine';
import { buildLobbyTimeControl, isClockNonZero } from '../clock/buildTimeControl';
import { getFlippedSetupHash } from '../setupHashFlip';
import { ClockEditor } from '../ui/ClockEditor';
import SetupHashInput from '../ui/SetupHashInput';
import {
  DEFAULT_PLAY_LOBBY_VALUES,
  type PlayLobbyFormValues,
  type PlayLobbySubmitPayload,
  type PlayMode,
  type RoomColorOption,
  type NextStartOption,
} from './types';

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

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

const cardStyle = {
  borderRadius: '18px',
  border: '2px solid #3c3226',
  background: 'rgba(255, 250, 242, 0.84)',
  boxShadow: '0 18px 30px rgba(39, 30, 20, 0.15)',
  padding: '18px',
  display: 'grid',
  gap: '14px',
} as const;

const helperCardStyle = {
  borderRadius: '12px',
  border: '1px solid #d7c5ab',
  background: '#fff7ea',
  padding: '12px',
  color: '#5a4630',
  fontSize: '13px',
  lineHeight: 1.45,
} as const;

const setupSelectionCardStyle = {
  padding: '14px',
  borderRadius: '12px',
  border: '1px solid #d7c5ab',
  background: '#fff8ee',
  display: 'grid',
  gap: '12px',
} as const;

const buttonStyle = (active: boolean) => ({
  padding: '8px 10px',
  borderRadius: '10px',
  border: '2px solid #6f5a38',
  background: active ? '#f2d9b2' : '#fff6e8',
  fontWeight: 700,
  cursor: 'pointer',
});

type PlaySettingsFormProps = {
  mode: PlayMode;
  title: string;
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: (payload: PlayLobbySubmitPayload) => void;
  initialValues?: Partial<PlayLobbyFormValues>;
};

export function PlaySettingsForm(props: PlaySettingsFormProps) {
  const { mode, title, submitLabel, submitDisabled = false, onSubmit, initialValues } = props;
  const initial = useMemo(
    () => ({ ...DEFAULT_PLAY_LOBBY_VALUES, ...initialValues }),
    [initialValues],
  );

  const [hostColor, setHostColor] = useState<RoomColorOption>(initial.hostColor);
  const [startColor, setStartColor] = useState<RoomColorOption>(initial.startColor);
  const [nextStartColor, setNextStartColor] = useState<NextStartOption>(initial.nextStartColor);
  const [customSetupsEnabled, setCustomSetupsEnabled] = useState(initial.customSetupsEnabled);
  const [setupMode, setSetupMode] = useState<engine.SetupMode>(initial.setupMode);
  const [allowedTribunHeights, setAllowedTribunHeights] = useState<Array<1 | 2 | 3>>(initial.allowedTribunHeights);
  const [armyMin, setArmyMin] = useState<number | ''>(initial.armyMin);
  const [armyMax, setArmyMax] = useState<number | ''>(initial.armyMax);
  const [sameClockSettings, setSameClockSettings] = useState(initial.sameClockSettings);
  const [sharedClock, setSharedClock] = useState(initial.sharedClock);
  const [blackClock, setBlackClock] = useState(initial.blackClock);
  const [whiteClock, setWhiteClock] = useState(initial.whiteClock);
  const [maxGameEnabled, setMaxGameEnabled] = useState(initial.maxGameEnabled);
  const [maxGameMinutesTotal, setMaxGameMinutesTotal] = useState<number | ''>(initial.maxGameMinutesTotal);
  const [sharedSetupHash, setSharedSetupHash] = useState(initial.sharedSetupHash);
  const [sharedFlipBlack, setSharedFlipBlack] = useState(initial.sharedFlipBlack);
  const [sharedFlipWhite, setSharedFlipWhite] = useState(initial.sharedFlipWhite);
  const [freeBlackSetupHash, setFreeBlackSetupHash] = useState(initial.freeBlackSetupHash);
  const [freeBlackFlip, setFreeBlackFlip] = useState(initial.freeBlackFlip);
  const [freeWhiteSetupHash, setFreeWhiteSetupHash] = useState(initial.freeWhiteSetupHash);
  const [freeWhiteFlip, setFreeWhiteFlip] = useState(initial.freeWhiteFlip);
  const [error, setError] = useState<string | null>(null);

  const setClockValue = (
    setter: Dispatch<SetStateAction<PlayLobbyFormValues['sharedClock']>>,
    field: keyof PlayLobbyFormValues['sharedClock'],
    value: number | '',
  ) => {
    setter((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSameClockToggle = (nextValue: boolean) => {
    setSameClockSettings(nextValue);
    if (nextValue) {
      setSharedClock(blackClock);
    } else {
      setBlackClock(sharedClock);
      setWhiteClock(sharedClock);
    }
    setError(null);
  };

  const toggleTribunHeight = (height: 1 | 2 | 3) => {
    setAllowedTribunHeights((prev) => {
      if (prev.includes(height)) {
        const next = prev.filter((item) => item !== height);
        return next.length > 0 ? next : prev;
      }
      return [...prev, height].sort((a, b) => a - b);
    });
    setError(null);
  };

  const canStartGame = sameClockSettings
    ? isClockNonZero(sharedClock)
    : isClockNonZero(blackClock) && isClockNonZero(whiteClock);

  const buildSetupConfig = (): engine.SetupConfig =>
    engine.normalizeSetupConfig({
      enabled: customSetupsEnabled,
      mode: setupMode,
      sharedSelection:
        customSetupsEnabled && setupMode === 'shared' && sharedSetupHash.trim()
          ? {
              hash: sharedSetupHash.trim(),
              flipBlack: sharedFlipBlack,
              flipWhite: sharedFlipWhite,
            }
          : null,
      allowedTribunHeights,
      armySize: {
        min: armyMin === '' ? null : clampNumber(armyMin, 0),
        max: armyMax === '' ? null : clampNumber(armyMax, 0),
      },
    });

  const buildSetupSelections = (): engine.SetupSelectionsBySide => {
    if (!customSetupsEnabled) {
      return { black: null, white: null };
    }
    if (setupMode === 'shared') {
      return {
        black: sharedSetupHash.trim() ? { hash: sharedSetupHash.trim(), flip: sharedFlipBlack } : null,
        white: sharedSetupHash.trim() ? { hash: sharedSetupHash.trim(), flip: sharedFlipWhite } : null,
      };
    }
    return {
      black: freeBlackSetupHash.trim() ? { hash: freeBlackSetupHash.trim(), flip: freeBlackFlip } : null,
      white: freeWhiteSetupHash.trim() ? { hash: freeWhiteSetupHash.trim(), flip: freeWhiteFlip } : null,
    };
  };

  const handleSubmit = () => {
    if (!canStartGame) {
      setError(
        sameClockSettings
          ? 'Clock invalid: initial time and buffer cannot both be 0.'
          : 'Clock invalid: both players must have either initial time or buffer greater than 0.',
      );
      return;
    }
    if (customSetupsEnabled && armyMin !== '' && armyMax !== '' && armyMin > armyMax) {
      setError('Setup constraints invalid: minimum army size cannot exceed maximum.');
      return;
    }

    const setupConfig = buildSetupConfig();
    if (customSetupsEnabled && setupConfig.allowedTribunHeights.length === 0) {
      setError('Setup constraints invalid: at least one tribun height must be allowed.');
      return;
    }

    const setupSelections = buildSetupSelections();
    if (mode === 'local' && customSetupsEnabled) {
      if (setupMode === 'shared' && !setupSelections.black?.hash) {
        setError('Shared setup hash is required for local custom setup games.');
        return;
      }
      if (setupMode === 'free' && (!setupSelections.black?.hash || !setupSelections.white?.hash)) {
        setError('Both black and white setup hashes are required in local free-setup games.');
        return;
      }
      const boardResult = engine.buildBoardFromSetups({ config: setupConfig, freeSelections: setupSelections });
      if (!boardResult.ok) {
        setError(boardResult.issues[0]?.message ?? 'Custom setups are not valid.');
        return;
      }
    }

    setError(null);
    onSubmit({
      timeControl: buildLobbyTimeControl({
        sameClockSettings,
        sharedClock,
        blackClock,
        whiteClock,
        maxGameEnabled,
        maxGameMinutesTotal,
      }),
      roomSettings: {
        hostColor,
        startColor,
        nextStartColor,
        setupConfig,
        setupSelections,
      },
    });
  };

  return (
    <section style={cardStyle}>
      <div style={sectionLabelStyle}>Room Configuration</div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: '#2c2318' }}>{title}</div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitDisabled || !canStartGame}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: '999px',
          border: '2px solid #6f5a38',
          background: submitDisabled || !canStartGame ? '#d8c8ab' : '#f2d9b2',
          color: '#2a2218',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          cursor: submitDisabled || !canStartGame ? 'not-allowed' : 'pointer',
        }}
      >
        {submitLabel}
      </button>

      {error ? (
        <div
          style={{
            borderRadius: '12px',
            border: '2px solid #8b3b3b',
            background: '#f7d7d5',
            color: '#5c1c16',
            padding: '10px 12px',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '10px',
        }}
      >
        {mode !== 'local' ? (
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
        ) : null}
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
          background: '#fff7ea',
          display: 'grid',
          gap: '10px',
        }}
      >
        <div style={sectionLabelStyle}>Setup Rules</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={customSetupsEnabled}
            onChange={(event) => setCustomSetupsEnabled(event.target.checked)}
          />
          Custom setups enabled
        </label>

        {customSetupsEnabled ? (
          <div style={{ display: 'grid', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button type="button" onClick={() => setSetupMode('shared')} style={buttonStyle(setupMode === 'shared')}>
                Shared setup
              </button>
              <button type="button" onClick={() => setSetupMode('free')} style={buttonStyle(setupMode === 'free')}>
                Free setups
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#5a4630' }}>
              {mode === 'local'
                ? setupMode === 'shared'
                  ? 'One setup hash configures both sides here, with independent flip toggles per color.'
                  : 'Choose the black and white setup hashes here before the local game starts.'
                : 'Setup hashes are selected in the game lobby after both players join.'}
            </div>

            {mode === 'local' ? (
              <div style={setupSelectionCardStyle}>
                <div style={sectionLabelStyle}>Local Setup Selection</div>
                {setupMode === 'shared' ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>Shared Setup Hash</div>
                      <SetupHashInput
                        value={sharedSetupHash}
                        onChange={setSharedSetupHash}
                        onOpenLibrary={() => undefined}
                        onFlipHash={() => {
                          const flipped = getFlippedSetupHash(sharedSetupHash);
                          if (flipped) setSharedSetupHash(flipped);
                        }}
                        placeholder="Enter shared setup hash"
                        showLibraryButton={false}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#3c2b18' }}>
                        <input type="checkbox" checked={sharedFlipBlack} onChange={(event) => setSharedFlipBlack(event.target.checked)} />
                        Flip for Black
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#3c2b18' }}>
                        <input type="checkbox" checked={sharedFlipWhite} onChange={(event) => setSharedFlipWhite(event.target.checked)} />
                        Flip for White
                      </label>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div style={fieldLabelStyle}>Black Setup Hash</div>
                      <SetupHashInput
                        value={freeBlackSetupHash}
                        onChange={setFreeBlackSetupHash}
                        onOpenLibrary={() => undefined}
                        onFlipHash={() => {
                          const flipped = getFlippedSetupHash(freeBlackSetupHash);
                          if (flipped) setFreeBlackSetupHash(flipped);
                        }}
                        placeholder="Enter black setup hash"
                        showLibraryButton={false}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#3c2b18' }}>
                        <input type="checkbox" checked={freeBlackFlip} onChange={(event) => setFreeBlackFlip(event.target.checked)} />
                        Flip Black
                      </label>
                    </div>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div style={fieldLabelStyle}>White Setup Hash</div>
                      <SetupHashInput
                        value={freeWhiteSetupHash}
                        onChange={setFreeWhiteSetupHash}
                        onOpenLibrary={() => undefined}
                        onFlipHash={() => {
                          const flipped = getFlippedSetupHash(freeWhiteSetupHash);
                          if (flipped) setFreeWhiteSetupHash(flipped);
                        }}
                        placeholder="Enter white setup hash"
                        showLibraryButton={false}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: '#3c2b18' }}>
                        <input type="checkbox" checked={freeWhiteFlip} onChange={(event) => setFreeWhiteFlip(event.target.checked)} />
                        Flip White
                      </label>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div style={{ display: 'grid', gap: '6px' }}>
              <div style={fieldLabelStyle}>Allowed Tribun Heights</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[1, 2, 3].map((height) => (
                  <button
                    key={height}
                    type="button"
                    onClick={() => toggleTribunHeight(height as 1 | 2 | 3)}
                    style={buttonStyle(allowedTribunHeights.includes(height as 1 | 2 | 3))}
                  >
                    {height}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <div style={fieldLabelStyle}>Army Size Min</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={armyMin}
                  onChange={(event) => {
                    if (event.target.value === '') {
                      setArmyMin('');
                      return;
                    }
                    setArmyMin(clampNumber(Number(event.target.value), 0));
                  }}
                  placeholder="No min"
                  style={inputStyle}
                />
              </div>
              <div>
                <div style={fieldLabelStyle}>Army Size Max</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={armyMax}
                  onChange={(event) => {
                    if (event.target.value === '') {
                      setArmyMax('');
                      return;
                    }
                    setArmyMax(clampNumber(Number(event.target.value), 0));
                  }}
                  placeholder="No max"
                  style={inputStyle}
                />
              </div>
            </div>
          </div>
        ) : null}
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
          <input type="checkbox" checked={sameClockSettings} onChange={(event) => handleSameClockToggle(event.target.checked)} />
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
            <ClockEditor title="Black" clock={blackClock} onChange={(field, value) => setClockValue(setBlackClock, field, value)} tone="dark" />
            <ClockEditor title="White" clock={whiteClock} onChange={(field, value) => setClockValue(setWhiteClock, field, value)} tone="dark" />
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
          <input type="checkbox" checked={maxGameEnabled} onChange={(event) => setMaxGameEnabled(event.target.checked)} />
          Max Game Time
        </label>

        {maxGameEnabled ? (
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
                  placeholder="Minutes"
                  style={inputStyle}
                />
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#5a4630' }}>Total wall-clock cap</div>
            </div>
          </div>
        ) : null}
      </div>

      <div style={helperCardStyle}>
        {mode === 'local'
          ? 'Local mode keeps everything on this device. There is no room code, no waiting, and no server match lifecycle.'
          : 'Friend mode creates a server-backed room. Setup selection happens in the shared match lobby after both players join.'}
      </div>
    </section>
  );
}
