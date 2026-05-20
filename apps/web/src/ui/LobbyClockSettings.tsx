import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { buildLobbyTimeControl, isClockNonZero } from "../clock/buildTimeControl";
import type { ClockInput, LobbyTimeControlPayload, TimeControl } from "../clock/types";
import { ClockEditor } from "./ClockEditor";

const sectionLabelStyle = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1.2px",
  textTransform: "uppercase" as const,
  color: "#7a6543",
};

const fieldLabelStyle = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "1.1px",
  textTransform: "uppercase" as const,
  color: "#6f5a38",
  marginBottom: "6px",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #ccb89b",
  borderRadius: "10px",
  background: "#fff9ef",
  color: "#1f1a13",
  padding: "10px 12px",
  fontSize: "14px",
  outline: "none",
};

const msToSecondsInput = (ms: number): number => Math.round(ms / 1000);
const minutesFromMs = (ms: number | null | undefined): number | "" => {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  return Math.round(ms / 60000);
};

const clockInputFromMs = (initialMs: number, bufferMs: number, incrementMs: number): ClockInput => ({
  initialSeconds: msToSecondsInput(initialMs),
  bufferSeconds: msToSecondsInput(bufferMs),
  incrementSeconds: msToSecondsInput(incrementMs),
});

const colorClocksMatch = (left: { black: number; white: number }, right: { black: number; white: number }): boolean =>
  left.black === right.black && left.white === right.white;

export const timeControlToClockForm = (
  timeControl: TimeControl,
): {
  sameClockSettings: boolean;
  sharedClock: ClockInput;
  blackClock: ClockInput;
  whiteClock: ClockInput;
  maxGameEnabled: boolean;
  maxGameMinutesTotal: number | "";
} => {
  const sameClockSettings =
    colorClocksMatch(timeControl.initialMs, timeControl.initialMs) &&
    colorClocksMatch(timeControl.bufferMs, timeControl.bufferMs) &&
    colorClocksMatch(timeControl.incrementMs, timeControl.incrementMs) &&
    timeControl.initialMs.black === timeControl.initialMs.white;

  const sharedClock = clockInputFromMs(
    timeControl.initialMs.black,
    timeControl.bufferMs.black,
    timeControl.incrementMs.black,
  );

  return {
    sameClockSettings,
    sharedClock,
    blackClock: clockInputFromMs(
      timeControl.initialMs.black,
      timeControl.bufferMs.black,
      timeControl.incrementMs.black,
    ),
    whiteClock: clockInputFromMs(
      timeControl.initialMs.white,
      timeControl.bufferMs.white,
      timeControl.incrementMs.white,
    ),
    maxGameEnabled: timeControl.maxGameMs != null && timeControl.maxGameMs > 0,
    maxGameMinutesTotal: minutesFromMs(timeControl.maxGameMs),
  };
};

const formatClockPair = (value: { black: number; white: number }): string => {
  const formatMs = (ms: number) => `${Math.round(ms / 1000)}s`;
  if (value.black === value.white) {
    return formatMs(value.black);
  }
  return `B ${formatMs(value.black)} / W ${formatMs(value.white)}`;
};

type LobbyClockSettingsProps = {
  timeControl: TimeControl;
  editable: boolean;
  busy?: boolean;
  onApply?: (payload: LobbyTimeControlPayload) => void;
};

export function LobbyClockSettings(props: LobbyClockSettingsProps) {
  const { timeControl, editable, busy = false, onApply } = props;
  const seed = useMemo(() => timeControlToClockForm(timeControl), [timeControl]);

  const [sameClockSettings, setSameClockSettings] = useState(seed.sameClockSettings);
  const [sharedClock, setSharedClock] = useState(seed.sharedClock);
  const [blackClock, setBlackClock] = useState(seed.blackClock);
  const [whiteClock, setWhiteClock] = useState(seed.whiteClock);
  const [maxGameEnabled, setMaxGameEnabled] = useState(seed.maxGameEnabled);
  const [maxGameMinutesTotal, setMaxGameMinutesTotal] = useState<number | "">(seed.maxGameMinutesTotal);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = timeControlToClockForm(timeControl);
    setSameClockSettings(next.sameClockSettings);
    setSharedClock(next.sharedClock);
    setBlackClock(next.blackClock);
    setWhiteClock(next.whiteClock);
    setMaxGameEnabled(next.maxGameEnabled);
    setMaxGameMinutesTotal(next.maxGameMinutesTotal);
    setError(null);
  }, [timeControl]);

  const setClockValue = (
    setter: Dispatch<SetStateAction<ClockInput>>,
    field: keyof ClockInput,
    value: number | "",
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

  const clocksValid = sameClockSettings
    ? isClockNonZero(sharedClock)
    : isClockNonZero(blackClock) && isClockNonZero(whiteClock);

  const handleApply = () => {
    if (!onApply) return;
    if (!clocksValid) {
      setError(
        sameClockSettings
          ? "Clock invalid: initial time and buffer cannot both be 0."
          : "Clock invalid: both players must have either initial time or buffer greater than 0.",
      );
      return;
    }
    setError(null);
    onApply(
      buildLobbyTimeControl({
        sameClockSettings,
        sharedClock,
        blackClock,
        whiteClock,
        maxGameEnabled,
        maxGameMinutesTotal,
      }),
    );
  };

  if (!editable) {
    const maxGameLabel =
      timeControl.maxGameMs == null || timeControl.maxGameMs <= 0
        ? "Off"
        : `${Math.round(timeControl.maxGameMs / 60000)} min`;
    return (
      <div style={{ display: "grid", gap: "6px", color: "#5a4630" }}>
        <div>Initial: {formatClockPair(timeControl.initialMs)}</div>
        <div>Buffer: {formatClockPair(timeControl.bufferMs)}</div>
        <div>Increment: {formatClockPair(timeControl.incrementMs)}</div>
        <div>Max game time: {maxGameLabel}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div style={sectionLabelStyle}>Clock Settings</div>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
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

      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 700 }}>
        <input type="checkbox" checked={maxGameEnabled} onChange={(event) => setMaxGameEnabled(event.target.checked)} />
        Max Game Time
      </label>

      {maxGameEnabled ? (
        <div style={{ display: "grid", gap: "7px" }}>
          <div style={fieldLabelStyle}>Minutes</div>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={maxGameMinutesTotal}
            onChange={(event) => {
              if (event.target.value === "") {
                setMaxGameMinutesTotal("");
                return;
              }
              setMaxGameMinutesTotal(Math.max(0, Number(event.target.value)));
            }}
            placeholder="Minutes"
            style={inputStyle}
          />
        </div>
      ) : null}

      {error ? (
        <div style={{ fontSize: "12px", fontWeight: 600, color: "#7c1e1e" }}>{error}</div>
      ) : null}

      <button
        type="button"
        onClick={handleApply}
        disabled={busy || !clocksValid}
        style={{
          padding: "10px 16px",
          borderRadius: "999px",
          border: "2px solid #6f5a38",
          background: busy || !clocksValid ? "#e6dccf" : "#f2d9b2",
          color: "#2a2218",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          cursor: busy || !clocksValid ? "not-allowed" : "pointer",
          justifySelf: "start",
        }}
      >
        {busy ? "Saving..." : "Apply clock settings"}
      </button>
    </div>
  );
}
