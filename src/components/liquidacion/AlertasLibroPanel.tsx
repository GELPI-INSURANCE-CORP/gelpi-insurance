"use client";

import { useEffect, useState } from "react";
import { SidePanel, Badge, Loading } from "@/components/agentes/ui";
import { money, fecha as fmtFecha } from "@/lib/format";
import { getDetalleAlertaDelLibro, type FilaAlertaLibro } from "@/lib/queries/liquidacion";

// Las pólizas detrás de la alerta roja del pago.
//
// Arturo: *"me estás dando la alerta pero no me estás diciendo dónde tengo que tocar para
// verlas"*. Tenía razón. Una alerta que dice "hay 9 pólizas mal" y no deja ver cuáles no es una
// alerta, es una preocupación.
//
// Para los duplicados las dos mitades del par van juntas, una debajo de la otra, con la que
// tiene la comisión marcada. Así se lee de corrido: ésta es la que vale, ésta es la copia, y
// esto es lo que cada una tiene que la otra no.

const TITULOS: Record<string, { titulo: string; ayuda: string }> = {
  poliza_duplicada_grupo: {
    titulo: "La misma póliza, cargada dos veces",
    ayuda:
      "Kemper compró Infinity, así que la misma póliza llega escrita de dos maneras: como Infinity desde el Book y como Kemper desde el statement. Son una sola. La que tiene la comisión es la que vale; la otra a veces trae la fecha de efectividad que a la primera le falta.",
  },
  poliza_duplicada_cruzada: {
    titulo: "El mismo número en compañías que no tienen nada que ver",
    ayuda:
      "Acá no se puede fusionar a ciegas: pueden ser dos pólizas distintas que comparten número por casualidad. Hay que mirarlas de a una.",
  },
  oficina_cruzada: {
    titulo: "La oficina de la póliza no es la del agente",
    ayuda:
      "Pasa cuando un agente cambia de oficina y sus pólizas viejas se quedan con la anterior. O la póliza ya no es suya, o la oficina quedó vieja — las dos cosas hay que decidirlas a mano, porque de acá sale el royalty.",
  },
  poliza_sin_dueno: {
    titulo: "Pólizas sin agente o sin oficina",
    ayuda: "Una póliza sin agente no se le paga a nadie, y una sin oficina no entra en el royalty de ninguna.",
  },
};

export default function AlertasLibroPanel({ tipo, onClose }: { tipo: string; onClose: () => void }) {
  const [filas, setFilas] = useState<FilaAlertaLibro[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setFilas(null);
    getDetalleAlertaDelLibro(tipo)
      .then((f) => { if (vivo) setFilas(f); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : "No se pudo cargar el detalle."); });
    return () => { vivo = false; };
  }, [tipo]);

  const meta = TITULOS[tipo] ?? { titulo: "Revisar el Book", ayuda: "" };

  // Agrupadas por número de póliza (o por agente, en el caso de la oficina cruzada), para que
  // las dos mitades del par queden pegadas.
  const grupos: { clave: string; filas: FilaAlertaLibro[] }[] = [];
  for (const f of filas ?? []) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === f.clave) ultimo.filas.push(f);
    else grupos.push({ clave: f.clave, filas: [f] });
  }

  function exportar() {
    const header = ["Clave", "Compañía", "Grupo", "Origen", "Cliente", "Ramo", "Vigencia", "Prima", "Líneas", "Comisión", "Agente", "Oficina", "Se queda"];
    const cuerpo = (filas ?? []).map((f) =>
      [f.clave, f.compania, f.grupo, f.origen, f.cliente, f.ramo, f.fechaVigencia ?? "", f.prima ?? "",
       f.lineas, f.comision.toFixed(2), f.agente, f.oficina, f.seQueda === true ? "Sí" : f.seQueda === false ? "No" : ""]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header.join(","), ...cuerpo].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `revisar-book-${tipo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SidePanel open onClose={onClose} title={meta.titulo} subtitle="Lo que hay que revisar en el Book" width="1100px">
      {error && <div className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">{error}</div>}
      {!error && filas === null && <Loading />}
      {filas !== null && (
        <div className="flex flex-col gap-4">
          {meta.ayuda && (
            <p className="rounded-xl border border-border bg-background/50 px-4 py-3 text-[12px] leading-relaxed text-muted">
              {meta.ayuda}
            </p>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-[13px] text-muted">
              {grupos.length} caso{grupos.length === 1 ? "" : "s"} · {filas.length} fila
              {filas.length === 1 ? "" : "s"} en el Book
            </div>
            <button
              type="button"
              onClick={exportar}
              disabled={filas.length === 0}
              className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium hover:bg-background disabled:opacity-40"
            >
              Exportar a CSV
            </button>
          </div>

          {grupos.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted">No hay nada que revisar acá.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {grupos.map((g) => (
                <div key={g.clave} className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-background/60 px-4 py-2 text-[13px] font-medium tabular-nums">
                    {g.clave}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-[12.5px]">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="px-3 py-1.5 font-medium">Compañía</th>
                          <th className="px-3 py-1.5 font-medium">Vino de</th>
                          <th className="px-3 py-1.5 font-medium">Cliente</th>
                          <th className="px-3 py-1.5 font-medium">Ramo</th>
                          <th className="px-3 py-1.5 font-medium">Vigencia</th>
                          <th className="px-3 py-1.5 font-medium text-right">Prima</th>
                          <th className="px-3 py-1.5 font-medium text-right">Comisión</th>
                          <th className="px-3 py-1.5 font-medium">Agente</th>
                          <th className="px-3 py-1.5 font-medium">Oficina</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.filas.map((f) => (
                          <tr
                            key={f.polizaId}
                            className={f.seQueda === false ? "border-t border-border text-muted" : "border-t border-border"}
                          >
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                {f.compania}
                                {/* Marcar cuál se queda es lo que convierte la lista en algo
                                    accionable: sin eso hay que contar líneas de comisión a ojo
                                    para saber cuál de las dos es la buena. */}
                                {f.seQueda === true && <Badge tone="ok">se queda</Badge>}
                                {f.seQueda === false && <Badge tone="neutral">es la copia</Badge>}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted">
                              {f.origen === "import" ? "el Book" : f.origen === "alta_manual" ? "carga a mano" : f.origen}
                            </td>
                            <td className="px-3 py-2">{f.cliente}</td>
                            <td className="px-3 py-2 text-muted">{f.ramo}</td>
                            <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                              {f.fechaVigencia ? (
                                fmtFecha(f.fechaVigencia)
                              ) : (
                                <span className="text-warn-fg">sin fecha</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {f.prima == null ? "—" : money(f.prima)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {f.lineas === 0 ? (
                                <span className="text-muted">sin líneas</span>
                              ) : (
                                <>
                                  {money(f.comision)}{" "}
                                  <span className="text-[11px] text-muted">
                                    ({f.lineas} lín.)
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted">{f.agente}</td>
                            <td className="px-3 py-2 text-muted">{f.oficina}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}
