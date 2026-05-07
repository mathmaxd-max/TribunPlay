const LIBRARY_ICON_URL = new URL("../assets/game/setup/Library.webp", import.meta.url).href;
const LIBRARY_OUTLINE_ICON_URL = new URL("../assets/game/setup/_Library.webp", import.meta.url).href;
const FLIP_ICON_URL = new URL("../assets/game/setup/Flip.webp", import.meta.url).href;
const FLIP_OUTLINE_ICON_URL = new URL("../assets/game/setup/_Flip.webp", import.meta.url).href;

type SetupHashInputProps = {
  value: string;
  onChange: (next: string) => void;
  onOpenLibrary: () => void;
  onFlipHash: () => void;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
};

const ICON_SIZE = 24;

const buttonStyle = {
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  border: "2px solid #6f5a38",
  background: "#fff6e8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
} as const;

function IconWithOutline(props: { fillUrl: string; outlineUrl: string; size: number }) {
  const { fillUrl, outlineUrl, size } = props;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-block",
        width: `${size}px`,
        height: `${size}px`,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#ffffff",
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
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#000000",
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

export default function SetupHashInput(props: SetupHashInputProps) {
  const { value, onChange, onOpenLibrary, onFlipHash, placeholder, invalid = false, disabled = false } = props;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: "8px", alignItems: "center" }}>
      <button
        type="button"
        onClick={onOpenLibrary}
        disabled={disabled}
        title="Open setup library"
        style={{ ...buttonStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <IconWithOutline fillUrl={LIBRARY_ICON_URL} outlineUrl={LIBRARY_OUTLINE_ICON_URL} size={ICON_SIZE} />
      </button>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={19}
        disabled={disabled}
        style={{
          border: invalid ? "2px solid #9f3030" : "1px solid #bda98b",
          borderRadius: "10px",
          padding: "10px 12px",
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: "1px",
          fontWeight: 700,
          background: "#fff9ef",
          width: "100%",
          boxSizing: "border-box",
          minWidth: 0,
        }}
      />
      <button
        type="button"
        onClick={onFlipHash}
        disabled={disabled}
        title="Replace hash with flipped equivalent"
        style={{ ...buttonStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <IconWithOutline fillUrl={FLIP_ICON_URL} outlineUrl={FLIP_OUTLINE_ICON_URL} size={ICON_SIZE} />
      </button>
    </div>
  );
}
