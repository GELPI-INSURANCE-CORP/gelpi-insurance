"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, Input, Button, Avatar, initials, Badge, Loading, EmptyState } from "./ui";
import { money } from "@/lib/format";
import type { AgenteDirectorioItem } from "@/lib/queries/agentes";

export default function AgenteDirectorio({
  agentes,
  loading,
  seleccionadoId,
  onSeleccionar,
  onNuevo,
}: {
  agentes: AgenteDirectorioItem[];
  loading: boolean;
  seleccionadoId: string | null;
  onSeleccionar: (id: string) => void;
  onNuevo: () => void;
}) {
  const [buscar, setBuscar] = useState("");

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return agentes;
    return agentes.filter((a) => a.nombre.toLowerCase().includes(q) || (a.codigo ?? "").toLowerCase().includes(q));
  }, [agentes, buscar]);

  const grupos = useMemo(() => {
    const map = new Map<string, AgenteDirectorioItem[]>();
    for (const a of filtrados) {
      const key = a.oficinaNombre;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtrados]);

  return (
    <Card className="flex flex-col min-h-0 h-full">
      <div className="p-3.5 border-b border-border flex flex-col gap-2.5">
        <Input value={buscar} onChange={setBuscar} placeholder="Buscar por nombre o código…" className="w-full" />
        <Button variant="primary" size="sm" onClick={onNuevo} className="w-full justify-center">
          <Plus className="w-3.5 h-3.5" />
          Nuevo agente
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <Loading />
        ) : filtrados.length === 0 ? (
          <EmptyState title="Sin agentes" subtitle="No hay agentes que coincidan con la búsqueda." />
        ) : (
          grupos.map(([oficina, lista]) => (
            <div key={oficina} className="mb-2">
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{oficina}</div>
              {lista.map((a) => {
                const selected = a.id === seleccionadoId;
                return (
                  <button
                    key={a.id}
                    onClick={() => onSeleccionar(a.id)}
                    className={
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left " +
                      (selected ? "bg-brand-tint shadow-[inset_3px_0_0_var(--brand)]" : "hover:bg-background")
                    }
                  >
                    <Avatar initials={initials(a.nombre)} soft={selected} />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className={"text-[13px] truncate " + (selected ? "font-semibold text-brand-dark" : "font-medium text-foreground")}>
                        {a.nombre}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {a.oficinaNombre}
                        {a.esEncargado ? " (encargado)" : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="text-xs font-semibold text-foreground">{money(a.comisionMes)}</div>
                      {a.excepcionesAbiertas > 0 ? (
                        <Badge tone="warn">{a.excepcionesAbiertas}</Badge>
                      ) : (
                        <div className="text-[10px] text-muted">0 excep.</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
