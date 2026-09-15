import clsx from "clsx";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  tone?: "brand" | "warn" | "bad" | "info" | "neutral";
}

const countTone: Record<string, string> = {
  brand: "bg-brand-tint text-brand-dark",
  warn: "bg-warn-bg text-warn-fg",
  bad: "bg-bad-bg text-bad-fg",
  info: "bg-info-bg text-info-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
};

export function Tabs({
  items,
  active,
  onChange,
  trailing,
}: {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={clsx(
            "flex flex-shrink-0 items-center gap-2 border-b-2 py-3 pr-5 text-[13px] font-medium whitespace-nowrap",
            active === it.key
              ? "border-brand text-brand-dark"
              : "border-transparent text-muted hover:text-foreground"
          )}
        >
          {it.label}
          {typeof it.count === "number" && (
            <span
              className={clsx(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                countTone[it.tone ?? "neutral"]
              )}
            >
              {it.count}
            </span>
          )}
        </button>
      ))}
      {trailing && <div className="ml-auto flex flex-shrink-0 items-center gap-2 py-2 pl-4">{trailing}</div>}
    </div>
  );
}
