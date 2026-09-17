"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button, Banner } from "@/components/agentes/ui";
import { supabase } from "@/lib/supabase";
import { uploadReporte, reintentarExtraccion, esReporteReintentable, DuplicadoError, type TipoReporte } from "@/lib/queries/subir";

type Fase = "idle" | "subiendo" | "procesando" | "listo" | "error";

export interface SubirLibroLabels {
  boton: string;
  titulo: string;
  fasesPorEstado: Record<string, string>;
  listo: (r: { total_ok: number; total_lineas: number }) => string;
}

export const LABELS_ABB: SubirLibroLabels = {
  boton: "Subir libro desde archivo",
  titulo: "Subí el libro de clientes (Excel, CSV o PDF); la IA lo estructura y actualiza el Active Business Book",
  fasesPorEstado: {
    subido: "Archivo recibido, esperando a la IA…",
    extrayendo: "La IA está leyendo el libro…",
    extraido: "Estructurando clientes y pólizas…",
    matcheado: "Aplicando cambios al libro…",
    cerrado: "Libro actualizado.",
  },
  listo: (r) => `Libro actualizado: ${r.total_ok ?? r.total_lineas ?? 0} pólizas procesadas.`,
};

export default function SubirLibroButton({
  onDone,
  tipo = "actualizacion_abb",
  aseguradoraId = null,
  requiereAseguradora = false,
  labels = LABELS_ABB,
}: {
  onDone: () => void;
  tipo?: TipoReporte;
  aseguradoraId?: string | null;
  requiereAseguradora?: boolean;
  labels?: SubirLibroLabels;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>("idle");
  const [mensaje, setMensaje] = useState<string>("");
  const [reporteId, setReporteId] = useState<string | null>(null);
  const [reintentableId, setReintentableId] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);

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
        setMensaje(labels.listo({ total_ok: data.total_ok, total_lineas: data.total_lineas }));
        onDone();
      } else {
        setMensaje(labels.fasesPorEstado[data.estado] ?? data.estado);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [reporteId, fase, onDone, labels]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (requiereAseguradora && !aseguradoraId) {
      setFase("error");
      setMensaje("Elegí la aseguradora antes de subir el archivo.");
      return;
    }
    setFase("subiendo");
    setMensaje(`Subiendo ${file.name}…`);
    setReintentableId(null);
    try {
      const { reporteId: id } = await uploadReporte({ file, tipo, aseguradoraId });
      setReporteId(id);
      setFase("procesando");
      setMensaje(labels.fasesPorEstado.subido ?? "Archivo recibido, esperando a la IA…");
    } catch (e) {
      if (e instanceof DuplicadoError && e.reporte && esReporteReintentable(e.reporte)) {
        setFase("error");
        setMensaje("Ese archivo ya se había subido pero no terminó de procesarse.");
        setReintentableId(e.reporte.id);
      } else {
        setFase("error");
        setMensaje(e instanceof DuplicadoError ? "Ese archivo ya se subió antes (idéntico)." : e instanceof Error ? e.message : "No se pudo subir el archivo.");
      }
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onReintentar() {
    if (!reintentableId) return;
    setReintentando(true);
    try {
      await reintentarExtraccion(reintentableId);
      setReporteId(reintentableId);
      setReintentableId(null);
      setFase("procesando");
      setMensaje(labels.fasesPorEstado.subido ?? "Archivo recibido, esperando a la IA…");
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo reintentar la extracción.");
    } finally {
      setReintentando(false);
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
      <Button size="sm" variant="primary" disabled={ocupado} onClick={() => inputRef.current?.click()} title={labels.titulo}>
        {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {labels.boton}
      </Button>
      {fase !== "idle" && (
        <div className="basis-full">
          <Banner
            tone={fase === "error" ? "bad" : "info"}
            action={
              reintentableId ? (
                <button type="button" className="text-xs underline disabled:opacity-50" disabled={reintentando} onClick={onReintentar}>
                  {reintentando ? "Reintentando…" : "Reintentar"}
                </button>
              ) : fase === "listo" || fase === "error" ? (
                <button type="button" className="text-xs underline" onClick={() => setFase("idle")}>Cerrar</button>
              ) : undefined
            }
          >
            {mensaje}
          </Banner>
        </div>
      )}
    </>
  );
}
