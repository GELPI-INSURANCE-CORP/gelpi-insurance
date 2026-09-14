"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldAlert } from "lucide-react";
import { Card, CardHead, Input, TextInput, TextArea, Button, Badge, Banner, Loading, EmptyState, Field, Modal } from "@/components/agentes/ui";
import { fechaHora } from "@/lib/format";
import {
  listAlias,
  agregarAlias,
  toggleAlias,
  borrarAlias,
  getConfiguracion,
  setConfiguracion,
  listAseguradoras,
  actualizarPlantillaMapeo,
  crearAseguradora,
  listOficinasConGerente,
  actualizarPctOverride,
  type AliasAgencia,
  type ConfigValores,
  type AseguradoraRow,
} from "@/lib/queries/configuracion";

export default function ConfiguracionPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">Configuración</h1>
      <SeccionAlias />
      <SeccionUmbrales />
      <SeccionPlantillas />
      <SeccionChargebacks />
      <SeccionOficinas />
    </div>
  );
}

function SeccionAlias() {
  const [alias, setAlias] = useState<AliasAgencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [nuevo, setNuevo] = useState("");
  const [saving, setSaving] = useState(false);

  const cargar = () => {
    setLoading(true);
    listAlias()
      .then(setAlias)
      .finally(() => setLoading(false));
  };
  useEffect(cargar, []);

  async function agregar() {
    if (!nuevo.trim()) return;
    setSaving(true);
    try {
      await agregarAlias(nuevo.trim(), null);
      setNuevo("");
      cargar();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHead title="Alias de la agencia" subtitle="Textos del campo 'Productor del reporte' que se consideran la agencia, no un agente real." />
      <div className="p-4 flex items-center gap-2">
        <Input value={nuevo} onChange={setNuevo} placeholder="Ej: Gelpi Insurance LLC" icon={false} className="flex-1" />
        <Button size="sm" onClick={agregar} disabled={saving || !nuevo.trim()}>
          <Plus className="w-3.5 h-3.5" />
          Agregar
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : alias.length === 0 ? (
        <EmptyState title="Sin alias" subtitle="Agregá el primer alias de la agencia." />
      ) : (
        <div className="divide-y divide-border">
          {alias.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <div className="flex items-center gap-3">
                <span className="font-medium">{a.texto}</span>
                <Badge tone={a.activo ? "ok" : "neutral"}>{a.activo ? "Activo" : "Inactivo"}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <button className="text-brand text-xs hover:underline" onClick={() => toggleAlias(a.id, !a.activo).then(cargar)}>
                  {a.activo ? "Desactivar" : "Activar"}
                </button>
                <button className="text-bad-fg text-xs hover:underline" onClick={() => borrarAlias(a.id).then(cargar)}>
                  <Trash2 className="w-3 h-3 inline" /> Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SeccionUmbrales() {
  const [config, setConfig] = useState<ConfigValores | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getConfiguracion().then(setConfig);
  }, []);

  async function guardar(clave: keyof ConfigValores, valor: number) {
    setSaving(clave);
    try {
      await setConfiguracion(clave, valor);
      setConfig((c) => (c ? { ...c, [clave]: valor } : c));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHead title="Umbrales de score" subtitle="Controlan cuándo el motor de matching concilia solo, cuándo pide confirmación y cuándo escala." />
      <div className="p-4">
        <Banner tone="warn">
          <ShieldAlert className="w-3.5 h-3.5 inline mr-1.5" />
          Regla dura: un falso match automático es peor que una excepción sin resolver, porque un falso match nunca se vuelve a revisar.
        </Banner>
      </div>
      {!config ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 pt-0">
          <UmbralInput label="Umbral auto (%)" value={config.umbral_auto} onSave={(v) => guardar("umbral_auto", v)} saving={saving === "umbral_auto"} />
          <UmbralInput label="Umbral mismatch (%)" value={config.umbral_mismatch} onSave={(v) => guardar("umbral_mismatch", v)} saving={saving === "umbral_mismatch"} />
          <UmbralInput label="Días para 'Atrasada'" value={config.dias_atrasada} onSave={(v) => guardar("dias_atrasada", v)} saving={saving === "dias_atrasada"} />
          <UmbralInput label="Ventana vigencia (días)" value={config.ventana_dias_vigencia} onSave={(v) => guardar("ventana_dias_vigencia", v)} saving={saving === "ventana_dias_vigencia"} />
        </div>
      )}
    </Card>
  );
}

function UmbralInput({ label, value, onSave, saving }: { label: string; value: number; onSave: (v: number) => void; saving: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <TextInput type="number" value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" onClick={() => onSave(Number(v))} disabled={saving || Number(v) === value}>
          {saving ? "…" : "Guardar"}
        </Button>
      </div>
    </Field>
  );
}

function SeccionPlantillas() {
  const [aseguradoras, setAseguradoras] = useState<AseguradoraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<AseguradoraRow | null>(null);
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");

  const cargar = () => {
    setLoading(true);
    listAseguradoras()
      .then(setAseguradoras)
      .finally(() => setLoading(false));
  };
  useEffect(cargar, []);

  async function crear() {
    if (!nombre.trim()) return;
    await crearAseguradora(nombre.trim(), codigo.trim());
    setNombre("");
    setCodigo("");
    setNuevaOpen(false);
    cargar();
  }

  return (
    <Card>
      <CardHead
        title="Plantillas de mapeo por aseguradora"
        actions={
          <Button size="sm" onClick={() => setNuevaOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Nueva aseguradora
          </Button>
        }
      />
      {loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium">Aseguradora</th>
                <th className="px-4 py-2.5 font-medium">Código</th>
                <th className="px-4 py-2.5 font-medium">Última actualización</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {aseguradoras.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{a.nombre}</td>
                  <td className="px-4 py-2.5 text-muted">{a.codigo ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{fechaHora(a.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <button className="text-brand text-xs hover:underline" onClick={() => setEditando(a)}>
                      Ver/editar plantilla
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <PlantillaModal
          aseguradora={editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}

      <Modal open={nuevaOpen} onClose={() => setNuevaOpen(false)} title="Nueva aseguradora">
        <div className="flex flex-col gap-3">
          <Field label="Nombre">
            <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Código">
            <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => setNuevaOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={crear}>
              Crear
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function PlantillaModal({ aseguradora, onClose, onSaved }: { aseguradora: AseguradoraRow; onClose: () => void; onSaved: () => void }) {
  const [texto, setTexto] = useState(JSON.stringify(aseguradora.plantilla_mapeo ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(texto);
    } catch {
      setError("JSON inválido.");
      return;
    }
    setSaving(true);
    try {
      await actualizarPlantillaMapeo(aseguradora.id, parsed);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Plantilla de mapeo — ${aseguradora.nombre}`} width="640px">
      <TextArea value={texto} onChange={(e) => setTexto(e.target.value)} rows={16} className="font-mono text-xs" />
      {error && <p className="text-xs text-bad-fg mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={guardar} disabled={saving}>
          {saving ? "Guardando…" : "Guardar plantilla"}
        </Button>
      </div>
    </Modal>
  );
}

function SeccionChargebacks() {
  return (
    <Card>
      <CardHead title="Reglas de chargeback" />
      <div className="p-4 text-[13px] text-muted leading-relaxed">
        Si el monto de una línea es negativo o el tipo de transacción es cancelación/ajuste, el sistema busca la línea de
        comisión original ya conciliada con el mismo número de póliza y hereda directo el mismo agente y la misma oficina,
        sin volver a pasar por el pipeline de matching. Si la línea original todavía no se conciliaba cuando llegó el
        chargeback, queda en estado &quot;En espera&quot; — nunca cae en &quot;Sin identificar&quot; por error.
      </div>
    </Card>
  );
}

function SeccionOficinas() {
  type OficinaCfg = { id: string; nombre: string; codigo: string | null; pct_override: number; gerente: { nombre: string } | null };
  const [oficinas, setOficinas] = useState<OficinaCfg[]>([]);
  const [config, setConfig] = useState<ConfigValores | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = () => {
    setLoading(true);
    Promise.all([listOficinasConGerente(), getConfiguracion()])
      .then(([o, c]) => {
        setOficinas(o as unknown as OficinaCfg[]);
        setConfig(c);
      })
      .finally(() => setLoading(false));
  };
  useEffect(cargar, []);

  async function toggleAcceso() {
    if (!config) return;
    const nuevo = !config.acceso_agentes_individuales;
    await setConfiguracion("acceso_agentes_individuales", nuevo);
    setConfig({ ...config, acceso_agentes_individuales: nuevo });
  }

  return (
    <Card>
      <CardHead title="Oficinas y permisos" />
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div>
          <div className="text-[13px] font-medium text-foreground">Acceso de agentes individuales</div>
          <div className="text-xs text-muted">Cada agente puede tener su propio login de solo lectura a su ficha. Apagado por defecto.</div>
        </div>
        {config && (
          <button
            onClick={toggleAcceso}
            className={
              "w-11 h-6 rounded-full relative transition-colors shrink-0 " + (config.acceso_agentes_individuales ? "bg-brand" : "bg-silver")
            }
          >
            <span
              className={
                "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform " +
                (config.acceso_agentes_individuales ? "translate-x-5" : "translate-x-0.5")
              }
            />
          </button>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-muted bg-background/60">
                <th className="px-4 py-2.5 font-medium">Oficina</th>
                <th className="px-4 py-2.5 font-medium">Gerente</th>
                <th className="px-4 py-2.5 font-medium text-right">% Override</th>
              </tr>
            </thead>
            <tbody>
              {oficinas.map((o) => (
                <OficinaRow key={o.id} oficina={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function OficinaRow({ oficina }: { oficina: { id: string; nombre: string; pct_override: number; gerente: { nombre: string } | null } }) {
  const [pct, setPct] = useState(String(oficina.pct_override));
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    try {
      await actualizarPctOverride(oficina.id, Number(pct) || 0);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5 font-medium">{oficina.nombre}</td>
      <td className="px-4 py-2.5 text-muted">{oficina.gerente?.nombre ?? "Sin encargado"}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          <TextInput type="number" value={pct} onChange={(e) => setPct(e.target.value)} className="w-20 text-right" />
          <Button size="sm" onClick={guardar} disabled={saving || Number(pct) === oficina.pct_override}>
            {saving ? "…" : "Guardar"}
          </Button>
        </div>
      </td>
    </tr>
  );
}
