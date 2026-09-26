"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Snowflake, Download, AlertTriangle } from "lucide-react";
import { Card, Input, Select, Button, Chip, Pagination, Loading, EmptyState, Banner, Modal, Field, TextInput } from "@/components/agentes/ui";
import PolizaDrawer, { EstadoBadge } from "@/components/clientes/PolizaDrawer";
import AltaManualModal from "@/components/clientes/AltaManualModal";
import SubirLibroButton from "@/components/clientes/SubirLibroButton";
import ReprocesarLibroButton from "@/components/clientes/ReprocesarLibroButton";
import { fecha, RAMOS } from "@/lib/format";
import {
  listPolizas,
  countPolizasSinAsignar,
  listConflictosVenta,
  resolverConflictoVenta,
  listAgentesOficinasAseguradoras,
  congelarSnapshotAbb,
  type FiltrosPolizas,
} from "@/lib/queries/clientes";

interface PolizaFila {
  id: string;
  cliente: string | null;
  telefono: string | null;
  email: string | null;
  numero_poliza: string;
  aseguradora: string | null;
  ramo: string;
  agente: string | null;
  agente_id: string | null;
  oficina: string | null;
  oficina_id: string | null;
  fecha_vigencia: string | null;
  fecha_vencimiento: string | null;
  estado: string;
  origen: string;
  prima: number | null;
  updated_at: string;
}

