"use client";
import Link from "next/link";

import { useEffect, useState } from "react";
import { Download, RefreshCw, ExternalLink, Pencil } from "lucide-react";
import {
  Card,
  Kpi,
  Button,
  Avatar,
  initials,
  Tabs,
  Badge,
  Input,
  Select,
  Pagination,
  Loading,
  EmptyState,
  Modal,
  Field,
  TextInput,
} from "./ui";
import { money, fecha, pct } from "@/lib/format";
import type { AgenteRow } from "@/lib/queries/agentes";
import {
  getAgenteKpis,
  listLineasComisionAgente,
  getLineaAuditoria,
  reasignarLinea,
  listBonoRepartoAgente,
  listExcepcionesAgente,
  listAseguradorasSimple,
  listAgentesSimple,
  type FiltrosComisiones,
} from "@/lib/queries/agentes";

const TIPOS_TRANSACCION: Record<string, string> = {
  nueva: "Nueva",
  renovacion: "Renovación",
  endoso: "Endoso",
  cancelacion: "Chargeback (cancel.)",
  ajuste: "Ajuste",
  otro: "Otro",
};

const ESTADO_TONE: Record<string, "ok" | "brand"> = {
  conciliado_auto: "ok",
  conciliado_confirmado: "ok",
  cuenta_casa: "brand",
};

interface LineaComision {
  id: string;
  aseguradora: string | null;
  poliza_abb: string | null;
  numero_poliza_crudo: string | null;
  cliente: string | null;
  tipo_transaccion: string;
  fecha_statement: string | null;
  prima: number | null;
  tasa: number | null;
  monto: number;
  estado: string;
  regla_match: string | null;
  score: number | null;
  productor_crudo: string | null;
}

