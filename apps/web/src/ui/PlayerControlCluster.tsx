import { formatClockTime } from '../clock/formatClockTime';
import type { ColorClock, PlayerColor } from '../clock/types';

type PlayerControlClusterProps = {
  color: PlayerColor;
  clocksMs: ColorClock;
  bufferMsRemaining: ColorClock;
  activeColor: PlayerColor;
  clockRunning: boolean;
  ended: boolean;
  lostOnTime?: boolean;
  // `mobile-top` rotates the whole cluster 180deg, `mobile-bottom` stays normal, `desktop` is handled by LocalGame.
  layoutVariant: 'mobile-top' | 'mobile-bottom' | 'desktop';
  hint?: string;
  drawLabel: string;
  surrenderLabel: string;
  canDraw: boolean;
  canSurrender: boolean;
  onClockClick: () => void;
  onDraw: () => void;
  onSurrender: () => void;
};

const CLOCK_HEIGHT = 120;
const CONTROL_GAP = 10;
const BUTTON_HEIGHT = (CLOCK_HEIGHT - CONTROL_GAP) / 2;

const actionButtonBase = {
  width: '100%',
  height: BUTTON_HEIGHT,
  borderRadius: '12px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.9px',
  cursor: 'pointer',
  fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
};

export function PlayerControlCluster(props: PlayerControlClusterProps) {
  const {
    color,
    clocksMs,
    bufferMsRemaining,
    activeColor,
    clockRunning,
    ended,
    lostOnTime = false,
    layoutVariant,
    hint = '',
    drawLabel,
    surrenderLabel,
    canDraw,
    canSurrender,
    onClockClick,
    onDraw,
    onSurrender,
  } = props;

  const isActive = !ended && activeColor === color;
  const isRunning = isActive && clockRunning;
  const showBuffer = Boolean(isRunning && bufferMsRemaining[color] > 0);
  const clockValue = formatClockTime(clocksMs[color]);
  const bufferValue = formatClockTime(bufferMsRemaining[color]);
  const tone = color === 'black' ? '#f4efe6' : '#1c1b19';
  const surface = color === 'black' ? '#2b2620' : '#f6eddf';
  const borderColor = lostOnTime ? '#a63d32' : isActive ? '#b9833b' : '#3b3327';
  const borderWidth = isActive ? 3 : 2;
  const boxShadow = isActive
    ? '0 12px 28px rgba(185, 131, 59, 0.35), 0 8px 16px rgba(20, 15, 10, 0.18)'
    : '0 8px 16px rgba(20, 15, 10, 0.12)';

  const isTopVariant = layoutVariant === 'mobile-top';
  // Bottom (white): buttons left, clock right. Top (black) uses the same row order; outer rotate(180deg) mirrors for that seat.
  const rowDirection = 'row';
  const buttonDirection = 'column';

  const cluster = (
    <div
      style={{
        display: 'flex',
        flexDirection: rowDirection,
        alignItems: 'stretch',
        justifyContent: 'stretch',
        gap: `${CONTROL_GAP}px`,
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: buttonDirection,
          gap: `${CONTROL_GAP}px`,
          height: `${CLOCK_HEIGHT}px`,
          flex: '1 1 50%',
          width: '50%',
          minWidth: 0,
        }}
      >
        <button
          type="button"
          disabled={!canSurrender}
          onClick={onSurrender}
          style={{
            ...actionButtonBase,
            border: '2px solid #5b2a2a',
            background: canSurrender ? '#8b3b3b' : '#b9a2a2',
            color: '#f8f1e7',
            cursor: canSurrender ? 'pointer' : 'not-allowed',
          }}
        >
          {surrenderLabel}
        </button>
        <button
          type="button"
          disabled={!canDraw}
          onClick={onDraw}
          style={{
            ...actionButtonBase,
            border: '2px solid #5a4a2f',
            background: canDraw ? '#c9a565' : '#d8c8ab',
            color: '#2a2218',
            cursor: canDraw ? 'pointer' : 'not-allowed',
          }}
        >
          {drawLabel}
        </button>
      </div>

      <button
        type="button"
        onClick={onClockClick}
        disabled={ended}
        aria-label={`${color === 'black' ? 'Black' : 'White'} clock${hint ? ` - ${hint}` : ''}`}
        style={{
          flex: '1 1 50%',
          width: '50%',
          minWidth: 0,
          height: `${CLOCK_HEIGHT}px`,
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
          position: 'relative',
          cursor: ended ? 'default' : 'pointer',
          padding: 0,
        }}
      >
        {showBuffer ? (
          <>
            <div
              style={{
                position: 'absolute',
                top: '14px',
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
                bottom: '16px',
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
        {hint ? (
          <div
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '14px',
              right: '14px',
              fontSize: '12px',
              fontWeight: 600,
              color: color === 'black' ? '#d4c9b8' : '#5a4630',
              letterSpacing: '0.3px',
              textAlign: 'left',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {hint}
          </div>
        ) : null}
      </button>
    </div>
  );

  if (!isTopVariant) return cluster;

  return (
    <div
      style={{
        width: '100%',
        transform: 'rotate(180deg)',
      }}
    >
      {cluster}
    </div>
  );
}
