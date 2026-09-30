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
// VA SIEMPRE EN INGLÉS, aunque la app esté en español y aunque mañana se agregue otro idioma.
// No es una pantalla del sistema: es un papel que sale de la agencia y llega a manos de un
// franquiciado. Si siguiera el selector de idioma de la interfaz, el documento que recibe una
// oficina dependería de cómo tenía configurada la pantalla el que le dio a imprimir, y dos
// oficinas podrían recibir el mismo mes en idiomas distintos. Por eso los textos están acá y no
// en textos.ts.
//
// El PDF sale con el botón de imprimir del navegador. No se usa librería a propósito: el
// proyecto exporta estático, y una tabla con tipografía de verdad impresa por el navegador se ve
// mejor que una dibujada a mano con jsPDF, sin sumar nada al bundle. Lo que hace que salga
// limpio es la hoja de impresión de globals.css, que esconde todo lo que no sea [data-imprimible].

const MESES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function etiquetaMes(d: Date): string {
  return `${MESES_EN[d.getMonth()]} ${d.getFullYear()}`;
}

function periodosDisponibles(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const hoy = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: etiquetaMes(d),
    });
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

  const [anio, numMes] = periodo.split("-").map(Number);
  const mes = new Date(anio, numMes - 1, 1);
  const mesAnterior = etiquetaMes(new Date(anio, numMes - 2, 1));

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

  return (
    <div className="flex flex-col gap-4">
      {/* La barra de control es de la app, no del documento: va en español como el resto del
          sistema, y la hoja de impresión no la deja pasar al PDF. */}
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
          className="mx-auto w-full max-w-[880px] rounded-2xl border border-border bg-surface px-14 py-12 shadow-sm print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none"
        >
          <header className="flex items-center justify-between gap-8 border-b border-border pb-6 print:pb-5">
            <Image
              src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi-oficial.webp`}
              alt="Gelpi Insurance"
              width={2000}
              height={699}
              className="h-11 w-auto"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-dark">
              Commission Statement
            </p>
          </header>

          <div className="mt-7 flex items-start justify-between gap-8 print:mt-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Office</p>
              <h1 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight text-foreground">
                {datos.oficina}
              </h1>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Statement period</p>
              <p className="mt-1.5 text-[24px] font-medium leading-tight tracking-tight text-foreground">
                {etiquetaMes(mes)}
              </p>
            </div>
          </div>

          {/* El número que la oficina viene a ver. Va grande y arriba; el desglose lo justifica
              después, no al revés. En pantalla lleva fondo; en papel, un filo fino, porque un
              bloque de color lleno se ve pesado impreso. */}
          <section className="my-9 flex flex-wrap items-center justify-between gap-x-10 gap-y-6 rounded-2xl bg-brand-tint px-8 py-7 print:my-4 print:py-4 print:break-inside-avoid print:bg-transparent print:ring-1 print:ring-brand-dark/25">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Office payout</p>
              <p className="mt-3 text-[56px] font-semibold leading-none tracking-tight tabular-nums text-brand-dark">
                {money(datos.neto)}
              </p>
            </div>
            <dl className="w-full min-w-[220px] text-[12px] sm:w-auto">
              <div className="flex items-baseline justify-between gap-8 border-b border-brand-dark/10 pb-2">
                <dt className="text-muted">Policies</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {datos.totalPolizas.toLocaleString("en-US")}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-8 border-b border-brand-dark/10 py-2">
                <dt className="text-muted">Premium written</dt>
                <dd className="font-medium tabular-nums text-foreground">{money(datos.totalPrima)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-8 pt-2">
                <dt className="text-muted">Carriers</dt>
                <dd className="font-medium tabular-nums text-foreground">{datos.companias.length}</dd>
              </div>
            </dl>
          </section>

          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-foreground/70 text-left">
                <th className="pb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pb-2">Carrier</th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pb-2">
                  Policies
                </th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pb-2">
                  Premium
                </th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pb-2">
                  Commission
                </th>
                <th className="pb-3 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pb-2">
                  {mesAnterior}
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.companias.map((c) => {
                const dif =
                  c.comisionMesAnterior != null && c.comisionMesAnterior !== 0
                    ? ((c.comision - c.comisionMesAnterior) / Math.abs(c.comisionMesAnterior)) * 100
                    : null;
                return (
                  <tr key={c.compania} className="border-b border-border">
                    <td className="py-3.5 font-medium text-foreground print:py-[7px]">{c.compania}</td>
                    <td className="py-3.5 text-right tabular-nums text-foreground print:py-[7px]">{c.polizas}</td>
                    <td className="py-3.5 text-right tabular-nums text-foreground print:py-[7px]">{money(c.prima)}</td>
                    <td className="py-3.5 text-right font-semibold tabular-nums text-foreground print:py-[7px]">
                      {money(c.comision)}
                    </td>
                    {/* Una compañía sin dato del mes anterior lleva raya y no 0%: casi siempre
                        significa que ese statement todavía no se cargó, no que la compañía sea
                        nueva. En un papel que va al franquiciado, decir "new" sería afirmar algo
                        que no sabemos. */}
                    <td className="py-3.5 text-right tabular-nums text-muted print:py-[7px]">
                      {c.comisionMesAnterior == null ? (
                        <>
                          —<span className="ml-2 inline-block w-14" />
                        </>
                      ) : (
                        <>
                          {money(c.comisionMesAnterior)}
                          {/* El lugar del porcentaje se reserva siempre, para que los montos de
                              esta columna queden alineados aunque a alguna fila no le toque uno. */}
                          {dif != null ? (
                            <span
                              className={
                                dif >= 0
                                  ? "ml-2 inline-block w-14 text-[11px] font-medium text-ok-fg"
                                  : "ml-2 inline-block w-14 text-[11px] font-medium text-bad-fg"
                              }
                            >
                              {dif >= 0 ? "▲" : "▼"} {Math.abs(dif).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="ml-2 inline-block w-14" />
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-foreground">
                <td className="pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted print:pt-3">Total</td>
                <td className="pt-4 text-right text-[14px] font-semibold tabular-nums text-foreground print:pt-3">
                  {datos.totalPolizas}
                </td>
                <td className="pt-4 text-right text-[14px] font-semibold tabular-nums text-foreground print:pt-3">
                  {money(datos.totalPrima)}
                </td>
                <td className="pt-4 text-right text-[14px] font-semibold tabular-nums text-foreground print:pt-3">
                  {money(datos.comisionGenerada)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>

          <div className="mt-10 ml-auto w-full max-w-[360px] text-[13px] print:mt-6 print:break-inside-avoid">
            <div className="flex justify-between border-b border-border py-2.5 print:py-2">
              <span className="text-muted">Commission generated</span>
              <span className="tabular-nums text-foreground">{money(datos.comisionGenerada)}</span>
            </div>
            <div className="flex justify-between py-2.5 print:py-2">
              <span className="text-muted">
                Franchise royalty{datos.pctRoyalty != null ? ` (${datos.pctRoyalty}%)` : ""}
              </span>
              <span className="tabular-nums text-foreground">−{money(datos.royalty)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t-2 border-brand-dark pt-3.5">
              <span className="text-[14px] font-semibold text-foreground">Net to Office</span>
              <span className="text-[22px] font-semibold tracking-tight tabular-nums text-brand-dark">
                {money(datos.neto)}
              </span>
            </div>
          </div>

          {/* Explicar la cuenta al pie evita la llamada preguntando de dónde salió el número, y el
              aviso de confidencialidad porque este papel lleva la producción completa de una
              oficina: cuánto vende, con qué compañías y cuánto se le retiene. */}
          <footer className="mt-12 border-t border-border pt-5 text-[10px] leading-relaxed text-muted print:mt-6 print:pt-4 print:leading-snug print:break-inside-avoid">
            <p>
              The franchise royalty is calculated on the total commission generated by the office
              during the period — new business and renewals alike — based on the carrier statements
              received for {etiquetaMes(mes)}. The net amount shown is what is remitted to the
              office; the distribution among its agents is handled by the office. A dash in the{" "}
              {mesAnterior} column means no statement from that carrier has been posted for that
              month.
            </p>
            <p className="mt-2">
              Statement issued on{" "}
              {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
            </p>
            <p className="mt-4 border-t border-border pt-3 font-medium text-foreground/70">
              Confidential. This statement is the property of Gelpi Insurance Corp and is intended
              solely for the office named above. Any reproduction, distribution or disclosure to
              third parties without written authorization is prohibited. All rights reserved.
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}
