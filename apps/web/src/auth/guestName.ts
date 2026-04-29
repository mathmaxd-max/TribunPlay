import guestNames from "./guestNames.json";

type GuestNamesData = {
  names: string[];
  pre?: string[];
  post?: string[];
};

const pick = (items: string[] | undefined): string | null => {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
};

/**
 * Generates a friendly guest name like:
 * - "Dr. Tim" (prefix) OR "Tim the witty" (suffix)
 *
 * Only one of prefix/suffix is applied. If the pre/post lists are empty,
 * it falls back to the base name.
 */
export function generateRandomGuestName(source: GuestNamesData = guestNames): string {
  const base = pick(source.names)?.trim() || "Guest";
  const pre = pick(source.pre)?.trim();
  const post = pick(source.post)?.trim();

  const hasPre = Boolean(pre);
  const hasPost = Boolean(post);
  if (!hasPre && !hasPost) return base;

  // Prefer the available side(s); if both exist, pick one at random.
  const usePre = hasPre && (!hasPost || Math.random() < 0.5);
  return usePre ? `${pre} ${base}`.trim() : `${base} ${post}`.trim();
}

