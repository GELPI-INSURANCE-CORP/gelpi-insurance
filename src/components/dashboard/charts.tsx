"use client";

import { useId } from "react";

// Gráficas del dashboard, dibujadas a mano en SVG.
//
// Sin librería a propósito: el proyecto exporta estático y no tiene ninguna hoy, y estas tres
// formas son cien líneas de matemática de secundaria. Meter recharts para esto traería 400 KB
// al bundle y una forma nueva de romperse en cada actualización.
//
// Todas reciben números ya calculados. Ninguna inventa un punto que no le hayan pasado: en una
// pantalla donde se mira plata, una línea de relleno se ve igual de bonita que una de verdad, y
// esa es exactamente la razón por la que no puede haber ninguna.

export const COLORES_GRAFICA = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
] as const;

// ---------------------------------------------------------------------------
// Sparkline: la forma de la curva, sin ejes ni números
// ---------------------------------------------------------------------------
// Va al pie de una tarjeta de KPI. No se lee un valor acá — para eso está el número grande
// arriba. Lo único que tiene que comunicar es si esto viene subiendo, bajando o plano.
export function Sparkline({
  datos,
  color = "var(--chart-1)",
  alto = 44,
}: {
  datos: number[];
  color?: string;
  alto?: number;
}) {
  const id = useId();
  if (datos.length < 2) return <div style={{ height: alto }} />;

  const W = 100;
  const H = 32;
  const min = Math.min(...datos);
  const max = Math.max(...datos);
  // Cuando todos los valores son iguales el rango es 0 y la división explota: se dibuja plano
  // en el medio, que es exactamente lo que esa serie significa.
  const rango = max - min || 1;
  const x = (i: number) => (i / (datos.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / rango) * (H - 4) - 2;

  const linea = datos.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${linea} L${W},${H} L0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height: alto, width: "100%", display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      {/* non-scaling-stroke: sin esto, estirar el viewBox a lo ancho de la tarjeta deforma el
          grosor de la línea y queda gorda abajo y fina arriba. */}
      <path
        d={linea}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dona: de qué está hecho un total
// ---------------------------------------------------------------------------
export interface PorcionDona {
  etiqueta: string;
  valor: number;
  color: string;
}

export function Dona({
  porciones,
  centroArriba,
  centroAbajo,
  tamano = 180,
}: {
  porciones: PorcionDona[];
  centroArriba: string;
  centroAbajo: string;
  tamano?: number;
}) {
  const total = porciones.reduce((s, p) => s + p.valor, 0);
  const R = 42;
  const CIRC = 2 * Math.PI * R;
  let acumulado = 0;

  return (
    <div style={{ width: tamano, height: tamano }} className="relative flex-shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {total <= 0 ? (
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--border)" strokeWidth="14" />
        ) : (
          porciones.map((p) => {
            const fraccion = p.valor / total;
            const dash = fraccion * CIRC;
            const offset = -acumulado * CIRC;
            acumulado += fraccion;
            return (
              <circle
                key={p.etiqueta}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={p.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${CIRC - dash}`}
                strokeDashoffset={offset}
              >
                <title>{p.etiqueta}</title>
              </circle>
            );
          })
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[19px] font-semibold tabular-nums leading-tight text-foreground">{centroArriba}</div>
        <div className="text-[11px] text-muted">{centroAbajo}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cascada: cómo se llega de un número a otro
// ---------------------------------------------------------------------------
// Cada paso arranca donde terminó el anterior, así se ve qué se le fue restando al total. La
// última barra no es un paso: sale desde cero y es el saldo final.
export interface PasoCascada {
  etiqueta: string;
  valor: number;
  esTotal?: boolean;
}

export function Cascada({ pasos, alto = 190 }: { pasos: PasoCascada[]; alto?: number }) {
  // Primero se recorren los pasos acumulando, para saber hasta dónde sube y hasta dónde baja el
  // conjunto. La escala tiene que salir de ahí y no del valor más grande suelto: si no, una
  // barra que cruza el cero se sale del dibujo.
  let corriendo = 0;
  const tramos = pasos.map((p) => {
    const desde = p.esTotal ? 0 : corriendo;
    const hasta = p.esTotal ? p.valor : corriendo + p.valor;
    if (!p.esTotal) corriendo += p.valor;
    return { ...p, desde, hasta };
  });

  const topes = tramos.flatMap((t) => [t.desde, t.hasta]).concat(0);
  const max = Math.max(...topes);
  const min = Math.min(...topes);
  const rango = max - min || 1;
  const aY = (v: number) => ((max - v) / rango) * (alto - 26);
  const yCero = aY(0);

  return (
    <div className="w-full">
      {/* La línea del cero va una sola vez por encima de todas las columnas. Dibujada por columna
          quedaba cortada en cada hueco del flex y parecía una fila de guiones sueltos. */}
      <div className="relative flex items-end gap-2" style={{ height: alto - 26 }}>
        <div
          className="pointer-events-none absolute left-0 right-0 z-0 border-t border-dashed border-border"
          style={{ top: yCero }}
          aria-hidden
        />
        {tramos.map((t) => {
          const arriba = Math.min(aY(t.desde), aY(t.hasta));
          const altoBarra = Math.max(Math.abs(aY(t.hasta) - aY(t.desde)), 2);
          const sube = t.hasta >= t.desde;
          const color = t.esTotal
            ? t.valor < 0
              ? "var(--bad-fg)"
              : "var(--ok-fg)"
            : sube
              ? "var(--ok-fg)"
              : "var(--bad-fg)";
          return (
            <div key={t.etiqueta} className="relative z-10 flex-1" style={{ height: alto - 26 }}>
              <div
                className="absolute left-1/2 w-full max-w-[52px] -translate-x-1/2 rounded-[3px]"
                style={{ top: arriba, height: altoBarra, background: color, opacity: t.esTotal ? 1 : 0.85 }}
                title={`${t.etiqueta}: ${t.valor.toLocaleString("en-US", { style: "currency", currency: "USD" })}`}
              />
              <div
                className="absolute left-0 right-0 text-center text-[10px] font-medium tabular-nums text-foreground"
                style={{ top: Math.max(arriba - 15, 0) }}
              >
                {t.valor === 0
                  ? "$0"
                  : t.valor.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {tramos.map((t) => (
          <div key={t.etiqueta} className="flex-1 text-center text-[10px] leading-tight text-muted">
            {t.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}
