import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  getImperoBoardConfig,
  getTutorialChapterById,
  getTutorialChapterNeighbors,
  type TutorialChapterId,
} from "../tutorial/chapters";
import TutorialBoard from "../tutorial/TutorialBoard";
import TutorialUnitTable from "../tutorial/TutorialUnitTable";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

const chapterCardStyle = {
  borderRadius: "16px",
  border: "2px solid #3c3226",
  background: "rgba(255, 250, 242, 0.88)",
  boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
  padding: "16px",
  display: "grid",
  gap: "10px",
} as const;

export default function TutorialChapter() {
  const params = useParams<{ chapterId: string }>();
  const chapter = useMemo(() => getTutorialChapterById(params.chapterId), [params.chapterId]);
  const [imperoBoard, setImperoBoard] = useState<"A" | "B">("A");

  if (!chapter) {
    return <Navigate to="/tutorial" replace />;
  }

  const neighbors = getTutorialChapterNeighbors(chapter.id as TutorialChapterId);
  const imperoBoardConfig = chapter.id === "impero" ? getImperoBoardConfig(imperoBoard) : null;
  const boardPreset = imperoBoardConfig?.boardPreset ?? chapter.boardPreset;
  const boardOpcodes = imperoBoardConfig?.allowedOpcodes ?? chapter.allowedOpcodes;
  const interactionMode = imperoBoardConfig?.interactionMode ?? chapter.interactionMode;

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
        <PageHeaderBrand kicker="Tutorial" title={chapter.title} />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Link
            to="/tutorial"
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
            Index
          </Link>
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
        </div>
      </header>

      <main style={{ width: "100%", maxWidth: "1100px", margin: "0 auto", padding: "18px 14px 24px", display: "grid", gap: "12px" }}>
        <section style={chapterCardStyle}>
          {chapter.content.map((line) => (
            <p key={line} style={{ margin: 0, lineHeight: 1.5, color: "#3f3122" }}>
              {line}
            </p>
          ))}
        </section>

        {chapter.kind === "content" ? null : chapter.kind === "unit-demo" ? (
          <TutorialUnitTable />
        ) : (
          <>
            {chapter.id === "impero" ? (
              <section style={chapterCardStyle}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setImperoBoard("A")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "999px",
                      border: "2px solid #6f5a38",
                      background: imperoBoard === "A" ? "#d8b178" : "#f7ecdb",
                      color: "#2a2218",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Board A
                  </button>
                  <button
                    type="button"
                    onClick={() => setImperoBoard("B")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "999px",
                      border: "2px solid #6f5a38",
                      background: imperoBoard === "B" ? "#d8b178" : "#f7ecdb",
                      color: "#2a2218",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Board B
                  </button>
                </div>
                <div style={{ fontWeight: 700, color: "#2c2318" }}>{imperoBoardConfig?.title}</div>
                {imperoBoardConfig?.copy.map((line) => (
                  <p key={line} style={{ margin: 0, lineHeight: 1.5, color: "#3f3122" }}>
                    {line}
                  </p>
                ))}
              </section>
            ) : null}

            {boardPreset && boardOpcodes ? (
              <TutorialBoard
                chapter={chapter}
                boardPreset={boardPreset}
                allowedOpcodes={boardOpcodes}
                interactionMode={interactionMode ?? "traditional"}
                resetKey={chapter.id === "impero" ? `impero-${imperoBoard}` : chapter.id}
              />
            ) : null}
          </>
        )}

        <nav style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
          {neighbors.previous ? (
            <Link
              to={`/tutorial/${neighbors.previous.id}`}
              style={{
                padding: "10px 14px",
                borderRadius: "999px",
                border: "2px solid #6f5a38",
                background: "#f2d9b2",
                color: "#2a2218",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Previous: {neighbors.previous.title}
            </Link>
          ) : (
            <span />
          )}
          {neighbors.next ? (
            <Link
              to={`/tutorial/${neighbors.next.id}`}
              style={{
                padding: "10px 14px",
                borderRadius: "999px",
                border: "2px solid #6f5a38",
                background: "#f2d9b2",
                color: "#2a2218",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Next: {neighbors.next.title}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </div>
  );
}
