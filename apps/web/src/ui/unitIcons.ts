const icon1 = new URL("../assets/game/units/icons/1.webp", import.meta.url).href;
const icon2 = new URL("../assets/game/units/icons/2.webp", import.meta.url).href;
const icon3 = new URL("../assets/game/units/icons/3.webp", import.meta.url).href;
const icon4 = new URL("../assets/game/units/icons/4.webp", import.meta.url).href;
const icon6 = new URL("../assets/game/units/icons/6.webp", import.meta.url).href;
const icon8 = new URL("../assets/game/units/icons/8.webp", import.meta.url).href;
const iconT = new URL("../assets/game/units/icons/T.webp", import.meta.url).href;

const outline1 = new URL("../assets/game/units/icons/_1.webp", import.meta.url).href;
const outline2 = new URL("../assets/game/units/icons/_2.webp", import.meta.url).href;
const outline3 = new URL("../assets/game/units/icons/_3.webp", import.meta.url).href;
const outline4 = new URL("../assets/game/units/icons/_4.webp", import.meta.url).href;
const outline6 = new URL("../assets/game/units/icons/_6.webp", import.meta.url).href;
const outline8 = new URL("../assets/game/units/icons/_8.webp", import.meta.url).href;
const outlineT = new URL("../assets/game/units/icons/_T.webp", import.meta.url).href;
const ALL_UNIT_ICON_URLS = [
  icon1,
  icon2,
  icon3,
  icon4,
  icon6,
  icon8,
  iconT,
  outline1,
  outline2,
  outline3,
  outline4,
  outline6,
  outline8,
  outlineT,
] as const;
let preloadPromise: Promise<void> | null = null;

export type UnitIconRequest = {
  height: number;
  tribun: boolean;
  outline: boolean;
};

/**
 * Resolves the best-matching unit icon URL.
 *
 * Constraints:
 * - We only have icons for heights 1/2/3/4/6/8, plus a special 1T icon ("T").
 * - Tribun units of height 2T/3T/... intentionally reuse the regular height icon
 *   (Tribun differentiation is done by color elsewhere).
 * - For intermediate heights (e.g. 5/7), return null so callers can fall back to numbers.
 */
export function resolveUnitIconUrl(req: UnitIconRequest): string | null {
  const { height, tribun, outline } = req;

  // Special case: 1T has a dedicated glyph.
  if (tribun && height === 1) return outline ? outlineT : iconT;

  switch (height) {
    case 1:
      return outline ? outline1 : icon1;
    case 2:
      return outline ? outline2 : icon2;
    case 3:
      return outline ? outline3 : icon3;
    case 4:
      return outline ? outline4 : icon4;
    case 6:
      return outline ? outline6 : icon6;
    case 8:
      return outline ? outline8 : icon8;
    default:
      return null;
  }
}

export function preloadAllUnitIcons(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  if (typeof Image === "undefined") {
    preloadPromise = Promise.resolve();
    return preloadPromise;
  }

  preloadPromise = Promise.all(
    ALL_UNIT_ICON_URLS.map(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        }),
    ),
  ).then(() => undefined);

  return preloadPromise;
}
