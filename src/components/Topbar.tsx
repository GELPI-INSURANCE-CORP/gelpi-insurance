"use client";

import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/polizas": "Pólizas",
  "/clientes": "Clientes",
  "/reclamos": "Reclamos",
  "/comisiones": "Comisiones",
};

export default function Topbar() {
  const pathname = usePathname();
  const title = TITLES[pathname] ?? "Gelpi Insurance";

  return (
    <header className="h-16 flex items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-8 sticky top-0 z-10">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-muted w-64">
          <Search className="h-4 w-4" />
          <span>Buscar cliente o póliza…</span>
        </div>
        <button className="relative rounded-full p-2 hover:bg-background">
          <Bell className="h-5 w-5 text-muted" />
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-gold" />
        </button>
        <div className="h-9 w-9 rounded-full bg-navy text-white flex items-center justify-center text-sm font-medium">
          RG
        </div>
      </div>
    </header>
  );
}
