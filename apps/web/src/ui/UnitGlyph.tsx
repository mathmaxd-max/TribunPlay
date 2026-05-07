import { areUnitIconLayersReady, resolveUnitIconUrl } from "./unitIcons";

export type UnitGlyphMode = "icon" | "number";

export type UnitGlyphUnit = {
  height: number;
  tribun: boolean;
};

type ColorStyle = {
  fill: string;
  stroke: string;
};

type SplitColorStyle = {
  primary: ColorStyle;
  secondary: ColorStyle;
};

function TintedIconGlyph(props: { unit: UnitGlyphUnit; sizePx: number; alt: string; fillColor: string; outlineColor: string }) {
  const { unit, sizePx, alt, fillColor, outlineColor } = props;
  const outlineUrl = resolveUnitIconUrl({ height: unit.height, tribun: unit.tribun, outline: true });
  const fillUrl = resolveUnitIconUrl({ height: unit.height, tribun: unit.tribun, outline: false });

  // Unsupported height (e.g. 5/7): caller must fall back to numbers.
  if (!outlineUrl || !fillUrl) return null;

  // We tint the icon by using the filled glyph as a mask layer; this preserves the outline asset.
  // If masks aren't supported, the browser will still show the outline (and the user still has numbers as fallback modes).
  return (
    <span
      aria-label={alt}
      style={{
        position: "relative",
        display: "inline-block",
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        isolation: "isolate",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          backgroundColor: outlineColor,
          WebkitMaskImage: `url(${outlineUrl})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${outlineUrl})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          backgroundColor: fillColor,
          WebkitMaskImage: `url(${fillUrl})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${fillUrl})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
      />
    </span>
  );
}

function NumberGlyph(props: {
  height: number;
  sizePx: number;
  color: ColorStyle;
  fontFamily?: string;
}) {
  const { height, sizePx, color, fontFamily } = props;
  const fontSize = Math.max(10, Math.floor(sizePx * 0.9));

  return (
    <span
      style={{
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily ?? '"Segoe UI", "Arial", sans-serif',
        fontWeight: 800,
        color: color.fill,
        WebkitTextStroke: `1px ${color.stroke}`,
        lineHeight: 1,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      {height}
    </span>
  );
}

function canRenderAsIcon(unit: UnitGlyphUnit): boolean {
  return areUnitIconLayersReady({ height: unit.height, tribun: unit.tribun });
}

export function UnitGlyph(props: {
  mode: UnitGlyphMode;
  unit: UnitGlyphUnit;
  sizePx: number;
  numberColor?: ColorStyle;
}) {
  const { mode, unit, sizePx, numberColor } = props;
  if (unit.height <= 0) return null;

  if (mode === "icon" && canRenderAsIcon(unit)) {
    const fillColor = numberColor?.fill ?? "#fff";
    const outlineColor = numberColor?.stroke ?? "#000";
    return (
      <TintedIconGlyph
        unit={unit}
        sizePx={sizePx}
        alt={unit.tribun ? `Tribun ${unit.height}` : `Unit ${unit.height}`}
        fillColor={fillColor}
        outlineColor={outlineColor}
      />
    );
  }

  return <NumberGlyph height={unit.height} sizePx={sizePx} color={numberColor ?? { fill: "#fff", stroke: "#000" }} />;
}

export function SplitUnitGlyph(props: {
  mode: UnitGlyphMode;
  primary: UnitGlyphUnit;
  secondary: UnitGlyphUnit;
  sizePx: number;
  offsetPx: { x: number; y: number };
  numberColors?: SplitColorStyle;
}) {
  const { mode, primary, secondary, sizePx, offsetPx, numberColors } = props;

  const splitSize = Math.max(10, Math.floor(sizePx * 0.8));
  const centerTransform = "translate(-50%, -50%)";

  return (
    <span style={{ position: "relative", display: "inline-block", width: `${sizePx}px`, height: `${sizePx}px`, pointerEvents: "none" }}>
      {primary.height > 0 && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `${centerTransform} translate(${-offsetPx.x}px, ${offsetPx.y}px)`,
          }}
        >
          <UnitGlyph
            mode={mode}
            unit={primary}
            sizePx={splitSize}
            numberColor={numberColors?.primary}
          />
        </span>
      )}
      {secondary.height > 0 && (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: `${centerTransform} translate(${offsetPx.x}px, ${-offsetPx.y}px)`,
          }}
        >
          <UnitGlyph
            mode={mode}
            unit={secondary}
            sizePx={splitSize}
            numberColor={numberColors?.secondary}
          />
        </span>
      )}
    </span>
  );
}
