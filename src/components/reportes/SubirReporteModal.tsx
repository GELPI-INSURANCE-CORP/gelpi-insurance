"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { UploadCloud, Search, X, FileText, Loader2, Plus } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/agentes/ui";
import { TIPOS_REPORTE } from "@/lib/format";
import {
  DuplicadoError,
  listAseguradoras,
  uploadReporte,
  type Aseguradora,
  type TipoReporte,
} from "@/lib/queries/subir";
import { crearAseguradora } from "@/lib/queries/configuracion";

// Los tipos que se suben desde acá, en el orden en que hacen falta. El statement de comisiones es
// el de todos los meses y va primero; el resto son casos sueltos. 'actualizacion_abb' no está a
// propósito: el Book se sube desde Book of Business, que es donde se lo mira.
const TIPOS: TipoReporte[] = [
  "comision_aseguradora",
  "produccion",
  "cancelaciones",
  "renovaciones",
  "chargebacks",
  "resumen_anual",
  "bono_contingencia",
  "venta_interna",
  "otro",
];

// Para qué sirve cada tipo, en una línea. Los nombres solos no se lo dicen a nadie que no haya
// armado el sistema — "Reporte de ventas (interno)" es el caso claro: nadie sabe qué es sin esto.
const AYUDA: Partial<Record<TipoReporte, string>> = {
  comision_aseguradora: "El estado de cuenta que manda la compañía con lo que te pagó este mes.",
  produccion: "Las pólizas nuevas que la compañía registró en el período.",
  cancelaciones: "Pólizas canceladas o por cancelar, para anticipar los chargebacks.",
  renovaciones: "Las que vencen o ya renovaron.",
  chargebacks: "Comisiones que la compañía te descuenta por cancelaciones.",
  resumen_anual: "El consolidado del año (1099).",
  bono_contingencia: "El bono anual o de contingencia, para repartirlo entre los agentes.",
  venta_interna:
    "El Excel del sistema interno con lo que vendió cada agente. Sirve para cruzarlo contra el statement y ver si la compañía te pagó todo lo que se vendió. Si no llevás ese registro aparte, no lo necesitás.",
  otro: "Cualquier otro archivo de la compañía; la IA intenta reconocerlo sola.",
};

const SIN_ASEGURADORA: TipoReporte[] = ["venta_interna"];

