"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { displayName, initials, signOut } from "@/lib/auth";

const TITLES: Record<string, string> = {
  "/comisiones/resumen": "Dashboard",
  "/comisiones/subir": "Comisiones",
  "/comisiones/statement": "Detalle del statement",
  "/comisiones/conciliacion": "Conciliación",
  "/comisiones/liquidacion": "Liquidación",
  "/comisiones/agentes": "Agentes",
  "/comisiones/clientes": "Book of Business",
  "/comisiones/oficinas": "Office",
  "/comisiones/bonos": "Bonos",
  "/comisiones/configuracion": "Configuración",
  "/comisiones/cuenta": "Mi cuenta",
};

export function Topbar({ onMenu }: { onMenu?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busqueda, setBusqueda] = useState("");

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

  function buscarGlobal(e: FormEvent) {
    e.preventDefault();
    const term = busqueda.trim();
    if (!term) return;
    router.push(`/comisiones/conciliacion/?buscar=${encodeURIComponent(term)}`);
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
        <form onSubmit={buscarGlobal} className="hidden h-9 w-70 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-muted focus-within:border-brand lg:flex">
          <Search size={14} className="flex-shrink-0" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente, póliza o agente…"
            aria-label="Buscar cliente, póliza o agente"
            className="w-full bg-transparent text-foreground outline-none placeholder:text-muted"
          />
        </form>
        <div className="relative flex h-9 w-9 items-center justify-center">
          <Bell size={20} className="text-muted" />
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
              <Link
                href="/comisiones/cuenta/"
                onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-left text-[13px] text-foreground hover:bg-background"
              >
                Cambiar contraseña
              </Link>
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
