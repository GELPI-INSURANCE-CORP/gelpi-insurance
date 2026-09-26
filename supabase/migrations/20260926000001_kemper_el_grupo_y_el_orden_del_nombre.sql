-- =========================================================
-- Kemper: el grupo de compañías, y el nombre al revés
-- =========================================================
-- Medido sobre el statement de Kemper de agosto (85 líneas de póliza, $5.638,57 de comisión, que
-- cuadra exacto con el "Grand Total" del propio archivo) ANTES de subirlo.
--
-- El problema no es que falte el dato. Es que la llave no abre.
--
-- 1) EL GRUPO. Los 85 números del statement se cruzaron contra el Book: 67 están ahí. Pero
--    guardados bajo otra compañía, porque el Book anota la que FIRMA la póliza y el statement lo
--    manda el grupo:
--
--      Infinity Auto Ins Co        48        Response Worldwide Ins Co   2
--      Response Ins Co              9        Warner Ins Co               2
--      Infinity Ind Ins Co          3        Infinity Assur Ins Co       1
--      Kemper Independence Ins Co   2
--
--    El motor exige que la póliza sea de la MISMA aseguradora del reporte, así que con el reporte
--    cargado como "Kemper" no matchea ninguna de las 67. Con el grupo, matchean las 67.
--
--    No se fusionan: Infinity sigue siendo Infinity en el Book, en los filtros y en sus propios
--    statements. Solo se declara que pertenecen al mismo grupo, que es la verdad.
--
-- 2) EL NOMBRE AL REVÉS. Kemper manda "APELLIDO, NOMBRE":
--
--      Statement: "ALVAREZ, RUBIEL"         Book: "RUBIEL ALVAREZ"
--      Statement: "Arango Ramos, Gisela"    Book: "Gisela Arango Ramos"
--
--    El paso que busca por asegurado compara los nombres completos en orden, así que no encuentra
--    ninguno. Comparar las palabras ordenadas alfabéticamente resuelve las dos formas sin aflojar
--    nada: sigue exigiendo que estén TODAS las palabras, solo deja de exigir que estén en el mismo
--    orden. Si con eso aparece más de un candidato, el paso no elige — igual que hoy.

-- ---------------------------------------------------------
-- 1. A qué grupo pertenece cada compañía
-- ---------------------------------------------------------
alter table aseguradoras add column if not exists grupo text;

comment on column aseguradoras.grupo is
  'Nombre del grupo asegurador al que pertenece la compañía. Dos compañías del mismo grupo se '
  'aceptan entre sí al cruzar pólizas: el statement lo manda el grupo (Kemper) y el Book anota la '
  'que firma (Infinity, Response, Warner). NULL = la compañía no pertenece a ningún grupo y solo '
  'se acepta a sí misma.';

create index if not exists idx_aseguradoras_grupo on aseguradoras (grupo) where grupo is not null;

create or replace function mismo_grupo(p_a uuid, p_b uuid) returns boolean
language sql stable as $$
  select case
    when p_a is null or p_b is null then false
    when p_a = p_b then true
    else exists (
      select 1 from aseguradoras x join aseguradoras y on x.grupo = y.grupo
       where x.id = p_a and y.id = p_b and x.grupo is not null)
  end;
$$;

-- El grupo Kemper. Los nombres van explícitos y no por un "ilike '%response%'" a propósito:
-- "Responsive" es OTRA compañía —Responsive Auto, que no tiene nada que ver con Kemper— y un
-- patrón suelto se la llevaría puesta.
update aseguradoras set grupo = 'Kemper'
 where nombre ilike 'kemper%'
    or nombre ilike 'infinity%'
    or nombre ilike 'response ins%'
    or nombre ilike 'response worldwide%'
    or nombre ilike 'warner ins%';

-- ---------------------------------------------------------
-- 2. El nombre con las palabras ordenadas
-- ---------------------------------------------------------
-- Misma normalización de siempre (sin acentos, sin puntuación, sin LLC/INC/CORP) y después las
-- palabras en orden alfabético. Las de una sola letra se caen: la inicial del segundo nombre
-- aparece en una versión del nombre y en la otra no, y es justo lo que impide que se reconozcan.
create or replace function normalizar_nombre_ordenado(p text) returns text
language sql immutable as $$
  select nullif(coalesce((
    select string_agg(w, ' ' order by w)
    from unnest(string_to_array(normalizar_nombre(p), ' ')) w
    where length(w) >= 2
  ), ''), '');
$$;

alter table clientes add column if not exists nombre_ordenado text;

-- Se llena desde el trigger que ya normalizaba el nombre, para que no haya dos caminos por donde
-- un cliente pueda entrar sin este campo.
create or replace function clientes_normalizar() returns trigger language plpgsql as $$
begin
  new.nombre_normalizado := normalizar_nombre(new.nombre);
  new.nombre_ordenado := normalizar_nombre_ordenado(new.nombre);
  return new;
end $$;

update clientes set nombre = nombre where nombre_ordenado is null;

create index if not exists idx_clientes_nombre_ordenado on clientes (nombre_ordenado);

-- ---------------------------------------------------------
-- 3. Enchufar las dos cosas en el motor
-- ---------------------------------------------------------
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
         and (r.aseguradora_id is null or mismo_grupo(aseguradora_id, r.aseguradora_id))
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
       and (r.aseguradora_id is null or mismo_grupo(aseguradora_id, r.aseguradora_id))
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
     where (c.nombre_normalizado = l.nombre_asegurado_normalizado
            or c.nombre_ordenado = normalizar_nombre_ordenado(l.nombre_asegurado_crudo))
       and (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
       and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
    if v_n = 1 then
      select p.* into v_pol from polizas p join clientes c on c.id = p.cliente_id
       where (c.nombre_normalizado = l.nombre_asegurado_normalizado
            or c.nombre_ordenado = normalizar_nombre_ordenado(l.nombre_asegurado_crudo))
         and (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
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
    where (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
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
-- Qué quedó
-- ---------------------------------------------------------
select
  (select count(*) from aseguradoras where grupo = 'Kemper') as companias_del_grupo_kemper,
  (select string_agg(nombre, ', ' order by nombre) from aseguradoras where grupo = 'Kemper') as cuales,
  (select count(*) from polizas p join aseguradoras a on a.id = p.aseguradora_id where a.grupo = 'Kemper')
    as polizas_del_grupo_en_el_book,
  (select count(*) from clientes where nombre_ordenado is not null) as clientes_con_nombre_ordenado,
  normalizar_nombre_ordenado('ALVAREZ, RUBIEL') as ejemplo_statement,
  normalizar_nombre_ordenado('Rubiel Alvarez') as ejemplo_book;

notify pgrst, 'reload schema';
