import { formatDurationHms } from '../utils/formatDuration';
import { coerceSeconds } from '../clock/buildTimeControl';
import type { ClockField, ClockInput } from '../clock/types';

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

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

export function ClockEditor(props: {
  title: string;
  clock: ClockInput;
  onChange: (field: ClockField, value: number | '') => void;
  tone?: 'light' | 'dark';
}) {
  const { title, clock, onChange, tone = 'light' } = props;
  const panelBg = tone === 'dark' ? '#f7ead6' : '#fffaf0';

  const renderRow = (label: string, field: ClockField) => (
    <div key={field} style={{ display: 'grid', gap: '7px' }}>
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
