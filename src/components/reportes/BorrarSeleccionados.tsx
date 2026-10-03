"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Modal, Button, TextArea } from "@/components/agentes/ui";
import { borrarReporte } from "@/lib/queries/subir";

// Borrar desde la lista, marcando la casilla.
//
// Arturo, con un statement de Progressive mal subido que no podía sacar: *"la regla de borrar
// debería ser afuera, que cuando lo selecciones con la casilla el cuadrado te deje borrarlo."*
//
// Tenía razón. El botón vivía adentro del statement, así que para borrar uno había que entrar,
// y si lo que se subió mal rompe la pantalla de adentro, no hay por dónde. Desde la lista
// siempre se puede: la casilla ya existía para consolidar, ahora también borra.
//
// Van de a varios porque el error típico no es subir un archivo mal, es subir tres: el mismo mes
// dos veces, o el archivo de otra compañía. Un motivo para todos y listo.

export default function BorrarSeleccionados({
  reportes,
  onBorrado,
}: {
  reportes: { id: string; nombre: string; lineas: number }[];
  onBorrado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);

  const totalLineas = reportes.reduce((s, r) => s + r.lineas, 0);

  async function borrar() {
    if (!motivo.trim()) {
      setError("Escribí por qué los estás borrando. Queda guardado.");
      return;
    }
    setBorrando(true);
    setError(null);

    // Uno por uno y no todos de golpe: si el tercero falla, los dos primeros ya se borraron y hay
    // que poder decir cuáles. Un "no se pudo" sin decir cuántos quedaron es peor que el error.
    const fallados: string[] = [];
    let lineas = 0;
    let polizas = 0;
    for (const [i, r] of reportes.entries()) {
      setProgreso(`Borrando ${i + 1} de ${reportes.length}: ${r.nombre}`);
      try {
        const res = await borrarReporte(r.id, motivo.trim());
        lineas += res.lineasBorradas;
        polizas += res.polizasPreservadas;
      } catch (e) {
        fallados.push(`${r.nombre}: ${porQue(e)}`);
      }
    }

    setBorrando(false);
    setProgreso(null);

    if (fallados.length > 0) {
      setError(
        `Se borraron ${reportes.length - fallados.length} de ${reportes.length}. No se pudo con:\n` +
          fallados.join("\n")
      );
      onBorrado();
      return;
    }

    setAbierto(false);
    alert(
      `Listo. Se borraron ${reportes.length} statement(s) y ${lineas} línea(s).` +
        (polizas > 0
          ? ` Las ${polizas} asignación(es) de agente que habías hecho a mano quedaron guardadas en el Book.`
          : "") +
        " Los archivos se pueden volver a subir."
    );
    onBorrado();
  }

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          setMotivo("");
          setError(null);
          setAbierto(true);
        }}
        title="Sacar del sistema los statements marcados"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Borrar {reportes.length === 1 ? "el statement" : `los ${reportes.length}`}
      </Button>

      <Modal
        open={abierto}
        onClose={() => !borrando && setAbierto(false)}
        title={reportes.length === 1 ? "Borrar el statement" : `Borrar ${reportes.length} statements`}
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-start gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-3 py-2.5 text-bad-fg">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Se van <strong>{totalLineas} línea(s)</strong> de{" "}
              <strong>{reportes.length} archivo(s)</strong>. Esto no se puede deshacer.
            </span>
          </div>

          <ul className="max-h-40 overflow-y-auto rounded-lg border border-border px-3 py-2 text-[12px] text-muted">
            {reportes.map((r) => (
              <li key={r.id} className="truncate py-0.5">
                {r.nombre} <span className="text-[11px]">· {r.lineas} línea(s)</span>
              </li>
            ))}
          </ul>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted">¿Por qué los estás borrando?</span>
            <TextArea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: me equivoqué de archivo, el statement venía incompleto, la aseguradora lo reemplazó…"
            />
          </label>

          <p className="text-[11px] leading-relaxed text-muted">
            El motivo queda guardado con la fecha y quién lo borró. Lo que asignaste a mano se
            guarda en el Book antes de borrar, y los archivos se pueden volver a subir.
          </p>

          {progreso && <p className="text-xs text-muted">{progreso}</p>}
          {error && <p className="whitespace-pre-line text-xs text-bad-fg">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={borrando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={borrar} disabled={borrando || !motivo.trim()}>
              {borrando ? "Borrando…" : "Borrar"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// Los errores de Supabase no son Error: son objetos con message/hint. El de esta función suele
// traer el motivo real (una FK que quedó apuntando, un permiso), y tragárselo deja al usuario
// mirando un "no se pudo" que no dice nada.
function porQue(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.hint, o.details].filter((x) => typeof x === "string" && x);
    if (partes.length) return partes.join(" — ");
  }
  return "No se pudo borrar.";
}
