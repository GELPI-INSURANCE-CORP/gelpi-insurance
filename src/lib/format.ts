export const money = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fecha = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("es-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

export const fechaHora = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("es-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const pct = (n: number | null | undefined) => `${Math.round(n ?? 0)}%`;

export const RAMOS: Record<string, string> = {
  auto: "Auto", hogar: "Hogar", comercial: "Comercial", motocicleta: "Motocicleta", bote: "Bote",
  inquilinos: "Inquilinos", inundacion: "Inundación", umbrella: "Umbrella", vida: "Vida", otro: "Otro",
};

// El tipo de transacción se muestra en inglés porque así viene en los statements de las
// aseguradoras y así lo lee el usuario todos los meses. Los valores guardados siguen en español
// (los fija un check de la tabla): esto es solo la etiqueta.
export const TIPOS_TRANSACCION: Record<string, string> = {
  nueva: "New Business",
  renovacion: "Renewal",
  cancelacion: "Canceled",
  endoso: "Endorsement",
  ajuste: "Adjustment",
  otro: "Other",
};

export const TIPOS_REPORTE: Record<string, string> = {
  comision_aseguradora: "Statement de comisiones", venta_interna: "Reporte de ventas (interno)", bono_contingencia: "Bono / contingencia",
  actualizacion_abb: "Active Business Book", produccion: "Producción / nuevo negocio", cancelaciones: "Cancelaciones y pendientes",
  renovaciones: "Renovaciones", chargebacks: "Chargebacks y ajustes", resumen_anual: "Resumen anual (1099)", otro: "Otro",
};

export const ESTADOS_LINEA: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" | "brand" }> = {
  pendiente: { label: "Pendiente", tone: "neutral" },
  conciliado_auto: { label: "Conciliado automático", tone: "ok" },
  conciliado_confirmado: { label: "Conciliado (confirmado)", tone: "ok" },
  mismatch: { label: "Mismatch", tone: "warn" },
  sin_identificar: { label: "Sin identificar", tone: "bad" },
  en_espera: { label: "En espera", tone: "info" },
  duplicado_sospechoso: { label: "Duplicado sospechoso", tone: "neutral" },
  descartado: { label: "Descartado", tone: "neutral" },
  cuenta_casa: { label: "Cuenta de la casa", tone: "brand" },
};
