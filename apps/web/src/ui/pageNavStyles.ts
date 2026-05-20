import type { CSSProperties } from "react";

export const navPillBase: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "999px",
  border: "2px solid #6f5a38",
  background: "#f2d9b2",
  color: "#2a2218",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.8px",
  fontSize: "12px",
};

export const navPillLinkStyle: CSSProperties = {
  ...navPillBase,
  textDecoration: "none",
};

export const navPillButtonStyle: CSSProperties = {
  ...navPillBase,
  cursor: "pointer",
};

export const navPillDisabledStyle: CSSProperties = {
  ...navPillBase,
  opacity: 0.55,
  cursor: "not-allowed",
  background: "#e6dccf",
};
