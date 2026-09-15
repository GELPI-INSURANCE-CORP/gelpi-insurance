"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2, ShieldAlert, CheckCircle2, Eye, EyeOff, Sparkles } from "lucide-react";
import { Card, CardHead, Input, TextInput, TextArea, Button, Badge, Banner, Loading, EmptyState, Field, Modal, Tabs, Select } from "@/components/agentes/ui";
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
  getAgenteCasa,
  crearAgenteCasa,
  actualizarAgenteCasa,
  getOficinaCasa,
  actualizarOficinaCasa,
  getConfigIA,
  guardarConfigIA,
  probarConexionIA,
  type AliasAgencia,
  type ConfigValores,
  type AseguradoraRow,
  type AgenteCasa,
  type OficinaCasa,
  type ConfigIA,
  type TestIAResult,
} from "@/lib/queries/configuracion";

const TABS = [
  { key: "admin", label: "Ficha del administrador" },
  { key: "alias", label: "Alias de la agencia" },
  { key: "umbrales", label: "Umbrales de match" },
  { key: "ia", label: "Conexión de IA" },
  { key: "plantillas", label: "Plantillas por aseguradora" },
  { key: "oficinas", label: "Oficinas y permisos" },
];

function ConfiguracionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const active = TABS.some((t) => t.key === tabParam) ? (tabParam as string) : "admin";

  function cambiarTab(key: string) {
    router.push(`/comisiones/configuracion/?tab=${key}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">Configuración</h1>
      <Card className="overflow-hidden">
        <Tabs tabs={TABS} active={active} onChange={cambiarTab} />
        <div className="p-4">
          {active === "admin" && <SeccionAdmin />}
          {active === "alias" && <SeccionAlias />}
          {active === "umbrales" && <SeccionUmbrales />}
          {active === "ia" && <SeccionIA />}
          {active === "plantillas" && <SeccionPlantillas />}
          {active === "oficinas" && <SeccionOficinas />}
        </div>
      </Card>
    </div>
  );
}

export default function ConfiguracionPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ConfiguracionContent />
    </Suspense>
  );
}

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast && (
    <div className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg border border-ok-fg/30 bg-ok-bg px-4 py-2.5 text-[13px] font-medium text-ok-fg shadow-lg">
      <CheckCircle2 size={16} />
      {toast}
    </div>
  );
  return { showToast: setToast, toastNode: node };
}

/* ========================= Ficha del administrador ========================= */

function SeccionAdmin() {
  const { showToast, toastNode } = useToast();
  const [agente, setAgente] = useState<AgenteCasa | null | undefined>(undefined);
  const [oficina, setOficina] = useState<OficinaCasa | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ofNombre, setOfNombre] = useState("");
  const [ofDireccion, setOfDireccion] = useState("");

  const cargar = () => {
    getAgenteCasa().then(setAgente);
    getOficinaCasa().then(setOficina);
  };
  useEffect(cargar, []);

  useEffect(() => {
    if (agente) {
      setNombre(agente.nombre ?? "");
      setEmail(agente.email ?? "");
      setTelefono(agente.telefono ?? "");
      setCodigo(agente.codigo ?? "");
    }
  }, [agente]);

  useEffect(() => {
    if (oficina) {
      setOfNombre(oficina.nombre ?? "");
      setOfDireccion(oficina.direccion ?? "");
    }
  }, [oficina]);

  async function crear() {
    if (!nombreNuevo.trim()) return;
    setCreando(true);
    try {
      const nuevo = await crearAgenteCasa(nombreNuevo.trim());
      setAgente(nuevo);
      showToast("Cuenta de la casa creada.");
    } finally {
      setCreando(false);
    }
  }

  async function guardar() {
    if (!agente) return;
    setSaving(true);
    try {
      await actualizarAgenteCasa(agente.id, { nombre, email: email || null, telefono: telefono || null, codigo: codigo || null });
      if (oficina) {
        await actualizarOficinaCasa(oficina.id, { nombre: ofNombre, direccion: ofDireccion || null });
      }
      cargar();
      showToast("Ficha del administrador guardada.");
    } finally {
      setSaving(false);
    }
  }

  if (agente === undefined || oficina === undefined) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      {toastNode}
      <Banner tone="info">
        Esta es la &quot;cuenta de la casa&quot;: el agente que aparece como <strong>Encargado</strong> en las oficinas sin
        gerente propio y como destino de <strong>Cuenta de la casa</strong> en Conciliación (chargebacks y comisiones sin
        agente identificado caen acá).
      </Banner>

      {!agente ? (
        <div className="flex flex-col gap-3 max-w-md">
          <p className="text-[13px] text-muted">No existe todavía un agente marcado como cuenta de la casa. Creá uno para empezar.</p>
          <Field label="Nombre">
            <TextInput value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Ej: Gelpi Insurance" />
          </Field>
          <Button variant="primary" onClick={crear} disabled={creando || !nombreNuevo.trim()}>
            {creando ? "Creando…" : "Crear cuenta de la casa"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-3">Agente</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nombre">
                <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </Field>
              <Field label="Código">
                <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </Field>
              <Field label="Email">
                <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Teléfono">
                <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} />
              </Field>
            </div>
          </div>

          {oficina && (
            <div>
              <h3 className="text-[13px] font-semibold text-foreground mb-3">Oficina matriz</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nombre">
                  <TextInput value={ofNombre} onChange={(e) => setOfNombre(e.target.value)} />
                </Field>
                <Field label="Dirección">
                  <TextInput value={ofDireccion} onChange={(e) => setOfDireccion(e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          <div>
            <Button variant="primary" onClick={guardar} disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================= Alias ========================= */

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
    <div>
      <p className="text-xs text-muted mb-3">Textos del campo &quot;Productor del reporte&quot; que se consideran la agencia, no un agente real.</p>
      <div className="flex items-center gap-2 mb-3">
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
        <div className="divide-y divide-border border border-border rounded-lg">
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
    </div>
  );
}

/* ========================= Umbrales ========================= */

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
    <div>
      <p className="text-xs text-muted mb-3">Controlan cuándo el motor de matching concilia solo, cuándo pide confirmación y cuándo escala.</p>
      <Banner tone="warn">
        <ShieldAlert className="w-3.5 h-3.5 inline mr-1.5" />
        Regla dura: un falso match automático es peor que una excepción sin resolver, porque un falso match nunca se vuelve a revisar.
      </Banner>
      {!config ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <UmbralInput label="Umbral auto (%)" value={config.umbral_auto} onSave={(v) => guardar("umbral_auto", v)} saving={saving === "umbral_auto"} />
          <UmbralInput label="Umbral mismatch (%)" value={config.umbral_mismatch} onSave={(v) => guardar("umbral_mismatch", v)} saving={saving === "umbral_mismatch"} />
          <UmbralInput label="Días para 'Atrasada'" value={config.dias_atrasada} onSave={(v) => guardar("dias_atrasada", v)} saving={saving === "dias_atrasada"} />
          <UmbralInput label="Ventana vigencia (días)" value={config.ventana_dias_vigencia} onSave={(v) => guardar("ventana_dias_vigencia", v)} saving={saving === "ventana_dias_vigencia"} />
        </div>
      )}
      <div className="mt-5 pt-4 border-t border-border text-xs text-muted leading-relaxed">
        <strong className="text-foreground">Reglas de chargeback:</strong> si el monto de una línea es negativo o el tipo de
        transacción es cancelación/ajuste, el sistema busca la línea de comisión original ya conciliada con el mismo número
        de póliza y hereda directo el mismo agente y la misma oficina, sin volver a pasar por el pipeline de matching. Si la
        línea original todavía no se conciliaba cuando llegó el chargeback, queda en estado &quot;En espera&quot; — nunca cae
        en &quot;Sin identificar&quot; por error.
      </div>
    </div>
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

/* ========================= Conexión de IA ========================= */

const MODELOS_IA = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini (recomendado, económico)" },
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { value: "gpt-4.1", label: "gpt-4.1" },
];

function SeccionIA() {
  const { showToast, toastNode } = useToast();
  const [config, setConfig] = useState<ConfigIA | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [reemplazando, setReemplazando] = useState(false);
  const [verKey, setVerKey] = useState(false);
  const [model, setModel] = useState("gpt-4o-mini");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestIAResult | null>(null);

  const cargar = () => {
    getConfigIA().then((c) => {
      setConfig(c);
      setModel(c.model);
      setReemplazando(!c.apiKeyMasked);
    });
  };
  useEffect(cargar, []);

  async function probar() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await probarConexionIA(apiKey.trim() || null, model);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "Error desconocido." });
    } finally {
      setTesting(false);
    }
  }

  async function guardar() {
    setSaving(true);
    try {
      await guardarConfigIA(apiKey.trim() || null, model);
      setApiKey("");
      cargar();
      showToast("Conexión de IA guardada.");
    } finally {
      setSaving(false);
    }
  }

  if (!config) return <Loading />;

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      {toastNode}
      <p className="text-xs text-muted">
        El cliente conecta su propia cuenta de OpenAI. La llave se guarda cifrada en la base del cliente y solo la usa el
        extractor de reportes (<code>extraer-reporte</code>). Sacala en{" "}
        <span className="text-foreground font-medium">platform.openai.com → API keys</span>. El modelo{" "}
        <span className="text-foreground font-medium">gpt-4o-mini</span> es barato: del orden de centavos por statement
        procesado.
      </p>

      <Field label="Llave de API de OpenAI">
        {config.apiKeyMasked && !reemplazando ? (
          <div className="flex items-center gap-2">
            <TextInput value={config.apiKeyMasked} disabled className="flex-1" />
            <Button size="sm" onClick={() => setReemplazando(true)}>
              Reemplazar
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <TextInput
                type={verKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setVerKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
                title={verKey ? "Ocultar" : "Mostrar"}
              >
                {verKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            {config.apiKeyMasked && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReemplazando(false);
                  setApiKey("");
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        )}
      </Field>

      <Field label="Modelo">
        <Select value={model} onChange={setModel} options={MODELOS_IA} className="w-full" />
      </Field>

      <div className="flex items-center gap-2">
        <Button onClick={probar} disabled={testing}>
          <Sparkles className="w-3.5 h-3.5" />
          {testing ? "Probando…" : "Probar conexión"}
        </Button>
        <Button variant="primary" onClick={guardar} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      {testResult && (
        <Banner tone={testResult.ok ? "info" : "bad"}>
          {testResult.ok
            ? `Conexión OK — modelo ${testResult.model}, ${testResult.latency_ms}ms.`
            : `Error: ${testResult.error ?? "no se pudo conectar."}`}
        </Banner>
      )}
    </div>
  );
}

/* ========================= Plantillas ========================= */

function SeccionPlantillas() {
  const [aseguradoras, setAseguradoras] = useState<AseguradoraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<AseguradoraRow | null>(null);
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [errorCrear, setErrorCrear] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = () => {
    setLoading(true);
    listAseguradoras()
      .then(setAseguradoras)
      .finally(() => setLoading(false));
  };
  useEffect(cargar, []);

  async function crear() {
    if (!nombre.trim()) return;
    setCreando(true);
    setErrorCrear(null);
    try {
      await crearAseguradora(nombre.trim(), codigo.trim());
      setNombre("");
      setCodigo("");
      setNuevaOpen(false);
      cargar();
    } catch (e) {
      setErrorCrear(e instanceof Error ? e.message : "No se pudo crear la aseguradora.");
    } finally {
      setCreando(false);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={() => setNuevaOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          Nueva aseguradora
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
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

      <Modal open={nuevaOpen} onClose={() => { setNuevaOpen(false); setErrorCrear(null); }} title="Nueva aseguradora">
        <div className="flex flex-col gap-3">
          <Field label="Nombre">
            <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Código">
            <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </Field>
          {errorCrear && <p className="text-xs text-bad-fg">{errorCrear}</p>}
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" onClick={() => { setNuevaOpen(false); setErrorCrear(null); }}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={crear} disabled={creando}>
              {creando ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
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

/* ========================= Oficinas ========================= */

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
    <div>
      <div className="flex items-center justify-between border border-border rounded-lg px-4 py-3 mb-4">
        <div>
          <div className="text-[13px] font-medium text-foreground">Acceso de agentes individuales (función no implementada)</div>
          <div className="text-xs text-muted">
            Este switch todavía no restringe nada: hoy cualquier usuario con login ve los datos de todas las oficinas
            y agentes. No crees ni compartas logins de agente asumiendo que esto los limita a su propia ficha.
          </div>
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
        <div className="overflow-x-auto border border-border rounded-lg">
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
    </div>
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
