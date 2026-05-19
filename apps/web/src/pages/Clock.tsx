import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBoardSfx } from '../audio/boardSfx';
import { isClockNonZero } from '../clock/buildTimeControl';
import type { ClockField, StandaloneClockSettings, StartColorOption } from '../clock/types';
import { useStandaloneClock } from '../clock/useStandaloneClock';
import { ClockEditor } from '../ui/ClockEditor';
import { StandaloneClockPanel } from '../ui/StandaloneClockPanel';

const barButtonStyle = {
  padding: '8px 14px',
  borderRadius: '999px',
  border: '2px solid #6f5a38',
  background: '#f2d9b2',
  color: '#2a2218',
  fontWeight: 700,
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.8px',
  cursor: 'pointer',
  textDecoration: 'none',
  fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
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

export default function Clock() {
  const clock = useStandaloneClock();
  const { playSfx } = useBoardSfx();
  const playedEndRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [draft, setDraft] = useState<StandaloneClockSettings>(clock.settings);

  useEffect(() => {
    if (clock.endReason && !playedEndRef.current) {
      playedEndRef.current = true;
      playSfx('gameEnded');
    }
    if (!clock.endReason) {
      playedEndRef.current = false;
    }
  }, [clock.endReason, playSfx]);

  const openSettings = () => {
    setDraft({ ...clock.settings });
    setSettingsError(null);
    setSettingsOpen(true);
  };

  const setDraftClockValue = (
    setter: Dispatch<SetStateAction<StandaloneClockSettings>>,
    which: 'sharedClock' | 'blackClock' | 'whiteClock',
    field: ClockField,
    value: number | '',
  ) => {
    setter((prev) => ({ ...prev, [which]: { ...prev[which], [field]: value } }));
    setSettingsError(null);
  };

  const handleApplySettings = () => {
    const clocksToCheck = draft.sameClockSettings
      ? [draft.sharedClock]
      : [draft.blackClock, draft.whiteClock];
    if (!clocksToCheck.some(isClockNonZero)) {
      setSettingsError('Set initial time or buffer above zero for at least one player.');
      return;
    }
    clock.reconfigure(draft);
    setSettingsOpen(false);
    setSettingsError(null);
  };

  const handlePauseOrResetClick = () => {
    if (clock.showPauseButton) {
      clock.pause();
      return;
    }
    if (clock.gameStarted) {
      setResetModalOpen(true);
      return;
    }
    clock.reset();
  };

  const confirmReset = () => {
    clock.reset();
    setResetModalOpen(false);
  };

  const endLoser = clock.endReason?.kind === 'timeout-player' ? clock.endReason.loser : null;

  return (
    <div
      style={{
        height: '100dvh',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#1a150f',
        color: '#f8f1e7',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');${spinButtonReset}`}</style>

      <StandaloneClockPanel
        color="black"
        rotated
        clocksMs={clock.clocksMs}
        bufferMsRemaining={clock.bufferMsRemaining}
        activeColor={clock.activeColor}
        clockRunning={clock.clockRunning}
        status={clock.status}
        endLoser={endLoser}
        hint={clock.panelHint('black')}
        onClick={() => {
          playSfx('tileClick');
          clock.handlePanelClick('black');
        }}
      />

      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '10px 12px',
          background: 'rgba(26, 21, 15, 0.98)',
          borderTop: '2px solid #3a2f22',
          borderBottom: '2px solid #3a2f22',
          zIndex: 5,
        }}
      >
        <Link to="/hub" style={barButtonStyle}>
          Hub
        </Link>
        <button type="button" style={barButtonStyle} onClick={openSettings}>
          Settings
        </button>
        <button type="button" style={barButtonStyle} onClick={handlePauseOrResetClick}>
          {clock.showPauseButton ? 'Pause' : 'Reset'}
        </button>
        {clock.hint ? (
          <span style={{ width: '100%', textAlign: 'center', fontSize: '12px', color: '#c4b8a8', marginTop: '2px' }}>
            {clock.hint}
          </span>
        ) : clock.status === 'paused' ? (
          <span style={{ width: '100%', textAlign: 'center', fontSize: '12px', color: '#c4b8a8', marginTop: '2px' }}>
            Paused — tap your side to resume
          </span>
        ) : null}
      </div>

      <StandaloneClockPanel
        color="white"
        clocksMs={clock.clocksMs}
        bufferMsRemaining={clock.bufferMsRemaining}
        activeColor={clock.activeColor}
        clockRunning={clock.clockRunning}
        status={clock.status}
        endLoser={endLoser}
        hint={clock.panelHint('white')}
        onClick={() => {
          playSfx('tileClick');
          clock.handlePanelClick('white');
        }}
      />

      {settingsOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 15, 10, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 60,
          }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            style={{
              width: 'min(560px, 96vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              background: '#fff7ea',
              borderRadius: '18px',
              border: '2px solid #3c3226',
              padding: '20px',
              color: '#1d1a14',
              display: 'grid',
              gap: '14px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#2c2318' }}>Clock settings</div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, color: '#3c2b18' }}>
              <input
                type="checkbox"
                checked={draft.sameClockSettings}
                onChange={(e) => {
                  const next = e.target.checked;
                  setSettingsError(null);
                  setDraft((prev) => {
                    if (next) {
                      return { ...prev, sameClockSettings: true, sharedClock: { ...prev.blackClock } };
                    }
                    return {
                      ...prev,
                      sameClockSettings: false,
                      blackClock: { ...prev.sharedClock },
                      whiteClock: { ...prev.sharedClock },
                    };
                  });
                }}
              />
              Same settings for both players
            </label>

            {draft.sameClockSettings ? (
              <ClockEditor
                title="Both players"
                clock={draft.sharedClock}
                onChange={(field, value) => setDraftClockValue(setDraft, 'sharedClock', field, value)}
              />
            ) : (
              <>
                <ClockEditor
                  title="Black"
                  clock={draft.blackClock}
                  onChange={(field, value) => setDraftClockValue(setDraft, 'blackClock', field, value)}
                  tone="dark"
                />
                <ClockEditor
                  title="White"
                  clock={draft.whiteClock}
                  onChange={(field, value) => setDraftClockValue(setDraft, 'whiteClock', field, value)}
                />
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, color: '#3c2b18' }}>
              <input
                type="checkbox"
                checked={draft.maxGameEnabled}
                onChange={(e) => {
                  setSettingsError(null);
                  setDraft((prev) => ({ ...prev, maxGameEnabled: e.target.checked }));
                }}
              />
              Maximum total game time
            </label>
            {draft.maxGameEnabled ? (
              <div>
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.1px',
                    textTransform: 'uppercase',
                    color: '#6f5a38',
                    marginBottom: '6px',
                  }}
                >
                  Minutes (total)
                </div>
                <input
                  type="number"
                  min={1}
                  value={draft.maxGameMinutesTotal}
                  onChange={(e) => {
                    setSettingsError(null);
                    setDraft((prev) => ({
                      ...prev,
                      maxGameMinutesTotal: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)),
                    }));
                  }}
                  style={{
                    width: '100%',
                    border: '1px solid #ccb89b',
                    borderRadius: '10px',
                    padding: '10px 12px',
                  }}
                />
              </div>
            ) : null}

            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '1.1px',
                  textTransform: 'uppercase',
                  color: '#6f5a38',
                  marginBottom: '6px',
                }}
              >
                Starting side
              </div>
              <select
                value={draft.startColor}
                onChange={(e) => {
                  setSettingsError(null);
                  setDraft((prev) => ({ ...prev, startColor: e.target.value as StartColorOption }));
                }}
                style={{
                  width: '100%',
                  border: '1px solid #ccb89b',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  background: '#fff9ef',
                }}
              >
                <option value="black">Black</option>
                <option value="white">White</option>
                <option value="random">Random</option>
              </select>
            </div>

            {settingsError ? (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid #c47a6a',
                  background: '#f8e8e4',
                  color: '#6b2e24',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
                role="alert"
              >
                {settingsError}
              </div>
            ) : null}

            <p
              style={{
                margin: 0,
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.4px',
                color: '#6f5a38',
                lineHeight: 1.45,
              }}
            >
              Applying these settings will reset the clock.
            </p>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" style={barButtonStyle} onClick={handleApplySettings}>
                Apply
              </button>
              <button
                type="button"
                style={{ ...barButtonStyle, background: '#e6dccf' }}
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetModalOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 15, 10, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 65,
          }}
          onClick={() => setResetModalOpen(false)}
        >
          <div
            style={{
              width: 'min(420px, 92vw)',
              background: '#fff7ea',
              borderRadius: '18px',
              border: '2px solid #3c3226',
              padding: '24px',
              textAlign: 'center',
              color: '#1d1a14',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#2c2318', marginBottom: '10px' }}>
              Reset clock?
            </div>
            <p style={{ margin: '0 0 20px', color: '#5a4630', lineHeight: 1.5, fontSize: '14px' }}>
              All times will return to the configured settings and the starting side will be chosen again.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={barButtonStyle} onClick={confirmReset}>
                Reset clock
              </button>
              <button
                type="button"
                style={{ ...barButtonStyle, background: '#e6dccf' }}
                onClick={() => setResetModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clock.endOverlay ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 15, 10, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 55,
          }}
          onClick={() => clock.reset()}
        >
          <div
            style={{
              width: 'min(480px, 92vw)',
              background: '#fff7ea',
              borderRadius: '18px',
              border: '2px solid #b9833b',
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 24px 40px rgba(39, 30, 20, 0.3)',
              color: '#1d1a14',
            }}
            onClick={(e) => e.stopPropagation()}
          >
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
              {clock.endOverlay.title}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', color: '#3c2b18' }}>
              {clock.endOverlay.reason}
            </div>
            <div style={{ fontSize: '16px', marginBottom: '20px', color: '#5a4630' }}>
              Result: {clock.endOverlay.result}
            </div>
            <button
              type="button"
              style={{ ...barButtonStyle, fontSize: '12px' }}
              onClick={() => {
                clock.reset();
              }}
            >
              Reset clock
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
