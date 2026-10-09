-- =========================================================
-- Asignar los MVR por linea, como un statement
-- =========================================================
-- Arturo, mirando el panel del MVR:
--
--   "Por que no lo pones que luzca como un statement, igual que como estan los otros? Que sea
--    por linea, ya lo identificado. Que el QuoteReport sea como su base de datos y que esto sea
--    la parte que vamos a editar y trabajar en ello."
--
-- Tiene razon y la division es exacta: el QuoteReport es material de consulta -- se sube, se
-- mira y no se toca -- y el MVR es donde hay trabajo. 389 cargos de los cuales hoy unos 47
-- quedan sin dueno y hay que decidirlos uno por uno.
--
-- Lo que faltaba del lado de la base: resolver_costo() trabaja sobre la EXCEPCION, que es lo
-- correcto cuando se entra por Conciliacion. Una pantalla que lista renglones necesita lo
-- contrario -- entrar por la LINEA -- y no tiene por que saber que existe una excepcion detras.

create or replace function asignar_costo(
  p_linea_id uuid, p_agente_id uuid, p_motivo text default null
) returns jsonb language plpgsql security definer as $fn$
declare
  c lineas_costo%rowtype;
  v_of uuid; v_prev uuid; v_usr uuid := auth.uid();
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then raise exception 'Ese cargo no existe'; end if;
  if p_agente_id is null then raise exception 'Falta el agente'; end if;

  select oficina_id into v_of from agentes where id = p_agente_id;
  v_prev := c.agente_id;

  update lineas_costo
     set estado = 'conciliado_confirmado', agente_id = p_agente_id,
         oficina_id = v_of, regla_match = 'manual'
   where id = c.id;

  -- Si el cargo tenia una excepcion esperando en Conciliacion, se cierra sola. Sin esto, el
  -- mismo cargo aparece resuelto en una pantalla y pendiente en la otra.
  update excepciones
     set estado = 'resuelta', accion = 'asignar', nota = p_motivo,
         resuelta_por = v_usr, resuelta_en = now()
   where linea_costo_id = c.id and estado = 'pendiente';

  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
  values ('linea_costo', c.id, 'asignar', 'agente_id', v_prev::text, p_agente_id::text, v_usr, p_motivo);

  return jsonb_build_object('ok', true, 'oficina_id', v_of);
end $fn$;

comment on function asignar_costo is
  'Asigna un cargo de MVR a un agente entrando por la LINEA, para la pantalla que los lista. '
  'Cierra de paso la excepcion que ese cargo tuviera abierta en Conciliacion.';

-- ---------------------------------------------------------
-- En lote
-- ---------------------------------------------------------
-- Los 13 comerciales de agosto son todos del mismo tipo y van a la misma decision. Hacerlos de
-- a uno son 13 viajes y 13 confirmaciones para una sola decision.
create or replace function asignar_costos(
  p_lineas uuid[], p_agente_id uuid, p_motivo text default null
) returns integer language plpgsql security definer as $fn$
declare x uuid; n integer := 0;
begin
  foreach x in array coalesce(p_lineas, '{}') loop
    perform asignar_costo(x, p_agente_id, p_motivo);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- ---------------------------------------------------------
-- Mandarlo a la casa
-- ---------------------------------------------------------
-- Para los que no son de nadie: los comerciales que la compania manda sin asegurado. Sin
-- oficina, igual que un cargo de la compania (20261003000003) -- si no se sabe quien lo pidio,
-- no se le puede descontar a ninguna oficina.
create or replace function costo_a_cuenta_casa(
  p_lineas uuid[], p_motivo text default null
) returns integer language plpgsql security definer as $fn$
declare x uuid; n integer := 0; v_casa uuid; v_usr uuid := auth.uid();
begin
  select id into v_casa from agentes where es_casa limit 1;
  foreach x in array coalesce(p_lineas, '{}') loop
    update lineas_costo
       set estado = 'cuenta_casa', agente_id = v_casa, oficina_id = null, regla_match = 'cuenta_casa'
     where id = x;
    update excepciones
       set estado = 'resuelta', accion = 'cuenta_casa', nota = p_motivo,
           resuelta_por = v_usr, resuelta_en = now()
     where linea_costo_id = x and estado = 'pendiente';
    insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
    values ('linea_costo', x, 'cuenta_casa', 'oficina_id', null, null, v_usr, p_motivo);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- ---------------------------------------------------------
-- El resumen que va arriba de la pantalla
-- ---------------------------------------------------------
create or replace function resumen_costos_reporte(p_reporte_id uuid)
returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'total',        (select count(*) from lineas_costo where reporte_id = p_reporte_id),
    'con_cargo',    (select count(*) from lineas_costo where reporte_id = p_reporte_id and monto > 0),
    'monto',        (select round(coalesce(sum(monto),0),2) from lineas_costo where reporte_id = p_reporte_id),
    'identificados',(select count(*) from lineas_costo where reporte_id = p_reporte_id
                      and estado in ('conciliado_auto','conciliado_confirmado')),
    'sin_dueno',    (select count(*) from lineas_costo where reporte_id = p_reporte_id
                      and estado in ('sin_identificar','pendiente')),
    'en_la_casa',   (select count(*) from lineas_costo where reporte_id = p_reporte_id and estado = 'cuenta_casa'),
    'por_oficina',  (select coalesce(jsonb_agg(t order by t->>'oficina'), '[]'::jsonb) from (
                       select jsonb_build_object(
                                'oficina', coalesce(o.nombre, 'Sin identificar'),
                                'cargos',  count(*),
                                'monto',   round(coalesce(sum(l.monto),0),2)) as t
                         from lineas_costo l
                         left join oficinas o on o.id = l.oficina_id
                        where l.reporte_id = p_reporte_id
                          and l.estado in ('conciliado_auto','conciliado_confirmado')
                        group by o.nombre) s)
  );
$fn$;

comment on function resumen_costos_reporte is
  'Los numeros de arriba de la pantalla de un MVR: cuantos cargos, cuantos cobraron, cuanto '
  'suma, cuantos tienen dueno y como se reparte por oficina.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from pg_proc
    where proname in ('asignar_costo','asignar_costos','costo_a_cuenta_casa','resumen_costos_reporte'))
    as funciones_nuevas_de_4,
  (select resumen_costos_reporte(id) from reportes where tipo = 'mvr' order by created_at desc limit 1)
    as asi_queda_tu_mvr;
