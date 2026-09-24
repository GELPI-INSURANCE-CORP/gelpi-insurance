"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Input, Button } from "@/components/agentes/ui";
import { crearAliasAseguradora, borrarAliasAseguradora, type AliasAseguradora } from "@/lib/queries/configuracion";

/**
 * Chips con los nombres alternativos de una aseguradora + campo para agregar uno nuevo.
 * Vive dentro de la fila de la tabla de "Plantillas por aseguradora"; el listado de alias
 * se carga una sola vez en el componente padre y acá solo se filtra por aseguradora_id.
 */
export function AliasAseguradoraEditor({
  aseguradoraId,
  alias,
  onChange,
}: {
  aseguradoraId: string;
  alias: AliasAseguradora[];
  onChange: () => void;
}) {
  const [nuevo, setNuevo] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function agregar() {
    const texto = nuevo.trim();
    if (!texto) return;
    setAgregando(true);
    setError(null);
    try {
      await crearAliasAseguradora(aseguradoraId, texto);
      setNuevo("");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar el alias.");
    } finally {
      setAgregando(false);
    }
  }

  async function borrar(id: string) {
    setBorrandoId(id);
    setError(null);
    try {
      await borrarAliasAseguradora(id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar el alias.");
    } finally {
      setBorrandoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1.5 max-w-xs">
      {alias.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {alias.map((al) => (
            <span
              key={al.id}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full border border-border bg-background text-[11px] text-muted"
            >
              {al.texto}
              <button
                type="button"
                onClick={() => borrar(al.id)}
                disabled={borrandoId === al.id}
                title={`Borrar alias "${al.texto}"`}
                className="text-muted hover:text-bad-fg disabled:opacity-40 rounded-full p-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Input value={nuevo} onChange={setNuevo} placeholder="Agregar nombre alternativo…" icon={false} className="flex-1" />
        <Button size="sm" onClick={agregar} disabled={agregando || !nuevo.trim()} title="Agregar alias">
          <Plus className="w-3.5 h-3.5" />
          Agregar
        </Button>
      </div>
      {error && <p className="text-[11px] text-bad-fg">{error}</p>}
    </div>
  );
}
