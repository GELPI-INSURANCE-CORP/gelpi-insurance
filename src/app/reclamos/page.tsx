import { reclamos } from "@/lib/mock-data";
import StatusBadge from "@/components/StatusBadge";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const date = (d: string) => new Date(d).toLocaleDateString("es-US", { year: "numeric", month: "short", day: "numeric" });

export default function ReclamosPage() {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-foreground">Reclamos</h2>
        <span className="text-sm text-muted">{reclamos.length} reclamos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">Número</th>
              <th className="px-5 py-3 font-medium">Póliza</th>
              <th className="px-5 py-3 font-medium">Cliente</th>
              <th className="px-5 py-3 font-medium">Tipo</th>
              <th className="px-5 py-3 font-medium">Monto</th>
              <th className="px-5 py-3 font-medium">Fecha</th>
              <th className="px-5 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {reclamos.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-background/60">
                <td className="px-5 py-3 font-medium text-foreground">{r.numero}</td>
                <td className="px-5 py-3 text-muted">{r.polizaNumero}</td>
                <td className="px-5 py-3">{r.clienteNombre}</td>
                <td className="px-5 py-3">{r.tipo}</td>
                <td className="px-5 py-3">{currency(r.monto)}</td>
                <td className="px-5 py-3 text-muted">{date(r.fecha)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={r.estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
