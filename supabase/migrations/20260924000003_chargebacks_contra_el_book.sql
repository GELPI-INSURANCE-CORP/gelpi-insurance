-- =========================================================
-- Chargebacks: buscar la póliza en el Book antes de rendirse
-- =========================================================
-- Cuando llega una línea negativa (cancelación, chargeback, "Credit Endorsement"), el motor busca
-- la línea ORIGINAL donde se pagó esa comisión, para descontársela al mismo agente. Si no la
-- encuentra, se rinde y la deja en 'en_espera'. Nunca mira el Active Business Book.
--
-- Eso deja plata sin dueño teniendo el dato a la vista. Medido sobre los statements reales: de las
-- 47 líneas sin resolver de Progressive, 21 tienen su póliza en el Book, con agente, bajo la misma
-- aseguradora. El motor no la usó porque el Paso 6 devuelve antes de llegar al match por póliza.
--
-- Y no es un caso raro. La línea original solo existe si también se subió el statement del mes en
-- que se vendió la póliza. Una agencia que recién empieza a usar el sistema no tiene historia, así
-- que TODAS sus cancelaciones caen acá: Progressive trae 15 "Cancel Pro Rate" y 28 "Credit
-- Endorsement" en un solo mes.
--
-- La línea original se sigue prefiriendo cuando existe: es más específica, porque prueba que a ese
-- agente se le pagó esa comisión concreta. El Book es el segundo intento, y queda con score 95 y
-- regla_match propia para poder distinguir después cómo se resolvió cada línea.
--
-- Si la póliza está en el Book pero sin agente, ya no se deja en 'en_espera' — un estado que no
-- dice nada y no ofrece qué hacer — sino en 'sin_identificar' con una excepción que explica que
-- lo que falta es el agente de esa póliza.

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
     and created_at > now() - interval '12 months'
     and id <> coalesce(l.duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid) <> l.id
   order by created_at limit 1;
  if v_dup is not null then
    update lineas_comision set estado = 'duplicado_sospechoso', regla_match = 'duplicado_exacto' where id = l.id;
    perform abrir_excepcion('duplicado', l.id,
      jsonb_build_object('linea_relacionada_id', v_dup),
      'Misma aseguradora, póliza, asegurado, vigencia, tipo y monto que otra línea ya cargada.', v_dup);
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
