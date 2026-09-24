-- =========================================================
-- Nombres alternativos de aseguradora + fusión de duplicadas
-- =========================================================
-- Una misma compañía llega con nombres distintos según la fuente: el Book de QQ la llama
-- "Response Ins Co" y "Response Worldwide Ins Co", el statement llega como "Responsive". Hoy el
-- sistema las trata como aseguradoras distintas, así que las pólizas quedan bajo una y el
-- statement busca contra la otra: no concilia nada y no hay ninguna pista de por qué.
--
-- La solución no es elegir un nombre "bueno": es que la aseguradora pueda tener varios nombres y
-- que todos resuelvan a la misma. Y para las que ya se duplicaron, poder fusionarlas sin perder
-- nada.

create table if not exists aseguradora_alias (
  id uuid primary key default gen_random_uuid(),
  aseguradora_id uuid not null references aseguradoras(id) on delete cascade,
  texto text not null,
  -- Misma normalización que usa alias_agencia: sin espacios, puntos ni may/min. "Response Ins Co",
  -- "RESPONSE INS. CO." y "response insco" son el mismo texto para buscar.
  texto_normalizado text generated always as (upper(regexp_replace(texto, '[^A-Za-z0-9]', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (texto_normalizado)
);

create index if not exists idx_aseguradora_alias_aseg on aseguradora_alias (aseguradora_id);

-- Fusiona `p_origen` dentro de `p_destino`: mueve todo lo que colgaba de la primera, deja su
-- nombre como alias de la segunda para que los archivos que la sigan nombrando así resuelvan
-- solos, y la borra.
create or replace function fusionar_aseguradoras(p_origen uuid, p_destino uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_nombre_origen text;
  v_polizas_movidas int := 0;
  v_polizas_fusionadas int := 0;
  v_reportes int := 0;
begin
  if p_origen = p_destino then
    raise exception 'No se puede fusionar una aseguradora consigo misma';
  end if;
  select nombre into v_nombre_origen from aseguradoras where id = p_origen;
  if v_nombre_origen is null then raise exception 'La aseguradora de origen no existe'; end if;
  if not exists (select 1 from aseguradoras where id = p_destino) then
    raise exception 'La aseguradora de destino no existe';
  end if;

  -- Pólizas que chocan: el mismo número ya existe en destino (unique aseguradora_id +
  -- numero_normalizado). Las líneas de comisión que apuntaban a la copia de origen se repuntan a
  -- la de destino y la copia se borra. Repuntar ANTES de borrar: al revés se perdería el vínculo
  -- de la línea con su póliza y quedaría plata sin poder rastrear a qué póliza correspondía.
  update lineas_comision lc
     set poliza_id = d.id
    from polizas o
    join polizas d
      on d.aseguradora_id = p_destino
     and d.numero_normalizado = o.numero_normalizado
   where o.aseguradora_id = p_origen
     and lc.poliza_id = o.id;

  with borradas as (
    delete from polizas o
     where o.aseguradora_id = p_origen
       and exists (
         select 1 from polizas d
          where d.aseguradora_id = p_destino
            and d.numero_normalizado = o.numero_normalizado
       )
    returning 1
  ) select count(*) into v_polizas_fusionadas from borradas;

  with movidas as (
    update polizas set aseguradora_id = p_destino where aseguradora_id = p_origen returning 1
  ) select count(*) into v_polizas_movidas from movidas;

  with r as (
    update reportes set aseguradora_id = p_destino where aseguradora_id = p_origen returning 1
  ) select count(*) into v_reportes from r;

  update lineas_venta set aseguradora_id = p_destino where aseguradora_id = p_origen;
  update bonos set aseguradora_id = p_destino where aseguradora_id = p_origen;
  update alias_agencia set aseguradora_id = p_destino where aseguradora_id = p_origen;
  update aseguradora_alias set aseguradora_id = p_destino where aseguradora_id = p_origen;

  -- El nombre de la que se va queda como alias de la que queda: si mañana vuelve a llegar un
  -- archivo que la nombra así, resuelve sola en vez de crear el duplicado otra vez.
  insert into aseguradora_alias (aseguradora_id, texto)
  values (p_destino, v_nombre_origen)
  on conflict (texto_normalizado) do nothing;

  delete from aseguradoras where id = p_origen;

  return jsonb_build_object(
    'ok', true,
    'nombre_origen', v_nombre_origen,
    'polizas_movidas', v_polizas_movidas,
    'polizas_fusionadas', v_polizas_fusionadas,
    'reportes_movidos', v_reportes
  );
end $$;

do $$ declare t text; begin
  for t in select unnest(array['aseguradora_alias']) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format('create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
