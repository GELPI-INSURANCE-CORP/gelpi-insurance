"use client";

import { useState } from "react";
import { Select } from "@/components/agentes/ui";
import SubirLibroButton, { type SubirLibroLabels } from "@/components/clientes/SubirLibroButton";

const LABELS_BONO: SubirLibroLabels = {
  boton: "Subir statement de bono",
  titulo: "Subí el statement de bono/contingencia (Excel, CSV o PDF); la IA lo estructura y lo carga acá",
  fasesPorEstado: {
    subido: "Archivo recibido, esperando a la IA…",
    extrayendo: "La IA está leyendo el statement…",
    extraido: "Estructurando el bono…",
    matcheado: "Bono cargado.",
    cerrado: "Bono cargado.",
  },
  listo: (r) => `Bono cargado: ${r.total_ok ?? r.total_lineas ?? 0} fila(s) del statement procesada(s).`,
};

export default function SubirBonoButton({
  aseguradoras,
  onDone,
}: {
  aseguradoras: { id: string; nombre: string }[];
  onDone: () => void;
}) {
  const [aseguradoraId, setAseguradoraId] = useState("");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={aseguradoraId}
        onChange={setAseguradoraId}
        options={[{ value: "", label: "Aseguradora…" }, ...aseguradoras.map((a) => ({ value: a.id, label: a.nombre }))]}
      />
      <SubirLibroButton
        onDone={onDone}
        tipo="bono_contingencia"
        aseguradoraId={aseguradoraId || null}
        requiereAseguradora
        labels={LABELS_BONO}
      />
    </div>
  );
}
