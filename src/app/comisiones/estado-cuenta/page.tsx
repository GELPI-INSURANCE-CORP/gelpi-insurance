"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { Select, Button, Loading } from "@/components/agentes/ui";
import { money } from "@/lib/format";
import { getEstadoCuentaOficina, type EstadoCuentaOficina } from "@/lib/queries/resumen";

// El estado de cuenta que la casa matriz le manda a cada oficina.
//
// Dice una sola cosa y la dice en grande: cuánto generó la oficina con cada compañía, cuánto se
// le cobra de royalty, y cuánto le entra a su cuenta. La oficina después le paga a su gente como
// quiera — eso ya no sale acá.
//
// Se guarda en PDF con el botón de imprimir del navegador. No se usa librería de PDF a propósito:
// el proyecto exporta estático, y una tabla con tipografía de verdad impresa por el navegador se
// ve mejor que una dibujada a mano con jsPDF, sin sumar nada al bundle. Lo que hace que salga
// limpio es la hoja de impresión de globals.css, que esconde todo lo que no sea [data-imprimible].

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function etiquetaMes(d: Date): string {
  const n = MESES[d.getMonth()];
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${d.getFullYear()}`;
}

function periodosDisponibles(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const hoy = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value: v, label: etiquetaMes(d) });
  }
  return out;
}

export default function EstadoCuentaPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Contenido />
    </Suspense>
  );
}

function Contenido() {
  const params = useSearchParams();
  const oficinaId = params.get("oficina") ?? "";
  const mesUrl = params.get("mes");

  const [periodo, setPeriodo] = useState(() => {
    if (mesUrl && /^\d{4}-\d{2}$/.test(mesUrl)) return mesUrl;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [datos, setDatos] = useState<EstadoCuentaOficina | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mes = (() => {
    const [a, m] = periodo.split("-").map(Number);
    return new Date(a, m - 1, 1);
  })();

  const cargar = useCallback(async () => {
    if (!oficinaId) {
      setError("Falta decir de qué oficina es el estado de cuenta.");
      setCargando(false);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const [a, m] = periodo.split("-").map(Number);
      const d = await getEstadoCuentaOficina(oficinaId, new Date(a, m - 1, 1));
      if (!d) setError("No se encontró esa oficina.");
      setDatos(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el estado de cuenta.");
    } finally {
      setCargando(false);
    }
  }, [oficinaId, periodo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const mesAnterior = etiquetaMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1));

  return (
    <div className="flex flex-col gap-4">
      {/* Nada de esto sale impreso: la hoja de impresión solo deja pasar [data-imprimible]. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/comisiones/resumen/"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
        >
          <ArrowLeft size={15} />
          Volver al dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Select value={periodo} onChange={setPeriodo} options={periodosDisponibles()} />
          <Button variant="primary" onClick={() => window.print()} disabled={!datos}>
            <Printer className="h-3.5 w-3.5" />
            Imprimir o guardar PDF
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-3 text-[13px] text-bad-fg">{error}</div>
      )}
      {cargando && <Loading />}

      {datos && !cargando && (
        <div
          data-imprimible
          className="mx-auto w-full max-w-[860px] rounded-xl border border-border bg-surface px-10 py-9 print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0"
        >
          <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
            <div>
              <Image
                src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi-oficial.webp`}
                alt="Gelpi Insurance"
                width={2000}
                height={699}
                className="h-11 w-auto"
              />
              <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-muted">Estado de cuenta</p>
            </div>
            <div className="text-right">
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">{datos.oficina}</h1>
              <p className="mt-0.5 text-[13px] text-muted">{etiquetaMes(mes)}</p>
            </div>
          </div>

          {/* El número que la oficina viene a ver. Va grande y arriba; el desglose lo justifica
              después, no al revés. */}
          <div className="my-7 flex flex-wrap items-end justify-between gap-6 rounded-xl bg-brand-tint px-6 py-5 print:bg-transparent print:px-0 print:ring-1 print:ring-border">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Le corresponde a la oficina</p>
              <p className="text-[34px] font-semibold leading-tight tabular-nums text-brand-dark">
                {money(datos.neto)}
              </p>
            </div>
            <div className="text-right text-[13px] text-muted">
              <p>
                {datos.totalPolizas.toLocaleString("en-US")} pólizas · {money(datos.totalPrima)} de prima
              </p>
              <p>{datos.companias.length} compañías</p>
            </div>
          </div>

          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="pb-2 font-medium">Compañía</th>
                <th className="pb-2 text-right font-medium">Pólizas</th>
                <th className="pb-2 text-right font-medium">Prima</th>
                <th className="pb-2 text-right font-medium">Comisión</th>
                <th className="pb-2 text-right font-medium">{mesAnterior}</th>
              </tr>
            </thead>
            <tbody>
              {datos.companias.map((c) => {
                const dif =
                  c.comisionMesAnterior != null && c.comisionMesAnterior !== 0
                    ? ((c.comision - c.comisionMesAnterior) / Math.abs(c.comisionMesAnterior)) * 100
                    : null;
                return (
                  <tr key={c.compania} className="border-b border-border/60">
                    <td className="py-2.5 font-medium text-foreground">{c.compania}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted">{c.polizas}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted">{money(c.prima)}</td>
                    <td className="py-2.5 text-right font-medium tabular-nums text-foreground">
                      {money(c.comision)}
                    </td>
                    {/* Raya y no 0%, y tampoco "nueva": que no haya dato del mes anterior casi
                        siempre significa que ese statement todavía no se cargó, no que la
                        compañía sea nueva para la oficina. Decir "nueva" en un documento que va
                        al franquiciado sería afirmar algo que no sabemos. */}
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {c.comisionMesAnterior == null ? (
                        <span className="text-[12px]">—</span>
                      ) : (
                        <>
                          {money(c.comisionMesAnterior)}
                          {dif != null && (
                            <span className={dif >= 0 ? "ml-1.5 text-ok-fg" : "ml-1.5 text-bad-fg"}>
                              {dif >= 0 ? "▲" : "▼"} {Math.abs(dif).toFixed(0)}%
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-7 ml-auto w-full max-w-[380px] text-[13px]">
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted">Comisión generada</span>
              <span className="tabular-nums text-foreground">{money(datos.comisionGenerada)}</span>
            </div>
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted">
                Royalty de franquicia{datos.pctRoyalty != null ? ` (${datos.pctRoyalty}%)` : ""}
              </span>
              <span className="tabular-nums text-bad-fg">−{money(datos.royalty)}</span>
            </div>
            <div className="flex justify-between py-3">
              <span className="font-semibold text-foreground">Neto a la oficina</span>
              <span className="text-[17px] font-semibold tabular-nums text-foreground">{money(datos.neto)}</span>
            </div>
          </div>

          {/* Explicar la cuenta al pie evita la llamada preguntando de dónde salió el número. */}
          <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted">
            El royalty se calcula sobre la comisión total que generó la oficina en el mes — negocio
            nuevo y renovación — según los statements recibidos de cada compañía en {etiquetaMes(mes)}.
            Una raya en la columna de {mesAnterior} significa que no hay statement de esa compañía
            cargado para ese mes.
            El neto es lo que se le transfiere a la oficina; el reparto entre sus agentes lo hace cada
            oficina. Documento generado el{" "}
            {new Date().toLocaleDateString("es-US", { day: "numeric", month: "long", year: "numeric" })}.
          </p>
        </div>
      )}
    </div>
  );
}
