const clampToNonNegativeInt = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
};

/**
 * Format a duration given in seconds as "1h 2m 3s", omitting zero segments.
 *
 * Rules:
 * - Negative/invalid values are clamped to 0.
 * - 0 is a special case and renders as "0s".
 */
export function formatDurationHms(totalSeconds: number): string {
  const total = clampToNonNegativeInt(totalSeconds);
  if (total === 0) return '0s';

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  // `total !== 0` guarantees at least one segment is non-zero.
  return parts.join(' ');
}

