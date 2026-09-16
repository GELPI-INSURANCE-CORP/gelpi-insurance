"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, Input, Button, Avatar, initials, Badge, Loading, EmptyState } from "./ui";
import type { AgenteDirectorioItem } from "@/lib/queries/agentes";

export default function AgentesTabla({
  agentes,
  loading,
  onVerFicha,
  onNuevo,
  onToggleActivo,
  cambiandoId,
}: {
  agentes: AgenteDirectorioItem[];
  loading: boolean;
  onVerFicha: (id: string) => void;
  onNuevo: () => void;
  onToggleActivo: (id: string, activo: boolean) => void;
  cambiandoId: string | null;
}) {
  const [buscar, setBuscar] = useState("");

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return agentes;
    return agentes.filter(
      (a) =>
        a.nombre.toLowerCase().includes(q) ||
        (a.codigo ?? "").toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q) ||
        (a.npn ?? "").toLowerCase().includes(q)
    );
  }, [agentes, buscar]);

  const activos = agentes.filter((a) => a.activo).length;
  const inactivos = agentes.length - activos;

  return (
    <Card className="flex flex-col min-h-0 h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex items-center gap-5 text-[13px]">
          <span className="text-muted">
            Activos: <strong className="text-ok-fg">{activos}</strong>
          </span>
          <span className="text-muted">
            Inactivos: <strong className="text-bad-fg">{inactivos}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input value={buscar} onChange={setBuscar} placeholder="Buscar por nombre, código, email o NPN…" className="w-64" />
          <Button variant="primary" size="sm" onClick={onNuevo}>
            <Plus className="w-3.5 h-3.5" />
            Nuevo agente
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <Loading />
        ) : filtrados.length === 0 ? (
          <EmptyState title="Sin agentes" subtitle="No hay agentes que coincidan con la búsqueda." />
        ) : (
          <table className="w-full min-w-[880px] border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Agente</th>
                <th className="px-3 py-2.5">Contacto</th>
                <th className="px-3 py-2.5">NPN</th>
                <th className="px-3 py-2.5">Oficina</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-background">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(a.nombre)} />
                      <button
                        type="button"
                        onClick={() => onVerFicha(a.id)}
                        className="text-left font-medium text-brand-dark hover:underline"
                      >
                        {a.nombre}
                        {a.esEncargado && <span className="ml-1 text-[11px] font-normal text-muted">(encargado)</span>}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">
                    <div className="flex flex-col gap-0.5">
                      <span>{a.email || "—"}</span>
                      {a.telefono && <span className="text-[11px]">{a.telefono}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">{a.npn || "—"}</td>
                  <td className="px-3 py-3 text-muted">{a.oficinaNombre}</td>
                  <td className="px-3 py-3">
                    <Badge tone={a.activo ? "ok" : "neutral"}>{a.activo ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => onVerFicha(a.id)}>
                        Ver
                      </Button>
                      <Button
                        size="sm"
                        variant={a.activo ? "danger" : "primary"}
                        disabled={cambiandoId === a.id}
                        onClick={() => onToggleActivo(a.id, !a.activo)}
                      >
                        {a.activo ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
