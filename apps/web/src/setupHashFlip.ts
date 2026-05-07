import { decodeCodeDetailed, encodePositionDetailed, flipSetup } from "@tribunplay/engine";

const flipCache = new Map<string, string | null>();

export const normalizeSetupHashInput = (value: string): string =>
  value.replace(/\s+/g, "").trim().toUpperCase();

export const getFlippedSetupHash = (rawHash: string): string | null => {
  const hash = normalizeSetupHashInput(rawHash);
  if (!hash) return null;
  if (flipCache.has(hash)) {
    return flipCache.get(hash) ?? null;
  }

  const decoded = decodeCodeDetailed(hash);
  if (!decoded.ok || !decoded.setup) {
    flipCache.set(hash, null);
    return null;
  }
  const flipped = flipSetup(decoded.setup);
  const encoded = encodePositionDetailed(flipped);
  if (!encoded.ok) {
    flipCache.set(hash, null);
    return null;
  }

  const flippedHash = encoded.code;
  flipCache.set(hash, flippedHash);
  if (!flipCache.has(flippedHash)) {
    flipCache.set(flippedHash, hash);
  }
  return flippedHash;
};
