"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { SidePanel, Badge, Chip, Loading, Button } from "@/components/agentes/ui";
import { money, fecha as fmtFecha } from "@/lib/format";
import { getDetalleAgente, type LineaDeAgente, type OrigenVeredicto } from "@/lib/queries/liquidacion";
import { clasificarNegocio, desclasificarNegocio } from "@/lib/queries/conciliacion";

// Qué hay detrás del número de un agente en Liquidación, y de dónde salió cada peso.
//
// Antes, para saber de dónde salían los $10.100 de alguien había que abrir cada statement y
// filtrar por esa persona — y sus ventas de un mismo mes pueden estar repartidas entre cinco
// compañías. Acá se ven todas juntas, con la fecha, la póliza y el cliente.
//
// Las líneas se separan en las tres cajas que deciden el pago: negocio nuevo (lo que se paga),
// renovación (lo que no) y sin clasificar (lo que hay que mirar). Las cajas son botones: se
// clickea una y la tabla se queda sólo con esas líneas.
//
// Y se clasifica DESDE ACÁ. Arturo: *"¿cómo yo puedo entrar a cada una de esas policies de sin
// clasificar para ver si las ajusto y son clasificadas? Necesito ver esa clasificación."* Antes
// la única forma era irse a Conciliación y buscar al agente a mano entre cientos de líneas, con
// lo cual nadie clasificó nunca nada: en seis meses de statements hay exactamente cero
// decisiones tomadas. El trabajo tiene que estar donde aparece el problema.
//
// La columna "Cómo se supo" no es decoración. Cuando el pago depende de que una línea esté de un
// lado y no del otro, hay que poder contestar "¿y esto por qué se paga?" sin abrir el Excel de
// la compañía — y hay que poder ver cuándo fue el sistema el que dedujo, para desconfiar de eso
// y no de lo que vino escrito en el archivo.

type Foco = "todas" | "nuevo" | "renovacion" | "sin_clasificar";

const ORIGEN: Record<OrigenVeredicto, { texto: string; tono: "ok" | "info" | "brand" | "warn" | "neutral"; ayuda: string }> = {
  archivo: {
    texto: "Lo dice la compañía",
    tono: "ok",
    ayuda: "El statement trae la línea marcada como negocio nuevo o renovación. Es la fuente más confiable.",
  },
  mismo_statement: {
    texto: "Por la póliza",
    tono: "info",
    ayuda: "La línea no lo decía, pero otras líneas de la misma póliza en este mismo statement sí.",
  },
  a_mano: {
    texto: "Lo decidiste vos",
    tono: "brand",
    ayuda: "Alguien clasificó esta póliza a mano. Le gana a lo que deduzca el sistema.",
  },
  otros_statements: {
    texto: "Por otro statement",
    tono: "warn",
    ayuda: "La misma póliza aparece clasificada en un statement de otro mes. El sistema lo dedujo: si está mal, se corrige acá.",
  },
  sin_clasificar: { texto: "—", tono: "neutral", ayuda: "" },
};

