-- =========================================================
-- Lo que quedó a medias, y la búsqueda por nombre que se colgaba
-- =========================================================
-- Tres cosas, todas verificadas contra la base antes de escribir esto.
--
-- 1. El arreglo de las primas negativas nunca se corrió. La migración 20260925000001 traía dos
--    cosas: limpiar las que estaban mal y arreglar la función que las creaba. Falló entera, y
--    cuando la rehice para desbloquear la pantalla mandé solo la limpieza. Quedaron 6 pólizas
--    nuevas con prima negativa, todas 'alta_manual' y todas de hoy entre las 18:51 y las 20:54:
--    son las que Arturo fue asignando a mano. La función va acá, ahora sí.
--
-- 2. agentes_por_nombre_recortado se cuelga. Correrla sobre los 24 chargebacks de Progressive
--    julio devuelve "canceling statement due to statement timeout". Por cada línea recorría las
--    2.345 pólizas unidas a sus clientes y, para cada fila, ejecutaba una subconsulta que armaba
--    un bool_and de varios LIKE. Se reescribe para que el filtro por nombre corra una sola vez
--    sobre la tabla de clientes -- 2.369 filas, que devuelven entre cero y siete -- y recién
--    después se junte con pólizas.
--
-- 3. Mientras estuvo colgándose, las sugerencias nunca llegaron a escribirse.

-- ---------------------------------------------------------
-- La prima de una póliza nunca es negativa
-- ---------------------------------------------------------
create or replace function asignar_linea_creando_poliza(
  p_linea_id uuid,
  p_agente_id uuid,
  p_motivo text default null
) returns jsonb language plpgsql security definer as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_of uuid;
  v_cli uuid;
  v_pol polizas%rowtype;
  v_norm text;
  v_prima numeric;
  v_creo_poliza boolean := false;
  v_creo_cliente boolean := false;
  v_usr uuid := auth.uid();
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then raise exception 'La línea no existe'; end if;
  if p_agente_id is null then raise exception 'Falta el agente'; end if;
  select * into r from reportes where id = l.reporte_id;
  select oficina_id into v_of from agentes where id = p_agente_id;

  v_norm := normalizar_poliza(l.numero_poliza_crudo);

  -- La prima de la línea sirve para la póliza solo si es positiva. Una cancelación trae la prima
  -- en negativo (es una devolución), y guardarla así deja el Book con pólizas de prima negativa
  -- que después el dashboard suma. Ante la duda, mejor sin prima que con una prima falsa.
  v_prima := case when coalesce(l.prima, 0) > 0 then l.prima else null end;

  -- Sin número de póliza no hay nada que aprender: un ajuste o un fee no es una póliza, y crear
  -- una con número inventado ensuciaría el Book para siempre. Se asigna solo la línea.
  if v_norm is null or r.aseguradora_id is null then
    update lineas_comision
       set estado = 'conciliado_confirmado', agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of), regla_match = 'manual'
     where id = l.id;
    return jsonb_build_object('ok', true, 'poliza_creada', false, 'cliente_creado', false,
      'motivo', 'La línea no trae número de póliza, así que no se pudo guardar en el Book.');
  end if;

  select * into v_pol from polizas
   where aseguradora_id = r.aseguradora_id and numero_normalizado = v_norm;

  if not found then
    -- Se reusa el cliente si ya existe con ese nombre; si no, se crea. Crear un cliente duplicado
    -- por cada statement dejaría el Book lleno de copias del mismo asegurado.
    if coalesce(l.nombre_asegurado_crudo, '') <> '' then
      select id into v_cli from clientes
       where nombre_normalizado = normalizar_nombre(l.nombre_asegurado_crudo)
       order by created_at limit 1;
      if v_cli is null then
        insert into clientes (nombre) values (l.nombre_asegurado_crudo) returning id into v_cli;
        v_creo_cliente := true;
      end if;
    end if;

    insert into polizas (cliente_id, numero_poliza, aseguradora_id, ramo, agente_id, oficina_id,
                         fecha_vigencia, prima, origen)
    values (v_cli, l.numero_poliza_crudo, r.aseguradora_id, coalesce(l.ramo, 'auto'), p_agente_id,
            v_of, l.fecha_vigencia, v_prima, 'alta_manual')
    returning * into v_pol;
    v_creo_poliza := true;
  else
    -- La póliza ya estaba: se le pone el agente, que es lo que faltaba para que matchee sola. La
    -- prima solo se completa si la póliza no tenía ninguna; el Book manda sobre el statement.
    update polizas
       set agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of),
           prima = coalesce(prima, v_prima)
     where id = v_pol.id;
  end if;

  update lineas_comision
     set estado = 'conciliado_confirmado', agente_id = p_agente_id, oficina_id = v_of,
         poliza_id = v_pol.id, regla_match = 'manual'
   where id = l.id;

  update excepciones
     set estado = 'resuelta', accion = 'asignar_creando_poliza',
         nota = coalesce(p_motivo, 'Asignada a mano; la póliza quedó guardada en el Book.'),
         resuelta_por = v_usr, resuelta_en = now()
   where linea_comision_id = l.id and estado in ('pendiente', 'en_espera');

  insert into auditoria (entidad, entidad_id, accion, campo, valor_nuevo, usuario, motivo)
  values ('polizas', v_pol.id,
          case when v_creo_poliza then 'alta_desde_statement' else 'agente_desde_statement' end,
          'agente_id', p_agente_id::text, v_usr, p_motivo);

  return jsonb_build_object('ok', true, 'poliza_creada', v_creo_poliza,
    'cliente_creado', v_creo_cliente, 'numero_poliza', v_pol.numero_poliza);
