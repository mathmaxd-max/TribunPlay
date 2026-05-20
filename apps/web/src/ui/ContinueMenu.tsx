import { useEffect, useRef, useState } from "react";

export type ContinueMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

type ContinueMenuProps = {
  items: ContinueMenuItem[];
};

export function ContinueMenu(props: ContinueMenuProps) {
  const { items } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          padding: "8px 14px",
          borderRadius: "999px",
          border: "2px solid #6f5a38",
          background: "#f2d9b2",
          color: "#2a2218",
          fontWeight: 700,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
          cursor: "pointer",
          fontSize: "12px",
        }}
      >
        Continue
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: "220px",
            zIndex: 90,
            borderRadius: "12px",
            border: "2px solid #3c3226",
            background: "#fffaf0",
            boxShadow: "0 12px 24px rgba(12, 9, 6, 0.28)",
            padding: "8px",
            display: "grid",
            gap: "6px",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.disabled ? item.disabledReason ?? "Unavailable" : item.label}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: "9px",
                border: "1px solid #bda98b",
                background: "#fff6e8",
                color: "#2a2218",
                fontWeight: 700,
                fontSize: "12px",
                letterSpacing: "0.4px",
                cursor: item.disabled ? "not-allowed" : "pointer",
                opacity: item.disabled ? 0.55 : 1,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
