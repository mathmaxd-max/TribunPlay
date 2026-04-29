import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { requestGoogleIdToken } from "../auth/googleIdentity";
import { resolveNextPath } from "../auth/redirect";
import { setIdentityFromAuthSuccess, type AuthSuccessResponse } from "../auth/identityStore";
import { API_BASE } from "../config";

const cardStyle = {
  width: "min(460px, 92vw)",
  borderRadius: "20px",
  border: "2px solid #1d1610",
  background: "rgba(255, 250, 242, 0.92)",
  boxShadow: "0 20px 36px rgba(39, 30, 20, 0.2)",
  padding: "24px",
  display: "grid",
  gap: "14px",
} as const;

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

export default function Login() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingMode, setLoadingMode] = useState<"google" | "login" | "signup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return resolveNextPath(params.get("next"));
  }, [location.search]);

  const isLoading = loadingMode !== null;

  const applyAuthSuccess = (payload: AuthSuccessResponse) => {
    setIdentityFromAuthSuccess(payload);
    navigate(nextPath, { replace: true });
  };

  const handleGoogle = async () => {
    if (!googleClientId) {
      setError("Google sign-in is unavailable.");
      return;
    }

    setLoadingMode("google");
    setError(null);
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
      applyAuthSuccess(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
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

    setLoadingMode(mode);
    setError(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email: normalizedEmail, password }
            : { email: normalizedEmail, password, name: name.trim() },
        ),
      });

      if (!response.ok) {
        // The API is expected to return JSON `{ error: string }`, but deployments/proxies can return
        // plain text / HTML for 404s and other failures. Surface a useful message either way.
        const statusHint = `${response.status} ${response.statusText}`.trim();
        const errData = await response.json().catch(async () => {
          const text = await response.text().catch(() => "");
          return { error: text ? `${statusHint}: ${text}` : statusHint || "Authentication failed" };
        });
        throw new Error(errData.error || statusHint || "Authentication failed");
      }

      const payload = (await response.json()) as AuthSuccessResponse;
      applyAuthSuccess(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)",
        color: "#1d1a14",
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
        padding: "22px 12px",
      }}
    >
      <div style={cardStyle}>
        <div style={{ fontSize: "33px", fontWeight: 700, color: "#2c2318" }}>Sign in</div>

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

        {mode === "signup" && (
          <div style={{ display: "grid", gap: "6px" }}>
            <label htmlFor="name" style={labelStyle}>
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              style={inputStyle}
              disabled={isLoading}
            />
          </div>
        )}

        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="email" style={labelStyle}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={inputStyle}
            disabled={isLoading}
            autoComplete={mode === "login" ? "email" : "new-email"}
          />
        </div>

        <div style={{ display: "grid", gap: "6px" }}>
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <input
            id="password"
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

        <button
          onClick={handleEmailSubmit}
          disabled={isLoading || !email.trim() || !password || (mode === "signup" && !name.trim())}
          aria-busy={loadingMode === "login" || loadingMode === "signup"}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background:
              isLoading || !email.trim() || !password || (mode === "signup" && !name.trim()) ? "#d8c8ab" : "#f2d9b2",
            color: "#2a2218",
            fontWeight: 700,
            letterSpacing: "1px",
            textTransform: "uppercase",
            cursor:
              isLoading || !email.trim() || !password || (mode === "signup" && !name.trim()) ? "not-allowed" : "pointer",
          }}
        >
          {mode === "login" ? (loadingMode === "login" ? "Logging in..." : "Log in") : loadingMode === "signup" ? "Creating account..." : "Sign up"}
        </button>

        <div style={{ textAlign: "center", fontSize: "14px", color: "#5a4630" }}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === "login" ? "signup" : "login"))}
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
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </div>

        <div style={{ textAlign: "center", fontSize: "13px" }}>
          <Link to="/" style={{ color: "#5a4630", textDecoration: "none" }}>
            Back to Home
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            marginTop: "14px",
            width: "min(460px, 92vw)",
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
    </div>
  );
}
