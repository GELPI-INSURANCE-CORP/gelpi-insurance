-- =========================================================
-- Liquidaciones congeladas
-- =========================================================
-- Hasta ahora, lo que se le paga a cada agente se calculaba al vuelo:
-- comisión del período × agentes.pct_split_default. Como pct_split_default es un solo número por
-- agente, subirle el porcentaje a alguien recalculaba también todos los meses ya pagados — agosto
-- pasaba a decir que se le debía el doble de lo que se le pagó de verdad, sin que nada avisara.
--
-- Al cerrar un mes se guarda acá una foto: cuánto entró por cada agente, con qué porcentaje y
-- cuánto se le pagó. Después de eso, cambiar el porcentaje del agente solo afecta a los meses que
-- todavía no se cerraron. Un mes cerrado se puede reabrir (borra la foto y vuelve a calcularse en
-- vivo), que es la salida cuando se cerró por error.

create table if not exists liquidaciones (
  id uuid primary key default gen_random_uuid(),
  periodo text not null unique,                       -- 'YYYY-MM'
  total_recibido numeric(14,2) not null default 0,
  total_a_pagar numeric(14,2) not null default 0,
  cerrada_en timestamptz not null default now(),
  cerrada_por uuid references auth.users(id),
  nota text
);

create table if not exists liquidacion_agente (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references liquidaciones(id) on delete cascade,
  agente_id uuid not null references agentes(id),
  -- Se guarda el nombre tal como estaba al cerrar: si el agente se renombra o se da de baja más
  -- adelante, el recibo de agosto tiene que seguir diciendo a quién se le pagó.
  agente_nombre text not null,
  comision_recibida numeric(14,2) not null default 0,
  pct numeric(5,2) not null default 0,
  a_pagar numeric(14,2) not null default 0,
  unique (liquidacion_id, agente_id)
);

create index if not exists idx_liquidacion_agente_liq on liquidacion_agente (liquidacion_id);

-- Misma política que el resto del esquema: single-tenant, cualquier usuario autenticado.
do $$ declare t text; begin
  for t in select unnest(array['liquidaciones', 'liquidacion_agente']) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format('create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
