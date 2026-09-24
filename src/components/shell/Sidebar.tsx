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

// `expandida` fuerza el estado abierto (icono + texto) sin depender del hover. El menú de celular
// monta este mismo componente dentro de un panel que no es `.group`, así que todas las clases
// `group-hover:` nunca se disparaban y el panel salía con los iconos pelados, sin una sola
// etiqueta. En el riel de escritorio se deja en false, que es donde el hover sí manda.
export function SidebarContent({ onNavigate, expandida = false }: { onNavigate?: () => void; expandida?: boolean }) {
  const pathname = usePathname();
  // Las clases se escriben enteras a propósito: Tailwind lee el código fuente como texto y una
  // clase armada con template string (`group-hover:${x}`) no existe para él, así que se purga.
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
        <div className={clsx("flex-col leading-none", expandida ? "flex" : "hidden group-hover:flex")}>
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
        <div
          className={clsx(
            "flex items-center gap-3 rounded-lg bg-brand py-2.5 text-sm font-semibold text-white",
            expandida ? "justify-start px-3" : "justify-center px-2.5 group-hover:justify-start group-hover:px-3"
          )}
        >
          <PieChart size={16} className="flex-shrink-0" />
          <span className={clsx("whitespace-nowrap", expandida ? "inline" : "hidden group-hover:inline")}>GELPI AMS</span>
        </div>
        <div
          className={clsx(
            "mt-1.5 flex flex-col gap-0.5 border-l",
            expandida
              ? "ml-5 border-border pl-3"
              : "border-transparent pl-0 group-hover:ml-5 group-hover:border-border group-hover:pl-3"
          )}
        >
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
                  "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
                  expandida ? "justify-start" : "justify-center group-hover:justify-start",
                  active ? "bg-brand-tint font-medium text-brand-dark" : "text-[#4b5563] hover:bg-background"
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand" />
                )}
                <Icon size={16} className="flex-shrink-0" />
                <span className={clsx("whitespace-nowrap", expandida ? "inline" : "hidden group-hover:inline")}>
                  {t.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-shrink-0 overflow-hidden border-t border-border px-5 py-4 text-[11px] whitespace-nowrap text-[#9a9ea6]">
        <span className={expandida ? "inline" : "hidden group-hover:inline"}>Gelpi Insurance © 2026</span>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="group fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-shrink-0 overflow-hidden border-r border-border bg-surface transition-[width] duration-200 ease-out hover:w-64 hover:shadow-xl md:flex">
      <div className="w-[72px] flex-shrink-0 transition-[width] duration-200 ease-out group-hover:w-64">
        <SidebarContent />
      </div>
    </aside>
  );
}