export default function DetalleAgenteDrawer({
  agenteId,
  nombre,
  periodo,
  etiquetaPeriodo,
  focoInicial = "todas",
  onClose,
  onCambio,
}: {
  agenteId: string;
  nombre: string;
  periodo: string;
  etiquetaPeriodo: string;
  // Desde la columna "Sin clasificar" se entra directo a lo que hay que resolver.
  focoInicial?: Foco;
  onClose: () => void;
  // Clasificar cambia cuánto se le paga, así que la pantalla de atrás tiene que recargar.
  onCambio?: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDeAgente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [foco, setFoco] = useState<Foco>(focoInicial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const l = await getDetalleAgente(agenteId, periodo);
      setLineas(l);
      setSel(new Set());
    } catch (e) {
      setError(porQue(e, "No se pudo cargar el detalle."));
    }
  }, [agenteId, periodo]);

  useEffect(() => {
    setLineas(null);
    void cargar();
  }, [cargar]);

  const nuevo = (lineas ?? []).filter((l) => l.negocioNuevo === true);
  const renovacion = (lineas ?? []).filter((l) => l.negocioNuevo === false);
  const sinClasificar = (lineas ?? []).filter((l) => l.negocioNuevo == null);

  const visibles = useMemo(() => {
    if (foco === "nuevo") return nuevo;
    if (foco === "renovacion") return renovacion;
    if (foco === "sin_clasificar") return sinClasificar;
    return lineas ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, foco]);

  // El pago sale del PREMIUM, así que las cajas suman premium. La comisión va abajo y en chico:
  // sigue sirviendo para cuadrar contra el statement, pero ya no es la base del pago.
  const suma = (ls: LineaDeAgente[]) => ls.reduce((s, l) => s + (l.prima ?? 0), 0);
  const sumaComision = (ls: LineaDeAgente[]) => ls.reduce((s, l) => s + l.comision, 0);
  const polizas = new Set((lineas ?? []).map((l) => l.numeroPoliza).filter((p) => p !== "—" && p !== "-")).size;

  // Sólo se pueden clasificar las que tienen número de póliza: la decisión se guarda contra la
  // póliza, no contra la línea, para que reprocesar el statement no la borre. Una línea sin
  // número no tiene dónde guardarse, y ofrecer el botón sería mentir.
  const seleccionables = visibles.filter((l) => l.numeroPoliza !== "—" && l.numeroPoliza !== "-");

  async function conGuardado(fn: () => Promise<string>) {
    setGuardando(true);
    setAviso(null);
    setError(null);
    try {
      const msg = await fn();
      await cargar();
      setAviso(msg);
      onCambio?.();
    } catch (e) {
      setError(porQue(e, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  function clasificar(ids: string[], esNuevo: boolean) {
    if (ids.length === 0) return;
    void conGuardado(async () => {
      const r = await clasificarNegocio(ids, esNuevo, `Desde el pago de ${nombre}, ${etiquetaPeriodo}`);
      const que = esNuevo ? "negocio nuevo" : "renovación";
      const extra = r.lineasAlcanzadas > ids.length
        ? ` Alcanzó ${r.lineasAlcanzadas} líneas en total, porque las demás líneas de esas mismas pólizas la siguen.`
        : "";
      return `${r.polizasGuardadas} póliza${r.polizasGuardadas === 1 ? "" : "s"} marcada${r.polizasGuardadas === 1 ? "" : "s"} como ${que}.${extra}`;
    });
  }

  function deshacer(ids: string[]) {
    if (ids.length === 0) return;
    void conGuardado(async () => {
      const n = await desclasificarNegocio(ids);
      return `Se deshicieron ${n} decisión${n === 1 ? "" : "es"}. Vuelven a quedar como las dejó el statement.`;
    });
  }

  function exportar() {
    const header = ["Fecha", "Compañía", "Póliza", "Cliente", "Tipo", "Negocio nuevo", "Cómo se supo", "Prima", "Comisión", "Statement"];
    const filas = (lineas ?? []).map((l) =>
      [l.fecha ?? "", l.compania, l.numeroPoliza, l.cliente, l.tipo,
       l.negocioNuevo === true ? "Sí" : l.negocioNuevo === false ? "No" : "Sin clasificar",
       ORIGEN[l.origen].texto, l.prima ?? "", l.comision.toFixed(2), l.statement ?? ""]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
    );
    const csv = [header.join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nombre.replace(/\s+/g, "-")}-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const idsSel = [...sel];

  return (
    <SidePanel open onClose={onClose} title={nombre} subtitle={`Lo que vendió en ${etiquetaPeriodo}`} width="1020px">
      {error && <div className="mb-3 rounded-lg bg-bad-bg px-3 py-2 text-[13px] text-bad-fg">{error}</div>}
      {aviso && <div className="mb-3 rounded-lg bg-ok-bg px-3 py-2 text-[13px] text-ok-fg">{aviso}</div>}
      {!error && lineas === null && <Loading />}
      {lineas !== null && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-[13px] text-muted">
              {lineas.length} línea{lineas.length === 1 ? "" : "s"} · {polizas} póliza{polizas === 1 ? "" : "s"} ·{" "}
              {new Set(lineas.map((l) => l.compania)).size} compañía
              {new Set(lineas.map((l) => l.compania)).size === 1 ? "" : "s"}
            </div>
            <Button size="sm" onClick={exportar} disabled={lineas.length === 0}>Exportar a CSV</Button>
          </div>

          {/* Las cajas son botones. La que está activa filtra la tabla. */}
          <div className="grid grid-cols-4 gap-3">
            <Caja titulo="Todo" detalle="el mes completo" monto={suma(lineas)} n={lineas.length}
                  comision={sumaComision(lineas)} activa={foco === "todas"} onClick={() => setFoco("todas")} />
            <Caja titulo="Premium nuevo" detalle="de acá sale el pago" monto={suma(nuevo)} n={nuevo.length}
                  comision={sumaComision(nuevo)} destacado activa={foco === "nuevo"} onClick={() => setFoco("nuevo")} />
            <Caja titulo="Premium renovación" detalle="no se paga" monto={suma(renovacion)} n={renovacion.length}
                  comision={sumaComision(renovacion)} activa={foco === "renovacion"} onClick={() => setFoco("renovacion")} />
            <Caja titulo="Sin clasificar" detalle="hay que decidirlo" monto={suma(sinClasificar)} n={sinClasificar.length}
                  comision={sumaComision(sinClasificar)} alerta={sinClasificar.length > 0}
                  activa={foco === "sin_clasificar"} onClick={() => setFoco("sin_clasificar")} />
          </div>

          {foco === "sin_clasificar" && sinClasificar.length > 0 && (
            <div className="rounded-xl border border-warn-fg/30 bg-warn-bg px-4 py-3 text-[12px] leading-relaxed text-foreground">
              Estas líneas no se pagan ni se descartan: el statement nunca dijo si eran negocio nuevo o
              renovación. Casi todas son cancelaciones y endosos, que por sí solos no dicen a qué término
              pertenecen. <strong>Lo que decidas se guarda contra la póliza</strong>, así que vale también
              para sus otras líneas y no se pierde si el statement se vuelve a procesar.
            </div>
          )}

          {/* Barra de acciones. Sólo aparece con algo seleccionado: un montón de botones apagados
              arriba de la tabla es ruido el 95% del tiempo. */}
          {idsSel.length > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-tint px-3 py-2">
              <span className="text-[13px] font-medium text-brand-dark">
                {idsSel.length} línea{idsSel.length === 1 ? "" : "s"} seleccionada{idsSel.length === 1 ? "" : "s"}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={guardando} onClick={() => clasificar(idsSel, true)}>
                  <Check className="h-3.5 w-3.5" />
                  Es negocio nuevo
                </Button>
                <Button size="sm" variant="secondary" disabled={guardando} onClick={() => clasificar(idsSel, false)}>
                  Es renovación
                </Button>
                <Button size="sm" variant="ghost" disabled={guardando} onClick={() => deshacer(idsSel)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Deshacer
                </Button>
                <Button size="sm" variant="ghost" disabled={guardando} onClick={() => setSel(new Set())}>
                  Quitar selección
                </Button>
              </div>
            </div>
          )}

          {visibles.length === 0 ? (
            <div className="text-[13px] text-muted py-6 text-center">
              {lineas.length === 0
                ? `No hay líneas conciliadas para ${nombre} en ${etiquetaPeriodo}.`
                : "No hay líneas en esta caja."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[13px]">
                <thead>
                  <tr className="text-left text-muted bg-background/60">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todas las visibles"
                        checked={seleccionables.length > 0 && seleccionables.every((l) => sel.has(l.id))}
                        onChange={(e) =>
                          setSel(e.target.checked ? new Set(seleccionables.map((l) => l.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Compañía</th>
                    <th className="px-3 py-2 font-medium">Póliza</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Cómo se supo</th>
                    <th className="px-3 py-2 font-medium text-right">Prima</th>
                    <th className="px-3 py-2 font-medium text-right">Comisión</th>
                    <th className="px-3 py-2 font-medium text-right w-44">Decidir</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((l) => {
                    const puede = l.numeroPoliza !== "—" && l.numeroPoliza !== "-";
                    return (
                      <tr key={l.id} className={sel.has(l.id) ? "border-t border-border bg-brand-tint/40" : "border-t border-border"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar la póliza ${l.numeroPoliza}`}
                            disabled={!puede}
                            checked={sel.has(l.id)}
                            onChange={(e) =>
                              setSel((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(l.id);
                                else next.delete(l.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.fecha ? fmtFecha(l.fecha) : "—"}</td>
                        <td className="px-3 py-2 text-muted whitespace-nowrap">{l.compania}</td>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{l.numeroPoliza}</td>
                        <td className="px-3 py-2">{l.cliente}</td>
                        <td className="px-3 py-2">
                          <Badge tone={l.negocioNuevo === true ? "ok" : l.negocioNuevo === false ? "neutral" : "warn"}>
                            {l.tipo}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {/* Para las que no se pudieron clasificar, acá va el por qué: es la
                              diferencia entre "el sistema falló" y "la compañía no lo dijo".
                              Va corto, con el motivo completo en el globito: el texto entero en
                              la celda hacía tres renglones por fila y empujaba los botones de
                              decidir fuera de la pantalla, que es justo lo que se viene a hacer
                              acá. */}
                          <span title={l.motivo ?? ORIGEN[l.origen].ayuda} className="cursor-help">
                            {l.negocioNuevo == null ? (
                              <Badge tone="warn">{motivoCorto(l.motivo)}</Badge>
                            ) : (
                              <Badge tone={ORIGEN[l.origen].tono}>{ORIGEN[l.origen].texto}</Badge>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">
                          {l.prima == null ? "—" : money(l.prima)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{money(l.comision)}</td>
                        <td className="px-3 py-2 text-right">
                          {!puede ? (
                            <span className="text-[11px] text-muted" title="Sin número de póliza no hay dónde guardar la decisión">
                              sin póliza
                            </span>
                          ) : l.origen === "a_mano" ? (
                            <Button size="sm" variant="ghost" disabled={guardando} onClick={() => deshacer([l.id])}>
                              <RotateCcw className="h-3.5 w-3.5" />
                              Deshacer
                            </Button>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant={l.negocioNuevo === true ? "secondary" : "primary"}
                                      disabled={guardando} title="Marcar esta póliza como negocio nuevo"
                                      onClick={() => clasificar([l.id], true)}>
                                Nuevo
                              </Button>
                              <Button size="sm" variant="secondary" disabled={guardando}
                                      title="Marcar esta póliza como renovación"
                                      onClick={() => clasificar([l.id], false)}>
                                Renov.
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function Caja({
  titulo, detalle, monto, n, comision, destacado, alerta, activa, onClick,
}: {
  titulo: string; detalle: string; monto: number; n: number; comision: number;
  destacado?: boolean; alerta?: boolean; activa?: boolean; onClick?: () => void;
}) {
  const borde = activa
    ? "border-brand ring-1 ring-brand"
    : alerta
      ? "border-warn-fg/30"
      : "border-border";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-background ${borde} ${alerta ? "bg-warn-bg" : ""}`}
    >
      <div className="text-[11px] text-muted uppercase tracking-wide">{titulo}</div>
      <div className={destacado ? "text-[19px] font-semibold tabular-nums" : "text-[19px] tabular-nums"}>{money(monto)}</div>
      <div className="text-[11px] text-muted">
        {n} línea{n === 1 ? "" : "s"} · {detalle}
      </div>
      <div className="text-[11px] text-muted">comisión {money(comision)}</div>
    </button>
  );
}

// Tres palabras en la celda, el motivo completo en el globito. Son tres casos y cada uno pide
// algo distinto: si nadie más tiene la póliza hay que decidirla a mano, si dos statements se
// contradicen hay que mirar cuál está mal, y si no hay número de póliza no hay nada que hacer.
function motivoCorto(motivo: string | null): string {
  if (!motivo) return "No se pudo saber";
  if (motivo.includes("no trae numero")) return "Sin número de póliza";
  if (motivo.includes("aparece como nueva")) return "Los statements se contradicen";
  return "La compañía no lo dijo";
}

// Los errores de Supabase son objetos planos con message/hint/details, no instancias de Error,
// así que un instanceof siempre falla y el usuario termina viendo el texto genérico.
function porQue(e: unknown, generico: string): string {
  if (e && typeof e === "object") {
    const o = e as { message?: string; hint?: string; details?: string };
    const partes = [o.message, o.details, o.hint].filter(Boolean);
    if (partes.length) return partes.join(" — ");
  }
  if (e instanceof Error) return e.message;
  return generico;
}
