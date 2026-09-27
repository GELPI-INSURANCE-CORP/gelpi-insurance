"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Crown, FileText } from "lucide-react";
import Link from "next/link";
import { Card, CardHead } from "@/components/ui";
import { money } from "@/lib/format";
import {
  getRoyaltyPorOficina,
  rangoYtd,
  type RoyaltyOficina,
} from "@/lib/queries/resumen";
import { COLORES_GRAFICA } from "@/components/dashboard/charts";

// Lo que Arturo gana como franquiciante.
//
// Cada oficina le paga un porcentaje de la COMISIÓN que genera. Es una cuenta aparte de la de
// los agentes y conviene no confundirlas nunca:
//
//   a los agentes   un % de la PRIMA vendida, y solo del negocio nuevo
//   a las oficinas  un % de la COMISIÓN generada, y de toda: nueva y renovación
//
// El porcentaje se pone acá mismo y se guarda solo. GELPI INSURANCE CORP es la oficina
// corporativa y no paga: cobrarse a sí mismo inflaría el total con plata que no entra de nadie.

export default function RoyaltyFranquicia({ mes, etiquetaMes }: { mes: Date; etiquetaMes: string }) {
  const periodoUrl = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, "0")}`;
  const [filas, setFilas] = useState<RoyaltyOficina[] | null>(null);
  const [ytd, setYtd] = useState<RoyaltyOficina[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const anio = mes.getFullYear();
      const ultimoDia = new Date(anio, mes.getMonth() + 1, 0).getDate();
      const mm = String(mes.getMonth() + 1).padStart(2, "0");
      const rango = { desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${String(ultimoDia).padStart(2, "0")}` };
      const acumulado = rangoYtd(mes);
      const [m, y] = await Promise.all([
        getRoyaltyPorOficina(rango.desde, rango.hasta),
        getRoyaltyPorOficina(acumulado.desde, acumulado.hasta),
      ]);
      setFilas(m);
      setYtd(y);
    } catch (e) {
      setError(porQue(e));
    }
  }, [mes]);

  useEffect(() => {
    void cargar();
  }, [cargar]);


  const cobrables = (filas ?? []).filter((f) => !f.esCorporativa);
  const totalMes = cobrables.reduce((s, f) => s + f.royalty, 0);
  const totalYtd = (ytd ?? []).filter((f) => !f.esCorporativa).reduce((s, f) => s + f.royalty, 0);
  const faltaPct = cobrables.filter((f) => f.pctRoyalty == null && f.comisionGenerada !== 0).length;

  return (
    <Card>
      <CardHead
        title="Franquicia — lo que te dejan las oficinas"
        subtitle="Un % de la comisión que cobra cada oficina en el mes del statement. No es la cuenta de los agentes: esa va sobre la prima vendida."
      />

      <div className="px-5 pb-5 pt-1">
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">
            <AlertTriangle size={15} className="flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Las dos cifras que se vienen a mirar acá. El year-to-date llega hasta el final del mes
            que se está viendo, no hasta hoy: si se mira marzo, el acumulado es hasta marzo. */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">Royalty de {etiquetaMes}</div>
            <div className="text-[24px] font-semibold tabular-nums text-foreground">{money(totalMes)}</div>
          </div>
          <div className="rounded-xl border border-brand/30 bg-brand-tint px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">
              Year to date · {mes.getFullYear()}
            </div>
            <div className="text-[24px] font-semibold tabular-nums text-brand-dark">{money(totalYtd)}</div>
          </div>
        </div>

        {faltaPct > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-warn-fg/30 bg-warn-bg px-3 py-2 text-[12px] text-warn-fg">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {faltaPct === 1
              ? "Hay 1 oficina generando comisión sin royalty definido; no entra en los totales de arriba."
              : `Hay ${faltaPct} oficinas generando comisión sin royalty definido; no entran en los totales de arriba.`}{" "}
            <Link href="/comisiones/oficinas/" className="font-semibold underline underline-offset-2">
              Ponérselo en Oficinas
            </Link>
          </div>
        )}

        {filas === null ? (
          <div className="py-6 text-center text-[13px] text-muted">Cargando…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="text-left text-muted">
                  <th className="px-3 py-2 font-medium">Oficina</th>
                  <th className="px-3 py-2 font-medium text-right">Comisión que generó</th>
                  <th className="px-3 py-2 font-medium w-28">Royalty %</th>
                  <th className="px-3 py-2 font-medium text-right">Te deja</th>
                  <th className="px-3 py-2 font-medium text-right">De tu total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => {
                  // Cuánto de lo que gana Arturo por franquicia sale de esta oficina.
                  const parte = totalMes > 0 ? (f.royalty / totalMes) * 100 : 0;
                  return (
                    <tr key={f.oficinaId} className="border-t border-border">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ background: COLORES_GRAFICA[i % COLORES_GRAFICA.length] }}
                            aria-hidden
                          />
                          <span className="font-medium text-foreground">{f.oficina}</span>
                          {f.esCorporativa && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-bg px-2 py-0.5 text-[11px] font-medium text-neutral-fg">
                              <Crown size={11} />
                              Corporativa
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {money(f.comisionGenerada)}
                      </td>
                      {/* Solo lectura a propósito. El royalty es un número de contrato que se
                          pacta una vez; tenerlo editable en la pantalla que se mira todos los días
                          es una invitación a moverlo sin querer. Se cambia en Oficinas. */}
                      <td className="px-3 py-2.5 tabular-nums text-muted">
                        {f.esCorporativa ? "—" : f.pctRoyalty == null ? "sin definir" : `${f.pctRoyalty}%`}
                      </td>
                      {/* Sin % definido no se muestra $0.00: eso se leería como "esta oficina no
                          te deja nada" cuando lo que pasa es que falta ponerle el número. */}
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {f.esCorporativa ? (
                          <span className="text-[12px] font-normal text-muted">no paga</span>
                        ) : f.pctRoyalty == null && f.comisionGenerada !== 0 ? (
                          <span className="text-[12px] font-normal text-warn-fg">falta el %</span>
                        ) : (
                          money(f.royalty)
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {f.esCorporativa || f.royalty === 0 ? "—" : `${parte.toFixed(1)}%`}
                      </td>
                      {/* El estado de cuenta se puede sacar aunque falte el %: el desglose por
                          compañía sirve igual, y el royalty saldrá en cero hasta que se defina. */}
                      <td className="px-3 py-2.5 text-right">
                        {f.esCorporativa ? null : (
                          <Link
                            href={`/comisiones/estado-cuenta/?oficina=${f.oficinaId}&mes=${periodoUrl}`}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-brand hover:underline"
                            title={`Estado de cuenta de ${f.oficina} para ${etiquetaMes}`}
                          >
                            <FileText size={13} />
                            Estado de cuenta
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-background/60">
                  <td className="px-3 py-2.5 font-semibold" colSpan={3}>
                    Total de {etiquetaMes}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{money(totalMes)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                    {totalMes > 0 ? "100%" : "—"}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

// Los errores de Supabase no son Error: son objetos con message/hint. Tragarse eso y mostrar
// "no se pudo" deja al usuario sin saber si falta correr el SQL o si es otra cosa.
function porQue(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.hint].filter((x) => typeof x === "string" && x);
    if (partes.length) return partes.join(" — ");
  }
  return "No se pudo cargar el royalty.";
}
