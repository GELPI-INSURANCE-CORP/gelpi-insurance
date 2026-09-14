import { ReactNode } from "react";
import clsx from "clsx";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "brand" | "silver";

const toneClasses: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  brand: "bg-brand-tint text-brand-dark",
  silver: "bg-silver text-neutral-fg",
};

export function Badge({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]",
        toneClasses[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
