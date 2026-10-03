"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { Card, Select, Chip, Badge, Loading, EmptyState, Button } from "@/components/agentes/ui";
import { money, fecha as fmtFecha } from "@/lib/format";
import { getCruce, type FilaCruce, type EstadoCruce } from "@/lib/queries/cruce";

// Lo que se vendió contra lo que pagaron, en las dos direcciones.
//
// El caso que la justifica: en agosto, el reporte de ventas de Nadira decía 59 pólizas por
// $87.222,06 y los statements $79.684,08. La diferencia no era un error — eran tres cosas
// distintas mezcladas, y una de ellas sí importaba: tres pólizas comerciales por $6.432,48 que
// ninguna compañía pagó nunca, porque de esas aseguradoras no se sube statement.
//
// Esa es la columna que esta pantalla existe para mostrar: vendido y sin cobrar.

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function etiquetaPeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  const nombre = MESES[mes - 1] ?? periodo;
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

function periodosDisponibles(): string[] {
  const out: string[] = [];
  const hoy = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const CAJAS: { estado: EstadoCruce; titulo: string; detalle: string; alerta?: boolean }[] = [
  {
    estado: "solo_venta",
    titulo: "Vendido y sin cobrar",
    detalle: "ninguna compañía pagó comisión",
    alerta: true,
  },
  { estado: "en_ambos", titulo: "Vendido y cobrado", detalle: "está en los dos lados" },
  {
    estado: "solo_statement",
    titulo: "Cobrado y no está en ventas",
    detalle: "de un mes anterior, o falta cargarlo",
  },
];

export default function CrucePage() {
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [filas, setFilas] = useState<FilaCruce[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foco, setFoco] = useState<EstadoCruce | "todas">("solo_venta");
  const [agente, setAgente] = useState("");

  const cargar = useCallback(async () => {
    setFilas(null);
    setError(null);
    try {
      setFilas(await getCruce(periodo));
    } catch (e) {
      setError(porQue(e, "No se pudo cargar el cruce."));
    }
  }, [periodo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const agentes = useMemo(
    () => [...new Set((filas ?? []).map((f) => f.agente))].sort(),
    [filas]
  );

  const visibles = useMemo(() => {
    let l = filas ?? [];
    if (agente) l = l.filter((f) => f.agente === agente);
    if (foco !== "todas") l = l.filter((f) => f.estado === foco);
    return l;
  }, [filas, foco, agente]);

  // Los totales se calculan sobre el filtro de agente pero no sobre el de estado: las cajas son
  // el filtro, así que tienen que seguir mostrando su propio total aunque no estén activas.
  const delAgente = useMemo(
    () => (agente ? (filas ?? []).filter((f) => f.agente === agente) : filas ?? []),
    [filas, agente]
  );

  function totalDe(estado: EstadoCruce) {
    const l = delAgente.filter((f) => f.estado === estado);
    return {
      n: l.length,
      vendida: l.reduce((s, f) => s + f.primaVendida, 0),
      cobrada: l.reduce((s, f) => s + f.primaCobrada, 0),
      comision: l.reduce((s, f) => s + f.comision, 0),
    };
  }

  function exportar() {
    const header = ["Estado", "Cliente", "Agente", "Oficina", "Ramo", "Compañías", "Fecha de venta", "Prima vendida", "Prima cobrada", "Comisión", "Pólizas"];
    const cuerpo = visibles.map((f) =>
      [f.estado, f.cliente, f.agente, f.oficina, f.ramo, f.companias, f.fechaVenta ?? "",
       f.primaVendida.toFixed(2), f.primaCobrada.toFixed(2), f.comision.toFixed(2), f.polizas]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header.join(","), ...cuerpo].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cruce-ventas-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sinVentas = (filas ?? []).every((f) => f.estado === "solo_statement");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/comisiones/liquidacion/"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] hover:bg-background"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Volver al pago
          </Link>
          <h1 className="text-[17px] font-semibold">Lo que se vendió contra lo que pagaron</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={periodo}
            onChange={(v) => setPeriodo(v)}
            options={periodosDisponibles().map((p) => ({ value: p, label: etiquetaPeriodo(p) }))}
          />
          <Button size="md" onClick={exportar} disabled={visibles.length === 0}>
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-info-fg/20 bg-info-bg px-4 py-3 text-[12.5px] leading-relaxed">
        Compara el <strong>reporte de ventas</strong> que subís (el export de QQ, como tipo
        &quot;Reporte de ventas interno&quot; en Comisiones) contra lo que las compañías
        <strong> pagaron como negocio nuevo</strong> ese mismo mes. Empareja por el nombre del
        cliente, porque el export de ventas no trae número de póliza.
      </div>

      {error && <div className="rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">{error}</div>}

      {filas !== null && sinVentas && filas.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warn-fg/30 bg-warn-bg px-4 py-3 text-[12.5px] leading-relaxed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-fg" />
          <span>
            No hay ningún reporte de ventas cargado para {etiquetaPeriodo(periodo)}, así que sólo
            se ve el lado de los statements. Subí el export de QQ desde{" "}
            <Link href="/comisiones/subir/" className="underline">Comisiones</Link>, eligiendo el
            tipo <strong>Reporte de ventas interno</strong>, y volvé acá.
          </span>
        </div>
      )}

      {filas !== null && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CAJAS.map((c) => {
              const t = totalDe(c.estado);
              const activa = foco === c.estado;
              return (
                <button
                  key={c.estado}
                  type="button"
                  onClick={() => setFoco(activa ? "todas" : c.estado)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors hover:bg-background ${
                    activa ? "border-brand ring-1 ring-brand" : c.alerta && t.n > 0 ? "border-warn-fg/30 bg-warn-bg" : "border-border"
                  }`}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted">{c.titulo}</div>
                  <div className="text-[20px] font-semibold tabular-nums">
                    {money(c.estado === "solo_statement" ? t.cobrada : t.vendida)}
                  </div>
                  <div className="text-[11px] text-muted">
                    {t.n} cliente{t.n === 1 ? "" : "s"} · {c.detalle}
                  </div>
                  {c.estado === "en_ambos" && (
                    <div className="text-[11px] text-muted">cobrado {money(t.cobrada)}</div>
                  )}
                  {c.estado === "solo_statement" && (
                    <div className="text-[11px] text-muted">comisión {money(t.comision)}</div>
                  )}
                </button>
              );
            })}
          </div>

          {agentes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] text-muted">Agente:</span>
              <Chip active={agente === ""} onClick={() => setAgente("")}>Todos</Chip>
              {agentes.map((a) => (
                <Chip key={a} active={agente === a} onClick={() => setAgente(a)}>{a}</Chip>
              ))}
            </div>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-background/60 text-left text-muted">
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Agente</th>
                    <th className="px-3 py-2 font-medium">Ramo</th>
                    <th className="px-3 py-2 font-medium">Vendida</th>
                    <th className="px-3 py-2 font-medium">Quién pagó</th>
                    <th className="px-3 py-2 text-right font-medium">Prima vendida</th>
                    <th className="px-3 py-2 text-right font-medium">Prima cobrada</th>
                    <th className="px-3 py-2 text-right font-medium">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f, i) => (
                    <tr key={`${f.cliente}-${f.agente}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {f.cliente}
                          {f.estado === "solo_venta" && <Badge tone="warn">sin cobrar</Badge>}
                          {f.estado === "solo_statement" && <Badge tone="neutral">no está en ventas</Badge>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{f.agente}</td>
                      <td className="px-3 py-2 text-muted">{f.ramo}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap text-muted">
                        {f.fechaVenta ? fmtFecha(f.fechaVenta) : "—"}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted">{f.companias}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.primaVendida === 0 ? <span className="text-muted">—</span> : money(f.primaVendida)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.primaCobrada === 0 ? <span className="text-muted">—</span> : money(f.primaCobrada)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {f.comision === 0 ? <span className="text-muted">—</span> : money(f.comision)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibles.length === 0 && (
              <EmptyState
                title="Nada en esta caja"
                subtitle={`No hay clientes en esa situación para ${etiquetaPeriodo(periodo)}.`}
              />
            )}
          </Card>
        </>
      )}

      {filas === null && !error && <Loading />}
    </div>
  );
}

// Los errores de Supabase son objetos planos con message/hint/details, no instancias de Error.
function porQue(e: unknown, generico: string): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; hint?: string; details?: string };
    const partes = [o.message, o.details, o.hint].filter(Boolean);
    if (partes.length) return partes.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return generico;
}
