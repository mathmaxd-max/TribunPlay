type TurnstileVerifySuccess = {
  success: true;
};

type TurnstileVerifyFailure = {
  success: false;
  error: string;
};

type TurnstileVerifyResult = TurnstileVerifySuccess | TurnstileVerifyFailure;

export type VerifyTurnstileInput = {
  enabled: boolean;
  secretKey?: string;
  token?: string;
  remoteIp?: string;
};

export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export type ResolveTurnstileServerConfigInput = {
  enabledFlag?: string;
  configuredSecretKey?: string;
  requestUrl: string;
  hostHeader?: string;
};

export type ResolveTurnstileServerConfigResult = {
  enabled: boolean;
  secretKey?: string;
  isLocalDevHost: boolean;
};

const isLocalDevHost = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";

const resolveRequestHost = (requestUrl: string, hostHeader?: string): string => {
  try {
    return new URL(requestUrl).hostname;
  } catch {
    return hostHeader ?? "";
  }
};

export const resolveTurnstileServerConfig = (
  input: ResolveTurnstileServerConfigInput,
): ResolveTurnstileServerConfigResult => {
  const requestHost = resolveRequestHost(input.requestUrl, input.hostHeader);
  const isLocal = isLocalDevHost(requestHost);
  return {
    enabled: input.enabledFlag === "true" || isLocal,
    // Local dev must use Turnstile's test key-pair; dashboard keys are domain-gated.
    secretKey: isLocal ? TURNSTILE_TEST_SECRET_KEY : input.configuredSecretKey,
    isLocalDevHost: isLocal,
  };
};

/**
 * Cloudflare Turnstile verification.
 *
 * IMPORTANT:
 * - The client-provided token is short-lived and generally single-use.
 * - Verification MUST be performed server-side before issuing a session.
 */
export const verifyTurnstile = async (input: VerifyTurnstileInput): Promise<TurnstileVerifyResult> => {
  if (!input.enabled) {
    return { success: true };
  }

  if (!input.secretKey) {
    // Misconfiguration: fail closed if enabled.
    return { success: false, error: "CAPTCHA is unavailable. Please try again later." };
  }

  if (!input.token) {
    return { success: false, error: "CAPTCHA verification required." };
  }

  const form = new FormData();
  form.set("secret", input.secretKey);
  form.set("response", input.token);
  if (input.remoteIp && input.remoteIp !== "unknown") {
    form.set("remoteip", input.remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });

    if (!response.ok) {
      return { success: false, error: "CAPTCHA verification failed." };
    }

    const data = (await response.json().catch(() => null)) as
      | { success?: boolean; "error-codes"?: unknown }
      | null;

    if (!data?.success) {
      const errorCodes = Array.isArray(data?.["error-codes"])
        ? (data?.["error-codes"] as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      if (errorCodes.length > 0) {
        console.error("Turnstile verification failed", errorCodes);
      }
      if (errorCodes.includes("timeout-or-duplicate")) {
        return { success: false, error: "CAPTCHA expired. Please verify again." };
      }
      if (errorCodes.includes("missing-input-secret") || errorCodes.includes("invalid-input-secret")) {
        return { success: false, error: "CAPTCHA is unavailable. Please try again later." };
      }
      return { success: false, error: "CAPTCHA verification failed." };
    }

    return { success: true };
  } catch {
    return { success: false, error: "CAPTCHA verification failed." };
  }
};
