-- =========================================================
-- Si otra línea de la misma póliza ya tiene dueño, esta también
-- =========================================================
-- Medido sobre las 19 que quedaron sin resolver en Kemper agosto. Dos huecos, los dos por el mismo
-- motivo de fondo: hay pasos del motor que solo se le ofrecen a un tipo de línea.
--
--   Otra línea del MISMO statement, misma póliza, ya con agente     5
--   El asegurado SÍ está en el Book, con agente                     5
--
-- 1) LA HERENCIA POR PÓLIZA SOLO CORRE PARA CANCELACIONES. El paso 6 empareja un chargeback con su
--    línea original, pero exige dos cosas: que la línea sea negativa, y que la original YA esté
--    conciliada. Las dos fallan seguido.
--
--    En Kemper, la póliza 10274056201 de "Arenas Alzate, John" trae tres líneas: +$222,64 (New),
--    −$146,30 y −$73,92. Es la misma póliza y la misma persona. La primera es positiva, así que
--    nunca fue candidata a heredar; y las otras dos no pudieron heredar de ella porque tampoco
--    estaba resuelta. Las tres quedaron sueltas teniendo el dato entre ellas.
--
--    Ahora, después de que el motor hizo todo lo que sabe, se hace una pasada más: cualquier línea
--    sin dueño que comparta número de póliza con una línea que SÍ tiene dueño, hereda. Sin importar
--    el signo y sin importar de qué statement venga — si el mes pasado se asignó esa póliza, este
--    mes se resuelve sola.
--
-- 2) LA BÚSQUEDA POR NOMBRE SOLO SE LE OFRECE A LOS CHARGEBACKS. resolver_sin_original() mira las
--    líneas marcadas como cancelación sin original, y nada más. Una línea positiva que no encontró
--    póliza ('sin_candidato') nunca pasa por ahí, aunque su asegurado esté en el Book con nombre y
--    agente. Medido: 5 de las 19 de Kemper están en esa situación, y una de ellas es de Thalia.

-- ---------------------------------------------------------
-- 1. Heredar de otra línea de la misma póliza
-- ---------------------------------------------------------
-- Queda como sugerencia y no como conciliado automático a propósito cuando la otra línea es de
-- OTRO statement: que una póliza haya sido de alguien hace tres meses es buena pista, no prueba.
-- Dentro del mismo statement sí concilia: son literalmente movimientos del mismo contrato en el
-- mismo período.
create or replace function resolver_por_poliza_conocida(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record;
  v_src lineas_comision%rowtype;
  n_mismo int := 0;
  n_otro int := 0;
begin
  for rec in
    select l.* from lineas_comision l
     where l.reporte_id = p_reporte_id
       and l.numero_normalizado is not null
       and l.agente_id is null
       and l.estado not in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa', 'descartado')
     order by l.fila
  loop
    -- Primero se busca dentro del mismo statement, que es la fuente más fuerte.
    select * into v_src from lineas_comision o
     where o.numero_normalizado = rec.numero_normalizado
       and o.id <> rec.id
       and o.agente_id is not null
       and o.estado in ('conciliado_auto', 'conciliado_confirmado')
     order by (o.reporte_id = rec.reporte_id) desc, o.created_at desc
     limit 1;
    if not found then continue; end if;

    if v_src.reporte_id = rec.reporte_id then
      update lineas_comision
         set agente_id = v_src.agente_id, oficina_id = v_src.oficina_id,
             poliza_id = coalesce(poliza_id, v_src.poliza_id),
             estado = 'conciliado_auto', regla_match = 'misma_poliza_del_statement',
             score = 96, candidatos = null
       where id = rec.id;
      update excepciones
         set estado = 'resuelta', accion = 'misma_poliza_del_statement',
             nota = 'Otra línea de la misma póliza, en este mismo statement, ya tenía dueño.',
             resuelta_en = now()
       where linea_comision_id = rec.id and estado in ('pendiente', 'en_espera');
      n_mismo := n_mismo + 1;
    else
      update lineas_comision
         set agente_id = v_src.agente_id, oficina_id = v_src.oficina_id,
             poliza_id = coalesce(poliza_id, v_src.poliza_id),
             estado = 'mismatch', regla_match = 'misma_poliza_de_otro_statement',
             score = 85, candidatos = null
       where id = rec.id;
      perform abrir_excepcion('mismatch', rec.id,
        jsonb_build_object('agente_id', v_src.agente_id, 'linea_relacionada_id', v_src.id),
        'Esta póliza ya se había asignado en otro statement. Confirmá si sigue siendo del mismo agente.');
      n_otro := n_otro + 1;
    end if;
  end loop;

  return jsonb_build_object('mismo_statement', n_mismo, 'otro_statement', n_otro);
end $BODY$;

-- ---------------------------------------------------------
-- 2. Ofrecerle la búsqueda por nombre a todas las que quedaron sin dueño
-- ---------------------------------------------------------
-- El texto de la excepción dejó de dar por sentado que la línea es una cancelación, porque ahora
-- también le llegan líneas positivas.
create or replace function matchear_chargeback_por_nombre(p_linea_id uuid) returns text
language plpgsql as $BODY$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_n int;
  v_uno record;
  v_cands jsonb;
  v_of uuid;
begin
  select * into l from lineas_comision where id = p_linea_id;
  select * into r from reportes where id = l.reporte_id;

  delete from excepciones where linea_comision_id = l.id and estado in ('pendiente', 'en_espera');

  if coalesce(l.nombre_asegurado_crudo, '') = '' then
    update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original',
      agente_id = null, oficina_id = null, candidatos = null where id = l.id;
    return 'en_espera';
  end if;

  select count(*) into v_n
  from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);

  if v_n = 1 then
    select * into v_uno
    from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);
    select oficina_id into v_of from agentes where id = v_uno.agente_id;
    update lineas_comision
       set estado = 'mismatch', regla_match = 'chargeback_por_nombre', score = 70,
           agente_id = v_uno.agente_id, oficina_id = v_of, candidatos = null
     where id = l.id;
    perform abrir_excepcion(
      'mismatch', l.id,
      jsonb_build_object('agente_id', v_uno.agente_id, 'agente', v_uno.agente, 'cliente', v_uno.cliente),
      format(
        'La póliza no está en el Book, pero el asegurado "%s" coincide con "%s", que es cliente '
        || 'de %s. Confirmá si es la misma persona.',
        l.nombre_asegurado_crudo, v_uno.cliente, v_uno.agente
      )
    );
    return 'mismatch';
  end if;

  if v_n > 1 then
    select jsonb_agg(jsonb_build_object('agente_id', agente_id, 'agente', agente, 'cliente', cliente))
      into v_cands
      from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);
    update lineas_comision
       set estado = 'sin_identificar', regla_match = 'chargeback_varios_nombres',
           agente_id = null, oficina_id = null, candidatos = v_cands
     where id = l.id;
    perform abrir_excepcion(
      'sin_identificar', l.id, v_cands,
      format('La póliza no está en el Book y el asegurado "%s" coincide con %s personas: '
             || 'elegí cuál es.', l.nombre_asegurado_crudo, v_n)
    );
    return 'sin_identificar';
  end if;

  update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original',
    agente_id = null, oficina_id = null, candidatos = null where id = l.id;
  return 'en_espera';
