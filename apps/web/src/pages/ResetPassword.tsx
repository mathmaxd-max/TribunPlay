import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { API_BASE } from "../config";

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useMemo(() => new URLSearchParams(location.search).get("token") ?? "", [location.search]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token) {
      setError("Missing reset token.");
      return;
    }
    if (!password) {
      setError("Enter your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unable to reset password." }));
        throw new Error(errData.error || "Unable to reset password.");
      }

      setSuccess("Your password has been reset. Redirecting to login...");
      window.setTimeout(() => navigate("/auth", { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
      <h2 style={{ margin: 0, fontSize: "28px" }}>Reset password</h2>
      <div style={{ marginTop: "12px", color: "#5a4630" }}>Set a new password for your account.</div>

      <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
        <label htmlFor="reset-password" style={{ fontWeight: 700, fontSize: "13px" }}>
          New password
        </label>
        <input
          id="reset-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={loading}
          style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
        />
      </div>

      <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
        <label htmlFor="reset-password-confirm" style={{ fontWeight: 700, fontSize: "13px" }}>
          Confirm new password
        </label>
        <input
          id="reset-password-confirm"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={loading}
          style={{ padding: "10px 12px", borderRadius: "10px", border: "1px solid #ccb89b", background: "#fff9ef" }}
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !password || !confirmPassword}
        style={{
          marginTop: "16px",
          padding: "10px 14px",
          borderRadius: "999px",
          border: "2px solid #6f5a38",
          background: loading || !password || !confirmPassword ? "#d8c8ab" : "#f2d9b2",
          color: "#2a2218",
          fontWeight: 700,
          cursor: loading || !password || !confirmPassword ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Updating..." : "Reset password"}
      </button>

      {success && (
        <div style={{ marginTop: "14px", border: "2px solid #5b7a41", background: "#e6f2da", color: "#22451a", borderRadius: "10px", padding: "10px 12px", fontWeight: 600 }}>
          {success}
        </div>
      )}

      {error && (
        <div style={{ marginTop: "14px", border: "2px solid #8b3b3b", background: "#f7d7d5", color: "#5c1c16", borderRadius: "10px", padding: "10px 12px", fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: "18px" }}>
        <Link to="/auth" style={{ color: "#1f4d2f", fontWeight: 700 }}>
          Back to login
        </Link>
      </div>
    </main>
  );
}
