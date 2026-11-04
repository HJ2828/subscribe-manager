import type { ElementType, HTMLAttributes, ReactNode } from "react";

import ailenMascot from "../assets/brand/ailen_remove_bg.png";
import moonMascot from "../assets/brand/moon_remove_bg.png";

export function GlassCard({
  as: Component = "section",
  className = "",
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return <Component className={`glass-card ${className}`.trim()} {...rest}>{children}</Component>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  mascot,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  mascot?: "moon" | "ailen";
  className?: string;
}) {
  const mascotSrc = mascot === "ailen" ? ailenMascot : moonMascot;
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header-copy">
        {eyebrow ? <span className="page-eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-header-actions">
        {mascot ? <img className="page-header-mascot" src={mascotSrc} alt="" aria-hidden="true" /> : null}
        {actions}
      </div>
    </header>
  );
}
