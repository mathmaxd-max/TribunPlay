import { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { API_BASE } from "../config";

export default function VerifyEmail() {
  const location = useLocation();
  const token = useMemo(() => new URLSearchParams(location.search).get("token") ?? "", [location.search]);
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }

    let cancelled = false;
    setStatus("verifying");
    setMessage(null);

    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: "Invalid or expired verification link" }));
          throw new Error(errData.error || "Invalid or expired verification link");
        }

        if (!cancelled) {
          setStatus("success");
          setMessage("Your email has been verified. You can now log in.");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setMessage(err instanceof Error ? err.message : "Verification failed.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "24px" }}>
      <h2 style={{ margin: 0, fontSize: "28px" }}>Email verification</h2>
      <div style={{ marginTop: "14px", fontSize: "16px", lineHeight: 1.5 }}>
        {status === "verifying" && "Verifying your email..."}
        {message && <div style={{ marginTop: "10px" }}>{message}</div>}
      </div>
      <div style={{ marginTop: "18px" }}>
        <Link to="/" style={{ color: "#1f4d2f", fontWeight: 700 }}>
          Go to login
        </Link>
      </div>
    </main>
  );
}

