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
      return { success: false, error: "CAPTCHA verification failed." };
    }

    return { success: true };
  } catch {
    return { success: false, error: "CAPTCHA verification failed." };
  }
};

