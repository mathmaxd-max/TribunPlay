import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as engine from "@tribunplay/engine";
import { getBaseColor, getHexagonColor, type HexagonState } from "../hexagonColors";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";
import { SplitUnitGlyph, UnitGlyph } from "../ui/UnitGlyph";
import { areAllUnitIconsReady, preloadAllUnitIcons } from "../ui/unitIcons";
import { useBoardSfx } from "../audio/boardSfx";
import { applyLeftBrush, applyRightErase, type BrushToolState } from "../boardCanvas/brushActions";
import { createEmptyCanvasBoard, getValidBoardCids, toEngineState, type SideToMove } from "../boardCanvas/boardState";

type PaintButton = 0 | 2;

const HEIGHT_OPTIONS: ReadonlyArray<BrushToolState["height"]> = [1, 2, 3, 4, 6, 8, "eraser"];
const OPCODE_LABELS: Record<number, string> = {
  0: "MOVE",
  1: "KILL",
  2: "LIBERATE",
  3: "DAMAGE",
  4: "ENSLAVE",
  5: "COMBINE",
  6: "SYM_COMBINE",
  7: "SPLIT",
  8: "BACKSTABB",
  9: "ATTACK_TRIBUN",
  10: "DRAW",
  11: "END",
};
const NON_MOVE_OPCODES = new Set<number>([10, 11]); // DRAW, END
const OPCODE_GROUPS: ReadonlyArray<{ title: string; opcodes: ReadonlyArray<number> }> = [
  { title: "Rearrange", opcodes: [0, 7, 5, 6] }, // MOVE, SPLIT, COMBINE, SYM_COMBINE
  { title: "Attack", opcodes: [1, 3, 4, 2, 8, 9] }, // KILL, DAMAGE, ENSLAVE, LIBERATE, BACKSTABB, ATTACK_TRIBUN
];

