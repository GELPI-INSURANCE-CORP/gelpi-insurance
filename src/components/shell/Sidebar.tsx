"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PieChart,
  LayoutDashboard,
  Upload,
  GitCompare,
  BookOpen,
  Building2,
  Gift,
  Settings,
  Wallet,
} from "lucide-react";
import clsx from "clsx";

const SUBTABS = [
  { href: "/comisiones/resumen", label: "Resumen", icon: LayoutDashboard },
  { href: "/comisiones/subir", label: "Comisiones", icon: Upload },
  { href: "/comisiones/conciliacion", label: "Conciliación", icon: GitCompare },
  { href: "/comisiones/liquidacion", label: "Liquidación", icon: Wallet },
  { href: "/comisiones/clientes", label: "Clientes (Book)", icon: BookOpen },
  { href: "/comisiones/oficinas", label: "Oficinas", icon: Building2 },
  { href: "/comisiones/bonos", label: "Bonos", icon: Gift },
  { href: "/comisiones/configuracion", label: "Configuración", icon: Settings },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 flex-shrink-0 items-center gap-2.5 border-b border-border px-5">
        <Image
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi.png`}
          alt="Gelpi Insurance"
          width={31}
          height={35}
          className="flex-shrink-0"
        />
        <div className="hidden flex-col leading-none group-hover:flex">
          <span
            className="whitespace-nowrap text-[20px] font-bold tracking-wide text-brand-dark"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            GELPI
          </span>
          <span className="mt-[3px] whitespace-nowrap text-[9px] font-medium tracking-[0.32em] text-[#7b7f86]">
            INSURANCE
          </span>
        </div>
      </div>
      <nav className="flex flex-grow flex-col gap-1 overflow-y-auto overflow-x-hidden p-3">
        <div className="flex items-center justify-center gap-3 rounded-lg bg-brand px-2.5 py-2.5 text-sm font-semibold text-white group-hover:justify-start group-hover:px-3">
          <PieChart size={16} className="flex-shrink-0" />
          <span className="hidden whitespace-nowrap group-hover:inline">GELPI AMS</span>
        </div>
        <div className="mt-1.5 flex flex-col gap-0.5 border-l border-transparent pl-0 group-hover:ml-5 group-hover:border-border group-hover:pl-3">
          {SUBTABS.map((t) => {
            const active = pathname?.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={onNavigate}
                title={t.label}
                className={clsx(
                  "flex items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] group-hover:justify-start",
                  active ? "bg-brand-tint font-medium text-brand-dark" : "text-[#4b5563] hover:bg-background"
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="hidden whitespace-nowrap group-hover:inline">{t.label}</span>
                {active && (
                  <span className="hidden h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand group-hover:ml-auto group-hover:inline-block" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-shrink-0 overflow-hidden border-t border-border px-5 py-4 text-[11px] whitespace-nowrap text-[#9a9ea6]">
        <span className="hidden group-hover:inline">Gelpi Insurance © 2026</span>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="group fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-shrink-0 overflow-hidden border-r border-border bg-surface transition-[width] duration-200 ease-out hover:w-64 hover:shadow-xl md:flex">
      <div className="w-64 flex-shrink-0">
        <SidebarContent />
      </div>
    </aside>
  );
}
