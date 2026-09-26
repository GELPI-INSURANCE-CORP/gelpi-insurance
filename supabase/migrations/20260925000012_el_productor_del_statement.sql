-- =========================================================
-- Bajar lo que queda por resolver: duplicados, alias y productor
-- =========================================================
-- Medido sobre el statement de GEICO de agosto ya cargado (487 líneas, $35.718,01): quedaban
-- 133 líneas sin resolver. Mirando por qué, aparecieron tres causas distintas, y ninguna era
-- "el sistema no pudo": las tres son reglas que estaban mirando el dato equivocado.
--
--   sin_candidato             44
--   chargeback_sin_original   37
--   duplicado_exacto          32
--   chargeback_por_nombre     17   (estas ya proponen un agente: las decide una persona)
--   asegurado_..._vigencia     3
--
-- Esta migración ataca las tres primeras. Las 17 con sugerencia se dejan como están a
-- propósito: ya tienen candidato y confirmarlas es una decisión de quien paga, no del sistema.

-- ---------------------------------------------------------
-- 1. Un duplicado dentro del mismo archivo no es un duplicado
-- ---------------------------------------------------------
-- Las 32 marcadas eran, las 32, repeticiones dentro del MISMO statement. Ninguna venía de otro
-- archivo. Y el total del statement — $35.718,01 — cuadra al centavo CONTANDO esas líneas: es
-- decir, la compañía las contó y las pagó. Marcarlas como sospechosas obliga a revisar a mano
-- plata que la aseguradora ya declaró como suya.
--
-- GEICO reposta la misma póliza varias veces en un mes. Ya se le agregó la fecha de transacción
-- a la clave, que bajó los falsos positivos de 65 a 32; las 32 que quedan son filas idénticas
-- hasta en el día, y no hay ningún campo que las distinga porque no hay nada que distinguir.
--
-- El riesgo real que esta regla tiene que cubrir es otro: subir dos veces el mismo statement
-- como dos reportes distintos. Eso se sigue detectando igual, porque la comparación ahora exige
-- que la otra línea sea de OTRO reporte. Dentro de un mismo archivo, lo que la compañía manda
-- dos veces es porque lo pagó dos veces.
--
-- Efecto medido de esto solo: 22 de esas 32 líneas SÍ tienen su póliza en el Book y se estaban
-- perdiendo porque la compuerta de duplicado corre antes que el match por número de póliza.

