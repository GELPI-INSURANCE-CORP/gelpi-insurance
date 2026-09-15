"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button, Banner } from "@/components/agentes/ui";
import { supabase } from "@/lib/supabase";
import { uploadReporte, DuplicadoError } from "@/lib/queries/subir";

type Fase = "idle" | "subiendo" | "procesando" | "listo" | "error";

const LABEL: Record<string, string> = {
  subido: "Archivo recibido, esperando a la IA…",
  extrayendo: "La IA está leyendo el libro…",
  extraido: "Estructurando clientes y pólizas…",
  matcheado: "Aplicando cambios al libro…",
  cerrado: "Libro actualizado.",
};

export default function SubirLibroButton({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>("idle");
  const [mensaje, setMensaje] = useState<string>("");
  const [reporteId, setReporteId] = useState<string | null>(null);

  useEffect(() => {
    if (!reporteId || fase !== "procesando") return;
    const t = setInterval(async () => {
      const { data } = await supabase.from("reportes").select("estado, error, total_lineas, total_ok").eq("id", reporteId).single();
      if (!data) return;
      if (data.estado === "error") {
        setFase("error");
        setMensaje(data.error ?? "La IA no pudo leer el archivo.");
      } else if (data.estado === "cerrado" || data.estado === "matcheado") {
        setFase("listo");
        setMensaje(`Libro actualizado: ${data.total_ok ?? data.total_lineas ?? 0} pólizas procesadas.`);
        onDone();
      } else {
        setMensaje(LABEL[data.estado] ?? data.estado);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [reporteId, fase, onDone]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFase("subiendo");
    setMensaje(`Subiendo ${file.name}…`);
    try {
      const { reporteId: id } = await uploadReporte({ file, tipo: "actualizacion_abb" });
      setReporteId(id);
      setFase("procesando");
      setMensaje(LABEL.subido);
    } catch (e) {
      setFase("error");
      setMensaje(e instanceof DuplicadoError ? "Ese archivo ya se subió antes (idéntico)." : e instanceof Error ? e.message : "No se pudo subir el archivo.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const ocupado = fase === "subiendo" || fase === "procesando";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <Button size="sm" variant="primary" disabled={ocupado} onClick={() => inputRef.current?.click()} title="Subí el libro de clientes (Excel, CSV o PDF); la IA lo estructura y actualiza el Active Business Book">
        {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Subir libro desde archivo
      </Button>
      {fase !== "idle" && (
        <div className="basis-full">
          <Banner tone={fase === "error" ? "bad" : "info"} action={fase === "listo" || fase === "error" ? <button type="button" className="text-xs underline" onClick={() => setFase("idle")}>Cerrar</button> : undefined}>
            {mensaje}
          </Banner>
        </div>
      )}
    </>
  );
}
