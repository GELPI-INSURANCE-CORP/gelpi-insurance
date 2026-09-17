"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, Select, Input, Button, Badge, Loading, EmptyState, Banner } from "@/components/agentes/ui";
import BonoDetalleModal from "@/components/bonos/BonoDetalleModal";
import NuevoBonoModal from "@/components/bonos/NuevoBonoModal";
import SubirBonoButton from "@/components/bonos/SubirBonoButton";
import { money } from "@/lib/format";
import { listBonos, type BonoRow, type FiltrosBonos } from "@/lib/queries/bonos";
import { listAgentesSimple, listAseguradorasSimple, listOficinasSimple } from "@/lib/queries/agentes";

const TIPO_LABEL: Record<string, string> = {
  contingencia_aseguradora: "Contingencia de aseguradora",
  spiff_campana: "SPIFF / campaña",
  override_manager: "Override de manager",
  retencion: "Retención",
  volumen: "Volumen",
  otro: "Otro",
};

const ESTADO_LABEL: Record<string, { label: string; tone: "neutral" | "brand" | "ok" }> = {
  pendiente: { label: "Pendiente de distribuir", tone: "neutral" },
  repartido: { label: "Repartido", tone: "brand" },
  pagado: { label: "Pagado", tone: "ok" },
};

type BonoConConteo = BonoRow & { agentesBeneficiados: number };

function BonosContent() {
  const [filtros, setFiltros] = useState<FiltrosBonos>({});
  const [rows, setRows] = useState<BonoConConteo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refs, setRefs] = useState<{ agentes: { id: string; nombre: string }[]; oficinas: { id: string; nombre: string }[]; aseguradoras: { id: string; nombre: string }[] }>({
    agentes: [],
    oficinas: [],
    aseguradoras: [],
  });
  const [seleccionado, setSeleccionado] = useState<BonoConConteo | null>(null);
  const [nuevoOpen, setNuevoOpen] = useState(false);

  const cargar = useCallback(() => {
    setLoading(true);
    listBonos(filtros)
      .then(setRows)
      .finally(() => setLoading(false));
  }, [filtros]);

  useEffect(() => cargar(), [cargar]);
  useEffect(() => {
    Promise.all([listAgentesSimple(), listOficinasSimple(), listAseguradorasSimple()]).then(([agentes, oficinas, aseguradoras]) => {
      setRefs({
        agentes: agentes.map((a) => ({ id: a.id, nombre: a.nombre })),
        oficinas: oficinas.map((o) => ({ id: o.id, nombre: o.nombre })),
        aseguradoras,
      });
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-foreground">Bonos</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setNuevoOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Cargar bono manual
          </Button>
          <SubirBonoButton aseguradoras={refs.aseguradoras} onDone={cargar} />
        </div>
      </div>

      <Banner tone="info">Regla dura: los bonos nunca se mezclan con la comisión regular. Se calculan, reparten y pagan por separado.</Banner>

      <Card>
        <div className="flex items-center gap-2 p-3 border-b border-border flex-wrap">
          <Select
            value={filtros.aseguradoraId ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, aseguradoraId: v || undefined }))}
            options={[{ value: "", label: "Aseguradora: Todas" }, ...refs.aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
          <Input value={filtros.periodo ?? ""} onChange={(v) => setFiltros((f) => ({ ...f, periodo: v || undefined }))} placeholder="Período AAAA-MM" icon={false} className="w-36" />
          <Select
            value={filtros.tipo ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, tipo: v || undefined }))}
            options={[{ value: "", label: "Tipo: Todos" }, ...Object.entries(TIPO_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <Select
            value={filtros.estado ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, estado: v || undefined }))}
            options={[{ value: "", label: "Estado: Todos" }, ...Object.entries(ESTADO_LABEL).map(([value, { label }]) => ({ value, label }))]}
          />
          <Select
            value={filtros.agenteId ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, agenteId: v || undefined }))}
            options={[{ value: "", label: "Agente: Todos" }, ...refs.agentes.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
          <Select
            value={filtros.oficinaId ?? ""}
            onChange={(v) => setFiltros((f) => ({ ...f, oficinaId: v || undefined }))}
            options={[{ value: "", label: "Oficina: Todas" }, ...refs.oficinas.map((o) => ({ value: o.id, label: o.nombre }))]}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Aseguradora</th>
                <th className="px-4 py-2.5 font-medium">Período</th>
                <th className="px-4 py-2.5 font-medium text-right">Monto total</th>
                <th className="px-4 py-2.5 font-medium">Regla de reparto</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium text-right">Agentes beneficiados</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const e = ESTADO_LABEL[b.estado] ?? { label: b.estado, tone: "neutral" as const };
                return (
                  <tr key={b.id} onClick={() => setSeleccionado(b)} className="border-t border-border cursor-pointer hover:bg-background">
                    <td className="px-4 py-2.5 font-medium">{b.nombre ?? TIPO_LABEL[b.tipo] ?? b.tipo}</td>
                    <td className="px-4 py-2.5">{b.aseguradora?.nombre ?? "—"}</td>
                    <td className="px-4 py-2.5">{b.periodo ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(b.monto_total)}</td>
                    <td className="px-4 py-2.5 text-muted">{b.regla_reparto}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.agentesBeneficiados}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <Loading />}
          {!loading && rows.length === 0 && <EmptyState title="Sin bonos" subtitle="No hay bonos que coincidan con los filtros." />}
        </div>
      </Card>

      {seleccionado && (
        <BonoDetalleModal
          bono={seleccionado}
          onClose={() => setSeleccionado(null)}
          onChanged={cargar}
          agentes={refs.agentes}
        />
      )}
      <NuevoBonoModal open={nuevoOpen} onClose={() => setNuevoOpen(false)} onCreated={cargar} aseguradoras={refs.aseguradoras} oficinas={refs.oficinas} />
    </div>
  );
}

export default function BonosPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BonosContent />
    </Suspense>
  );
}
