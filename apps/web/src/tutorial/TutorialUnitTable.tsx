import { useMemo, useState } from "react";
import { UnitGlyph } from "../ui/UnitGlyph";

const HEIGHTS = [1, 2, 3, 4, 6, 8] as const;

type DemoColor = "black" | "white";

function unitColors(color: DemoColor, tribun: boolean): { fill: string; stroke: string } {
  if (tribun) {
    return color === "black" ? { fill: "#AE0000", stroke: "#000000" } : { fill: "#00B4FF", stroke: "#FFFFFF" };
  }
  return color === "black" ? { fill: "#000000", stroke: "#FFFFFF" } : { fill: "#FFFFFF", stroke: "#000000" };
}

export default function TutorialUnitTable() {
  const [color, setColor] = useState<DemoColor>("black");
  const [tribun, setTribun] = useState(false);
  const textColor = useMemo(() => unitColors(color, tribun), [color, tribun]);

  return (
    <section
      style={{
        border: "2px solid #3c3226",
        borderRadius: "16px",
        background: "rgba(255, 250, 242, 0.88)",
        padding: "16px",
        display: "grid",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontWeight: 700, color: "#2c2318" }}>
          Color{" "}
          <select
            value={color}
            onChange={(event) => setColor(event.target.value as DemoColor)}
            style={{ marginLeft: "8px", padding: "6px 10px", borderRadius: "10px", border: "1px solid #9a886f" }}
          >
            <option value="black">Black</option>
            <option value="white">White</option>
          </select>
        </label>
        <label style={{ fontWeight: 700, color: "#2c2318", display: "flex", alignItems: "center", gap: "6px" }}>
          <input type="checkbox" checked={tribun} onChange={(event) => setTribun(event.target.checked)} />
          Tribun
        </label>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#5a4630" }}>
            <th style={{ padding: "8px", borderBottom: "1px solid #d3c2a8" }}>Height</th>
            <th style={{ padding: "8px", borderBottom: "1px solid #d3c2a8" }}>Number Render</th>
            <th style={{ padding: "8px", borderBottom: "1px solid #d3c2a8" }}>Icon Render</th>
          </tr>
        </thead>
        <tbody>
          {HEIGHTS.map((height) => (
            <tr key={height}>
              <td style={{ padding: "10px 8px", fontWeight: 700, color: "#2c2318" }}>{height}</td>
              <td style={{ padding: "10px 8px" }}>
                <UnitGlyph mode="number" unit={{ height, tribun }} sizePx={36} numberColor={textColor} />
              </td>
              <td style={{ padding: "10px 8px" }}>
                <UnitGlyph mode="icon" unit={{ height, tribun }} sizePx={36} numberColor={textColor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