export default function AgenteFicha({
  agente,
  onIrExcepciones,
  onEditar,
}: {
  agente: AgenteRow;
  onIrExcepciones: () => void;
  onEditar?: () => void;
}) {
  const [kpis, setKpis] = useState<{
    comisionMes: number;
    comisionYtd: number;
    bonosYtd: number;
    polizasActivas: number;
    excepcionesAbiertas: number;
  } | null>(null);
  const [tab, setTab] = useState<"comisiones" | "bonos" | "excepciones">("comisiones");
  const [totalComisiones, setTotalComisiones] = useState(0);
  const [totalExcepciones, setTotalExcepciones] = useState(0);
  const [totalBonos, setTotalBonos] = useState(0);

  useEffect(() => {
    let alive = true;
    getAgenteKpis(agente.id).then((k) => alive && setKpis(k));
    return () => {
      alive = false;
    };
  }, [agente.id]);

  return (
    <div className="flex flex-col gap-5 min-h-0 overflow-hidden">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3.5">
          <Avatar initials={initials(agente.nombre)} size={56} soft />
          <div className="flex flex-col gap-0.5">
            <div className="text-lg font-semibold text-foreground">{agente.nombre}</div>
            <div className="text-[13px] text-muted">{agente.oficina?.nombre ?? "Sin oficina"}</div>
            <div className="text-xs text-neutral-fg">
              Código interno: {agente.codigo ?? "—"} &nbsp;·&nbsp; NPN: {agente.npn ?? "—"} &nbsp;·&nbsp; Activo desde: {fecha(agente.fecha_alta)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {onEditar && (
            <Button size="sm" variant="secondary" onClick={onEditar}>
              <Pencil className="w-3.5 h-3.5" />
              Editar
            </Button>
          )}
          <ExportarEstadoCuenta agenteId={agente.id} agenteNombre={agente.nombre} />
          <Button size="sm" onClick={onIrExcepciones} disabled={!kpis || kpis.excepcionesAbiertas === 0}>
            <ExternalLink className="w-3.5 h-3.5" />
            Ir a excepciones ({kpis?.excepcionesAbiertas ?? 0})
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Comisión del mes" value={kpis ? money(kpis.comisionMes) : "…"} />
        <Kpi label="Comisión YTD" value={kpis ? money(kpis.comisionYtd) : "…"} />
        <Kpi label="Bonos YTD" value={kpis ? money(kpis.bonosYtd) : "…"} sub="Separado de la comisión" tone="muted" />
        <Kpi label="Pólizas activas (ABB)" value={kpis ? String(kpis.polizasActivas) : "…"} />
        <Kpi
          label="Excepciones abiertas"
          value={kpis ? String(kpis.excepcionesAbiertas) : "…"}
          sub={kpis ? (kpis.excepcionesAbiertas === 0 ? "Al día" : "Requieren atención") : undefined}
          tone={kpis?.excepcionesAbiertas ? "warn" : "ok"}
        />
      </div>

      <Card className="flex flex-col min-h-0 overflow-hidden">
        <Tabs
          active={tab}
          onChange={(k) => setTab(k as typeof tab)}
          tabs={[
            { key: "comisiones", label: "Comisiones", count: totalComisiones },
            { key: "bonos", label: "Bonos", count: totalBonos },
            { key: "excepciones", label: "Excepciones vinculadas", count: totalExcepciones, tone: totalExcepciones > 0 ? "warn" : undefined },
          ]}
        />
        {tab === "comisiones" && <TabComisiones agente={agente} onTotal={setTotalComisiones} />}
        {tab === "bonos" && <TabBonos agenteId={agente.id} onTotal={setTotalBonos} />}
        {tab === "excepciones" && <TabExcepciones agenteId={agente.id} onTotal={setTotalExcepciones} />}
      </Card>
    </div>
  );
}

function ExportarEstadoCuenta({ agenteId, agenteNombre }: { agenteId: string; agenteNombre: string }) {
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportar() {
    setExportando(true);
    setError(null);
    try {
      // PostgREST recorta cada respuesta a max_rows=1000 (supabase/config.toml) sin avisar,
      // así que paginamos en bloques de 1000 hasta cubrir el total real del agente.
      const pageSize = 1000;
      let rows: LineaComision[] = [];
      let page = 1;
      let total = Infinity;
      while (rows.length < total) {
        const res = await listLineasComisionAgente(agenteId, {}, page, pageSize);
        total = res.total;
        rows = rows.concat(res.rows as LineaComision[]);
        if (res.rows.length === 0) break;
        page += 1;
      }
      const header = ["Aseguradora", "N° póliza", "Cliente", "Tipo", "Fecha statement", "Prima", "Tasa", "Comisión", "Estado"];
      const csv = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.aseguradora ?? "",
            r.poliza_abb ?? r.numero_poliza_crudo ?? "",
            r.cliente ?? "",
            TIPOS_TRANSACCION[r.tipo_transaccion] ?? r.tipo_transaccion,
            r.fecha_statement ?? "",
            r.prima ?? "",
            r.tasa ?? "",
            r.monto,
            r.estado,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estado-cuenta-${agenteNombre.replace(/\s+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo exportar el estado de cuenta.");
    } finally {
      setExportando(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={exportar} disabled={exportando}>
        <Download className="w-3.5 h-3.5" />
        {exportando ? "Exportando…" : "Exportar estado de cuenta (CSV)"}
      </Button>
      {error && <p className="text-xs text-bad-fg">{error}</p>}
    </div>
  );
}

function TabComisiones({ agente, onTotal }: { agente: AgenteRow; onTotal: (n: number) => void }) {
  const [filtros, setFiltros] = useState<FiltrosComisiones>({});
  const [buscar, setBuscar] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LineaComision[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aseguradoras, setAseguradoras] = useState<{ id: string; nombre: string }[]>([]);
  const [porque, setPorque] = useState<LineaComision | null>(null);
  const [reasignando, setReasignando] = useState<LineaComision | null>(null);
  const [historialOpen, setHistorialOpen] = useState(false);

  useEffect(() => {
    listAseguradorasSimple().then(setAseguradoras);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFiltros((f) => ({ ...f, buscar })), 300);
    return () => clearTimeout(t);
  }, [buscar]);

  useEffect(() => {
    setPage(1);
  }, [filtros]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listLineasComisionAgente(agente.id, filtros, page, 25)
      .then(({ rows, total }) => {
        if (!alive) return;
        setRows(rows as LineaComision[]);
        setTotal(total);
        onTotal(total);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agente.id, filtros, page]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
        <Select
          value={filtros.aseguradoraId ?? ""}
          onChange={(v) => setFiltros((f) => ({ ...f, aseguradoraId: v || undefined }))}
          options={[{ value: "", label: "Aseguradora: Todas" }, ...aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]}
        />
        <input
          type="date"
          value={filtros.desde ?? ""}
          onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value || undefined }))}
          className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground"
        />
        <input
          type="date"
          value={filtros.hasta ?? ""}
          onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value || undefined }))}
          className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground"
        />
        <Select
          value={filtros.tipoTransaccion ?? ""}
          onChange={(v) => setFiltros((f) => ({ ...f, tipoTransaccion: v || undefined }))}
          options={[{ value: "", label: "Tipo: Todas" }, ...Object.entries(TIPOS_TRANSACCION).map(([value, label]) => ({ value, label }))]}
        />
        <Input value={buscar} onChange={setBuscar} placeholder="Buscar por póliza o cliente…" className="ml-auto w-56" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted bg-background/60">
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">Aseguradora</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">N° póliza</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cliente</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">Tipo</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">F. statement</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Prima</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Tasa</th>
              <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Comisión</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">Estado</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-middle">
                <td className="px-4 py-2.5 font-medium">{r.aseguradora}</td>
                <td className="px-4 py-2.5 text-muted whitespace-nowrap">{r.poliza_abb ?? r.numero_poliza_crudo}</td>
                <td className="px-4 py-2.5">{r.cliente}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={r.tipo_transaccion === "cancelacion" ? "bad" : r.tipo_transaccion === "nueva" ? "info" : "neutral"}>
                    {TIPOS_TRANSACCION[r.tipo_transaccion] ?? r.tipo_transaccion}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-muted whitespace-nowrap">{fecha(r.fecha_statement)}</td>
                <td className={"px-4 py-2.5 text-right tabular-nums " + (r.monto < 0 ? "text-bad-fg" : "")}>{money(r.prima)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.tasa != null ? pct(r.tasa) : "—"}</td>
                <td className={"px-4 py-2.5 text-right tabular-nums font-medium " + (r.monto < 0 ? "text-bad-fg" : "")}>{money(r.monto)}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={ESTADO_TONE[r.estado] ?? "neutral"}>{r.estado === "cuenta_casa" ? "Cuenta de la casa" : r.estado === "conciliado_auto" ? "Conciliado automático" : "Conciliado (confirmado)"}</Badge>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setPorque(r)} className="text-brand text-xs hover:underline">
                      Ver por qué
                    </button>
                    <button onClick={() => setReasignando(r)} className="text-brand text-xs hover:underline">
                      Reasignar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <Loading />}
        {!loading && rows.length === 0 && <EmptyState title="Sin líneas de comisión" subtitle="Este agente no tiene comisiones conciliadas con estos filtros." />}
      </div>

      <Pagination page={page} pageSize={25} total={total} onChange={setPage} />

      <div className="p-4 border-t border-border">
        <Button variant="secondary" onClick={() => setHistorialOpen(true)}>
          Ver historial completo de comisiones
        </Button>
      </div>

      {porque && <VerPorQueModal linea={porque} onClose={() => setPorque(null)} />}
      {reasignando && (
        <ReasignarModal
          linea={reasignando}
          onClose={() => setReasignando(null)}
          onDone={() => {
            setReasignando(null);
            setFiltros((f) => ({ ...f }));
          }}
        />
      )}
      {historialOpen && <HistorialCompletoModal onClose={() => setHistorialOpen(false)} agenteInicial={agente} />}
    </div>
  );
}

