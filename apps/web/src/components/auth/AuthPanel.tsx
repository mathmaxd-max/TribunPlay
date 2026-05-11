import { useEffect, useMemo, useRef, useState } from "react";
import { requestGoogleIdToken } from "../../auth/googleIdentity";
import { API_BASE, TURNSTILE_SITE_KEY } from "../../config";
import type { AuthSuccessResponse } from "../../auth/identityStore";
import { renderTurnstile } from "../../auth/turnstile";

const labelStyle = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "1.1px",
  textTransform: "uppercase" as const,
  color: "#6f5a38",
} as const;

const inputStyle = {
  width: "100%",
  border: "1px solid #ccb89b",
  borderRadius: "10px",
  background: "#fff9ef",
  color: "#1f1a13",
  padding: "11px 12px",
  fontSize: "14px",
  outline: "none",
} as const;

type Props = {
  googleClientId?: string;
  onAuthSuccess: (payload: AuthSuccessResponse) => void;
};

type ResendVerificationResult = {
  success: boolean;
  result: "sent" | "already_verified" | "accepted";
};

export default function AuthPanel({ googleClientId, onAuthSuccess }: Props) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupPasswordRepeat, setSignupPasswordRepeat] = useState("");
  const [loadingMode, setLoadingMode] = useState<"google" | "login" | "signup" | "forgot" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [forgotPasswordNotice, setForgotPasswordNotice] = useState<string | null>(null);

  const turnstileEnabled = useMemo(() => Boolean(TURNSTILE_SITE_KEY), []);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const turnstileResetRef = useRef<(() => void) | null>(null);

  const isLoading = loadingMode !== null;

  useEffect(() => {
    if (!turnstileEnabled) return;
    if (!TURNSTILE_SITE_KEY) return;
    const host = turnstileHostRef.current;
    if (!host) return;

    let cancelled = false;

    (async () => {
      try {
        host.innerHTML = "";
        setTurnstileToken(null);

        const { reset } = await renderTurnstile(host, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "auto",
          callback: (token) => {
            if (!cancelled) setTurnstileToken(token);
          },
          "expired-callback": () => {
            if (!cancelled) setTurnstileToken(null);
          },
          "error-callback": () => {
            if (!cancelled) setTurnstileToken(null);
          },
        });

        if (!cancelled) {
          turnstileResetRef.current = () => reset();
        }
      } catch (err) {
        if (!cancelled) {
          setTurnstileToken(null);
          setError(err instanceof Error ? err.message : "CAPTCHA is unavailable.");
        }
      }
    })();

    return () => {
      cancelled = true;
      turnstileResetRef.current = null;
    };
  }, [turnstileEnabled]);

  const getCaptchaTokenOrThrow = (): string | null => {
    if (!turnstileEnabled) return null;
    if (!turnstileToken) {
      throw new Error("Please complete the CAPTCHA to continue.");
    }
    return turnstileToken;
  };

  const resetCaptchaAfterSubmit = () => {
    if (!turnstileEnabled) return;
    setTurnstileToken(null);
    turnstileResetRef.current?.();
  };

  const handleGoogle = async () => {
    if (!googleClientId) {
      setError("Google sign-in is unavailable.");
      return;
    }

    setLoadingMode("google");
    setError(null);
    setForgotPasswordNotice(null);
    try {
      const googleIdToken = await requestGoogleIdToken(googleClientId);
      const response = await fetch(`${API_BASE}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleIdToken }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Google sign-in failed" }));
        throw new Error(errData.error || "Google sign-in failed");
      }

      const payload = (await response.json()) as AuthSuccessResponse;
      onAuthSuccess(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingMode(null);
    }
  };

  const handleResendVerification = async () => {
    const normalizedEmail = (pendingVerificationEmail ?? email).trim().toLowerCase();
    if (!normalizedEmail) return;

    setLoadingMode("signup");
    setError(null);
    setForgotPasswordNotice(null);
    try {
      const captchaToken = getCaptchaTokenOrThrow();
      const body: Record<string, unknown> = { email: normalizedEmail };
      if (captchaToken) body.turnstileToken = captchaToken;

      const response = await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unable to resend verification email." }));
        throw new Error(errData.error || "Unable to resend verification email. Please try again later.");
      }

      const payload = (await response.json()) as ResendVerificationResult;
      if (payload.result === "already_verified") {
        setError("Email is already verified. Please log in.");
        return;
      }
      if (payload.result === "sent") {
        setForgotPasswordNotice("Verification email sent. Please check your inbox.");
        return;
      }
      setForgotPasswordNotice("If this account can receive verification mail, we have accepted your request.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend verification email.");
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingMode(null);
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email address.");
      return;
    }

    setLoadingMode("forgot");
    setError(null);
    setForgotPasswordNotice(null);
    try {
      const captchaToken = getCaptchaTokenOrThrow();
      const body: Record<string, unknown> = { email: normalizedEmail };
      if (captchaToken) body.turnstileToken = captchaToken;

      const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unable to process password reset." }));
        throw new Error(errData.error || "Unable to process password reset.");
      }

      setForgotPasswordNotice("If an account exists for this email, a reset link has been sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to process password reset.");
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingMode(null);
    }
  };

  const handleEmailSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name to sign up.");
      return;
    }
    if (mode === "signup" && password !== signupPasswordRepeat) {
      setError("Passwords do not match.");
      return;
    }

    setLoadingMode(mode);
    setError(null);
    setForgotPasswordNotice(null);
    try {
      const captchaToken = getCaptchaTokenOrThrow();
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body: Record<string, unknown> =
        mode === "login"
          ? { email: normalizedEmail, password }
          : { email: normalizedEmail, password, name: name.trim() };
      if (captchaToken) body.turnstileToken = captchaToken;
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const statusHint = `${response.status} ${response.statusText}`.trim();
        const errData = await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return { error: text ? `${statusHint}: ${text}` : statusHint || "Authentication failed" };
        });
        throw new Error(errData.error || statusHint || "Authentication failed");
      }

      const payload = (await response.json()) as AuthSuccessResponse | { requiresEmailVerification?: boolean };
      if (mode === "signup" && payload && "requiresEmailVerification" in payload && payload.requiresEmailVerification) {
        setPendingVerificationEmail(normalizedEmail);
        return;
      }
      onAuthSuccess(payload as AuthSuccessResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      resetCaptchaAfterSubmit();
      setLoadingMode(null);
    }
  };

  const isForgotMode = mode === "forgot" && !pendingVerificationEmail;

  const submitDisabled =
    isLoading ||
    !email.trim() ||
    (!pendingVerificationEmail && !isForgotMode && !password) ||
    (!pendingVerificationEmail && !isForgotMode && mode === "signup" && !name.trim()) ||
    (!pendingVerificationEmail && !isForgotMode && mode === "signup" && !signupPasswordRepeat) ||
    (!pendingVerificationEmail && !isForgotMode && mode === "signup" && password !== signupPasswordRepeat) ||
    (turnstileEnabled && !turnstileToken);

  return (
    <section
      style={{
        borderRadius: "18px",
        border: "2px solid #3c3226",
        background: "rgba(255, 250, 242, 0.84)",
        boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
        padding: "18px",
        display: "grid",
        gap: "12px",
      }}
      aria-label="Login with account"
    >
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
        Account
      </div>
      <div style={{ fontSize: "30px", fontWeight: 700, color: "#2c2318" }}>
        {pendingVerificationEmail
          ? "Verify your email"
          : isForgotMode
            ? "Reset password"
            : mode === "login"
              ? "Log in"
              : "Sign up"}
      </div>

      {!pendingVerificationEmail && !isForgotMode && (
        <>
          <button
            onClick={handleGoogle}
            disabled={isLoading || !googleClientId}
            style={{
              width: "100%",
              padding: "11px 14px",
              borderRadius: "999px",
              border: "2px solid #1f4d2f",
              background: isLoading || !googleClientId ? "#8ea593" : "#2f6b3f",
              color: "#f7f3eb",
              fontWeight: 700,
              letterSpacing: "0.6px",
              cursor: isLoading || !googleClientId ? "not-allowed" : "pointer",
            }}
            aria-busy={loadingMode === "google"}
          >
            {loadingMode === "google" ? "Connecting..." : "Continue with Google"}
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "10px" }}>
            <div style={{ height: "1px", background: "#d7c5ab" }} />
            <div style={{ fontSize: "12px", color: "#6f5a38", textTransform: "uppercase", letterSpacing: "1px" }}>or</div>
            <div style={{ height: "1px", background: "#d7c5ab" }} />
          </div>
        </>
      )}

      {turnstileEnabled && (
        <div style={{ display: "grid", gap: "8px" }}>
          <div style={labelStyle}>CAPTCHA</div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "10px",
              borderRadius: 0,
              background: "rgba(255, 249, 239, 0.55)",
              boxShadow: "inset 0 0 0 1px rgba(204, 184, 155, 0.65)",
            }}
          >
            <div
              ref={turnstileHostRef}
              style={{
                minHeight: "66px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 0,
                overflow: "hidden",
                background: "transparent",
              }}
            />
          </div>
        </div>
      )}

      {!pendingVerificationEmail && mode === "signup" && (
        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="auth-name" style={labelStyle}>
            Name
          </label>
          <input
            id="auth-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={inputStyle}
            disabled={isLoading}
            autoComplete="name"
          />
        </div>
      )}

      <div style={{ display: "grid", gap: "6px" }}>
        <label htmlFor="auth-email" style={labelStyle}>
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          value={pendingVerificationEmail ?? email}
          onChange={(event) => setEmail(event.target.value)}
          style={inputStyle}
          disabled={isLoading || Boolean(pendingVerificationEmail)}
          autoComplete={mode === "login" ? "email" : "new-email"}
        />
      </div>

      {!pendingVerificationEmail && !isForgotMode && (
        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="auth-password" style={labelStyle}>
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={inputStyle}
            disabled={isLoading}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleEmailSubmit();
              }
            }}
          />
        </div>
      )}

      {!pendingVerificationEmail && mode === "signup" && (
        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="auth-password-repeat" style={labelStyle}>
            Confirm password
          </label>
          <input
            id="auth-password-repeat"
            type="password"
            value={signupPasswordRepeat}
            onChange={(event) => setSignupPasswordRepeat(event.target.value)}
            style={inputStyle}
            disabled={isLoading}
            autoComplete="new-password"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleEmailSubmit();
              }
            }}
          />
        </div>
      )}

      <button
        onClick={pendingVerificationEmail ? handleResendVerification : isForgotMode ? handleForgotPassword : handleEmailSubmit}
        disabled={submitDisabled}
        aria-busy={loadingMode === "login" || loadingMode === "signup" || loadingMode === "forgot"}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: "999px",
          border: "2px solid #6f5a38",
          background: submitDisabled ? "#d8c8ab" : "#f2d9b2",
          color: "#2a2218",
          fontWeight: 700,
          letterSpacing: "1px",
          textTransform: "uppercase",
          cursor: submitDisabled ? "not-allowed" : "pointer",
        }}
      >
        {pendingVerificationEmail
          ? loadingMode === "signup"
            ? "Resending..."
            : "Resend verification email"
          : isForgotMode
            ? loadingMode === "forgot"
              ? "Sending reset link..."
              : "Send reset link"
            : mode === "login"
              ? loadingMode === "login"
                ? "Logging in..."
                : "Log in"
              : loadingMode === "signup"
                ? "Creating account..."
                : "Sign up"}
      </button>

      {pendingVerificationEmail ? (
        <div style={{ textAlign: "center", fontSize: "14px", color: "#5a4630", lineHeight: 1.4 }}>
          We sent a verification link to <strong>{pendingVerificationEmail}</strong>. Please check your inbox and verify your
          email before logging in.
          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              onClick={() => {
                setPendingVerificationEmail(null);
                setMode("login");
                setSignupPasswordRepeat("");
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "#1f4d2f",
                fontWeight: 700,
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
              disabled={isLoading}
            >
              Back to login
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", fontSize: "14px", color: "#5a4630", lineHeight: 1.35 }}>
          {isForgotMode ? "Remembered your password? " : mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setForgotPasswordNotice(null);
              setMode((prev) => {
                if (prev === "forgot") return "login";
                return prev === "login" ? "signup" : "login";
              });
              setSignupPasswordRepeat("");
            }}
            style={{
              border: "none",
              background: "transparent",
              color: "#1f4d2f",
              fontWeight: 700,
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
            disabled={isLoading}
          >
            {isForgotMode ? "Log in" : mode === "login" ? "Sign up" : "Log in"}
          </button>
          {mode === "login" && (
            <div style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setForgotPasswordNotice(null);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#1f4d2f",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                }}
                disabled={isLoading}
              >
                Forgot password?
              </button>
            </div>
          )}
        </div>
      )}

      {forgotPasswordNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            borderRadius: "12px",
            border: "2px solid #5b7a41",
            background: "#e6f2da",
            color: "#22451a",
            padding: "10px 14px",
            fontWeight: 600,
          }}
        >
          {forgotPasswordNotice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            borderRadius: "12px",
            border: "2px solid #8b3b3b",
            background: "#f7d7d5",
            color: "#5c1c16",
            padding: "10px 14px",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
