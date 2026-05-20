type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal(props: ConfirmModalProps) {
  const {
    open,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    busy = false,
    danger = false,
    onConfirm,
    onCancel,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(14, 10, 6, 0.58)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "14px",
        zIndex: 65,
      }}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        style={{
          width: "min(420px, 92vw)",
          borderRadius: "16px",
          border: "2px solid #3c3226",
          background: "#fffaf0",
          padding: "24px",
          display: "grid",
          gap: "10px",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#2a2218" }}>{title}</div>
        <p style={{ margin: 0, color: "#5a4630", lineHeight: 1.5, fontSize: "14px" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              border: "1px solid #6f5a38",
              borderRadius: "8px",
              background: "#fff6e8",
              padding: "6px 10px",
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              border: danger ? "2px solid #8b3b3b" : "2px solid #6f5a38",
              borderRadius: "8px",
              background: danger ? "#f7d7d5" : "#f2d9b2",
              color: danger ? "#5c1c16" : "#2a2218",
              padding: "6px 10px",
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
