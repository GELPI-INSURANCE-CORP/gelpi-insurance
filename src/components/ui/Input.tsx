import { InputHTMLAttributes, ReactNode } from "react";
import { Search } from "lucide-react";
import clsx from "clsx";

export function Input({
  icon,
  className,
  ...rest
}: { icon?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div
      className={clsx(
        "flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground focus-within:border-brand",
        className
      )}
    >
      {icon ?? <Search size={14} className="text-muted flex-shrink-0" />}
      <input
        className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
        {...rest}
      />
    </div>
  );
}
