type GoogleCredentialResponse = {
  credential?: string;
};

type GooglePromptMomentNotification = {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
};

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  prompt: (momentListener?: (notification: GooglePromptMomentNotification) => void) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

const loadGoogleIdentityScript = (): Promise<void> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google sign-in is only available in the browser"));
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-google-gsi='true']");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load Google sign-in")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleGsi = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google sign-in"));
      document.head.appendChild(script);
    });
  }

  return googleScriptPromise;
};

export const requestGoogleIdToken = async (clientId: string): Promise<string> => {
  await loadGoogleIdentityScript();

  if (!window.google?.accounts?.id) {
    throw new Error("Google sign-in is unavailable");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    window.google!.accounts.id.initialize({
      client_id: clientId,
      cancel_on_tap_outside: true,
      callback: (response) => {
        if (!response?.credential) {
          done(() => reject(new Error("Google sign-in did not return a credential")));
          return;
        }

        done(() => resolve(response.credential!));
      },
    });

    window.google!.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        const reason = notification.getNotDisplayedReason?.() ?? "not_displayed";
        done(() => reject(new Error(`Google sign-in unavailable (${reason})`)));
      } else if (notification.isSkippedMoment()) {
        const reason = notification.getSkippedReason?.() ?? "skipped";
        done(() => reject(new Error(`Google sign-in skipped (${reason})`)));
      }
    });

    setTimeout(() => {
      done(() => reject(new Error("Google sign-in timed out. Please try again.")));
    }, 60000);
  });
};
