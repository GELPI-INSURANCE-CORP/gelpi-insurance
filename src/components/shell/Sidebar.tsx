"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  ReceiptText,
  BookOpen,
  Building2,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import { useT } from "@/lib/i18n";
import type { ClaveTexto } from "@/lib/i18n/textos";

// Conciliación y Liquidación salieron del menú: son pasos DE un statement, no secciones aparte, y
// tener ocho entradas hacía que el usuario no supiera por dónde empezar. Se entra a las dos desde
// Comisiones. Las rutas siguen existiendo tal cual — hay enlaces a ellas repartidos por otras
// pantallas (Resumen, Oficinas, la ficha del agente) y sacarlas dejaría esos enlaces en un 404.
const SUBTABS = [
  { href: "/comisiones/resumen", clave: "nav.dashboard" as ClaveTexto, icon: LayoutDashboard, tambien: [] as string[] },
  // Estando en Conciliación o Liquidación se ilumina Commissions: es de donde se entra, así el menú
  // no queda sin ningún item marcado y el usuario no pierde de vista dónde está parado.
  //
  // El ícono era una flecha de subir archivo: describía el acto de cargar un Excel, no de qué trata
  // la sección. Lo que se hace ahí es plata — cuánto pagó cada compañía y cuánto le toca a cada
  // agente — así que va una billetera. Lo mismo con Bonuses: un regalo no es un bono de producción.
  { href: "/comisiones/subir", clave: "nav.commissions" as ClaveTexto, icon: Wallet, tambien: ["/comisiones/conciliacion", "/comisiones/liquidacion", "/comisiones/statement"] },
  // Los MVR tienen entrada propia porque son plata que SALE, y se trabajan al reves que un
  // statement: no se cobra, se descuenta, y hay que poder mirarlos de todas las companias
  // juntas para mandarle a cada oficina cuanto gasto en el mes.
  { href: "/comisiones/mvr", clave: "nav.mvr" as ClaveTexto, icon: ReceiptText, tambien: [] as string[] },
  { href: "/comisiones/clientes", clave: "nav.book" as ClaveTexto, icon: BookOpen, tambien: [] as string[] },
  { href: "/comisiones/oficinas", clave: "nav.offices" as ClaveTexto, icon: Building2, tambien: [] as string[] },
];

// Settings va separado y al pie. No es un lugar donde se trabaja: se entra una vez a configurar
// algo y no se vuelve en semanas, así que mezclarlo con las secciones de todos los días le hacía
// ganar un lugar que no le corresponde.
//
// Bonuses salió del menú: un bono no es una sección aparte, es un archivo más que manda la
// compañía. Se sube desde Commissions eligiendo ese tipo de reporte, igual que un statement. La
// ruta sigue viva para los enlaces que ya existen.
const PIE = { href: "/comisiones/configuracion", clave: "nav.settings" as ClaveTexto, icon: Settings };

// `expandida` fuerza el estado abierto (icono + texto) sin depender del hover. El menú de celular
// monta este mismo componente dentro de un panel que no es `.group`, así que todas las clases
// `group-hover:` nunca se disparaban y el panel salía con los iconos pelados, sin una sola
// etiqueta. En el riel de escritorio se deja en false, que es donde el hover sí manda.
export function SidebarContent({ onNavigate, expandida = false }: { onNavigate?: () => void; expandida?: boolean }) {
  const pathname = usePathname();
  const t = useT();
  // Las clases se escriben enteras a propósito: Tailwind lee el código fuente como texto y una
  // clase armada con template string (`group-hover:${x}`) no existe para él, así que se purga.
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 flex-shrink-0 items-center border-b border-border px-5">
        {/* Colapsado (72px de riel) solo entra el escudo. logo-gelpi.png es el mismo arte recortado
            del logo oficial (no un dibujo aparte), así que al expandir no hay un salto visual raro
            entre un ícono y otro: es la misma figura, nomás con el wordmark al lado. */}
        <Image
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi.png`}
          alt="Gelpi Insurance"
          width={31}
          height={35}
          className={clsx("flex-shrink-0", expandida ? "hidden" : "block group-hover:hidden")}
        />
        {/* Expandido: el logo oficial completo. Es un archivo ancho (2000x699, ~2.9:1) porque trae
            el escudo y el wordmark en horizontal, así que se limita por alto (h-9) y se deja el
            ancho automático en vez de forzarlo al cuadrado que ocupaba el ícono solo. */}
        <Image
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi-oficial.webp`}
          alt="Gelpi Insurance"
          width={2000}
          height={699}
          className={clsx("h-9 w-auto flex-shrink-0", expandida ? "block" : "hidden group-hover:block")}
        />
      </div>
      <nav className="flex flex-grow flex-col gap-1 overflow-y-auto overflow-x-hidden p-3">
        {/* El borde izquierdo y el sangrado (ml-5/pl-3) que tenía este bloque colgaban visualmente
            del encabezado "GELPI AMS" de arriba. Sin ese encabezado ya no hay de qué colgar, así
            que las sub-tabs van derechas contra el borde del riel, igual que Settings al pie. */}
        <div className="flex flex-col gap-1.5">
          {SUBTABS.map((item) => {
            const active =
              pathname?.startsWith(item.href) || item.tambien.some((p) => pathname?.startsWith(p));
            const Icon = item.icon;
            const etiqueta = t(item.clave);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={etiqueta}
                className={clsx(
                  "relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13px]",
                  expandida ? "justify-start" : "justify-center group-hover:justify-start",
                  active ? "bg-brand-tint font-medium text-brand-dark" : "text-[#4b5563] hover:bg-background"
                )}
              >
                {active && (
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand" />
                )}
                <Icon size={16} className="flex-shrink-0" />
                <span className={clsx("whitespace-nowrap", expandida ? "inline" : "hidden group-hover:inline")}>
                  {etiqueta}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Settings al pie, justo arriba de la firma: se entra una vez a configurar algo y no se
          vuelve en semanas. Arriba, entre las secciones de todos los días, ganaba un lugar que no
          le corresponde. */}
      <div className="mt-auto flex-shrink-0 px-3 pb-1">
        <Link
          href={PIE.href}
          onClick={onNavigate}
          title={t(PIE.clave)}
          className={clsx(
            "relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13px]",
            expandida ? "justify-start" : "justify-center group-hover:justify-start",
            pathname?.startsWith(PIE.href)
              ? "bg-brand-tint font-medium text-brand-dark"
              : "text-[#4b5563] hover:bg-background"
          )}
        >
          {pathname?.startsWith(PIE.href) && (
            <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand" />
          )}
          <PIE.icon size={16} className="flex-shrink-0" />
          <span className={clsx("whitespace-nowrap", expandida ? "inline" : "hidden group-hover:inline")}>
            {t(PIE.clave)}
          </span>
        </Link>
      </div>

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
