"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PieChart } from "lucide-react";
import clsx from "clsx";

const SUBTABS = [
  { href: "/comisiones/resumen", label: "Resumen" },
  { href: "/comisiones/subir", label: "Subir Reportes" },
  { href: "/comisiones/conciliacion", label: "Conciliación" },
  { href: "/comisiones/agentes", label: "Agentes" },
  { href: "/comisiones/clientes", label: "Clientes (Book)" },
  { href: "/comisiones/oficinas", label: "Oficinas" },
  { href: "/comisiones/bonos", label: "Bonos" },
  { href: "/comisiones/configuracion", label: "Configuración" },
];

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 flex-shrink-0 items-center gap-2.5 border-b border-border px-5">
        <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi.png`} alt="Gelpi Insurance" width={31} height={35} />
        <div className="flex flex-col leading-none">
          <span
            className="text-[20px] font-bold tracking-wide text-brand-dark"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            GELPI
          </span>
          <span className="mt-[3px] text-[9px] font-medium tracking-[0.32em] text-[#7b7f86]">
            INSURANCE
          </span>
        </div>
      </div>
      <nav className="flex flex-grow flex-col gap-1 overflow-y-auto p-3">
        <div className="flex items-center gap-3 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white">
          <PieChart size={16} />
          Comisiones
        </div>
        <div className="ml-5 mt-1.5 flex flex-col gap-0.5 border-l border-border pl-3">
          {SUBTABS.map((t) => {
            const active = pathname?.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
                  active
                    ? "bg-brand-tint font-medium text-brand-dark before:h-1.5 before:w-1.5 before:flex-shrink-0 before:rounded-full before:bg-brand before:content-['']"
                    : "text-[#4b5563] hover:bg-background"
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex-shrink-0 border-t border-border px-5 py-4 text-[11px] text-[#9a9ea6]">
        Gelpi Insurance © 2026
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-shrink-0 border-r border-border bg-surface md:flex">
      <SidebarContent />
    </aside>
  );
}
