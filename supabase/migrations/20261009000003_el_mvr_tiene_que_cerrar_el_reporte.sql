-- =========================================================
-- El MVR y las cotizaciones tienen que cerrar su reporte
-- =========================================================
-- Arturo subio el primer MVR de Progressive y el QuoteReport, y los dos quedaron asi:
--
--   Progressive · Cargos por MVR        Reading file...   389 filas sin cuadrar
--   Sin compania · Cotizaciones         Reading file...  1393 filas sin cuadrar
--
-- Las dos cosas son el mismo error mio. Los renglones entraron bien -- 389 y 1393, los numeros
-- correctos -- pero el reporte nunca se cerro.
--
-- QUE FALTABA. En este sistema el que cierra el reporte no es la edge function: es la funcion
-- de la base que procesa las lineas. procesar_ventas() termina con
--
--   update reportes set estado = case when n_conf > 0 then 'matcheado' else 'cerrado' end,
--     total_lineas = ..., total_ok = ..., total_excepciones = ...
--
-- y procesar_matching() hace lo propio. procesar_costos() no hacia ninguna de las dos cosas:
-- repartia las lineas y volvia sin tocar el reporte. Resultado:
--
--   estado se quedaba en 'extrayendo'  -> la pantalla muestra "Reading file..." para siempre
--   total_ok y total_excepciones en 0  -> y como total_lineas si estaba, la pantalla resta
--                                         389 - 0 - 0 y avisa "389 filas sin cuadrar"
--
-- El aviso de "sin cuadrar" hizo exactamente lo que tiene que hacer: habia 389 renglones que no
-- estaban ni en OK ni en pendiente, y lo dijo.

-- ---------------------------------------------------------
-- 0. Que el QuoteReport se vea DENTRO del MVR, no al lado
-- ---------------------------------------------------------
-- Arturo, viendo la lista despues de subir:
--
--   "Eso que hiciste que sale ahi deberia salir dentro de donde dice Cargos por MVR
--    Progressive, no afuera."
--
-- Tiene razon: el subio UNA cosa y la lista le muestra DOS renglones, uno de ellos "Sin
-- compania", que no le dice nada a nadie.
--
-- Es un enlace de pantalla y nada mas. Los dos siguen siendo reportes independientes -- borrar
-- el MVR no borra las cotizaciones, y el mismo QuoteReport sirve para los MVR de United, Kemper
-- y Responsive sin resubirlo -- pero el que llego pegado a una subida se muestra adentro de
-- ella. Por eso "on delete set null": si se borra el MVR, el QuoteReport se queda y pasa a
-- verse solo.
alter table reportes
  add column if not exists subido_con_id uuid references reportes(id) on delete set null;

comment on column reportes.subido_con_id is
  'El reporte llego en la misma subida que este otro, y la lista lo muestra anidado adentro. '
  'Es solo presentacion: los dos son reportes independientes y se borran por separado.';

create index if not exists reportes_subido_con on reportes (subido_con_id)
  where subido_con_id is not null;

-- v_reportes empieza con r.*, y Postgres expande ese * UNA VEZ, cuando se crea la vista: la
-- columna nueva no aparece sola. Hay que rehacerla, y por el mismo motivo que v_excepciones no
-- sirve "create or replace" -- el * corre todas las columnas de lugar. El cuerpo es identico al
-- de 20260925000003; lo unico que cambia es que el * ahora trae subido_con_id.
drop view if exists v_reportes;

create view v_reportes as
select r.*,
       -- El mes al que pertenece el statement. Los reportes de Book y de ventas internas no tienen
       -- período de statement y quedan en null, que es lo correcto: no son de ningún mes.
       case when r.tipo = 'comision_aseguradora'
            then coalesce(mes_del_periodo(r.periodo), date_trunc('month', r.created_at)::date)
            else mes_del_periodo(r.periodo)
       end as mes_statement,
       case when coalesce(c.lineas, 0) > 0 then c.lineas else r.total_lineas end as lineas_reales,
       case when coalesce(c.lineas, 0) > 0 then c.ok else r.total_ok end as ok_reales,
       case when coalesce(c.lineas, 0) > 0 then c.pendientes else r.total_excepciones end as pendientes_reales,
       coalesce(c.fuera, 0) as fuera_reales,
       coalesce(c.monto, 0) as monto_total
from reportes r
left join lateral (
  select count(*) as lineas,
         count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')) as ok,
         count(*) filter (where l.estado not in ('conciliado_auto','conciliado_confirmado','cuenta_casa','descartado')) as pendientes,
         count(*) filter (where l.estado = 'descartado') as fuera,
         coalesce(sum(l.monto) filter (where l.estado <> 'descartado'), 0) as monto
  from lineas_comision l where l.reporte_id = r.id
) c on true;

-- Igual que con v_excepciones: el DROP se lleva esta propiedad, y sin ella la vista devuelve
-- filas saltandose la RLS con la pantalla viendose identica.
alter view v_reportes set (security_invoker = on);

