"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import AgentesTabla from "@/components/agentes/AgentesTabla";
import AgenteFicha from "@/components/agentes/AgenteFicha";
import NuevoAgenteModal from "@/components/agentes/NuevoAgenteModal";
import { Button, Loading } from "@/components/agentes/ui";
import {
  listAgentesDirectorio,
  listOficinasSimple,
  listAgentesSimple,
  getAgente,
  actualizarEstadoAgente,
  type AgenteDirectorioItem,
  type AgenteRow,
} from "@/lib/queries/agentes";

function AgentesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agenteIdParam = searchParams.get("agente");

  const [agentes, setAgentes] = useState<AgenteDirectorioItem[]>([]);
  const [loadingDirectorio, setLoadingDirectorio] = useState(true);
  const [dirError, setDirError] = useState<string | null>(null);
  const [oficinas, setOficinas] = useState<{ id: string; nombre: string }[]>([]);
  const [agentesSimple, setAgentesSimple] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevoOpen, setNuevoOpen] = useState(false);

  const [agenteSeleccionado, setAgenteSeleccionado] = useState<AgenteRow | null>(null);
  const [loadingAgente, setLoadingAgente] = useState(false);
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);
  const [editando, setEditando] = useState<AgenteRow | null>(null);

  const cargarDirectorio = useCallback(() => {
    setLoadingDirectorio(true);
    setDirError(null);
    listAgentesDirectorio()
      .then(setAgentes)
      .catch((e: unknown) => setDirError(e instanceof Error ? e.message : "No se pudo cargar el directorio de agentes."))
      .finally(() => setLoadingDirectorio(false));
  }, []);

  useEffect(() => {
    cargarDirectorio();
    listOficinasSimple().then((o) => setOficinas(o.map((x) => ({ id: x.id, nombre: x.nombre }))));
    listAgentesSimple().then((a) => setAgentesSimple(a.map((x) => ({ id: x.id, nombre: x.nombre }))));
  }, [cargarDirectorio]);

  useEffect(() => {
    if (!agenteIdParam) {
      setAgenteSeleccionado(null);
      return;
    }
    let alive = true;
    setLoadingAgente(true);
    getAgente(agenteIdParam)
      .then((a) => alive && setAgenteSeleccionado(a))
      .finally(() => alive && setLoadingAgente(false));
    return () => {
      alive = false;
    };
  }, [agenteIdParam]);

  function seleccionar(id: string) {
    router.push(`/comisiones/agentes/?agente=${id}`);
  }

  async function abrirEditar(id: string) {
    const a = agenteSeleccionado?.id === id ? agenteSeleccionado : await getAgente(id);
    if (a) {
      setEditando(a);
      setNuevoOpen(true);
    }
  }

  function volverAlListado() {
    router.push(`/comisiones/agentes/`);
  }

  async function handleToggleActivo(id: string, activo: boolean) {
    setCambiandoId(id);
    try {
      await actualizarEstadoAgente(id, activo);
      cargarDirectorio();
    } finally {
      setCambiandoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-96px)] min-h-[600px]">
      <h1 className="text-lg font-semibold text-foreground">Agentes</h1>
      {dirError && (
        <div className="flex items-center gap-3 rounded-lg border border-bad-fg/30 bg-bad-bg px-4 py-2.5 text-[13px] text-bad-fg">
          <span className="flex-1">No se pudo cargar el directorio de agentes: {dirError}</span>
          <button type="button" onClick={cargarDirectorio} className="font-semibold underline underline-offset-2">
            Reintentar
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!agenteIdParam ? (
          <AgentesTabla
            agentes={agentes}
            loading={loadingDirectorio}
            onVerFicha={seleccionar}
            onNuevo={() => {
              setEditando(null);
              setNuevoOpen(true);
            }}
            onEditar={abrirEditar}
            onToggleActivo={handleToggleActivo}
            cambiandoId={cambiandoId}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Button variant="ghost" size="sm" onClick={volverAlListado} className="self-start">
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver al listado
            </Button>
            {loadingAgente && <Loading />}
            {!loadingAgente && agenteSeleccionado && (
              <AgenteFicha
                agente={agenteSeleccionado}
                onIrExcepciones={() => router.push(`/comisiones/conciliacion/?agente=${agenteSeleccionado.id}`)}
                onEditar={() => abrirEditar(agenteSeleccionado.id)}
              />
            )}
          </div>
        )}
      </div>

      <NuevoAgenteModal
        open={nuevoOpen}
        onClose={() => {
          setNuevoOpen(false);
          setEditando(null);
        }}
        onCreated={() => {
          cargarDirectorio();
          if (editando && agenteIdParam === editando.id) getAgente(editando.id).then(setAgenteSeleccionado);
        }}
        oficinas={oficinas}
        agentes={agentesSimple}
        editando={editando}
      />
    </div>
  );
}

export default function AgentesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AgentesContent />
    </Suspense>
  );
}
