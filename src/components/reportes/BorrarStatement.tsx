"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Modal, Button, TextArea } from "@/components/agentes/ui";
import { borrarReporte } from "@/lib/queries/subir";

// Borrar un statement que se subió mal.
//
// Va en dos lugares porque a un reporte se llega por dos caminos distintos: los statements de
// comisión abren su propia pantalla, y el resto (bonos, Book, ventas internas) abre el panel
// lateral. Tener el botón en uno solo dejaba fuera justo a los que más se borran.
//
// Es distinto de reprocesar: reprocesar vuelve a leer el mismo archivo, borrar lo saca del
// sistema para poder subir otro. Por eso pide motivo y va en rojo, separado del resto.

export default function BorrarStatement({
  reporteId,
  nombreArchivo,
  periodo,
  totalLineas,
  onBorrado,
}: {
  reporteId: string;
  nombreArchivo: string;
  periodo: string | null;
  totalLineas: number;
  onBorrado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function borrar() {
    if (!motivo.trim()) {
      setError("Escribí por qué lo estás borrando. Queda guardado.");
      return;
    }
    setBorrando(true);
    setError(null);
    try {
      const r = await borrarReporte(reporteId, motivo.trim());
      setAbierto(false);
      // Se avisa cuántas asignaciones manuales quedaron guardadas en el Book: es justo lo que
      // uno teme perder al borrar, y si no se dice no se ve por ningún lado.
      alert(
        `Statement borrado. Se fueron ${r.lineasBorradas} línea(s) y ${r.excepcionesBorradas} excepción(es).` +
          (r.polizasPreservadas > 0
            ? ` Las ${r.polizasPreservadas} asignación(es) de agente que habías hecho a mano quedaron guardadas en el Book, así que al volver a subir el archivo se reencuentran solas.`
            : "") +
          " El archivo se puede volver a subir."
      );
      onBorrado();
    } catch (e) {
      setError(porQue(e));
    } finally {
      setBorrando(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setMotivo("");
          setError(null);
          setAbierto(true);
        }}
        title="Sacar este statement del sistema para volver a subirlo"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Borrar statement
      </Button>

      <Modal open={abierto} onClose={() => setAbierto(false)} title="Borrar el statement">
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-start gap-2 rounded-lg border border-bad-fg/30 bg-bad-bg px-3 py-2.5 text-bad-fg">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Se van <strong>{totalLineas} línea(s)</strong> de <strong>{nombreArchivo}</strong>
              {periodo ? <> (período {periodo})</> : null}. Esto no se puede deshacer.
            </span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-muted">¿Por qué lo estás borrando?</span>
            <TextArea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: se subió el archivo equivocado, el statement venía incompleto, la aseguradora lo reemplazó…"
            />
          </label>

          <p className="text-[11px] leading-relaxed text-muted">
            El motivo queda guardado con la fecha y quién lo borró. Dentro de un mes, cuando falte un
            statement, esa nota es la única forma de saber qué pasó. Lo que asignaste a mano se guarda
            en el Book antes de borrar, y el archivo se puede volver a subir.
          </p>

          {error && <p className="text-xs text-bad-fg">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={borrando}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={borrar} disabled={borrando || !motivo.trim()}>
              {borrando ? "Borrando…" : "Borrar statement"}
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
  return "No se pudo borrar el statement.";
}
