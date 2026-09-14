import { polizas } from "@/lib/mock-data";
import StatusBadge from "@/components/StatusBadge";

const currency = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const date = (d: string) => new Date(d).toLocaleDateString("es-US", { year: "numeric", month: "short", day: "numeric" });

export default function PolizasPage() {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-foreground">Todas las pólizas</h2>
        <span className="text-sm text-muted">{polizas.length} pólizas</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">Número</th>
              <th className="px-5 py-3 font-medium">Cliente</th>
              <th className="px-5 py-3 font-medium">Tipo</th>
              <th className="px-5 py-3 font-medium">Aseguradora</th>
              <th className="px-5 py-3 font-medium">Prima</th>
              <th className="px-5 py-3 font-medium">Vigencia</th>
              <th className="px-5 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {polizas.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-background/60">
                <td className="px-5 py-3 font-medium text-foreground">{p.numero}</td>
                <td className="px-5 py-3">{p.clienteNombre}</td>
                <td className="px-5 py-3">{p.tipo}</td>
                <td className="px-5 py-3">{p.aseguradora}</td>
                <td className="px-5 py-3">{currency(p.prima)}</td>
                <td className="px-5 py-3 text-muted">
                  {date(p.inicio)} – {date(p.vencimiento)}
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={p.estado} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
