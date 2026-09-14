import { comisiones } from "@/lib/mock-data";
import StatusBadge from "@/components/StatusBadge";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ComisionesPage() {
  const total = comisiones.reduce((sum, c) => sum + c.monto, 0);
  const pendiente = comisiones.filter((c) => !c.pagada).reduce((sum, c) => sum + c.monto, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Total en comisiones</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{currency(total)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">Pendiente de pago</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{currency(pendiente)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Comisiones por agente</h2>
          <span className="text-sm text-muted">{comisiones.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="px-5 py-3 font-medium">Agente</th>
                <th className="px-5 py-3 font-medium">Póliza</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">%</th>
                <th className="px-5 py-3 font-medium">Monto</th>
                <th className="px-5 py-3 font-medium">Período</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {comisiones.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-background/60">
                  <td className="px-5 py-3 font-medium text-foreground">{c.agente}</td>
                  <td className="px-5 py-3 text-muted">{c.polizaNumero}</td>
                  <td className="px-5 py-3">{c.clienteNombre}</td>
                  <td className="px-5 py-3">{c.porcentaje}%</td>
                  <td className="px-5 py-3">{currency(c.monto)}</td>
                  <td className="px-5 py-3 text-muted">{c.periodo}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.pagada ? "pagada" : "no_pagada"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
