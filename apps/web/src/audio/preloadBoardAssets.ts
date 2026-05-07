import { preloadAllUnitIcons } from '../ui/unitIcons';

const EXTRA_BOARD_IMAGE_URLS = [
  new URL('../assets/game/units/icons/Trash.webp', import.meta.url).href,
  new URL('../assets/game/units/icons/_Trash.webp', import.meta.url).href,
] as const;

let preloadBoardImagesPromise: Promise<void> | null = null;

const preloadImage = (url: string): Promise<void> =>
  new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode !== 'function') {
        resolve();
        return;
      }
      img.decode().catch(() => undefined).finally(() => resolve());
    };
    img.onerror = () => resolve();
    img.src = url;
    if (img.complete && typeof img.decode === 'function') {
      img.decode().catch(() => undefined).finally(() => resolve());
    }
  });

const preloadExtraBoardImages = (): Promise<void> => {
  if (preloadBoardImagesPromise) return preloadBoardImagesPromise;
  preloadBoardImagesPromise = Promise.all(EXTRA_BOARD_IMAGE_URLS.map((url) => preloadImage(url))).then(() => undefined);
  return preloadBoardImagesPromise;
};

export const preloadBoardVisualAssets = (): Promise<void> =>
  Promise.all([preloadAllUnitIcons(), preloadExtraBoardImages()]).then(() => undefined);
