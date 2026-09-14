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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editando) {
      setNombre(editando.nombre);
      setCodigo(editando.codigo ?? "");
      setDireccion(editando.direccion ?? "");
      setGerenteId(editando.gerente_agente_id ?? "");
      setPctOverride(String(editando.pct_override ?? 0));
    } else {
      setNombre("");
      setCodigo("");
      setDireccion("");
      setGerenteId("");
      setPctOverride("0");
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
        codigo: codigo.trim(),
        direccion: direccion.trim(),
        gerente_agente_id: gerenteId || null,
        pct_override: Number(pctOverride) || 0,
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
      </div>
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
