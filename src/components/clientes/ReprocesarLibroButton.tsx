"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button, Banner } from "@/components/agentes/ui";
import { supabase } from "@/lib/supabase";
import { listReportes, reprocesarReporte, type Reporte } from "@/lib/queries/subir";

// Volver a leer el último libro subido, sin tener que subirlo de nuevo.
//
// Hasta ahora no había forma de hacerlo. El Book salió de la lista de Comisiones cuando esa
// pantalla pasó a mostrar solo statements — es correcto, el padrón de pólizas no es un statement —
// pero el botón de reprocesar vivía ahí, así que se fue con él. Y volver a subir el mismo archivo
// tampoco sirve: el hash es único y el sistema lo rechaza por duplicado.
//
// Eso importa cada vez que se arregla algo en la lectura del libro: el archivo ya está guardado y
// lo único que hace falta es volver a pasarlo por el extractor. El caso concreto fue el nombre de
// los clientes comerciales, que quedaron sin vincular a su póliza por una diferencia entre cómo
// normalizaba el nombre el importador y cómo lo normaliza la base.

const FASES: Record<string, string> = {
  subido: "Archivo recibido, esperando a la IA…",
  extrayendo: "La IA está leyendo el libro…",
  extraido: "Estructurando clientes y pólizas…",
  matcheado: "Aplicando cambios al libro…",
  cerrado: "Libro actualizado.",
};

type Fase = "idle" | "procesando" | "listo" | "error";

export default function ReprocesarLibroButton({ onDone }: { onDone: () => void }) {
  const [libro, setLibro] = useState<Reporte | null>(null);
  const [fase, setFase] = useState<Fase>("idle");
  const [mensaje, setMensaje] = useState("");

  const buscarLibro = useCallback(async () => {
    try {
      const reportes = await listReportes({ familia: "book" });
      setLibro(reportes[0] ?? null);
    } catch {
      // Que no se pueda leer la lista no es motivo para romper la pantalla del Book: el botón
      // simplemente no aparece y todo lo demás sigue funcionando.
      setLibro(null);
    }
  }, []);

  useEffect(() => { void buscarLibro(); }, [buscarLibro]);

  // Mientras corre, se pregunta por el estado igual que al subir: el extractor tarda minutos y sin
  // esto el usuario no sabe si está pasando algo.
  useEffect(() => {
    if (fase !== "procesando" || !libro) return;
    const t = setInterval(async () => {
      const { data } = await supabase
        .from("reportes")
        .select("estado, error, total_ok, total_lineas")
        .eq("id", libro.id)
        .single();
      if (!data) return;
      if (data.estado === "error") {
        setFase("error");
        setMensaje(data.error ?? "La IA no pudo leer el archivo.");
      } else if (data.estado === "cerrado" || data.estado === "matcheado") {
        setFase("listo");
        setMensaje(`Libro actualizado: ${data.total_ok ?? data.total_lineas ?? 0} pólizas procesadas.`);
        onDone();
        void buscarLibro();
      } else {
        setMensaje(FASES[data.estado] ?? data.estado);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [fase, libro, onDone, buscarLibro]);

  async function onReprocesar() {
    if (!libro) return;
    setFase("procesando");
    setMensaje("Volviendo a leer el libro…");
    try {
      await reprocesarReporte(libro.id);
    } catch (e) {
      setFase("error");
      setMensaje(e instanceof Error ? e.message : "No se pudo reprocesar el libro.");
    }
  }

  if (!libro) return null;

  const ocupado = fase === "procesando";

  return (
    <>
      <Button
        size="sm"
        disabled={ocupado}
        onClick={onReprocesar}
        title={`Vuelve a leer "${libro.nombre_archivo}", el último libro subido, sin tener que subirlo otra vez`}
      >
        {ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {ocupado ? "Reprocesando…" : "Reprocesar libro"}
      </Button>
      {fase !== "idle" && mensaje && (
        <Banner tone={fase === "error" ? "bad" : "info"}>{mensaje}</Banner>
      )}
    </>
  );
}
