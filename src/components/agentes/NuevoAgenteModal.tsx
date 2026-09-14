"use client";

import { useState } from "react";
import { Modal, Field, TextInput, Select, Button } from "./ui";
import { crearAgente } from "@/lib/queries/agentes";

export default function NuevoAgenteModal({
  open,
  onClose,
  onCreated,
  oficinas,
  agentes,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  oficinas: { id: string; nombre: string }[];
  agentes: { id: string; nombre: string }[];
}) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [oficinaId, setOficinaId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [pctSplit, setPctSplit] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setNombre("");
    setCodigo("");
    setOficinaId("");
    setSupervisorId("");
    setEmail("");
    setTelefono("");
    setPctSplit("0");
    setError(null);
  }

  async function submit() {
    if (!nombre.trim() || !oficinaId) {
      setError("Nombre y oficina son obligatorios.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await crearAgente({
        nombre: nombre.trim(),
        codigo: codigo.trim(),
        oficina_id: oficinaId,
        supervisor_id: supervisorId || null,
        email: email.trim(),
        telefono: telefono.trim(),
        pct_split_default: Number(pctSplit) || 0,
      });
      reset();
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el agente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo agente">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre completo">
          <TextInput value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" />
        </Field>
        <Field label="Código interno">
          <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="GEL-0XX" />
        </Field>
        <Field label="Oficina">
          <Select
            value={oficinaId}
            onChange={setOficinaId}
            options={[{ value: "", label: "Seleccionar…" }, ...oficinas.map((o) => ({ value: o.id, label: o.nombre }))]}
          />
        </Field>
        <Field label="Supervisor (opcional)">
          <Select
            value={supervisorId}
            onChange={setSupervisorId}
            options={[{ value: "", label: "Ninguno" }, ...agentes.map((a) => ({ value: a.id, label: a.nombre }))]}
          />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        </Field>
        <Field label="Teléfono">
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        </Field>
        <Field label="% split por defecto">
          <TextInput value={pctSplit} onChange={(e) => setPctSplit(e.target.value)} type="number" />
        </Field>
      </div>
      {error && <p className="text-xs text-bad-fg mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Guardando…" : "Crear agente"}
        </Button>
      </div>
    </Modal>
  );
}
