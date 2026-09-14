import clsx from "clsx";

const STYLES: Record<string, string> = {
  activa: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  aprobado: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pagado: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pagada: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pendiente: "bg-amber-50 text-amber-700 ring-amber-600/20",
  en_revision: "bg-amber-50 text-amber-700 ring-amber-600/20",
  abierto: "bg-blue-50 text-blue-700 ring-blue-600/20",
  vencida: "bg-red-50 text-red-700 ring-red-600/20",
  cancelada: "bg-red-50 text-red-700 ring-red-600/20",
  rechazado: "bg-red-50 text-red-700 ring-red-600/20",
  no_pagada: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const LABELS: Record<string, string> = {
  activa: "Activa",
  aprobado: "Aprobado",
  pagado: "Pagado",
  pagada: "Pagada",
  pendiente: "Pendiente",
  en_revision: "En revisión",
  abierto: "Abierto",
  vencida: "Vencida",
  cancelada: "Cancelada",
  rechazado: "Rechazado",
  no_pagada: "No pagada",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        STYLES[status] ?? STYLES.no_pagada
      )}
    >
      {LABELS[status] ?? status}
    </span>
  );
}