end $$;

-- ---------------------------------------------------------
-- Buscar personas por nombre recortado, sin colgarse
-- ---------------------------------------------------------
create or replace function agentes_por_nombre_recortado(p_nombre text, p_aseguradora uuid)
returns table (agente_id uuid, agente text, cliente text, poliza_id uuid)
language sql stable as $FN$
  with partes as (
    select string_to_array(normalizar_nombre(p_nombre), ' ') as todas
  ), datos as (
    select
      -- Los patrones ya armados: 'like all (array)' es una sola operación, mientras que el
      -- bool_and de antes era una subconsulta que se ejecutaba una vez por cada cliente.
      (select array_agg('%' || t || '%') from unnest(p.todas) t where length(t) >= 3) as patrones,
      (select t from unnest(p.todas) with ordinality as u(t, i)
        where length(t) = 1 order by i desc limit 1) as inicial
    from partes p
  ), candidatos as (
    -- Este es el paso que importa para la velocidad: el filtro por nombre se resuelve acá, contra
    -- la tabla de clientes sola, y deja entre cero y un puñado de filas. Antes el mismo filtro se
    -- evaluaba sobre el producto de clientes por pólizas.
    select c.id, c.nombre
    from clientes c
    cross join datos d
    where d.patrones is not null
      and c.nombre_normalizado like all (d.patrones)
      -- La inicial tiene que arrancar alguna palabra del nombre: o es la primera del nombre, o
      -- viene después de un espacio. Dicho con dos LIKE en vez de con otra subconsulta.
      and (
        d.inicial is null
        or c.nombre_normalizado like d.inicial || '%'
        or c.nombre_normalizado like '% ' || d.inicial || '%'
      )
  )
  select distinct on (a.id) a.id, a.nombre, c.nombre, pol.id
  from candidatos c
  join polizas pol on pol.cliente_id = c.id
  join agentes a on a.id = pol.agente_id
  where coalesce(a.es_casa, false) = false
  -- La compañía no filtra, pero pesa: entre las pólizas de esa persona se prefiere una de la
  -- misma compañía del statement, que es la más relevante para esta línea.
  order by a.id, (pol.aseguradora_id = p_aseguradora) desc nulls last, pol.updated_at desc;
$FN$;

-- ---------------------------------------------------------
-- Limpiar las 6 que se crearon hoy
-- ---------------------------------------------------------
-- A NULL y no a cero: cero afirmaría que esa póliza no cobra prima, y eso es falso. NULL dice
-- "no sabemos", que es la verdad, y además no arrastra el promedio.
update polizas set prima = null where prima < 0;

notify pgrst, 'reload schema';