function ClientesContent() {
  const searchParams = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosPolizas>({
    oficinaId: searchParams.get("oficina") ?? undefined,
    agenteId: searchParams.get("agente") ?? undefined,
  });
  const [buscar, setBuscar] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PolizaFila[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sinAsignar, setSinAsignar] = useState(0);
  const [conflictos, setConflictos] = useState<{ id: string; explicacion: string | null; venta_cliente: string | null; venta_poliza: string | null; candidatos: { agente_reclamado?: string } | null }[]>([]);
  const [refs, setRefs] = useState<{ agentes: { id: string; nombre: string }[]; oficinas: { id: string; nombre: string }[]; aseguradoras: { id: string; nombre: string }[] }>({
    agentes: [],
    oficinas: [],
    aseguradoras: [],
  });
  const [seleccionada, setSeleccionada] = useState<PolizaFila | null>(null);
  const [altaOpen, setAltaOpen] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    listPolizas(filtros, page, 50)
      .then(({ rows, total }) => {
        setRows(rows as PolizaFila[]);
        setTotal(total);
      })
      .finally(() => setLoading(false));
  }, [filtros, page]);

  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    countPolizasSinAsignar().then(setSinAsignar);
    listConflictosVenta().then((c) => setConflictos(c as typeof conflictos));
    listAgentesOficinasAseguradoras().then(setRefs);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => ({ ...f, buscar: buscar || undefined }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [buscar]);

  function toggleSinAgente() {
    setFiltros((f) => ({ ...f, sinAgente: !f.sinAgente }));
    setPage(1);
  }

  async function exportarCsv() {
    setExportando(true);
    setExportError(null);
    try {
      // El botón promete "el libro completo", no la página visible: traemos todas las filas
      // que matchean los filtros actuales, paginando en bloques de 1000 (max_rows de PostgREST,
      // ver supabase/config.toml) en vez de reusar `rows` (solo la página en pantalla).
      const pageSize = 1000;
      let all: PolizaFila[] = [];
      let p = 1;
      let total = Infinity;
      while (all.length < total) {
        const { rows: r, total: t } = await listPolizas(filtros, p, pageSize);
        all = all.concat(r as PolizaFila[]);
        total = t;
        if (r.length === 0) break;
        p += 1;
      }
      const header = ["Cliente", "N° póliza", "Aseguradora", "Ramo", "Agente", "Oficina", "Vigencia", "Estado", "Origen"];
      const csv = [
        header.join(","),
        ...all.map((r) =>
          [r.cliente, r.numero_poliza, r.aseguradora, RAMOS[r.ramo] ?? r.ramo, r.agente, r.oficina, r.fecha_vigencia, r.estado, r.origen]
            .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
            .join(",")
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "active-business-book.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "No se pudo exportar el libro completo.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-foreground">Clientes · Active Business Book</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <SubirLibroButton onDone={cargar} />
          <ReprocesarLibroButton onDone={cargar} />
          <Button size="sm" onClick={() => setAltaOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Alta manual de cliente/póliza
          </Button>
          <Button size="sm" onClick={() => setSnapshotOpen(true)}>
            <Snowflake className="w-3.5 h-3.5" />
            Congelar snapshot del ABB
          </Button>
          <Button size="sm" onClick={exportarCsv} disabled={exportando}>
            <Download className="w-3.5 h-3.5" />
            {exportando ? "Exportando…" : "Exportar libro completo (CSV)"}
          </Button>
        </div>
      </div>

      {exportError && (
        <Banner tone="bad">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          {exportError}
        </Banner>
      )}

      {sinAsignar > 0 && (
        <Banner
          tone="warn"
          action={
            <Chip active={!!filtros.sinAgente} onClick={toggleSinAgente}>
              Sin agente asignado
            </Chip>
          }
        >
          <strong>{sinAsignar}</strong> pólizas activas no tienen agente u oficina asignados.
        </Banner>
      )}

      {conflictos.length > 0 && (
        <div className="flex flex-col gap-2">
          {conflictos.map((c) => (
            <Banner key={c.id} tone="bad" action={<ResolverConflicto excepcionId={c.id} agentes={refs.agentes} onResuelto={() => { listConflictosVenta().then((r) => setConflictos(r as typeof conflictos)); cargar(); }} />}>
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
              Conflicto de venta: {c.venta_cliente ?? "cliente sin nombre"} · póliza {c.venta_poliza ?? "—"} — {c.explicacion}
            </Banner>
          ))}
        </div>
      )}

      <Card className="flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
          <Input value={buscar} onChange={setBuscar} placeholder="Póliza, cliente o teléfono…" className="w-64" />
          <Select
            value={filtros.oficinaId ?? ""}
            onChange={(v) => { setFiltros((f) => ({ ...f, oficinaId: v || undefined })); setPage(1); }}
            options={[{ value: "", label: "Oficina: Todas" }, ...refs.oficinas.map((o) => ({ value: o.id, label: o.nombre }))]}
          />
          <Select
            value={filtros.agenteId ?? ""}
            onChange={(v) => { setFiltros((f) => ({ ...f, agenteId: v || undefined })); setPage(1); }}
            options={[{ value: "", label: "Agente: Todos" }, ...refs.agentes.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
          <Select
            value={filtros.aseguradoraId ?? ""}
            onChange={(v) => { setFiltros((f) => ({ ...f, aseguradoraId: v || undefined })); setPage(1); }}
            options={[{ value: "", label: "Aseguradora: Todas" }, ...refs.aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
          <Select
            value={filtros.estado ?? ""}
            onChange={(v) => { setFiltros((f) => ({ ...f, estado: v || undefined })); setPage(1); }}
            options={[
              { value: "", label: "Estado: Todos" },
              { value: "activa", label: "Activa" },
              { value: "cancelada", label: "Cancelada" },
              { value: "vencida", label: "Vencida" },
              { value: "pendiente", label: "Pendiente" },
            ]}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Cliente</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">N° póliza</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Aseguradora</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Agente</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Oficina</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Vigencia</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Estado</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Origen</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setSeleccionada(r)} className="border-t border-border cursor-pointer hover:bg-background">
                  <td className="px-4 py-2.5 font-medium">{r.cliente}</td>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">{r.numero_poliza}</td>
                  <td className="px-4 py-2.5">{r.aseguradora}</td>
                  <td className="px-4 py-2.5">{r.agente ?? <span className="text-bad-fg">Sin asignar</span>}</td>
                  <td className="px-4 py-2.5">{r.oficina ?? <span className="text-bad-fg">Sin asignar</span>}</td>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">{fecha(r.fecha_vigencia)}</td>
                  <td className="px-4 py-2.5">
                    <EstadoBadge estado={r.estado} />
                  </td>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">{r.origen}</td>
                  <td className="px-4 py-2.5 text-muted whitespace-nowrap">{fecha(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <Loading />}
          {!loading && rows.length === 0 && <EmptyState title="Sin pólizas" subtitle="No hay pólizas que coincidan con los filtros." />}
        </div>
        <Pagination page={page} pageSize={50} total={total} onChange={setPage} />
      </Card>

      {seleccionada && (
        <PolizaDrawer
          poliza={seleccionada}
          onClose={() => setSeleccionada(null)}
          onSaved={() => {
            setSeleccionada(null);
            cargar();
          }}
          agentes={refs.agentes}
          oficinas={refs.oficinas}
        />
      )}

      <AltaManualModal
        open={altaOpen}
        onClose={() => setAltaOpen(false)}
        onCreated={cargar}
        agentes={refs.agentes}
        oficinas={refs.oficinas}
        aseguradoras={refs.aseguradoras}
      />

      <SnapshotModal open={snapshotOpen} onClose={() => setSnapshotOpen(false)} />
    </div>
  );
}

function ResolverConflicto({
  excepcionId,
  agentes,
  onResuelto,
}: {
  excepcionId: string;
  agentes: { id: string; nombre: string }[];
  onResuelto: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [agenteId, setAgenteId] = useState("");
  const [saving, setSaving] = useState(false);

  async function resolver() {
    if (!agenteId) return;
    setSaving(true);
    try {
      await resolverConflictoVenta(excepcionId, agenteId);
      onResuelto();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Resolver
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Resolver conflicto de venta">
        <Field label="Agente dueño de la póliza">
          <Select value={agenteId} onChange={setAgenteId} options={[{ value: "", label: "Seleccionar…" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={resolver} disabled={saving || !agenteId}>
            {saving ? "Guardando…" : "Confirmar dueño"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SnapshotModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function confirmar() {
    setSaving(true);
    try {
      await congelarSnapshotAbb(nota);
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { onClose(); setDone(false); setNota(""); }} title="Congelar snapshot del ABB">
      {done ? (
        <p className="text-sm text-ok-fg">
          Snapshot marcado. Todavía no hay una pantalla para consultar versiones anteriores del libro; esto solo deja
          registrado cuándo se cerró este corte.
        </p>
      ) : (
        <>
          <Field label="Nota (opcional)">
            <TextInput value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: usada para conciliar sept-2026" />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmar} disabled={saving}>
              {saving ? "Congelando…" : "Congelar snapshot"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function ClientesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ClientesContent />
    </Suspense>
  );
}