function VerPorQueModal({ linea, onClose }: { linea: LineaComision; onClose: () => void }) {
  const [auditoria, setAuditoria] = useState<{ accion: string; motivo: string | null; created_at: string; usuario: string | null } | null>(null);
  useEffect(() => {
    getLineaAuditoria(linea.id).then((a) => setAuditoria(a as typeof auditoria));
  }, [linea.id]);
  return (
    <Modal open onClose={onClose} title="Por qué se atribuyó esta línea">
      <div className="flex flex-col gap-3 text-[13px]">
        <Row label="Regla de match" value={linea.regla_match ?? "—"} />
        <Row label="Score" value={linea.score != null ? `${linea.score}%` : "—"} />
        <Row label="Productor del reporte (crudo)" value={linea.productor_crudo ?? "—"} />
        <div className="border-t border-border pt-3 mt-1">
          <div className="text-xs font-medium text-muted mb-1.5">Última entrada de auditoría</div>
          {auditoria ? (
            <div className="bg-background rounded-lg p-3 text-xs flex flex-col gap-1">
              <div>
                <span className="font-medium">{auditoria.accion}</span> · {fecha(auditoria.created_at)}
              </div>
              {auditoria.motivo && <div className="text-muted">Motivo: {auditoria.motivo}</div>}
            </div>
          ) : (
            <div className="text-xs text-muted">Sin entradas de auditoría para esta línea.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}

function ReasignarModal({ linea, onClose, onDone }: { linea: LineaComision; onClose: () => void; onDone: () => void }) {
  const [agentes, setAgentes] = useState<{ id: string; nombre: string }[]>([]);
  const [agenteId, setAgenteId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgentesSimple().then((a) => setAgentes(a.filter((x) => !x.es_casa)));
  }, []);

  async function submit() {
    if (!agenteId || !motivo.trim()) {
      setError("Elegí un agente y escribí el motivo.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await reasignarLinea(linea.id, agenteId, motivo.trim());
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reasignar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Reasignar a otro agente">
      <div className="flex flex-col gap-4">
        <Field label="Nuevo agente">
          <Select
            value={agenteId}
            onChange={setAgenteId}
            options={[{ value: "", label: "Seleccionar…" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
        </Field>
        <Field label="Motivo (obligatorio)">
          <TextInput value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se reasigna esta línea…" />
        </Field>
        {error && <p className="text-xs text-bad-fg">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Guardando…" : "Reasignar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TabBonos({ agenteId, onTotal }: { agenteId: string; onTotal: (n: number) => void }) {
  type Reparto = { id: string; monto: number; motivo: string | null; pagado: boolean; bonos: { nombre: string | null; tipo: string; periodo: string | null; estado: string } | null };
  const [rows, setRows] = useState<Reparto[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    listBonoRepartoAgente(agenteId)
      .then((r) => {
        if (!alive) return;
        setRows(r as unknown as Reparto[]);
        onTotal(r.length);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenteId]);

  if (loading) return <Loading />;
  if (rows.length === 0) return <EmptyState title="Sin bonos" subtitle="Este agente no tiene bonos repartidos." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-muted bg-background/60">
            <th className="px-4 py-2.5 font-medium">Bono</th>
            <th className="px-4 py-2.5 font-medium">Período</th>
            <th className="px-4 py-2.5 font-medium text-right">Monto</th>
            <th className="px-4 py-2.5 font-medium">Motivo</th>
            <th className="px-4 py-2.5 font-medium">Pagado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-2.5 font-medium">{r.bonos?.nombre ?? r.bonos?.tipo}</td>
              <td className="px-4 py-2.5">{r.bonos?.periodo ?? "—"}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(r.monto)}</td>
              <td className="px-4 py-2.5 text-muted">{r.motivo ?? "—"}</td>
              <td className="px-4 py-2.5">
                <Badge tone={r.pagado ? "ok" : "warn"}>{r.pagado ? "Pagado" : "Pendiente"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabExcepciones({ agenteId, onTotal }: { agenteId: string; onTotal: (n: number) => void }) {
  type Excepcion = { id: string; tipo: string; explicacion: string | null; created_at: string; atrasada: boolean };
  const [rows, setRows] = useState<Excepcion[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    listExcepcionesAgente(agenteId)
      .then((r) => {
        if (!alive) return;
        setRows(r as unknown as Excepcion[]);
        onTotal(r.length);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenteId]);

  if (loading) return <Loading />;
  if (rows.length === 0) return <EmptyState title="Sin excepciones vinculadas" subtitle="Este agente no tiene excepciones pendientes." />;

  return (
    <div className="flex flex-col divide-y divide-border">
      {rows.map((e) => (
        <div key={e.id} className="p-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={e.tipo === "mismatch" ? "warn" : e.tipo === "duplicado" ? "neutral" : "bad"}>{e.tipo}</Badge>
              {e.atrasada && <Badge tone="bad">Atrasada</Badge>}
            </div>
            <div className="text-xs text-muted mt-1 max-w-lg">{e.explicacion}</div>
          </div>
          <Link href={`/comisiones/conciliacion/?excepcion=${e.id}`} className="text-brand text-xs hover:underline shrink-0">
            Ver en Conciliación
          </Link>
        </div>
      ))}
    </div>
  );
}

function HistorialCompletoModal({ onClose, agenteInicial }: { onClose: () => void; agenteInicial: AgenteRow }) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<LineaComision[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtros] = useState<FiltrosComisiones>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listLineasComisionAgente(agenteInicial.id, filtros, page, 50)
      .then(({ rows, total }) => {
        if (!alive) return;
        setRows(rows as LineaComision[]);
        setTotal(total);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [agenteInicial.id, filtros, page]);

  return (
    <Modal open onClose={onClose} title={`Historial completo — ${agenteInicial.nombre}`} width="960px">
      <div className="flex items-center gap-2 mb-1 text-xs text-muted">
        <RefreshCw className="w-3 h-3" /> Filtrable por oficina, agente, aseguradora y fechas desde la tab Comisiones.
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-5 py-2 font-medium">Aseguradora</th>
                <th className="px-5 py-2 font-medium">N° póliza</th>
                <th className="px-5 py-2 font-medium">Cliente</th>
                <th className="px-5 py-2 font-medium">F. statement</th>
                <th className="px-5 py-2 font-medium text-right">Comisión</th>
                <th className="px-5 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-5 py-2">{r.aseguradora}</td>
                  <td className="px-5 py-2 text-muted">{r.poliza_abb ?? r.numero_poliza_crudo}</td>
                  <td className="px-5 py-2">{r.cliente}</td>
                  <td className="px-5 py-2 text-muted">{fecha(r.fecha_statement)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{money(r.monto)}</td>
                  <td className="px-5 py-2">
                    <Badge tone={ESTADO_TONE[r.estado] ?? "neutral"}>{r.estado}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3">
        <Pagination page={page} pageSize={50} total={total} onChange={setPage} />
      </div>
    </Modal>
  );
}
