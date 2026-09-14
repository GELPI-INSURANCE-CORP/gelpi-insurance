import { clientes } from "@/lib/mock-data";

const date = (d: string) => new Date(d).toLocaleDateString("es-US", { year: "numeric", month: "short", day: "numeric" });

export default function ClientesPage() {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold text-foreground">Clientes</h2>
        <span className="text-sm text-muted">{clientes.length} clientes</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="px-5 py-3 font-medium">Nombre</th>
              <th className="px-5 py-3 font-medium">Contacto</th>
              <th className="px-5 py-3 font-medium">Ciudad</th>
              <th className="px-5 py-3 font-medium">Pólizas activas</th>
              <th className="px-5 py-3 font-medium">Cliente desde</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-background/60">
                <td className="px-5 py-3 font-medium text-foreground">{c.nombre}</td>
                <td className="px-5 py-3 text-muted">
                  <div>{c.email}</div>
                  <div>{c.telefono}</div>
                </td>
                <td className="px-5 py-3">{c.ciudad}</td>
                <td className="px-5 py-3">{c.polizasActivas}</td>
                <td className="px-5 py-3 text-muted">{date(c.clienteDesde)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
