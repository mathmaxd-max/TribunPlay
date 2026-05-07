import { Link } from "react-router-dom";
import { useState } from "react";
import { BoardSfxControls } from "../audio/BoardSfxControls";
import { useBoardSfx } from "../audio/boardSfx";
import { getAccountSettings, updateAccountSettings } from "../settings/accountSettings";

export default function Settings() {
  const [accountSettings, setAccountSettings] = useState(() => getAccountSettings());
  const { muted, volume, setVolume, toggleMuted } = useBoardSfx();

  const handleSingleClickReselectToggle = () => {
    const next = updateAccountSettings({
      singleClickCancelReselect: !accountSettings.singleClickCancelReselect,
    });
    setAccountSettings(next);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)",
        color: "#1d1a14",
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          flexWrap: "wrap",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#ccb896",
              fontWeight: 700,
            }}
          >
            Tribun Play
          </div>
          <div style={{ fontSize: "20px", fontWeight: 400 }}>Settings</div>
        </div>
        <Link
          to="/hub"
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background: "#f2d9b2",
            color: "#2a2218",
            fontWeight: 700,
            textDecoration: "none",
            letterSpacing: "1px",
            textTransform: "uppercase",
            fontSize: "12px",
          }}
        >
          Back to Hub
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "940px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "16px" }}>
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
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Gameplay
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "#2a2218",
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            <input
              type="checkbox"
              checked={accountSettings.singleClickCancelReselect}
              onChange={handleSingleClickReselectToggle}
            />
            Enable single-click cancel + reselect during move input
          </label>
        </section>

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
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Board Sound
          </div>
          <div style={{ color: "#5a4630", fontSize: "14px" }}>Volume range is 0% to 200%. Default is 100%.</div>
          <BoardSfxControls
            muted={muted}
            volume={volume}
            onToggleMuted={toggleMuted}
            onVolumeChange={setVolume}
          />
        </section>
      </main>
    </div>
  );
}
