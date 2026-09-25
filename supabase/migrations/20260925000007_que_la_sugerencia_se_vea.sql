-- =========================================================
-- Que la sugerencia llegue a la pantalla
-- =========================================================
-- El paso que busca al cliente por el nombre recortado dejaba la línea en 'mismatch' y guardaba el
-- agente propuesto en la explicación de la excepción. Pero la pantalla no lee de ahí: lee
-- v_excepciones.agente_sugerido_id, que sale de lineas_comision.agente_id.
--
-- Resultado: la línea quedaba marcada "revisar el agente" sin decir cuál, y el botón "Confirmar
-- sugeridas" seguía apagado porque para el sistema no había ninguna sugerencia. Arturo lo dijo
-- exacto: "no veo ninguna sugerencia".
--
-- Es la misma forma en que funcionan los demás pasos del motor: cuando el match no llega al umbral
-- automático, el agente igual se escribe en la línea y el estado dice que hay que revisarlo. Una
-- sugerencia que no se puede ver no es una sugerencia.

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

  -- Se limpia lo que haya quedado de una corrida anterior: si no, volver a pasar este paso
  -- acumularía una excepción nueva por cada vez, todas sobre la misma línea.
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
    -- El agente propuesto se escribe en la línea, que es de donde la pantalla lo lee. El estado
    -- 'mismatch' y el score por debajo del umbral automático dicen que hace falta confirmarlo:
    -- el nombre coincide, pero la póliza es desconocida y eso no alcanza para pagar solo.
    update lineas_comision
       set estado = 'mismatch', regla_match = 'chargeback_por_nombre', score = 70,
           agente_id = v_uno.agente_id, oficina_id = v_of, candidatos = null
     where id = l.id;
    perform abrir_excepcion(
      'mismatch', l.id,
      jsonb_build_object('agente_id', v_uno.agente_id, 'agente', v_uno.agente, 'cliente', v_uno.cliente),
      format(
        'Es una cancelación y no hay línea original ni póliza en el Book. Pero el asegurado "%s" '
        || 'coincide con "%s", que es cliente de %s. Confirmá si es la misma persona.',
        l.nombre_asegurado_crudo, v_uno.cliente, v_uno.agente
      )
    );
    return 'mismatch';
  end if;

  if v_n > 1 then
    select jsonb_agg(jsonb_build_object('agente_id', agente_id, 'agente', agente, 'cliente', cliente))
      into v_cands
      from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);
    -- Con varios candidatos no se propone ninguno: elegir uno al azar entre siete Zamora sería
    -- peor que no elegir. Se guardan todos para que la pantalla los ofrezca.
    update lineas_comision
       set estado = 'sin_identificar', regla_match = 'chargeback_varios_nombres',
           agente_id = null, oficina_id = null, candidatos = v_cands
     where id = l.id;
    perform abrir_excepcion(
      'sin_identificar', l.id, v_cands,
      format('Es una cancelación sin original. El asegurado "%s" coincide con %s personas del Book: '
             || 'elegí cuál es.', l.nombre_asegurado_crudo, v_n)
    );
    return 'sin_identificar';
  end if;

  update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original',
    agente_id = null, oficina_id = null, candidatos = null where id = l.id;
  return 'en_espera';
end $BODY$;

-- ---------------------------------------------------------
-- Que se pueda volver a correr sin dejar nada a medias
-- ---------------------------------------------------------
-- Antes solo miraba las líneas que seguían en 'chargeback_sin_original', así que las que una
-- corrida anterior ya había tocado quedaban congeladas con el resultado viejo — incluida la que
-- quedó sin agente visible por el problema de arriba. Ahora vuelve a evaluar las tres.
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
       and regla_match in ('chargeback_sin_original', 'chargeback_por_nombre', 'chargeback_varios_nombres')
       -- Lo que la persona ya confirmó a mano no se vuelve a tocar.
       and estado not in ('conciliado_confirmado', 'cuenta_casa', 'descartado')
     order by fila
  loop
    res := matchear_chargeback_por_nombre(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;
  return cnt;
end $BODY$;

notify pgrst, 'reload schema';
