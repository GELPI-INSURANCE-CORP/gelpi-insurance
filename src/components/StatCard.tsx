import { LucideIcon } from "lucide-react";
import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
}

export default function StatCard({ label, value, icon: Icon, trend, trendUp }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <div className="rounded-lg bg-navy/5 p-2">
          <Icon className="h-5 w-5 text-navy" />
        </div>
      </div>
      {trend && (
        <p
          className={clsx(
            "mt-3 text-xs font-medium",
            trendUp ? "text-emerald-600" : "text-red-500"
          )}
        >
          {trend}
        </p>
      )}
    </div>
  );
}
