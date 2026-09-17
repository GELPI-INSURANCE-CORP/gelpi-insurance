"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PieChart,
  LayoutDashboard,
  Upload,
  GitCompare,
  Users,
  BookOpen,
  Building2,
  Gift,
  Settings,
} from "lucide-react";
import clsx from "clsx";

const SUBTABS = [
  { href: "/comisiones/resumen", label: "Resumen", icon: LayoutDashboard },
  { href: "/comisiones/subir", label: "Subir Reportes", icon: Upload },
  { href: "/comisiones/conciliacion", label: "Conciliación", icon: GitCompare },
  { href: "/comisiones/agentes", label: "Agentes", icon: Users },
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
        <div className="flex items-center gap-3 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white">
          <PieChart size={16} className="flex-shrink-0" />
          <span className="hidden whitespace-nowrap group-hover:inline">GELPI AMS</span>
        </div>
        <div className="ml-5 mt-1.5 flex flex-col gap-0.5 border-l border-border pl-3">
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
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
                  active
                    ? "bg-brand-tint font-medium text-brand-dark before:h-1.5 before:w-1.5 before:flex-shrink-0 before:rounded-full before:bg-brand before:content-['']"
                    : "text-[#4b5563] hover:bg-background"
                )}
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="hidden whitespace-nowrap group-hover:inline">{t.label}</span>
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
