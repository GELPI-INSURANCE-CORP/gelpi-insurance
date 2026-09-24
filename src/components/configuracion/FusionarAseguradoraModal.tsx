"use client";

import { useState } from "react";
import { AlertTriangle, Merge } from "lucide-react";
import { Modal, Field, Select, Button, Banner, Kpi } from "@/components/agentes/ui";
import { fusionarAseguradoras, type AseguradoraRow, type ResultadoFusion } from "@/lib/queries/configuracion";

/**
 * Fusiona `aseguradora` dentro de otra elegida por el usuario. Es irreversible (mueve pólizas,
 * reportes, líneas y bonos, y borra `aseguradora`), así que exige elegir destino Y tildar un
 * checkbox de confirmación antes de habilitar el botón — no se puede disparar de un solo click.
 */
export function FusionarAseguradoraModal({
  aseguradora,
  todas,
  onClose,
  onFusionado,
}: {
  aseguradora: AseguradoraRow;
  todas: AseguradoraRow[];
  onClose: () => void;
  onFusionado: () => void;
}) {
  const [destinoId, setDestinoId] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFusion | null>(null);

  const candidatos = todas.filter((t) => t.id !== aseguradora.id);
  const opciones = [{ value: "", label: "Elegí la aseguradora destino…" }, ...candidatos.map((t) => ({ value: t.id, label: t.nombre }))];
  const destino = candidatos.find((t) => t.id === destinoId) ?? null;

  async function confirmar() {
    if (!destino || !confirmado) return;
    setFusionando(true);
    setError(null);
    try {
      const r = await fusionarAseguradoras(aseguradora.id, destino.id);
      setResultado(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo fusionar la aseguradora.");
    } finally {
      setFusionando(false);
    }
  }

  // Mientras la fusión está en curso no se puede cerrar (ni con click afuera ni con Escape):
  // ya se disparó en el servidor y cerrar la ventana no la cancela.
  const cerrarModal = fusionando ? () => {} : resultado ? onFusionado : onClose;

  return (
    <Modal open onClose={cerrarModal} title={`Fusionar "${aseguradora.nombre}"`} width="560px">
      {resultado ? (
        <div className="flex flex-col gap-4">
          <Banner tone="info">
            Listo. &quot;{resultado.nombre_origen}&quot; ahora es un nombre alternativo de{" "}
            <strong>{destino?.nombre}</strong>: si vuelve a llegar un archivo con ese nombre, el sistema lo va a
            reconocer solo, sin duplicar la aseguradora.
          </Banner>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi label="Pólizas movidas" value={String(resultado.polizas_movidas)} />
            <Kpi label="Pólizas fusionadas (número repetido)" value={String(resultado.polizas_fusionadas)} />
            <Kpi label="Reportes movidos" value={String(resultado.reportes_movidos)} />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onFusionado}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Banner tone="warn">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
            Toda la información de <strong>{aseguradora.nombre}</strong> — pólizas, reportes y bonos — va a pasar a la
            aseguradora que elijas abajo. El nombre &quot;{aseguradora.nombre}&quot; va a quedar como nombre
            alternativo de la que elijas, y <strong>{aseguradora.nombre}</strong> va a desaparecer.
          </Banner>

          {candidatos.length === 0 ? (
            <Banner tone="warn">No hay otra aseguradora para elegir como destino. Creá otra aseguradora primero.</Banner>
          ) : (
            <>
              <Field label="Fusionar dentro de">
                <Select value={destinoId} onChange={setDestinoId} options={opciones} className="w-full" />
              </Field>

              {destino && (
                <Banner tone="bad">
                  Vas a mover <strong>todo</strong> de <strong>{aseguradora.nombre}</strong> a{" "}
                  <strong>{destino.nombre}</strong>, y <strong>{aseguradora.nombre}</strong> va a dejar de existir. Esta
                  acción no se puede deshacer.
                </Banner>
              )}

              <label className="flex items-start gap-2 text-[13px] text-foreground">
                <input
                  type="checkbox"
                  checked={confirmado}
                  onChange={(e) => setConfirmado(e.target.checked)}
                  disabled={!destino || fusionando}
                  className="mt-0.5"
                />
                <span>Entiendo que esta acción no se puede deshacer y quiero continuar.</span>
              </label>
            </>
          )}

          {error && (
            <Banner tone="bad">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
              {error}
            </Banner>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={fusionando}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmar} disabled={!destino || !confirmado || fusionando}>
              <Merge className="w-3.5 h-3.5" />
              {fusionando ? "Fusionando…" : "Fusionar aseguradoras"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
