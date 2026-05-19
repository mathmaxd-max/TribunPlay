import { formatClockTime } from '../clock/formatClockTime';
import type { ColorClock, PlayerColor, StandaloneClockStatus } from '../clock/types';

type StandaloneClockPanelProps = {
  color: PlayerColor;
  clocksMs: ColorClock;
  bufferMsRemaining: ColorClock;
  activeColor: PlayerColor;
  clockRunning: boolean;
  status: StandaloneClockStatus;
  endLoser: PlayerColor | null;
  hint: string;
  rotated?: boolean;
  onClick: () => void;
};

export function StandaloneClockPanel(props: StandaloneClockPanelProps) {
  const {
    color,
    clocksMs,
    bufferMsRemaining,
    activeColor,
    clockRunning,
    status,
    endLoser,
    hint,
    rotated = false,
    onClick,
  } = props;

  const isActive = status !== 'ended' && activeColor === color;
  const isRunning = isActive && clockRunning;
  const showBuffer = Boolean(isRunning && bufferMsRemaining[color] > 0);
  const clockValue = formatClockTime(clocksMs[color]);
  const bufferValue = formatClockTime(bufferMsRemaining[color]);
  const tone = color === 'black' ? '#f4efe6' : '#1c1b19';
  const surface = color === 'black' ? '#2b2620' : '#f6eddf';
  const lostOnTime = status === 'ended' && endLoser === color;

  let borderColor = isActive ? '#b9833b' : '#3b3327';
  if (lostOnTime) borderColor = '#a63d32';
  const borderWidth = isActive ? 3 : 2;
  const boxShadow = isActive
    ? '0 12px 28px rgba(185, 131, 59, 0.35), 0 8px 16px rgba(20, 15, 10, 0.18)'
    : '0 8px 16px rgba(20, 15, 10, 0.12)';

  const panel = (
    <button
      type="button"
      onClick={onClick}
      disabled={status === 'ended'}
      aria-label={`${color === 'black' ? 'Black' : 'White'} clock${isActive ? ', on turn' : ''}${hint ? ` — ${hint}` : ''}`}
      style={{
        flex: 1,
        width: '100%',
        minHeight: 0,
        border: 'none',
        padding: '20px 16px',
        cursor: status === 'ended' ? 'default' : 'pointer',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: color === 'black' ? '#c4b8a8' : '#6f5a38',
        }}
      >
        {color === 'black' ? 'Black' : 'White'}
      </div>
      <div
        style={{
          position: 'relative',
          width: 'min(420px, 92vw)',
          height: '120px',
          borderRadius: '16px',
          border: `${borderWidth}px solid ${borderColor}`,
          background: surface,
          color: tone,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
          letterSpacing: '1px',
          boxShadow,
          opacity: lostOnTime ? 0.88 : 1,
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
        }}
      >
        {showBuffer ? (
          <>
            <div
              style={{
                position: 'absolute',
                top: '12px',
                left: '14px',
                fontSize: '14px',
                fontWeight: 700,
                color: color === 'black' ? '#9fd8b6' : '#2f6b3f',
              }}
            >
              {bufferValue}
            </div>
            <div
              style={{
                position: 'absolute',
                right: '14px',
                bottom: '12px',
                fontSize: '32px',
                fontWeight: 700,
              }}
            >
              {clockValue}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '40px', fontWeight: 700 }}>{clockValue}</div>
        )}
      </div>
      {hint ? (
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: color === 'black' ? '#d4c9b8' : '#5a4630',
            letterSpacing: '0.3px',
          }}
        >
          {hint}
        </div>
      ) : null}
    </button>
  );

  if (!rotated) return panel;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        transform: 'rotate(180deg)',
      }}
    >
      {panel}
    </div>
  );
}
