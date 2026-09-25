-- =========================================================
-- Cancelaciones cuyo dueño está en el Book con otro nombre
-- =========================================================
-- Medido sobre las 24 "Cancelación sin original" de Progressive julio:
--
--   La línea original NO está en el statement    24 de 24
--   La póliza NO está en el Book                 24 de 24
--   El CLIENTE sí está en el Book                13 de 24
--
-- O sea: el motor tenía razón en que no hay original y en que la póliza es desconocida, pero se
-- le escapaba la persona. Progressive manda el nombre del asegurado recortado —
-- "Travieso Art A." donde el Book dice "Adrian Travieso Artiles", "ROSE ARAGON K." donde dice
-- "KAARINA Y ROSE ARAGON" — así que comparar nombres completos nunca iba a encontrarlo.
--
-- Este paso busca por las palabras que sí sobrevivieron al recorte. Solo se usa como último
-- recurso, después de haber fallado la línea original y el número de póliza, porque un nombre es
-- mucho más débil que un número: hay siete Zamora en el Book.
--
-- Por eso NO se concilia solo aunque haya una sola coincidencia. Queda sugerido, para que la
-- persona confirme. Pagarle a alguien porque su apellido coincidía es peor que dejar la línea
-- pendiente.

-- ---------------------------------------------------------
-- Buscar personas en el Book por un nombre recortado
-- ---------------------------------------------------------
-- Devuelve los agentes posibles: se queda con los clientes cuyo nombre contiene TODAS las palabras
-- largas del nombre recortado, y de ahí saca el agente de sus pólizas.
--
-- Las palabras de menos de tres letras se descartan: la inicial suelta ("D.", "A.") y partículas
-- como DE o Y aparecen en medio Book y no distinguen a nadie.
create or replace function agentes_por_nombre_recortado(p_nombre text, p_aseguradora uuid)
returns table (agente_id uuid, agente text, cliente text, poliza_id uuid)
language sql stable as $$
  with tokens as (
    select array_agg(t) as ts
    from unnest(string_to_array(normalizar_nombre(p_nombre), ' ')) t
    where length(t) >= 3
  )
  select distinct on (a.id) a.id, a.nombre, c.nombre, p.id
  from clientes c
  join polizas p on p.cliente_id = c.id
  join agentes a on a.id = p.agente_id
  cross join tokens
  where tokens.ts is not null
    and array_length(tokens.ts, 1) >= 1
    and (select bool_and(c.nombre_normalizado like '%' || t || '%') from unnest(tokens.ts) t)
    and (p_aseguradora is null or p.aseguradora_id = p_aseguradora)
    and coalesce(a.es_casa, false) = false
  order by a.id, p.updated_at desc;
$$;

-- ---------------------------------------------------------
-- Enchufarlo en el motor, como último intento
-- ---------------------------------------------------------
create or replace function matchear_chargeback_por_nombre(p_linea_id uuid) returns text
language plpgsql as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_n int;
  v_uno record;
  v_cands jsonb;
begin
  select * into l from lineas_comision where id = p_linea_id;
  select * into r from reportes where id = l.reporte_id;
  if coalesce(l.nombre_asegurado_crudo, '') = '' then
    update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original' where id = l.id;
    return 'en_espera';
  end if;

  select count(*) into v_n
  from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);

  if v_n = 1 then
    select * into v_uno
    from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);
    -- Sugerido, no conciliado: el nombre coincide pero la póliza es desconocida, así que hace falta
    -- que una persona diga que sí. El score queda por debajo del umbral automático a propósito.
    update lineas_comision
       set estado = 'mismatch', regla_match = 'chargeback_por_nombre', score = 70
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
    -- Varios candidatos: se guardan todos para que la pantalla los ofrezca. Elegir uno al azar
    -- entre siete Zamora sería peor que no elegir.
    select jsonb_agg(jsonb_build_object('agente_id', agente_id, 'agente', agente, 'cliente', cliente))
      into v_cands
      from agentes_por_nombre_recortado(l.nombre_asegurado_crudo, r.aseguradora_id);
    update lineas_comision
       set estado = 'sin_identificar', regla_match = 'chargeback_varios_nombres', candidatos = v_cands
     where id = l.id;
    perform abrir_excepcion(
      'sin_identificar', l.id, v_cands,
      format('Es una cancelación sin original. El asegurado "%s" coincide con %s personas del Book: '
             || 'elegí cuál es.', l.nombre_asegurado_crudo, v_n)
    );
    return 'sin_identificar';
  end if;

  update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original' where id = l.id;
  return 'en_espera';
end $$;

-- ---------------------------------------------------------
-- Una segunda pasada, despues del motor
-- ---------------------------------------------------------
-- El paso va aca y no adentro de matchear_linea por dos razones. Una practica: matchear_linea
-- tiene 170 lineas y habria que reescribirla entera para cambiarle la ultima, con todo el riesgo
-- que eso trae. Y una de fondo: esto no es un paso mas del motor, es un segundo intento sobre lo
-- que el motor ya dio por perdido, y se lee mejor asi.
--
-- Ademas se puede volver a correr sobre statements viejos sin releer el archivo: busca por
-- regla_match y no por estado, asi que alcanza con llamarla.
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
       and regla_match = 'chargeback_sin_original'
     order by fila
  loop
    res := matchear_chargeback_por_nombre(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;
  return cnt;
end $BODY$;

create or replace function procesar_matching(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record; res text; cnt jsonb := '{}'::jsonb;
begin
  for rec in select id from lineas_comision where reporte_id = p_reporte_id and estado = 'pendiente' order by fila loop
    res := matchear_linea(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;

  -- Segunda pasada sobre las cancelaciones que quedaron sin dueno: el cliente puede estar en el
  -- Book con el nombre completo aunque la compania lo mande recortado.
  perform resolver_sin_original(p_reporte_id);

  update reportes r set estado = 'matcheado',
    total_lineas = (select count(*) from lineas_comision where reporte_id = r.id),
    total_ok = (select count(*) from lineas_comision where reporte_id = r.id and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    total_excepciones = (select count(*) from excepciones e join lineas_comision l on l.id = e.linea_comision_id where l.reporte_id = r.id and e.estado = 'pendiente')
   where id = p_reporte_id;
  return cnt;
end $BODY$;

notify pgrst, 'reload schema';
