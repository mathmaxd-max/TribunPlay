import { useState } from "react";

type Props = {
  initialName?: string;
  onContinue: (name: string) => void;
};

const fieldLabelStyle = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "1.1px",
  textTransform: "uppercase" as const,
  color: "#6f5a38",
  marginBottom: "6px",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #ccb89b",
  borderRadius: "10px",
  background: "#fff9ef",
  color: "#1f1a13",
  padding: "10px 12px",
  fontSize: "14px",
  outline: "none",
};

export default function GuestPanel({ initialName = "", onContinue }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const submitGuest = () => {
    const normalizedName = name.trim().replace(/\s+/g, " ");
    if (!normalizedName) {
      setError("Please enter a name to continue as guest.");
      return;
    }
    setError(null);
    onContinue(normalizedName);
  };

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
      aria-label="Continue as guest"
    >
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
        Guest
      </div>
      <div style={{ fontSize: "30px", fontWeight: 700, color: "#2c2318" }}>Continue as guest</div>

      <div style={{ display: "grid", gap: "8px" }}>
        <label htmlFor="guest-name" style={fieldLabelStyle}>
          Name
        </label>
        <input
          id="guest-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Enter your player name"
          style={inputStyle}
          autoComplete="nickname"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitGuest();
            }
          }}
        />
        <div style={{ fontSize: "12px", color: "#6f5a38", lineHeight: 1.45 }}>
          Use guest mode for instant access. You can still log in later.
        </div>
      </div>

      <button
        onClick={submitGuest}
        disabled={!name.trim()}
        style={{
          padding: "10px 18px",
          borderRadius: "999px",
          border: "2px solid #6f5a38",
          background: !name.trim() ? "#d8c8ab" : "#f2d9b2",
          color: "#2a2218",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          cursor: !name.trim() ? "not-allowed" : "pointer",
        }}
      >
        Continue as Guest
      </button>

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