-- ---------------------------------------------------------
-- 2. Los nombres con que la compañía llama a cada agente
-- ---------------------------------------------------------
-- GEICO escribe "GRETER ELIMAY RODRIGUEZ" y el sistema tiene "Greter Gelpi". Escribe
-- "SANTIAGO VIDAL FERNANDEZ" y el sistema tiene "Santiago Vidal". Son 26 líneas que no podían
-- resolver su productor por una diferencia de apellido.
--
-- Ya existe esta idea para las aseguradoras (aseguradora_alias). Faltaba para los agentes, y es
-- el mismo problema: cada compañía escribe los nombres a su manera y eso no va a cambiar.
create table if not exists agente_alias (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references agentes(id) on delete cascade,
  texto text not null,
  -- Misma normalización que alias_agencia y aseguradora_alias: sin espacios, puntos ni
  -- mayúsculas. "Greter Gelpi", "GRETER GELPI" y "greter.gelpi" son el mismo texto para buscar.
  texto_normalizado text generated always as (upper(regexp_replace(texto, '[^A-Za-z0-9]', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (texto_normalizado)
);
create index if not exists idx_agente_alias_agente on agente_alias (agente_id);
alter table agente_alias enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'agente_alias' and policyname = 'auth_all') then
    create policy auth_all on agente_alias for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Los dos que el statement de GEICO trajo. Se buscan por nombre en vez de por id para que esto
-- no dependa de los identificadores de una base en particular.
insert into agente_alias (agente_id, texto)
select a.id, v.texto
from (values
  ('GRETER ELIMAY RODRIGUEZ', 'Greter Gelpi'),
  ('SANTIAGO VIDAL FERNANDEZ', 'Santiago Vidal')
) as v(texto, agente)
join agentes a on normalizar_nombre(a.nombre) = normalizar_nombre(v.agente)
on conflict (texto_normalizado) do nothing;

-- Resolver un nombre de productor a un agente: primero por nombre, después por alias.
create or replace function agente_por_texto(p text) returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  if coalesce(btrim(p), '') = '' then return null; end if;
  select a.id into v from agentes a
   where normalizar_nombre(a.nombre) = normalizar_nombre(p) limit 1;
  if v is not null then return v; end if;
  select al.agente_id into v from agente_alias al
   where al.texto_normalizado = upper(regexp_replace(p, '[^A-Za-z0-9]', '', 'g')) limit 1;
  return v;
end $$;

-- ---------------------------------------------------------
-- 3. Cuando no queda nada más, el productor del statement
-- ---------------------------------------------------------
-- Para las líneas cuya póliza no está en el Book y cuyo asegurado tampoco, hoy el sistema se
-- rinde. Pero el archivo trae quién escribió el negocio: es el dato que la propia compañía usa
-- para pagar. Ignorarlo y dejar la línea pendiente no es más prudente, es solamente más trabajo.
--
-- Con una excepción, y es la razón por la que esto no se aplica a todos por igual: hay agentes
-- que no tienen código propio en la compañía, así que su producción sale a nombre de otro. En
-- GEICO pasa con Thalia, cuya producción aparece bajo Arturo. Para esos casos el nombre del
-- productor NO alcanza, y la línea tiene que quedar para que la mire una persona.
--
-- Eso se marca en el agente y no se escribe en el código: mañana puede ser otra compañía u otro
-- agente, y nadie debería tener que tocar una función para arreglarlo.
alter table agentes
  add column if not exists produccion_compartida boolean not null default false;

comment on column agentes.produccion_compartida is
  'true = otros agentes producen bajo el código de esta persona en alguna compañía, así que el '
  'nombre del productor en un statement no basta para asignarle la comisión. Caso real: en GEICO '
  'Thalia no tiene código propio y su producción sale a nombre de Arturo.';

update agentes set produccion_compartida = true
 where normalizar_nombre(nombre) = normalizar_nombre('ARTURO GELPI');

create or replace function resolver_por_productor(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record;
  v_ag uuid;
  v_of uuid;
  v_compartida boolean;
  n_ok int := 0;
  n_compartida int := 0;
  n_sin_agente int := 0;
begin
  for rec in
    select l.* from lineas_comision l
     where l.reporte_id = p_reporte_id
       -- Solo lo que quedó sin dueño. Lo que ya tiene agente sugerido (chargeback_por_nombre)
       -- no se toca: ahí hay un candidato y la decisión es de quien paga.
       and l.regla_match in ('sin_candidato', 'chargeback_sin_original')
       and l.estado not in ('conciliado_confirmado', 'cuenta_casa', 'descartado')
       and l.agente_id is null
     order by l.fila
  loop
    v_ag := agente_por_texto(rec.productor_crudo);
    if v_ag is null then
      n_sin_agente := n_sin_agente + 1;
      continue;
    end if;

    select a.produccion_compartida, a.oficina_id into v_compartida, v_of
      from agentes a where a.id = v_ag;

    if coalesce(v_compartida, false) then
      n_compartida := n_compartida + 1;
      continue;
    end if;

    update lineas_comision
       set agente_id = v_ag,
           oficina_id = coalesce(oficina_id, v_of),
           estado = 'conciliado_auto',
           regla_match = 'productor_del_statement',
           score = 80,
           candidatos = null
     where id = rec.id;

    -- La excepción que había abierta deja de tener sentido: la línea ya tiene dueño.
    update excepciones
       set estado = 'resuelta', accion = 'productor_del_statement',
           nota = format('Asignada al productor que declara el statement (%s).', rec.productor_crudo),
           resuelta_en = now()
     where linea_comision_id = rec.id and estado in ('pendiente', 'en_espera');

    n_ok := n_ok + 1;
  end loop;

  return jsonb_build_object(
    'asignadas', n_ok,
    'produccion_compartida', n_compartida,
    'productor_desconocido', n_sin_agente
  );
end $BODY$;

-- ---------------------------------------------------------
-- 4. Enchufar los cambios en el motor
-- ---------------------------------------------------------
-- matchear_linea se reescribe entera porque el cambio del duplicado está en su primer paso.
-- Es la versión de 20260924000003 con una sola línea distinta, marcada abajo.
create or replace function matchear_linea(p_linea_id uuid) returns text
language plpgsql as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_umbral_auto numeric := cfg_num('umbral_auto', 90);
  v_umbral_mismatch numeric := cfg_num('umbral_mismatch', 60);
  v_ventana int := cfg_num('ventana_dias_vigencia', 5)::int;
  v_pol polizas%rowtype;
  v_n int;
  v_alias boolean;
  v_primera boolean;
  v_dup uuid;
  v_orig lineas_comision%rowtype;
  v_cands jsonb;
  v_best record;
  v_estado text;
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = l.reporte_id;

  -- Paso 7 (compuerta): duplicado exacto en los últimos 12 meses (otra línea con la
  -- misma clave), salvo que el usuario ya haya aceptado explícitamente este par con
  -- 'mantener_ambas' (duplicado_par_id en cualquiera de las dos direcciones).
  select id into v_dup from lineas_comision
   where clave_duplicado = l.clave_duplicado and id <> l.id and estado <> 'descartado'
     -- Dentro del mismo archivo, lo que la compañía manda dos veces lo pagó dos veces y está
     -- en su total: marcarlo obliga a revisar a mano plata ya declarada. Lo que esta regla
     -- tiene que atrapar es el mismo statement subido dos veces, y eso sigue igual.
     and reporte_id <> l.reporte_id
     and created_at > now() - interval '12 months'
     and id <> coalesce(l.duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid) <> l.id
   order by created_at limit 1;
  if v_dup is not null then
    update lineas_comision set estado = 'duplicado_sospechoso', regla_match = 'duplicado_exacto' where id = l.id;
    perform abrir_excepcion('duplicado', l.id,
      jsonb_build_object('linea_relacionada_id', v_dup),
      'Misma aseguradora, póliza, asegurado, vigencia, tipo y monto que una línea de OTRO reporte ya cargado.', v_dup);
    return 'duplicado_sospechoso';
  end if;

  -- Paso 6: chargebacks / ajustes heredan de la línea original
  if l.monto < 0 or l.tipo_transaccion in ('cancelacion','ajuste') then
    select * into v_orig from lineas_comision
     where numero_normalizado = l.numero_normalizado and id <> l.id and monto > 0
       and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') and agente_id is not null
     order by created_at desc limit 1;
    if found then
      update lineas_comision set estado = 'conciliado_auto', regla_match = 'herencia_chargeback', score = 100,
        poliza_id = v_orig.poliza_id, agente_id = v_orig.agente_id, oficina_id = v_orig.oficina_id, linea_original_id = v_orig.id
       where id = l.id;
      return 'conciliado_auto';
    end if;

    -- Sin línea original: el Book sabe de quién es la póliza. Antes esto devolvía 'en_espera'
    -- directamente y la plata quedaba sin dueño teniendo el dato a la vista.
    if l.numero_normalizado is not null then
      select * into v_pol from polizas
       where numero_normalizado = l.numero_normalizado
         and (r.aseguradora_id is null or aseguradora_id = r.aseguradora_id)
       order by (aseguradora_id = r.aseguradora_id) desc nulls last, updated_at desc limit 1;
      if found and v_pol.agente_id is not null then
        update lineas_comision set estado = 'conciliado_auto', regla_match = 'chargeback_por_book', score = 95,
          poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id
         where id = l.id;
        return 'conciliado_auto';
      end if;
      -- La póliza está en el Book pero sin agente: eso no es "esperar", es un dato que falta y
      -- que el usuario puede completar. Se dice cuál es el problema en vez de dejarla muda.
      if found then
        update lineas_comision set estado = 'sin_identificar', regla_match = 'chargeback_poliza_sin_agente',
          score = 90, poliza_id = v_pol.id where id = l.id;
        perform abrir_excepcion('sin_identificar', l.id, jsonb_build_object('poliza_id', v_pol.id),
          'Es una cancelación o ajuste. La póliza está en el Active Business Book pero no tiene agente asignado.');
        return 'sin_identificar';
      end if;
    end if;

    update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original' where id = l.id;
    return 'en_espera';
  end if;
  v_alias := es_alias_agencia(l.productor_crudo);

  -- Paso 2: match exacto por número de póliza
  if l.numero_normalizado is not null then
    select * into v_pol from polizas
     where numero_normalizado = l.numero_normalizado
       and (r.aseguradora_id is null or aseguradora_id = r.aseguradora_id)
     order by (aseguradora_id = r.aseguradora_id) desc nulls last, updated_at desc limit 1;
    if found then
      if v_pol.agente_id is null then
        update lineas_comision set estado = 'sin_identificar', regla_match = 'poliza_sin_agente', score = 100, poliza_id = v_pol.id where id = l.id;
        perform abrir_excepcion('sin_identificar', l.id, jsonb_build_object('poliza_id', v_pol.id),
          'La póliza existe en el Active Business Book pero no tiene agente ni oficina asignados.');
        return 'sin_identificar';
      end if;
      -- Paso 3: alias de agencia → primera vez pide confirmación
      v_primera := v_alias and not exists (
        select 1 from lineas_comision x where x.numero_normalizado = l.numero_normalizado and x.id <> l.id
          and x.estado in ('conciliado_confirmado','conciliado_auto') and x.es_primera_confirmacion_alias);
      if v_primera then
        update lineas_comision set estado = 'mismatch', regla_match = 'poliza_exacta_alias_primera_vez', score = 96,
          poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id, es_primera_confirmacion_alias = true,
          candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 96))
         where id = l.id;
        perform abrir_excepcion('mismatch', l.id,
          jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 96)),
          format('El número de póliza matcheó exacto, pero el Productor del reporte (%s) es un alias de la agencia y es la primera vez que esta póliza se reporta a nombre de la agencia. Confirmá la reasignación; las próximas conciliarán solas.', l.productor_crudo));
        return 'mismatch';
      end if;
      update lineas_comision set estado = 'conciliado_auto', regla_match = 'poliza_exacta', score = 100,
        poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id where id = l.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- Paso 4: asegurado + aseguradora + vigencia ±ventana
  if l.nombre_asegurado_normalizado is not null then
    select count(*) into v_n from polizas p join clientes c on c.id = p.cliente_id
     where c.nombre_normalizado = l.nombre_asegurado_normalizado
       and (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
       and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
    if v_n = 1 then
      select p.* into v_pol from polizas p join clientes c on c.id = p.cliente_id
       where c.nombre_normalizado = l.nombre_asegurado_normalizado
         and (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
         and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
      update lineas_comision set estado = 'mismatch', regla_match = 'asegurado_aseguradora_vigencia', score = 92,
        poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id,
        candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 92))
       where id = l.id;
      perform abrir_excepcion('mismatch', l.id,
        jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 92)),
        'El número de póliza no coincide exacto, pero el asegurado, la aseguradora y la fecha de vigencia sí. Confirmá en 1 clic.');
      return 'mismatch';
    end if;
  end if;

  -- Paso 5: fuzzy con score compuesto
  select jsonb_agg(jsonb_build_object('poliza_id', s.id, 'agente_id', s.agente_id, 'oficina_id', s.oficina_id, 'score', s.score, 'numero_poliza', s.numero_poliza, 'cliente', s.cliente) order by s.score desc)
    into v_cands
  from (
    select p.id, p.agente_id, p.oficina_id, p.numero_poliza, c.nombre as cliente,
      round((((
        0.55 * coalesce(similarity(c.nombre_normalizado, l.nombre_asegurado_normalizado), 0) +
        0.30 * coalesce(similarity(p.numero_normalizado, l.numero_normalizado), 0) +
        0.15 * case when l.fecha_vigencia is null or p.fecha_vigencia is null then 0.5
                    when abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana then 1 else 0 end
      ) * 100)::numeric), 1) as score
    from polizas p left join clientes c on c.id = p.cliente_id
    where (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
      and (c.nombre_normalizado % coalesce(l.nombre_asegurado_normalizado,'') or p.numero_normalizado % coalesce(l.numero_normalizado,''))
    order by score desc limit 5
  ) s;

  select (v_cands->0->>'score')::numeric as score, (v_cands->0->>'poliza_id')::uuid as poliza_id,
         (v_cands->0->>'agente_id')::uuid as agente_id, (v_cands->0->>'oficina_id')::uuid as oficina_id,
         jsonb_array_length(coalesce(v_cands,'[]'::jsonb)) as n into v_best;

  if v_best.score is not null and v_best.score >= v_umbral_mismatch then
    update lineas_comision set estado = 'mismatch', regla_match = 'fuzzy', score = v_best.score, candidatos = v_cands,
      poliza_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.poliza_id else null end,
      agente_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.agente_id else null end,
      oficina_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.oficina_id else null end
     where id = l.id;
    perform abrir_excepcion('mismatch', l.id, v_cands,
      format('Coincidencia parcial (%s%%). Elegí el candidato correcto del Active Business Book o reasigná a mano.', v_best.score));
    return 'mismatch';
  end if;

  update lineas_comision set estado = 'sin_identificar', regla_match = 'sin_candidato', score = coalesce(v_best.score, 0), candidatos = v_cands where id = l.id;
  perform abrir_excepcion('sin_identificar', l.id, v_cands,
    'No se encontró ningún candidato en el Active Business Book (score < ' || v_umbral_mismatch || '%). Asigná a mano o dá de alta el cliente y la póliza.');
  return 'sin_identificar';
end $$;

-- ---------------------------------------------------------
-- 5. Correr el productor como tercera pasada
-- ---------------------------------------------------------
create or replace function procesar_matching(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record; res text; cnt jsonb := '{}'::jsonb;
begin
  for rec in select id from lineas_comision where reporte_id = p_reporte_id and estado = 'pendiente' order by fila loop
    res := matchear_linea(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;

  -- Segunda pasada: las cancelaciones sin dueño, buscando al cliente en el Book por el nombre
  -- recortado que manda la compañía.
  perform resolver_sin_original(p_reporte_id);

  -- Tercera: lo que sigue sin dueño se le asigna al productor que declara el statement, salvo
  -- los agentes cuya producción sale bajo el código de otro.
  perform resolver_por_productor(p_reporte_id);

  update reportes r set estado = 'matcheado',
    total_lineas = (select count(*) from lineas_comision where reporte_id = r.id),
    total_ok = (select count(*) from lineas_comision where reporte_id = r.id and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    total_excepciones = (select count(*) from excepciones e join lineas_comision l on l.id = e.linea_comision_id where l.reporte_id = r.id and e.estado = 'pendiente')
   where id = p_reporte_id;
  return cnt;
end $BODY$;

notify pgrst, 'reload schema';
