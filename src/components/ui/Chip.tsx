import { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export function Chip({
  active = false,
  children,
  icon,
  className,
  ...rest
}: {
  active?: boolean;
  children: ReactNode;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] whitespace-nowrap transition",
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface text-foreground hover:bg-background",
        className
      )}
      {...rest}
    >
      {children}
      {icon}
    </button>
  );
}