export default function SubirReporteModal({
  open,
  onClose,
  aseguradoras,
  onAseguradorasChange,
  onSubido,
}: {
  open: boolean;
  onClose: () => void;
  aseguradoras: Aseguradora[];
  onAseguradorasChange: (lista: Aseguradora[]) => void;
  onSubido: () => void;
}) {
  const [tipo, setTipo] = useState<TipoReporte>("comision_aseguradora");
  const [aseguradoraId, setAseguradoraId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputFile = useRef<HTMLInputElement>(null);

  // Cada vez que se abre, el formulario arranca limpio. Dejar la compañía del mes pasado elegida es
  // la forma más fácil de subir un statement de United como si fuera de Progressive.
  useEffect(() => {
    if (!open) return;
    setTipo("comision_aseguradora");
    setAseguradoraId("");
    setBusqueda("");
    setPeriodo("");
    setArchivos([]);
    setError(null);
  }, [open]);

  const pideAseguradora = !SIN_ASEGURADORA.includes(tipo);

  const filtradas = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    const lista = t ? aseguradoras.filter((a) => a.nombre.toLowerCase().includes(t)) : aseguradoras;
    return lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [aseguradoras, busqueda]);

  // Solo se ofrece crear cuando lo buscado no existe: si escribe "Progre" y Progressive está en la
  // lista, ofrecerle crear "Progre" es la mejor manera de terminar con la compañía duplicada.
  const nombreNuevo = busqueda.trim();
  const puedeCrear =
    nombreNuevo.length >= 3 && !aseguradoras.some((a) => a.nombre.toLowerCase() === nombreNuevo.toLowerCase());

  async function crear() {
    if (!puedeCrear) return;
    setCreando(true);
    setError(null);
    try {
      await crearAseguradora(nombreNuevo, "");
      const lista = await listAseguradoras();
      onAseguradorasChange(lista);
      const creada = lista.find((a) => a.nombre.toLowerCase() === nombreNuevo.toLowerCase());
      if (creada) {
        setAseguradoraId(creada.id);
        setBusqueda("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la compañía.");
    } finally {
      setCreando(false);
    }
  }

  function agregar(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    setArchivos((prev) => [...prev, ...Array.from(lista)]);
    setError(null);
  }

  async function subir() {
    if (archivos.length === 0) {
      setError("Falta el archivo.");
      return;
    }
    if (pideAseguradora && !aseguradoraId) {
      setError("Elegí la compañía.");
      return;
    }
    setSubiendo(true);
    setError(null);
    const fallados: string[] = [];
    for (const file of archivos) {
      try {
        await uploadReporte({
          file,
          tipo,
          aseguradoraId: pideAseguradora ? aseguradoraId : null,
          periodo: periodo.trim() || null,
        });
      } catch (err) {
        fallados.push(
          err instanceof DuplicadoError
            ? `${file.name}: ya lo habías subido, es el mismo archivo.`
            : `${file.name}: ${err instanceof Error ? err.message : "no se pudo subir"}`
        );
      }
    }
    setSubiendo(false);
    onSubido();
    // Si alguno falló se queda abierto con el detalle: cerrar y mostrar el error atrás deja al
    // usuario sin saber cuál de los archivos no entró.
    if (fallados.length > 0) {
      setError(fallados.join(" · "));
      setArchivos([]);
      return;
    }
    onClose();
  }

  const nombreAseguradora = aseguradoras.find((a) => a.id === aseguradoraId)?.nombre ?? "";

  return (
    <Modal open={open} onClose={subiendo ? () => {} : onClose} title="Subir un reporte" width="580px">
      <div className="flex flex-col gap-5">
        <Campo label="Tipo de reporte">
          <select
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoReporte);
              setError(null);
            }}
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none focus:border-brand"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {TIPOS_REPORTE[t]}
              </option>
            ))}
          </select>
          {AYUDA[tipo] && <p className="mt-1.5 text-xs leading-relaxed text-muted">{AYUDA[tipo]}</p>}
        </Campo>

        {pideAseguradora && (
          <Campo label="Compañía">
            {aseguradoraId ? (
              <div className="flex h-10 items-center justify-between rounded-lg border border-brand bg-brand-tint/40 px-3">
                <span className="text-[13px] font-medium text-foreground">{nombreAseguradora}</span>
                <button
                  type="button"
                  onClick={() => setAseguradoraId("")}
                  className="text-muted hover:text-foreground"
                  aria-label="Cambiar compañía"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar compañía…"
                    autoFocus
                    className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-brand"
                  />
                </div>
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border">
                  {filtradas.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAseguradoraId(a.id);
                        setError(null);
                      }}
                      className="flex w-full items-center px-3 py-2 text-left text-[13px] text-foreground hover:bg-brand-tint/50"
                    >
                      {a.nombre}
                    </button>
                  ))}
                  {filtradas.length === 0 && (
                    <p className="px-3 py-2.5 text-xs text-muted">No hay ninguna compañía con ese nombre.</p>
                  )}
                </div>
                {puedeCrear && (
                  <button
                    type="button"
                    onClick={crear}
                    disabled={creando}
                    className="mt-1.5 flex items-center gap-1.5 self-start text-xs text-brand hover:underline disabled:opacity-50"
                  >
                    {creando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Agregar “{nombreNuevo}” como compañía nueva
                  </button>
                )}
              </>
            )}
          </Campo>
        )}

        <Campo label="Período" opcional>
          <input
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            placeholder="Agosto 2026"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-muted focus:border-brand"
          />
        </Campo>

        <Campo label="Archivo">
          <div
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setArrastrando(false);
              agregar(e.dataTransfer.files);
            }}
            onClick={() => inputFile.current?.click()}
            className={clsx(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
              arrastrando ? "border-brand bg-brand-tint/50" : "border-border hover:border-brand/60 hover:bg-background"
            )}
          >
            <UploadCloud size={22} className="text-muted" />
            <span className="text-[13px] text-foreground">Arrastrá el archivo o hacé clic para elegirlo</span>
            <span className="text-xs text-muted">PDF · Excel · CSV — la IA lee cualquiera</span>
          </div>
          <input
            ref={inputFile}
            type="file"
            multiple
            accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              agregar(e.target.files);
              e.target.value = "";
            }}
          />
          {archivos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {archivos.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                >
                  <FileText size={13} className="flex-shrink-0 text-muted" />
                  <span className="flex-1 truncate text-foreground">{f.name}</span>
                  <span className="flex-shrink-0 text-muted">{(f.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    onClick={() => setArchivos((prev) => prev.filter((_, j) => j !== i))}
                    className="flex-shrink-0 text-muted hover:text-foreground"
                    aria-label={`Quitar ${f.name}`}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Campo>

        {error && (
          <p className="rounded-lg border border-bad-fg/30 bg-bad-bg px-3 py-2.5 text-xs leading-relaxed text-bad-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={subiendo}
            className="h-9 rounded-lg border border-border px-4 text-[13px] text-foreground hover:bg-background disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={subir}
            disabled={subiendo}
            className="flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {subiendo && <Loader2 size={14} className="animate-spin" />}
            {subiendo ? "Subiendo…" : "Subir reporte"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Campo({ label, opcional, children }: { label: string; opcional?: boolean; children: ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="mb-1.5 text-xs font-medium text-foreground">
        {label}
        {opcional && <span className="ml-1.5 font-normal text-muted">(opcional)</span>}
      </span>
      {children}
    </label>
  );
}
