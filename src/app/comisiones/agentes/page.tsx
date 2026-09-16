"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AgenteDirectorio from "@/components/agentes/AgenteDirectorio";
import AgenteFicha from "@/components/agentes/AgenteFicha";
import NuevoAgenteModal from "@/components/agentes/NuevoAgenteModal";
import { EmptyState, Loading } from "@/components/agentes/ui";
import { listAgentesDirectorio, listOficinasSimple, listAgentesSimple, getAgente, type AgenteDirectorioItem, type AgenteRow } from "@/lib/queries/agentes";

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

  useEffect(() => {
    if (!agenteIdParam && agentes.length > 0) {
      router.replace(`/comisiones/agentes/?agente=${agentes[0].id}`);
    }
  }, [agenteIdParam, agentes, router]);

  function seleccionar(id: string) {
    router.push(`/comisiones/agentes/?agente=${id}`);
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
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6 flex-1 min-h-0">
        <AgenteDirectorio
          agentes={agentes}
          loading={loadingDirectorio}
          seleccionadoId={agenteIdParam}
          onSeleccionar={seleccionar}
          onNuevo={() => setNuevoOpen(true)}
        />
        <div className="min-h-0 overflow-y-auto">
          {loadingAgente && <Loading />}
          {!loadingAgente && agenteSeleccionado && (
            <AgenteFicha agente={agenteSeleccionado} onIrExcepciones={() => router.push(`/comisiones/conciliacion/?agente=${agenteSeleccionado.id}`)} />
          )}
          {!loadingAgente && !agenteSeleccionado && (
            <EmptyState title="Elegí un agente" subtitle="Seleccioná un agente del directorio para ver su ficha completa." />
          )}
        </div>
      </div>

      <NuevoAgenteModal
        open={nuevoOpen}
        onClose={() => setNuevoOpen(false)}
        onCreated={cargarDirectorio}
        oficinas={oficinas}
        agentes={agentesSimple}
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
