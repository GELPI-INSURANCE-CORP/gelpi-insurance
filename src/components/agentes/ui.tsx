"use client";

import { ReactNode, useEffect } from "react";
import clsx from "clsx";
import { X, ChevronLeft, ChevronRight, Search } from "lucide-react";

/* =========================================================
   Primitivos compartidos (Frontend B)
   No dependen de src/components/ui/* — si en el futuro existen
   los primitivos de Frontend A se puede migrar, pero no es obligatorio.
   ========================================================= */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("bg-surface border border-border rounded-xl", className)}>{children}</div>;
}

export function CardHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground m-0">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = "muted",
  destacado = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "bad" | "brand" | "muted";
  /** Resalta la tarjeta con fondo y borde del color del tono (además del texto), para KPIs que deben distinguirse de un vistazo. */
  destacado?: boolean;
}) {
  const toneClass: Record<string, string> = {
    ok: "text-ok-fg",
    warn: "text-warn-fg",
    bad: "text-bad-fg",
    brand: "text-brand",
    muted: "text-muted",
  };
  const destacadoClass: Record<string, string> = {
    ok: "bg-ok-bg border-ok-fg/30",
    warn: "bg-warn-bg border-warn-fg/30",
    bad: "bg-bad-bg border-bad-fg/30",
    brand: "bg-brand-tint border-brand/30",
    muted: "bg-surface border-border",
  };
  return (
    <div
      className={clsx(
        "rounded-xl border p-5 flex flex-col gap-1 min-w-0",
        destacado ? destacadoClass[tone] : "bg-surface border-border"
      )}
    >
      <div className="text-[13px] text-muted truncate">{label}</div>
      <div className="text-[26px] font-semibold text-foreground tracking-tight truncate">{value}</div>
      {sub && <div className={clsx("text-xs font-medium mt-1", toneClass[tone])}>{sub}</div>}
    </div>
  );
}

type ButtonVariant = "primary" | "dark" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  type = "button",
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand text-white border-transparent hover:bg-brand-dark",
    dark: "bg-brand-dark text-white border-transparent",
    secondary: "bg-surface text-foreground border-border hover:bg-background",
    ghost: "bg-transparent text-muted border-transparent hover:bg-background",
    danger: "bg-bad-bg text-bad-fg border-transparent hover:brightness-95",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 rounded-lg font-medium border whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "brand";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const toneClass: Record<Tone, string> = {
    ok: "bg-ok-bg text-ok-fg",
    warn: "bg-warn-bg text-warn-fg",
    bad: "bg-bad-bg text-bad-fg",
    info: "bg-info-bg text-info-fg",
    neutral: "bg-neutral-bg text-neutral-fg",
    brand: "bg-brand-tint text-brand-dark",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
        toneClass[tone]
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap",
        active ? "bg-brand text-white border-brand" : "bg-surface text-foreground border-border hover:bg-background"
      )}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  icon = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  icon?: boolean;
}) {
  return (
    <div className={clsx("flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-surface text-[13px]", className)}>
      {icon && <Search className="w-3.5 h-3.5 text-muted shrink-0" />}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full outline-none bg-transparent placeholder:text-muted text-foreground"
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground outline-none",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px]">
      <span className="text-muted font-medium">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground outline-none focus:border-brand w-full",
        props.className
      )}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={clsx(
        "px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-foreground outline-none focus:border-brand w-full",
        props.className
      )}
    />
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number; tone?: Tone }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-border px-4 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            "py-3 mr-5 text-[13px] font-medium border-b-2 flex items-center gap-2 whitespace-nowrap",
            active === t.key ? "text-brand-dark border-brand" : "text-muted border-transparent hover:text-foreground"
          )}
        >
          {t.label}
          {typeof t.count === "number" && (
            <span
              className={clsx(
                "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold",
                t.tone === "bad"
                  ? "bg-bad-bg text-bad-fg"
                  : t.tone === "warn"
                  ? "bg-warn-bg text-warn-fg"
                  : t.tone === "brand"
                  ? "bg-brand-tint text-brand-dark"
                  : "bg-neutral-bg text-neutral-fg"
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {subtitle && <div className="text-xs text-muted max-w-sm">{subtitle}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted gap-2">
      <span className="w-4 h-4 rounded-full border-2 border-border border-t-brand animate-spin" />
      {label}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border flex-wrap gap-2">
      <div className="text-xs text-muted">
        Mostrando {from}–{to} de {total} · {pageSize} por página
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="w-3.5 h-3.5" />
          Anterior
        </Button>
        <span className="text-xs text-muted">
          {page} / {totalPages}
        </span>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Siguiente
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "560px",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-surface border border-border rounded-xl shadow-xl max-h-[90vh] flex flex-col w-full"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-[15px] font-semibold text-foreground m-0">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-background">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "480px",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 transition-visibility",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <div
        className={clsx("absolute inset-0 bg-black/40 transition-opacity", open ? "opacity-100" : "opacity-0")}
        onClick={onClose}
      />
      <div
        className={clsx(
          "absolute right-0 top-0 h-full bg-surface border-l border-border shadow-xl flex flex-col transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width, maxWidth: "100vw" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-[15px] font-semibold text-foreground m-0">{title}</h3>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1 rounded-lg hover:bg-background">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ initials, size = 32, soft }: { initials: string; size?: number; soft?: boolean }) {
  return (
    <div
      className={clsx(
        "rounded-full flex items-center justify-center font-semibold shrink-0",
        soft ? "bg-brand-tint text-brand-dark" : "bg-silver text-neutral-fg"
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function Banner({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "bad";
  children: ReactNode;
  action?: ReactNode;
}) {
  const toneClass: Record<string, string> = {
    info: "bg-brand-tint border-brand/30 text-brand-dark",
    warn: "bg-warn-bg border-warn-fg/30 text-warn-fg",
    bad: "bg-bad-bg border-bad-fg/30 text-bad-fg",
  };
  return (
    <div className={clsx("flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-[13px] flex-wrap", toneClass[tone])}>
      <div className="leading-relaxed">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
