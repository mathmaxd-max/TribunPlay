export type TurnstileRenderOptions = {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact";
  /**
   * Called with a short-lived token that MUST be verified server-side.
   * Tokens are generally single-use; plan to reset the widget after submitting.
   */
  callback?: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loadPromise: Promise<void> | null = null;

export const loadTurnstile = (): Promise<void> => {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-tribun="turnstile"]');
    if (existing) {
      // If the script exists but turnstile isn't ready yet, wait for it.
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load CAPTCHA")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.tribun = "turnstile";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load CAPTCHA"));
    document.head.appendChild(script);
  });

  return loadPromise;
};

export const renderTurnstile = async (
  container: HTMLElement,
  options: TurnstileRenderOptions,
): Promise<{ widgetId: string; reset: () => void }> => {
  await loadTurnstile();

  if (!window.turnstile) {
    throw new Error("CAPTCHA is unavailable.");
  }

  const widgetId = window.turnstile.render(container, options);
  return {
    widgetId,
    reset: () => window.turnstile?.reset(widgetId),
  };
};

