import { ReactNode } from "react";
import clsx from "clsx";
import type { Tone } from "./Badge";

const subToneClasses: Record<"ok" | "warn" | "bad" | "muted" | "brand", string> = {
  ok: "text-ok-fg",
  warn: "text-warn-fg",
  bad: "text-bad-fg",
  muted: "text-muted",
  brand: "text-brand",
};

export function Kpi({
  label,
  value,
  sub,
  subTone = "muted",
  highlighted = false,
  onClick,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "ok" | "warn" | "bad" | "muted" | "brand";
  highlighted?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={clsx(
        "flex flex-col gap-1 rounded-xl border p-5 text-left",
        highlighted ? "border-bad-fg bg-bad-bg" : "border-border bg-surface",
        onClick && "cursor-pointer transition hover:shadow-sm"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={clsx("text-[13px]", highlighted ? "text-bad-fg" : "text-muted")}>
          {label}
        </span>
        {icon}
      </div>
      <div
        className={clsx(
          "text-[26px] font-semibold tracking-tight",
          highlighted ? "text-bad-fg text-[28px]" : "text-foreground"
        )}
      >
        {value}
      </div>
      {sub && (
        <div className={clsx("mt-2 text-xs font-medium", subToneClasses[subTone])}>{sub}</div>
      )}
    </Comp>
  );
}
