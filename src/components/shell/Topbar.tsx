"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { displayName, initials, signOut } from "@/lib/auth";

const TITLES: Record<string, string> = {
  "/comisiones/resumen": "Resumen",
  "/comisiones/subir": "Subir Reportes",
  "/comisiones/conciliacion": "Conciliación",
  "/comisiones/agentes": "Agentes",
  "/comisiones/clientes": "Clientes (Book)",
  "/comisiones/oficinas": "Oficinas",
  "/comisiones/bonos": "Bonos",
  "/comisiones/configuracion": "Configuración",
};

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const title =
    Object.entries(TITLES).find(([href]) => pathname?.startsWith(href))?.[1] ?? "Gelpi Insurance";

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-10 flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenu}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border md:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={18} />
        </button>
        <h1 className="truncate text-[18px] font-semibold text-foreground">{title}</h1>
      </div>
      <div className="flex flex-shrink-0 items-center gap-4">
        <div className="hidden h-9 w-70 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-muted lg:flex">
          <Search size={14} />
          Buscar cliente, póliza o agente…
        </div>
        <div className="relative flex h-9 w-9 items-center justify-center">
          <Bell size={20} className="text-muted" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand" />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white"
          >
            {initials(user)}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-56 rounded-lg border border-border bg-surface py-1 shadow-lg">
              <div className="truncate border-b border-border px-3 py-2 text-[13px] text-foreground">
                {displayName(user)}
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-background"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
