"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, RotateCcw, Sparkles } from "lucide-react";
import { Card, CardHead, Button, Badge, Chip, Loading, EmptyState } from "@/components/agentes/ui";
import { money, fecha as fmtFecha } from "@/lib/format";
import {
  getLineasSinClasificar,
  clasificarNegocio,
  desclasificarNegocio,
  type LineaSinClasificar,
} from "@/lib/queries/conciliacion";

// Las líneas que el archivo no dice si son negocio nuevo o renovación.
//
// A los agentes se les paga solo el negocio nuevo, así que cada una de estas es plata parada: no
// se paga y nadie sabe si se debería. Casi todas son cancelaciones y endosos — movimientos que
// por sí solos no dicen a qué término pertenecen.
//
// Para la mayoría el sistema ya sabe la respuesta y no la había usado: la misma póliza aparece
// clasificada en OTRO statement. Eso se muestra como sugerencia y se acepta en bloque. Lo que
// queda sin evidencia se decide a mano.
//
// Lo que se decide se guarda contra la PÓLIZA, no contra la línea, así que reprocesar el reporte
// no lo borra — y alcanza también a las hermanas de esa misma póliza.

type Filtro = "todas" | "sugeridas" | "a_mano";

export default function SinClasificarPanel({ onCount }: { onCount?: (n: number) => void }) {
  const [lineas, setLineas] = useState<LineaSinClasificar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const l = await getLineasSinClasificar();
      setLineas(l);
      setSel(new Set());
      onCount?.(l.length);
    } catch (e) {
      setError(porQue(e, "No se pudo cargar la lista."));
    }
  }, [onCount]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const l = lineas ?? [];
    if (filtro === "sugeridas") return l.filter((x) => x.sugerencia !== null);
    if (filtro === "a_mano") return l.filter((x) => x.sugerencia === null);
    return l;
  }, [lineas, filtro]);

  const conSugerencia = (lineas ?? []).filter((l) => l.sugerencia !== null);
  const totalComision = (lineas ?? []).reduce((s, l) => s + l.comision, 0);
  const comisionSugerida = conSugerencia.reduce((s, l) => s + l.comision, 0);

  async function guardar(fn: () => Promise<string>) {
    setGuardando(true);
    setAviso(null);
    try {
      setAviso(await fn());
      await cargar();
    } catch (e) {
      setError(porQue(e, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  // Aceptar todas las sugerencias son dos llamadas, no una: las que el sistema dice que son
  // nuevas y las que dice que son renovación se guardan con valores distintos.
  function aceptarSugerencias() {
    const nuevas = conSugerencia.filter((l) => l.sugerencia === true).map((l) => l.id);
    const renov = conSugerencia.filter((l) => l.sugerencia === false).map((l) => l.id);
    void guardar(async () => {
      let pol = 0;
      let alc = 0;
      let sinPol = 0;
      if (nuevas.length) {
        const r = await clasificarNegocio(nuevas, true, "Sugerencia del sistema aceptada en bloque");
        pol += r.polizasGuardadas; alc += r.lineasAlcanzadas; sinPol += r.lineasSinPoliza;
      }
      if (renov.length) {
        const r = await clasificarNegocio(renov, false, "Sugerencia del sistema aceptada en bloque");
        pol += r.polizasGuardadas; alc += r.lineasAlcanzadas; sinPol += r.lineasSinPoliza;
      }
      return textoResultado(pol, alc, sinPol);
    });
  }

  function marcar(valor: boolean) {
    const ids = [...sel];
    void guardar(async () => {
      const r = await clasificarNegocio(ids, valor, null);
      return textoResultado(r.polizasGuardadas, r.lineasAlcanzadas, r.lineasSinPoliza);
    });
  }

  function deshacer() {
    const ids = [...sel];
    void guardar(async () => {
      const n = await desclasificarNegocio(ids);
      return `Se deshicieron ${n} decisión${n === 1 ? "" : "es"}.`;
    });
  }

  function exportar() {
    const header = ["Fecha", "Compañía", "Statement", "Póliza", "Cliente", "Tipo", "Agente", "Prima", "Comisión", "Sugerencia", "Por qué"];
    const filas = visibles.map((l) =>
      [l.fecha ?? "", l.compania, l.periodo, l.numeroPoliza, l.cliente, l.tipo, l.agente,
       l.prima ?? "", l.comision.toFixed(2),
       l.sugerencia === true ? "Negocio nuevo" : l.sugerencia === false ? "Renovación" : "—", l.motivo]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "sin-clasificar.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggle(id: string) {
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const todasVisiblesSel = visibles.length > 0 && visibles.every((l) => sel.has(l.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CardHead
          title="Sin clasificar: ni negocio nuevo ni renovación"
          actions={
            <>
              <span className="text-xs text-muted">{sel.size} seleccionadas</span>
              <Button variant="secondary" size="sm" disabled={sel.size === 0 || guardando} onClick={() => marcar(true)}>
                Es negocio nuevo
              </Button>
              <Button variant="secondary" size="sm" disabled={sel.size === 0 || guardando} onClick={() => marcar(false)}>
                Es renovación
              </Button>
              <Button variant="ghost" size="sm" disabled={sel.size === 0 || guardando} onClick={deshacer}>
                <RotateCcw size={14} />
                Deshacer
              </Button>
              <Button variant="ghost" size="sm" onClick={exportar} disabled={visibles.length === 0}>
                <Download size={14} />
                Exportar
              </Button>
            </>
          }
        />

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">
            <AlertTriangle size={15} className="flex-shrink-0" />
            {error}
          </div>
        )}
        {aviso && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-ok-fg/30 bg-ok-bg px-3 py-2 text-[13px] text-ok-fg">
            <Check size={15} className="flex-shrink-0" />
            {aviso}
          </div>
        )}

        {/* Con error y sin datos no va ni el spinner ni la tabla: el aviso de arriba ya lo dice. */}
        {lineas === null ? (
          error ? null : <Loading />
        ) : lineas.length === 0 ? (
          <EmptyState
            title="No queda nada sin clasificar"
            subtitle="Todas las líneas conciliadas están puestas como negocio nuevo o como renovación."
          />
        ) : (
          <>
            {/* Lo primero es cuánta plata hay parada y cuánta de esa el sistema ya sabe resolver. */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
              <div className="text-[13px]">
                <span className="font-semibold tabular-nums">{money(totalComision)}</span>
                <span className="text-muted"> en {lineas.length} línea{lineas.length === 1 ? "" : "s"} que hoy no se le pagan a nadie</span>
              </div>
              {conSugerencia.length > 0 && (
                <Button size="sm" onClick={aceptarSugerencias} disabled={guardando}>
                  <Sparkles size={14} />
                  Aceptar las {conSugerencia.length} que el sistema ya sabe ({money(comisionSugerida)})
                </Button>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Chip active={filtro === "todas"} onClick={() => setFiltro("todas")}>
                Todas {lineas.length}
              </Chip>
              <Chip active={filtro === "sugeridas"} onClick={() => setFiltro("sugeridas")}>
                El sistema ya sabe {conSugerencia.length}
              </Chip>
              <Chip active={filtro === "a_mano"} onClick={() => setFiltro("a_mano")}>
                Hay que mirarlas {lineas.length - conSugerencia.length}
              </Chip>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1040px] text-[13px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-left text-muted">
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={todasVisiblesSel}
                        onChange={() =>
                          setSel(todasVisiblesSel ? new Set() : new Set(visibles.map((l) => l.id)))
                        }
                        aria-label="Seleccionar todas las visibles"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Compañía</th>
                    <th className="px-3 py-2 font-medium">Póliza</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Agente</th>
                    <th className="px-3 py-2 font-medium text-right">Prima</th>
                    <th className="px-3 py-2 font-medium text-right">Comisión</th>
                    <th className="px-3 py-2 font-medium">Qué dice la misma póliza</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((l) => (
                    <tr key={l.id} className="border-t border-border hover:bg-background">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={sel.has(l.id)}
                          onChange={() => toggle(l.id)}
                          aria-label={`Seleccionar ${l.numeroPoliza}`}
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.fecha ? fmtFecha(l.fecha) : "—"}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{l.compania}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.numeroPoliza}</td>
                      <td className="px-3 py-2">{l.cliente}</td>
                      <td className="px-3 py-2"><Badge tone="neutral">{l.tipo}</Badge></td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{l.agente}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">
                        {l.prima == null ? "—" : money(l.prima)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(l.comision)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {l.sugerencia === true && <Badge tone="ok">Negocio nuevo</Badge>}
                          {l.sugerencia === false && <Badge tone="neutral">Renovación</Badge>}
                          <span className="text-xs text-muted">{l.motivo}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// Se guarda por póliza, así que marcar 10 líneas puede resolver 30: las otras 20 son hermanas de
// las mismas pólizas. Decirlo evita que el número de la pantalla parezca un error.
function textoResultado(polizas: number, lineas: number, sinPoliza: number): string {
  const base = `Guardado: ${polizas} póliza${polizas === 1 ? "" : "s"}, que cubre${polizas === 1 ? "" : "n"} ${lineas} línea${lineas === 1 ? "" : "s"}.`;
  if (sinPoliza > 0) {
    return `${base} ${sinPoliza} línea${sinPoliza === 1 ? " no se pudo guardar porque no trae" : "s no se pudieron guardar porque no traen"} número de póliza.`;
  }
  return base;
}

// Los errores de Supabase no son Error: son objetos con message/hint/details. Tragarse eso y
// mostrar "no se pudo" deja al usuario sin saber si falta correr el SQL o si es otra cosa.
function porQue(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.hint].filter((x) => typeof x === "string" && x);
    if (partes.length) return partes.join(" — ");
  }
  return fallback;
}
