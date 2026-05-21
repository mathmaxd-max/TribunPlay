import type { CSSProperties } from "react";
import type { MovementSelector } from "../policy";
import {
  getMiniTileCenter,
  hexagonPoints,
  MINI_GRID_BOUNDS,
  MINI_GRID_TILES,
  MINI_HEX_RADIUS,
} from "./hexMiniGrid";
import { MOVEMENT_PATTERN_DIAGRAMS, type DiagramColor, type DiagramOverlay } from "./movementPatternDiagrams";

const OVERLAY_COLORS: Record<DiagramColor, string> = {
  purple: "#7b4fa8",
  red: "#c0392b",
  blue: "#2980b9",
  black: "#1a1a1a",
};

const DOT_RADIUS = 9;
const STROKE_WIDTH = 5;
const ARROW_HEAD_LEN = 19;
const ARROW_HEAD_WIDTH = 19;

type MovementPatternDiagramProps = {
  selector: MovementSelector;
  /** Optional lines from chapter.movementDiagramSubtext (e.g. extra rules for 1 and 8/8T). */
  subtext?: string[];
  panelStyle?: CSSProperties;
};

function resolveCoord(x: number, y: number): { cx: number; cy: number } | null {
  return getMiniTileCenter(x, y);
}

function arrowGeometry(
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): {
  lineEnd: { cx: number; cy: number };
  headPoints: string;
} {
  const angle = Math.atan2(to.cy - from.cy, to.cx - from.cx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfLen = ARROW_HEAD_LEN / 2;
  const halfWidth = ARROW_HEAD_WIDTH / 2;

  const tipX = to.cx + halfLen * cos;
  const tipY = to.cy + halfLen * sin;
  const baseX = to.cx - halfLen * cos;
  const baseY = to.cy - halfLen * sin;
  const leftX = baseX + halfWidth * sin;
  const leftY = baseY - halfWidth * cos;
  const rightX = baseX - halfWidth * sin;
  const rightY = baseY + halfWidth * cos;

  return {
    lineEnd: { cx: baseX, cy: baseY },
    headPoints: `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`,
  };
}

function renderOverlay(overlay: DiagramOverlay, key: string): JSX.Element | null {
  const stroke = OVERLAY_COLORS[overlay.color];
  const fill = OVERLAY_COLORS[overlay.color];

  if (overlay.kind === "dot") {
    const center = resolveCoord(overlay.x, overlay.y);
    if (!center) return null;
    return <circle key={key} cx={center.cx} cy={center.cy} r={DOT_RADIUS} fill={fill} />;
  }

  const fromCenter = resolveCoord(overlay.from[0], overlay.from[1]);
  const toCenter = resolveCoord(overlay.to[0], overlay.to[1]);
  if (!fromCenter || !toCenter) return null;

  if (overlay.kind === "line") {
    return (
      <line
        key={key}
        x1={fromCenter.cx}
        y1={fromCenter.cy}
        x2={toCenter.cx}
        y2={toCenter.cy}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
    );
  }

  const { lineEnd, headPoints } = arrowGeometry(fromCenter, toCenter);

  return (
    <g key={key}>
      <line
        x1={fromCenter.cx}
        y1={fromCenter.cy}
        x2={lineEnd.cx}
        y2={lineEnd.cy}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
      <polygon points={headPoints} fill={fill} />
    </g>
  );
}

export default function MovementPatternDiagram({ selector, subtext, panelStyle }: MovementPatternDiagramProps) {
  const overlays = MOVEMENT_PATTERN_DIAGRAMS[selector];
  const innerRadius = MINI_HEX_RADIUS - 2;
  const subtextLines = subtext?.filter((line) => line.trim().length > 0) ?? [];

  return (
    <div
      style={{
        ...panelStyle,
        padding: "16px",
        display: "grid",
        gap: "10px",
        justifyItems: "center",
      }}
    >
      <div style={{ fontWeight: 700, color: "#2c2318", textAlign: "center", width: "100%" }}>
        Movement pattern ({selector})
      </div>
      <svg
        viewBox={`0 0 ${MINI_GRID_BOUNDS.width} ${MINI_GRID_BOUNDS.height}`}
        width={MINI_GRID_BOUNDS.width}
        height={MINI_GRID_BOUNDS.height}
        style={{ display: "block", maxWidth: "100%" }}
        role="img"
        aria-label={`Movement pattern diagram for unit type ${selector}`}
      >
        {MINI_GRID_TILES.map((tile) => (
          <polygon
            key={`tile-${tile.x}-${tile.y}`}
            points={hexagonPoints(tile.cx, tile.cy, innerRadius)}
            fill={tile.fill}
            stroke="#1a1a1a"
            strokeWidth={2}
          />
        ))}
        <g>
          {overlays.map((overlay, index) => renderOverlay(overlay, `${selector}-${index}`))}
        </g>
      </svg>
      {subtextLines.length > 0 ? (
        <div style={{ width: "100%", display: "grid", gap: "6px", textAlign: "center" }}>
          {subtextLines.map((line, index) => (
            <p key={`${selector}-subtext-${index}`} style={{ margin: 0, lineHeight: 1.5, color: "#5a4630", fontSize: "14px" }}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
