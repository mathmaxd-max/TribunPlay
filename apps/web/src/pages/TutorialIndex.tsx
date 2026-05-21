import { Link } from "react-router-dom";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";
import { TUTORIAL_CHAPTERS } from "../tutorial/chapters";

const cardStyle = {
  borderRadius: "16px",
  border: "2px solid #3c3226",
  background: "rgba(255, 250, 242, 0.88)",
  boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
  padding: "16px",
  display: "grid",
  gap: "8px",
} as const;

export default function TutorialIndex() {
  return (
    <div
      style={{
        minHeight: "100vh",
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
          gap: "12px",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
          flexWrap: "wrap",
        }}
      >
        <PageHeaderBrand kicker="Learn" title="Tutorial" />
        <Link
          to="/hub"
          style={{
            padding: "8px 12px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background: "#f2d9b2",
            color: "#2a2218",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            textDecoration: "none",
          }}
        >
          Hub
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "960px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "12px" }}>
        <section style={{ ...cardStyle, gap: "6px" }}>
          <div style={{ fontWeight: 700, fontSize: "28px", color: "#2c2318" }}>Interactive tutorial chapters</div>
          <div style={{ color: "#5a4630" }}>Learn rules chapter by chapter with guided boards and restricted move sets. All chapters are part of the intended rule set, even the "Extra" chapters. But if you understand chapters 1 through 7, you can already play a decent game :)</div>
        </section>

        {TUTORIAL_CHAPTERS.map((chapter) => (
          <article key={chapter.id} style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: "22px", color: "#2c2318" }}>{chapter.title}</div>
            <div style={{ color: "#5a4630" }}>{chapter.summary}</div>
            <Link
              to={`/tutorial/${chapter.id}`}
              style={{
                width: "fit-content",
                padding: "10px 14px",
                borderRadius: "999px",
                border: "2px solid #6f5a38",
                background: "#f2d9b2",
                color: "#2a2218",
                fontWeight: 700,
                letterSpacing: "1px",
                textDecoration: "none",
                textTransform: "uppercase",
              }}
            >
              Open chapter
            </Link>
          </article>
        ))}
      </main>
    </div>
  );
}

