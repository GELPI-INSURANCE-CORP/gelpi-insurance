"use client";

import { useEffect, useState } from "react";
import { Modal, Field, TextInput, Select, Button } from "./ui";
import { crearAgente, actualizarAgente, type AgenteRow } from "@/lib/queries/agentes";

// Partir "Nombre Apellido" en dos campos para precargar el formulario al editar.
// Heurística simple: todo menos la última palabra es el nombre de pila.
function partirNombre(nombreCompleto: string): { nombre: string; apellido: string } {
  const partes = nombreCompleto.trim().split(/\s+/);
  if (partes.length < 2) return { nombre: partes[0] ?? "", apellido: "" };
  return { nombre: partes.slice(0, -1).join(" "), apellido: partes[partes.length - 1] };
}

export default function NuevoAgenteModal({
  open,
  onClose,
  onCreated,
  oficinas,
  agentes,
  editando,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  oficinas: { id: string; nombre: string }[];
  agentes: { id: string; nombre: string }[];
  editando?: AgenteRow | null;
}) {
  const [nombrePila, setNombrePila] = useState("");
  const [apellido, setApellido] = useState("");
  const [codigo, setCodigo] = useState("");
  const [oficinaId, setOficinaId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [npn, setNpn] = useState("");
  const [pctSplit, setPctSplit] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setNombrePila("");
    setApellido("");
    setCodigo("");
    setOficinaId("");
    setSupervisorId("");
    setEmail("");
    setTelefono("");
    setNpn("");
    setPctSplit("0");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    if (editando) {
      const { nombre, apellido: ap } = partirNombre(editando.nombre);
      setNombrePila(nombre);
      setApellido(ap);
      setCodigo(editando.codigo ?? "");
      setOficinaId(editando.oficina_id ?? "");
      setSupervisorId(editando.supervisor_id ?? "");
      setEmail(editando.email ?? "");
      setTelefono(editando.telefono ?? "");
      setNpn(editando.npn ?? "");
      setPctSplit(String(editando.pct_split_default ?? 0));
      setError(null);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editando]);

  async function submit() {
    if (!nombrePila.trim() || !apellido.trim() || !oficinaId || !email.trim()) {
      setError("Nombre, apellido, email y oficina son obligatorios.");
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      nombre: `${nombrePila.trim()} ${apellido.trim()}`,
      codigo: codigo.trim() || null,
      oficina_id: oficinaId,
      supervisor_id: supervisorId || null,
      email: email.trim(),
      telefono: telefono.trim(),
      npn: npn.trim() || null,
      pct_split_default: Number(pctSplit) || 0,
    };
    try {
      if (editando) {
        await actualizarAgente(editando.id, input);
      } else {
        await crearAgente(input);
      }
      reset();
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el agente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editando ? `Editar agente — ${editando.nombre}` : "Nuevo agente"}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nombre">
          <TextInput value={nombrePila} onChange={(e) => setNombrePila(e.target.value)} placeholder="Nombre" />
        </Field>
        <Field label="Apellido">
          <TextInput value={apellido} onChange={(e) => setApellido(e.target.value)} placeholder="Apellido" />
        </Field>
        <Field label="Email">
          <TextInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="nombre@gelpiinsurance.com" />
        </Field>
        <Field label="Celular">
          <TextInput value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+1 (999) 999-9999" />
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
            options={[{ value: "", label: "Ninguno" }, ...agentes.filter((a) => a.id !== editando?.id).map((a) => ({ value: a.id, label: a.nombre }))]}
          />
        </Field>
        <Field label="NPN (opcional)">
          <TextInput value={npn} onChange={(e) => setNpn(e.target.value)} placeholder="National Producer Number" />
        </Field>
        <Field label="Código interno (opcional)">
          <TextInput value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="GEL-0XX" />
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
          {saving ? "Guardando…" : editando ? "Guardar cambios" : "Crear agente"}
        </Button>
      </div>
    </Modal>
  );
}
