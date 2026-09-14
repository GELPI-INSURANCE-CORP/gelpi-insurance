import { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";

type Variant = "primary" | "dark" | "secondary" | "ghost";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  dark: "bg-brand-dark text-white hover:opacity-90",
  secondary: "bg-surface text-foreground border border-border hover:bg-background",
  ghost: "bg-transparent text-muted hover:text-foreground",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-[30px] px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
};

const base =
  "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap border border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  href,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  href?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = clsx(base, variantClasses[variant], sizeClasses[size], className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
