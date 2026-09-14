import { FileText, Users, ShieldAlert, DollarSign } from "lucide-react";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import { clientes, comisiones, polizas, reclamos } from "@/lib/mock-data";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function DashboardPage() {
  const polizasActivas = polizas.filter((p) => p.estado === "activa").length;
  const primaTotal = polizas
    .filter((p) => p.estado === "activa")
    .reduce((sum, p) => sum + p.prima, 0);
  const reclamosAbiertos = reclamos.filter(
    (r) => r.estado === "abierto" || r.estado === "en_revision"
  ).length;
  const comisionesPendientes = comisiones
    .filter((c) => !c.pagada)
    .reduce((sum, c) => sum + c.monto, 0);

  const recientes = [...polizas].slice(-5).reverse();

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Pólizas activas" value={String(polizasActivas)} icon={FileText} trend="+2 este mes" trendUp />
        <StatCard label="Clientes" value={String(clientes.length)} icon={Users} trend="+1 este mes" trendUp />
        <StatCard label="Reclamos abiertos" value={String(reclamosAbiertos)} icon={ShieldAlert} trend="2 requieren atención" />
        <StatCard label="Comisiones pendientes" value={currency(comisionesPendientes)} icon={DollarSign} trend={`Prima total activa: ${currency(primaTotal)}`} trendUp />
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Pólizas recientes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Prima</th>
                <th className="px-5 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium text-foreground">{p.numero}</td>
                  <td className="px-5 py-3">{p.clienteNombre}</td>
                  <td className="px-5 py-3">{p.tipo}</td>
                  <td className="px-5 py-3">{currency(p.prima)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={p.estado} />
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
