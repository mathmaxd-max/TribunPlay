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
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        borderRadius: '999px',
        border: '1px solid #6f5a38',
        background: 'rgba(250, 240, 223, 0.16)',
      }}
      aria-label="Board sound controls"
    >
      <button
        type="button"
        onClick={onToggleMuted}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute board sounds' : 'Mute board sounds'}
        style={{
          padding: '4px 10px',
          borderRadius: '999px',
          border: '1px solid #6f5a38',
          background: muted ? '#5c4a33' : '#f2d9b2',
          color: muted ? '#f8f1e7' : '#2a2218',
          fontWeight: 700,
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          cursor: 'pointer',
        }}
      >
        {muted ? 'Muted' : 'Sound'}
      </button>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: '#f8f1e7',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
        }}
      >
        Vol
        <input
          type="range"
          min={0}
          max={200}
          step={5}
          value={volumePercent}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          disabled={muted}
          aria-label="Board sound volume"
          style={{ width: '86px', cursor: muted ? 'not-allowed' : 'pointer' }}
        />
      </label>
      <span style={{ minWidth: '34px', textAlign: 'right', fontSize: '11px', color: '#f8f1e7', fontWeight: 700 }}>
        {muted ? '0%' : `${volumePercent}%`}
      </span>
    </div>
  );
}
