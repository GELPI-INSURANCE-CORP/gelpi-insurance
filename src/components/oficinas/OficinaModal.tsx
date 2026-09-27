"use client";

import { useEffect, useState } from "react";
import { Modal, Field, TextInput, Select, Button } from "@/components/agentes/ui";
import { crearOficina, actualizarOficina, type OficinaResumen } from "@/lib/queries/oficinas";

export default function OficinaModal({
  open,
  onClose,
  onSaved,
  agentes,
  editando,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  agentes: { id: string; nombre: string }[];
  editando: OficinaResumen | null;
}) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [direccion, setDireccion] = useState("");
  const [gerenteId, setGerenteId] = useState("");
  const [pctOverride, setPctOverride] = useState("0");
  // El royalty vive acá atrás y no en el dashboard a propósito: es un número de contrato que se
  // pacta una vez y no se toca, y tenerlo editable en la pantalla que se mira todos los días
  // es una invitación a moverlo sin querer.
  const [pctRoyalty, setPctRoyalty] = useState("");
  const [esCorporativa, setEsCorporativa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editando) {
      setNombre(editando.nombre);
      setCodigo(editando.codigo ?? "");
      setDireccion(editando.direccion ?? "");
      setGerenteId(editando.gerente_agente_id ?? "");
      setPctOverride(String(editando.pct_override ?? 0));
      setPctRoyalty(editando.pct_royalty == null ? "" : String(editando.pct_royalty));
      setEsCorporativa(Boolean(editando.es_corporativa));
    } else {
      setNombre("");
      setCodigo("");
      setDireccion("");
      setGerenteId("");
      setPctOverride("0");
      setPctRoyalty("");
      setEsCorporativa(false);
    }
    setError(null);
  }, [editando, open]);

  async function submit() {
    if (!nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        nombre: nombre.trim(),
        codigo: codigo.trim() || null,
        direccion: direccion.trim(),
        gerente_agente_id: gerenteId || null,
        pct_override: Number(pctOverride) || 0,
        // Vacío se guarda como null y no como 0: "todavía no lo definí" y "no paga royalty"
        // son cosas distintas, y el dashboard las muestra distinto.
        pct_royalty: pctRoyalty.trim() === "" ? null : Number(pctRoyalty),
        es_corporativa: esCorporativa,
      };
      if (editando) await actualizarOficina(editando.id, input);
      else await crearOficina(input);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editando ? "Editar oficina" : "Nueva oficina"}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <Field label="Código">
          <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        </Field>
        <Field label="Dirección">
          <TextInput value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        </Field>
        <Field label="Encargado">
          <Select value={gerenteId} onChange={setGerenteId} options={[{ value: "", label: "Sin encargado" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]} />
        </Field>
        <Field label="% Override">
          <TextInput type="number" value={pctOverride} onChange={(e) => setPctOverride(e.target.value)} />
        </Field>
        <Field label="% Royalty de franquicia">
          <TextInput
            type="number"
            placeholder="sin definir"
            value={pctRoyalty}
            onChange={(e) => setPctRoyalty(e.target.value)}
            disabled={esCorporativa}
          />
        </Field>
      </div>

      {/* El royalty no es el split del agente, y conviene decirlo justo donde los dos campos
          quedan uno al lado del otro, que es exactamente donde se pueden confundir. */}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        El royalty se cobra sobre la <strong>comisión</strong> que genera la oficina, toda: nueva y
        renovación. No es lo mismo que el % del agente, que va sobre la <strong>prima</strong> y solo
        del negocio nuevo.
      </p>

      <label className="mt-3 flex items-center gap-2 text-[13px] text-foreground">
        <input
          type="checkbox"
          checked={esCorporativa}
          onChange={(e) => {
            setEsCorporativa(e.target.checked);
            if (e.target.checked) setPctRoyalty("");
          }}
        />
        Es la oficina corporativa (no paga royalty)
      </label>
      {error && <p className="text-xs text-bad-fg mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Guardando…" : editando ? "Guardar cambios" : "Crear oficina"}
        </Button>
      </div>
    </Modal>
  );
}
