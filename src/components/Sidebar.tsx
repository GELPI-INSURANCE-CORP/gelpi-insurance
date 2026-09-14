"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  ShieldAlert,
  Percent,
  Shield,
} from "lucide-react";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/polizas", label: "Pólizas", icon: FileText },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/reclamos", label: "Reclamos", icon: ShieldAlert },
  { href: "/comisiones", label: "Comisiones", icon: Percent },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-navy text-white">
      <div className="flex items-center gap-2 px-6 h-16 border-b border-white/10">
        <Shield className="h-6 w-6 text-gold" />
        <div>
          <p className="font-semibold leading-tight">Gelpi Insurance</p>
          <p className="text-xs text-white/50 leading-tight">Panel interno</p>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-navy-light text-white"
                  : "text-white/70 hover:bg-navy-light hover:text-white"
              )}
            >
              <Icon className={clsx("h-4 w-4", active && "text-gold")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-6 py-4 border-t border-white/10 text-xs text-white/40">
        Gelpi Insurance © {new Date().getFullYear()}
      </div>
    </aside>
  );
}
