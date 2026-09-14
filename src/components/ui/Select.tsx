import { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  options,
  placeholder,
  className,
  ...rest
}: {
  options: SelectOption[];
  placeholder?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div
      className={clsx(
        "relative flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground focus-within:border-brand",
        className
      )}
    >
      <select
        className="w-full min-w-0 appearance-none bg-transparent pr-5 text-[13px] outline-none"
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="text-muted pointer-events-none absolute right-3" />
    </div>
  );
}
