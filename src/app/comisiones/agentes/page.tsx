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
  const [oficinas, setOficinas] = useState<{ id: string; nombre: string }[]>([]);
  const [agentesSimple, setAgentesSimple] = useState<{ id: string; nombre: string }[]>([]);
  const [nuevoOpen, setNuevoOpen] = useState(false);

  const [agenteSeleccionado, setAgenteSeleccionado] = useState<AgenteRow | null>(null);
  const [loadingAgente, setLoadingAgente] = useState(false);

  const cargarDirectorio = useCallback(() => {
    setLoadingDirectorio(true);
    listAgentesDirectorio()
      .then(setAgentes)
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