export default function BoardCanvas() {
  const [board, setBoard] = useState<Uint8Array>(() => createEmptyCanvasBoard());
  const [sideToMove, setSideToMove] = useState<SideToMove>("black");
  const [tool, setTool] = useState<BrushToolState>({
    activeColor: 0,
    height: 1,
    tribun: false,
    enslave: false,
    overwrite: false,
  });
  const [unitIconsReady, setUnitIconsReady] = useState(() => areAllUnitIconsReady());
  const [userFlip180, setUserFlip180] = useState(false);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);

  const boardRef = useRef(board);
  const paintRef = useRef<{ active: boolean; button: PaintButton; lastCid: number | null }>({
    active: false,
    button: 0,
    lastCid: null,
  });
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const { playSfx } = useBoardSfx();

  useEffect(() => {
    let active = true;
    if (areAllUnitIconsReady()) {
      setUnitIconsReady(true);
      return () => {
        active = false;
      };
    }
    void preloadAllUnitIcons().then(() => {
      if (active) {
        setUnitIconsReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    const stop = () => {
      paintRef.current.active = false;
      paintRef.current.lastCid = null;
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  useEffect(() => {
    if (!boardViewportRef.current) return;
    const element = boardViewportRef.current;
    const updateSize = () => setBoardViewportWidth(element.clientWidth);
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const validCids = useMemo(() => getValidBoardCids(), []);
  const rotate180 = userFlip180;
  const brushableSet = useMemo(() => {
    const next = new Set<number>();
    for (const cid of validCids) {
      if (applyLeftBrush(board, cid, tool) !== null) next.add(cid);
    }
    return next;
  }, [board, tool, validCids]);
  const erasableSet = useMemo(() => {
    const next = new Set<number>();
    for (const cid of validCids) {
      if (engine.unitByteToUnit(board[cid])) next.add(cid);
    }
    return next;
  }, [board, validCids]);

  const boardMetrics = useMemo(() => {
    const innerHexSize = 26;
    const borderWidth = 2;
    const spacingMultiplier = 0.98;
    const outerHexSize = innerHexSize + borderWidth;
    const centerSize = outerHexSize * spacingMultiplier;
    const d = (Math.sqrt(3) / 2) * centerSize;
    const outerHexWidth = 2 * outerHexSize;
    const outerHexHeight = Math.sqrt(3) * outerHexSize;

    const tiles = validCids.map((cid) => {
      const { x, y } = engine.decodeCoord(cid);
      const displayX = rotate180 ? -x : x;
      const displayY = rotate180 ? -y : y;
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      return { cid, x, y, centerX, centerY };
    });

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const tile of tiles) {
      minX = Math.min(minX, tile.centerX - outerHexWidth / 2);
      maxX = Math.max(maxX, tile.centerX + outerHexWidth / 2);
      minY = Math.min(minY, tile.centerY - outerHexHeight / 2);
      maxY = Math.max(maxY, tile.centerY + outerHexHeight / 2);
    }

    return {
      tiles,
      minX,
      minY,
      width: maxX - minX + 2,
      height: maxY - minY + 2,
      outerHexWidth,
      outerHexHeight,
    };
  }, [rotate180, validCids]);

  const boardScale = useMemo(() => {
    const w = boardMetrics.width;
    if (w <= 0) return 1;
    const available = boardViewportWidth || w;
    return Math.min(1, available / w);
  }, [boardMetrics.width, boardViewportWidth]);

  const statsInfo = useMemo(() => {
    const sideLabel = sideToMove === "black" ? "Black" : "White";
    const converted = toEngineState({ board, sideToMove });
    if (!converted.ok) {
      return {
        sideLabel,
        legalLabel: "-",
        statusLabel: `Invalid position: ${converted.issues[0]}`,
        opcodeGroups: OPCODE_GROUPS.map((group) => ({
          title: group.title,
          entries: group.opcodes.map((opcode) => ({
            label: OPCODE_LABELS[opcode] ?? `OP${opcode}`,
            count: 0,
          })),
        })),
      };
    }
    try {
      const actions = engine.generateLegalActions(converted.state);
      const byOpcode = new Map<number, number>();
      let moveCount = 0;
      for (const action of actions) {
        const decoded = engine.decodeAction(action);
        if (!NON_MOVE_OPCODES.has(decoded.opcode)) {
          moveCount += 1;
        }
        if (NON_MOVE_OPCODES.has(decoded.opcode)) continue;
        byOpcode.set(decoded.opcode, (byOpcode.get(decoded.opcode) ?? 0) + 1);
      }
      const opcodeGroups = OPCODE_GROUPS.map((group) => ({
        title: group.title,
        entries: group.opcodes.map((opcode) => ({
          label: OPCODE_LABELS[opcode] ?? `OP${opcode}`,
          count: byOpcode.get(opcode) ?? 0,
        })),
      }));
      return {
        sideLabel,
        legalLabel: String(moveCount),
        statusLabel: "Valid position",
        opcodeGroups,
      };
    } catch (error) {
      return {
        sideLabel,
        legalLabel: "-",
        statusLabel: `Invalid position: ${error instanceof Error ? error.message : "invalid position"}`,
        opcodeGroups: OPCODE_GROUPS.map((group) => ({
          title: group.title,
          entries: group.opcodes.map((opcode) => ({
            label: OPCODE_LABELS[opcode] ?? `OP${opcode}`,
            count: 0,
          })),
        })),
      };
    }
  }, [board, sideToMove]);

  const applyPaint = (cid: number, button: PaintButton) => {
    const result = button === 2 ? applyRightErase(boardRef.current, cid, { enslave: tool.enslave }) : applyLeftBrush(boardRef.current, cid, tool);
    if (!result) {
      return;
    }
    boardRef.current = result.board;
    setBoard(result.board);
    playSfx("tileClick");
  };

  const startPaint = (cid: number, button: PaintButton) => {
    paintRef.current.active = true;
    paintRef.current.button = button;
    paintRef.current.lastCid = cid;
    applyPaint(cid, button);
  };

  const continuePaint = (cid: number) => {
    if (!paintRef.current.active) return;
    if (paintRef.current.lastCid === cid) return;
    paintRef.current.lastCid = cid;
    applyPaint(cid, paintRef.current.button);
  };

  const segmentedWrapStyle = {
    display: "inline-flex",
    borderRadius: "999px",
    border: "2px solid #6f5a38",
    overflow: "hidden",
    background: "#fff6e8",
    width: "fit-content",
  } as const;

  const segmentedButtonStyle = (active: boolean) =>
    ({
      padding: "8px 12px",
      border: "none",
      background: active ? "#f2d9b2" : "transparent",
      fontWeight: 700,
      color: "#2a2218",
      cursor: "pointer",
      textTransform: "uppercase",
      letterSpacing: "0.6px",
      fontSize: "12px",
    }) as const;

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
          gap: "10px",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
          flexWrap: "wrap",
        }}
      >
        <PageHeaderBrand title="Board Canvas" />
        <Link
          to="/hub"
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            border: "2px solid #7f6a4a",
            background: "#f2d9b2",
            color: "#2a2218",
            textDecoration: "none",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            fontSize: "12px",
          }}
        >
          Back to Hub
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "1160px", margin: "0 auto", padding: "12px", display: "grid", gap: "12px", flex: 1, minHeight: 0 }}>
        <section
          style={{
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.86)",
            boxShadow: "0 16px 28px rgba(39, 30, 20, 0.14)",
            padding: "12px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", color: "#7a6543", textTransform: "uppercase" }}>Color</div>
            <div style={segmentedWrapStyle}>
              <button type="button" onClick={() => setTool((prev) => ({ ...prev, activeColor: 0 }))} style={segmentedButtonStyle(tool.activeColor === 0)}>
                Black
              </button>
              <button type="button" onClick={() => setTool((prev) => ({ ...prev, activeColor: 1 }))} style={segmentedButtonStyle(tool.activeColor === 1)}>
                White
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", color: "#7a6543", textTransform: "uppercase" }}>Height</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {HEIGHT_OPTIONS.map((height) => {
                const active = tool.height === height;
                return (
                  <button
                    key={`height-${String(height)}`}
                    type="button"
                    onClick={() => setTool((prev) => ({ ...prev, height }))}
                    style={{
                      borderRadius: "999px",
                      border: "2px solid #6f5a38",
                      background: active ? "#f2d9b2" : "#fff6e8",
                      color: "#2a2218",
                      fontWeight: 700,
                      letterSpacing: "0.4px",
                      cursor: "pointer",
                      padding: "8px 12px",
                      minWidth: "46px",
                    }}
                  >
                    {height === "eraser" ? "Eraser" : height}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {(
              [
                ["tribun", "Tribun"],
                ["enslave", "Enslave"],
                ["overwrite", "Overwrite"],
              ] as const
            ).map(([key, label]) => {
              const active = tool[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTool((prev) => ({ ...prev, [key]: !prev[key] }))}
                  style={{
                    borderRadius: "999px",
                    border: "2px solid #6f5a38",
                    background: active ? "#f2d9b2" : "#fff6e8",
                    color: "#2a2218",
                    fontWeight: 700,
                    letterSpacing: "0.6px",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    padding: "8px 12px",
                  }}
                >
                  {label}: {active ? "On" : "Off"}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", color: "#7a6543", textTransform: "uppercase" }}>Side to move</div>
            <div style={segmentedWrapStyle}>
              <button type="button" onClick={() => setSideToMove("black")} style={segmentedButtonStyle(sideToMove === "black")}>
                Black
              </button>
              <button type="button" onClick={() => setSideToMove("white")} style={segmentedButtonStyle(sideToMove === "white")}>
                White
              </button>
            </div>
          </div>
        </section>

        <section
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.7)",
            boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
            padding: "10px",
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setUserFlip180((prev) => !prev)}
            title="Flip board"
            aria-label="Flip board"
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              border: `2px solid ${rotate180 ? "#111" : "#1c1a16"}`,
              background: rotate180 ? "#111" : "#f6f0e6",
              color: rotate180 ? "#f6f0e6" : "#1c1a16",
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 12px rgba(20, 15, 10, 0.18)",
              zIndex: 2,
            }}
          />

          <div
            ref={boardViewportRef}
            style={{
              position: "relative",
              width: "100%",
              height: `${Math.ceil(boardMetrics.height * boardScale)}px`,
              minHeight: 0,
              overflow: "hidden",
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: `${boardMetrics.width}px`,
                height: `${boardMetrics.height}px`,
                transform: `translate(-50%, -50%) scale(${boardScale})`,
                transformOrigin: "center",
              }}
            >
              {boardMetrics.tiles.map(({ cid, x, y, centerX, centerY }) => {
                const hexX = centerX - boardMetrics.outerHexWidth / 2 - boardMetrics.minX;
                const hexY = centerY - boardMetrics.outerHexHeight / 2 - boardMetrics.minY;
                const unit = engine.unitByteToUnit(board[cid]);
                const isBrushable = brushableSet.has(cid);
                const isErasable = erasableSet.has(cid);
                const state: HexagonState = isBrushable || isErasable ? "selectable" : "default";
                const baseColor = getBaseColor(x, y);
                const tileColor = getHexagonColor(baseColor, state);
                const hexClipPath = "polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)";
                const textColor = unit?.tribun ? (unit.color === 0 ? "#AE0000" : "#00B4FF") : unit?.color === 0 ? "#000" : "#fff";
                const strokeColor = unit?.tribun ? (unit.color === 0 ? "#000" : "#fff") : unit?.color === 0 ? "#fff" : "#000";

                return (
                  <div key={`tile-${cid}`}>
                    <div
                      style={{
                        position: "absolute",
                        left: `${hexX}px`,
                        top: `${hexY}px`,
                        width: `${boardMetrics.outerHexWidth}px`,
                        height: `${boardMetrics.outerHexHeight}px`,
                        clipPath: hexClipPath,
                        background: "#2d2922",
                        pointerEvents: "none",
                        zIndex: 4,
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: "2px",
                          clipPath: hexClipPath,
                          background: tileColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          userSelect: "none",
                        }}
                      >
                        {unit
                          ? unit.s > 0
                            ? (
                              <SplitUnitGlyph
                                mode={unitIconsReady ? "icon" : "number"}
                                primary={{ height: unit.s, tribun: false }}
                                secondary={{ height: unit.p, tribun: unit.tribun }}
                                sizePx={unit.tribun ? 42 : 37}
                                offsetPx={{ x: 6, y: 8 }}
                                numberColors={{
                                  primary: { fill: unit.color === 0 ? "#fff" : "#000", stroke: unit.color === 0 ? "#000" : "#fff" },
                                  secondary: { fill: textColor ?? "#fff", stroke: strokeColor ?? "#000" },
                                }}
                              />
                            )
                            : (
                              <UnitGlyph
                                mode={unitIconsReady ? "icon" : "number"}
                                unit={{ height: unit.p, tribun: unit.tribun }}
                                sizePx={36}
                                numberColor={{ fill: textColor ?? "#fff", stroke: strokeColor ?? "#000" }}
                              />
                            )
                          : null}
                      </div>
                    </div>

                    <div
                      style={{
                        position: "absolute",
                        left: `${hexX}px`,
                        top: `${hexY}px`,
                        width: `${boardMetrics.outerHexWidth}px`,
                        height: `${boardMetrics.outerHexHeight}px`,
                        clipPath: hexClipPath,
                        background: "transparent",
                        cursor: isBrushable || isErasable ? "pointer" : "default",
                        zIndex: 7,
                      }}
                      onMouseDown={(event) => {
                        if (event.button !== 0 && event.button !== 2) return;
                        event.preventDefault();
                        startPaint(cid, event.button as PaintButton);
                      }}
                      onMouseEnter={() => continuePaint(cid)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "8px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Stats</div>
          <div style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#5a4630" }}>
            <div>Side to move: <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{statsInfo.sideLabel}</span></div>
            <div>Legal moves: <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{statsInfo.legalLabel}</span></div>
            <div style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }} title={statsInfo.statusLabel}>Status: {statsInfo.statusLabel}</div>
            <div style={{ display: "grid", gap: "2px" }}>
              <div style={{ fontWeight: 700 }}>Move generation</div>
              {statsInfo.opcodeGroups.map((group) => (
                <div key={group.title} style={{ display: "grid", gap: "2px", marginTop: "2px" }}>
                  <div style={{ fontWeight: 700 }}>{group.title}</div>
                  {group.entries.map((entry) => (
                    <div key={`${group.title}-${entry.label}`}>
                      {entry.label}:{" "}
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>{entry.count}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
