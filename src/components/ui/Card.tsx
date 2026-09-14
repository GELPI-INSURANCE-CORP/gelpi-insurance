import { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

export function Card({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-xl border border-border bg-surface", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-3 border-b border-border px-5 py-4",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="truncate text-[15px] font-semibold text-foreground">{title}</h2>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-3">{action}</div>}
    </div>
  );
}