create or replace function procesar_costos(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare
  x uuid;
  v_ok bigint; v_exc bigint; v_total bigint;
begin
  for x in select id from lineas_costo where reporte_id = p_reporte_id loop
    perform matchear_costo(x);
  end loop;

  select count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
         count(*) filter (where l.estado in ('sin_identificar','pendiente')),
         count(*)
    into v_ok, v_exc, v_total
    from lineas_costo l
   where l.reporte_id = p_reporte_id;

  -- Mismo criterio que procesar_ventas: si quedo algo que decidir, 'matcheado' (hay trabajo
  -- pendiente en Conciliacion); si no quedo nada, 'cerrado'.
  update reportes
     set estado = case when v_exc > 0 then 'matcheado' else 'cerrado' end,
         total_lineas = v_total,
         total_ok = v_ok,
         total_excepciones = v_exc
   where id = p_reporte_id;

  return query
    select l.estado, count(*) from lineas_costo l
     where l.reporte_id = p_reporte_id group by l.estado order by 2 desc;
end $fn$;

comment on function procesar_costos is
  'Reparte los cargos de un reporte de MVR contra las cotizaciones Y CIERRA EL REPORTE. Lo '
  'segundo no es un detalle: si no actualiza estado y los contadores, la pantalla se queda en '
  '"Reading file..." y avisa que las filas no cuadran, porque no estan ni en OK ni en pendiente.';

-- ---------------------------------------------------------
-- Las cotizaciones tambien, y de paso reintentan los MVR
-- ---------------------------------------------------------
-- Antes esto lo hacia la edge function a mano: insertaba, y despues buscaba los costos
-- 'sin_identificar' para reprocesarlos. Mejor en la base, por lo mismo de siempre: la funcion
-- no se puede olvidar y el reproceso queda disponible desde el boton de reintentar.
create or replace function procesar_cotizaciones(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare
  v_ok bigint; v_exc bigint; v_total bigint; r uuid;
begin
  -- El trigger de lineas_cotizacion ya resolvio agente_id contra agente_por_texto() al
  -- insertar. Aca solo se cuenta: una cotizacion sin agente reconocido no sirve para
  -- identificar un MVR, asi que cuenta como pendiente.
  select count(*) filter (where q.agente_id is not null),
         count(*) filter (where q.agente_id is null),
         count(*)
    into v_ok, v_exc, v_total
    from lineas_cotizacion q
   where q.reporte_id = p_reporte_id;

  update reportes
     set estado = 'cerrado',
         total_lineas = v_total,
         total_ok = v_ok,
         total_excepciones = v_exc
   where id = p_reporte_id;

  -- Cotizaciones nuevas pueden identificar MVR que antes quedaron sin dueno. Se reintentan,
  -- asi el orden en que llegan los archivos no cambia el resultado.
  for r in select distinct c.reporte_id from lineas_costo c where c.estado = 'sin_identificar' loop
    perform procesar_costos(r);
  end loop;

  return query
    select case when q.agente_id is null then 'sin agente' else 'con agente' end, count(*)
      from lineas_cotizacion q where q.reporte_id = p_reporte_id
     group by 1 order by 2 desc;
end $fn$;

comment on function procesar_cotizaciones is
  'Cierra un reporte de cotizaciones y reintenta los MVR que habian quedado sin dueno. El '
  'contador de excepciones son las cotizaciones cuyo agente no se reconocio: esas no sirven '
  'para identificar ningun MVR.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Arreglar los dos que ya quedaron colgados
-- ---------------------------------------------------------
-- Los reportes que Arturo acaba de subir estan en 'extrayendo' con los contadores en cero. Sus
-- lineas SI entraron, asi que no hay que volver a subir nada: alcanza con procesarlos.
do $do$
declare r record;
begin
  for r in
    select rep.id, rep.tipo
      from reportes rep
     where rep.tipo in ('mvr', 'cotizaciones')
       and (rep.estado = 'extrayendo'
            or rep.total_lineas <> coalesce(rep.total_ok, 0) + coalesce(rep.total_excepciones, 0))
  loop
    if r.tipo = 'mvr' then
      perform procesar_costos(r.id);
    else
      perform procesar_cotizaciones(r.id);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  rep.tipo,
  coalesce(asg.nombre, 'sin compania')                          as compania,
  rep.estado,
  rep.total_lineas,
  rep.total_ok,
  rep.total_excepciones,
  rep.total_lineas - coalesce(rep.total_ok,0) - coalesce(rep.total_excepciones,0) as sin_cuadrar,
  (select round(coalesce(sum(c.monto),0),2) from lineas_costo c
    where c.reporte_id = rep.id and c.estado in ('conciliado_auto','conciliado_confirmado')) as mvr_repartido
from reportes rep
left join aseguradoras asg on asg.id = rep.aseguradora_id
where rep.tipo in ('mvr', 'cotizaciones')
order by rep.created_at desc;