end $BODY$;

create or replace function resolver_sin_original(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record;
  res text;
  cnt jsonb := '{}'::jsonb;
begin
  for rec in
    select id from lineas_comision
     where reporte_id = p_reporte_id
       -- 'sin_candidato' es lo nuevo: una línea positiva cuya póliza no está en el Book tiene el
       -- mismo problema que una cancelación sin original, y merece el mismo intento.
       and regla_match in ('chargeback_sin_original', 'chargeback_por_nombre',
                           'chargeback_varios_nombres', 'sin_candidato')
       and estado not in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa', 'descartado')
     order by fila
  loop
    res := matchear_chargeback_por_nombre(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;
  return cnt;
end $BODY$;

-- ---------------------------------------------------------
-- 3. El orden de las pasadas
-- ---------------------------------------------------------
-- La herencia por póliza va DOS veces: una después del nombre y otra al final. Cada pasada que
-- asigna puede habilitar una herencia que antes no tenía de dónde agarrarse, y correrla dos veces
-- cuesta nada comparado con dejar una línea pendiente teniendo el dato al lado.
create or replace function procesar_matching(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record; res text; cnt jsonb := '{}'::jsonb;
begin
  for rec in select id from lineas_comision where reporte_id = p_reporte_id and estado = 'pendiente' order by fila loop
    res := matchear_linea(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;

  perform resolver_sin_original(p_reporte_id);
  perform resolver_por_poliza_conocida(p_reporte_id);
  perform resolver_por_productor(p_reporte_id);
  perform resolver_por_poliza_conocida(p_reporte_id);

  update reportes r set estado = 'matcheado',
    total_lineas = (select count(*) from lineas_comision where reporte_id = r.id),
    total_ok = (select count(*) from lineas_comision where reporte_id = r.id and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    total_excepciones = (select count(*) from excepciones e join lineas_comision l on l.id = e.linea_comision_id where l.reporte_id = r.id and e.estado = 'pendiente')
   where id = p_reporte_id;
  return cnt;
end $BODY$;

notify pgrst, 'reload schema';
