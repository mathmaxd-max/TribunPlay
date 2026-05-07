import type { CSSProperties, ReactNode } from "react";
import brandIcon from "../assets/game/brand/Icon.webp";

const kickerStyle: CSSProperties = {
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "#ccb896",
  fontWeight: 700,
};

const titleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 400,
};

type PageHeaderBrandProps = {
  kicker?: ReactNode;
  title: ReactNode;
  textColumnStyle?: CSSProperties;
};

export function PageHeaderBrand({
  kicker = "Tribun Play",
  title,
  textColumnStyle,
}: PageHeaderBrandProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <img
        src={brandIcon}
        alt=""
        width={40}
        height={40}
        draggable={false}
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          objectFit: "contain",
        }}
      />
      <div style={textColumnStyle}>
        <div style={kickerStyle}>{kicker}</div>
        <div style={titleStyle}>{title}</div>
      </div>
    </div>
  );
}
