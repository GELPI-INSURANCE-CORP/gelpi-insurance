"use client";
import { ReactNode } from "react";
import { X } from "lucide-react";

export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h3 className="truncate text-[15px] font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-background"
          aria-label="Cerrar"
        >
          <X size={16} />
        </button>
      </div>
      {subtitle && (
        <div className="flex-shrink-0 border-b border-border px-5 py-2 text-[13px] text-muted">
          {subtitle}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex-shrink-0 border-t border-border px-5 py-3">{footer}</div>}
    </div>
  );
}
