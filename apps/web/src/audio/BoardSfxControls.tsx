type BoardSfxControlsProps = {
  muted: boolean;
  volume: number;
  onToggleMuted: () => void;
  onVolumeChange: (nextVolume: number) => void;
};

export function BoardSfxControls(props: BoardSfxControlsProps) {
  const { muted, volume, onToggleMuted, onVolumeChange } = props;
  const volumePercent = Math.round(volume * 100);

  return (
    <div
      style={{
        width: "100%",
        display: "grid",
        gap: "12px",
        padding: "12px 14px",
        borderRadius: "14px",
        border: "1px solid #ccb89b",
        background: "rgba(255, 249, 239, 0.65)",
        boxSizing: "border-box",
      }}
      aria-label="Board sound controls"
    >
      <label
        style={{
          display: "grid",
          gap: "6px",
          width: "100%",
          margin: 0,
          color: "#5a4630",
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
        }}
      >
        Volume
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={volumePercent}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          disabled={muted}
          aria-label="Board sound volume"
          style={{
            width: "100%",
            boxSizing: "border-box",
            cursor: muted ? "not-allowed" : "pointer",
          }}
        />
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onToggleMuted}
          aria-pressed={muted}
          aria-label={muted ? "Unmute board sounds" : "Mute board sounds"}
          style={{
            padding: "6px 12px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background: muted ? "#5c4a33" : "#f2d9b2",
            color: muted ? "#f8f1e7" : "#2a2218",
            fontWeight: 700,
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            cursor: "pointer",
          }}
        >
          {muted ? "Muted" : "Sound"}
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            color: "#2a2218",
            fontWeight: 700,
            fontSize: "14px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span aria-live="polite">{volumePercent}%</span>
          {muted ? (
            <span style={{ fontSize: "12px", fontWeight: 600, color: "#6f5a38" }}>(output off)</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
