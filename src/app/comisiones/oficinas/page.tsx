"use client";
import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Card, CardHead, Select, Button, Loading, EmptyState } from "@/components/agentes/ui";
import OficinaModal from "@/components/oficinas/OficinaModal";
import { money, pct } from "@/lib/format";
import { listOficinasResumen, type OficinaResumen } from "@/lib/queries/oficinas";
import { listAgentesSimple, listAseguradorasSimple } from "@/lib/queries/agentes";

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function OficinasPage() {
  const [periodo, setPeriodo] = useState(periodoActual());
  const [aseguradoraId, setAseguradoraId] = useState("");
  const [aseguradoras, setAseguradoras] = useState<{ id: string; nombre: string }[]>([]);
  const [agentes, setAgentes] = useState<{ id: string; nombre: string }[]>([]);
  const [oficinas, setOficinas] = useState<OficinaResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<OficinaResumen | null>(null);

  const cargar = useCallback(() => {
    setLoading(true);
    listOficinasResumen(periodo, aseguradoraId || undefined)
      .then(setOficinas)
      .finally(() => setLoading(false));
  }, [periodo, aseguradoraId]);

  useEffect(() => cargar(), [cargar]);
  useEffect(() => {
    listAseguradorasSimple().then(setAseguradoras);
    listAgentesSimple().then((a) => setAgentes(a.map((x) => ({ id: x.id, nombre: x.nombre }))));
  }, []);

  const totales = oficinas.reduce(
    (acc, o) => ({
      numAgentes: acc.numAgentes + o.numAgentes,
      polizasActivas: acc.polizasActivas + o.polizasActivas,
      comisionMes: acc.comisionMes + o.comisionMes,
      excepcionesAbiertas: acc.excepcionesAbiertas + o.excepcionesAbiertas,
    }),
    { numAgentes: 0, polizasActivas: 0, comisionMes: 0, excepcionesAbiertas: 0 }
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-foreground">Oficinas</h1>
        <Button
          size="sm"
          onClick={() => {
            setEditando(null);
            setModalOpen(true);
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva oficina
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="month"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          className="h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-foreground"
        />
        <Select
          value={aseguradoraId}
          onChange={setAseguradoraId}
          options={[{ value: "", label: "Aseguradora: Todas" }, ...aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]}
        />
      </div>

      {loading ? (
        <Loading />
      ) : oficinas.length === 0 ? (
        <EmptyState title="Sin oficinas" subtitle="Todavía no hay oficinas registradas." />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {oficinas.map((o) => (
              <Card key={o.id} className="p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-foreground">{o.nombre}</div>
                    <div className="text-xs text-muted">Encargado: {o.gerenteNombre}</div>
                  </div>
                  <button
                    onClick={() => {
                      setEditando(o);
                      setModalOpen(true);
                    }}
                    className="text-muted hover:text-foreground p-1 rounded hover:bg-background"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <Stat label="Agentes" value={String(o.numAgentes)} />
                  <Stat label="Pólizas activas" value={String(o.polizasActivas)} />
                  <Stat label="Comisión del mes" value={money(o.comisionMes)} />
                  <Stat label="Excepciones abiertas" value={String(o.excepcionesAbiertas)} tone={o.excepcionesAbiertas > 0 ? "warn" : undefined} />
                  <Stat label="Antigüedad promedio" value={`${o.antiguedadPromedioAnios.toFixed(1)} años`} />
                  <Stat label="% conciliado automático" value={pct(o.pctConciliadoAuto)} />
                </div>
                <div className="flex items-center gap-3 pt-2 border-t border-border text-xs">
                  <Link href={`/comisiones/clientes/?oficina=${o.id}`} className="text-brand hover:underline">
                    Ver Active Business Book
                  </Link>
                  <Link href={`/comisiones/conciliacion/?oficina=${o.id}`} className="text-brand hover:underline">
                    Ver excepciones
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHead title="Tabla comparativa" />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-muted bg-background/60">
                    <th className="px-4 py-2.5 font-medium">Oficina</th>
                    <th className="px-4 py-2.5 font-medium text-right">Agentes</th>
                    <th className="px-4 py-2.5 font-medium text-right">Pólizas activas</th>
                    <th className="px-4 py-2.5 font-medium text-right">Comisión del mes</th>
                    <th className="px-4 py-2.5 font-medium text-right">Excepciones</th>
                    <th className="px-4 py-2.5 font-medium text-right">% autom.</th>
                  </tr>
                </thead>
                <tbody>
                  {oficinas.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium">{o.nombre}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.numAgentes}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.polizasActivas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(o.comisionMes)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.excepcionesAbiertas}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pct(o.pctConciliadoAuto)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-semibold bg-background/60">
                    <td className="px-4 py-2.5">Totales</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.numAgentes}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.polizasActivas}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(totales.comisionMes)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{totales.excepcionesAbiertas}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <OficinaModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={cargar} agentes={agentes} editando={editando} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={"font-semibold " + (tone === "warn" ? "text-warn-fg" : "text-foreground")}>{value}</div>
    </div>
  );
}
