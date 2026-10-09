-- =========================================================
-- Los cargos de la misma cotizacion van juntos
-- =========================================================
-- Kemper manda su "Point of Sale Detail" con un Quote ID por renglon, y varios renglones
-- comparten el mismo numero: el titular y cada conductor de ESA cotizacion. Por ejemplo la
-- 9262852975 trae tres: WENDY PEREZ [NI] con su CLUE, WENDY PEREZ con su MVR, y PHILIP LINDEN
-- con el suyo.
--
-- Philip Linden no esta en el Book ni en las cotizaciones: la poliza no es de el, es un
-- conductor de la de Wendy. Buscandolo por su nombre no aparece nunca y su cargo queda sin
-- dueno para siempre. Pero el archivo ya dijo que es la misma cotizacion que la de Wendy, y de
-- Wendy si se sabe de quien es. Esa informacion estaba en el archivo y se estaba tirando.
--
-- Asi que despues de cruzar fila por fila, los que quedaron sin dueno heredan el de su
-- cotizacion. Y hereda del cruce bueno, no de cualquiera: solo de una fila que haya quedado
-- conciliada.

alter table lineas_costo add column if not exists cotizacion_crudo text;

comment on column lineas_costo.cotizacion_crudo is
  'Numero de cotizacion tal cual lo manda la compania (Kemper: Quote ID). Varias filas con el '
  'mismo numero son la misma cotizacion -- el titular y sus conductores -- asi que el dueno que '
  'se encuentra para una vale para todas.';

create index if not exists lineas_costo_cotizacion_crudo
  on lineas_costo (reporte_id, cotizacion_crudo)
  where cotizacion_crudo is not null;

-- ---------------------------------------------------------
-- Heredar dentro de la cotizacion
-- ---------------------------------------------------------
create or replace function heredar_por_cotizacion(p_reporte_id uuid) returns integer
language plpgsql as $fn$
declare
  v_n integer := 0;
begin
  with dueno as (
    -- Un dueno por cotizacion, y solo si NO hay discusion: si dos filas de la misma cotizacion
    -- quedaron con agentes distintos, no se hereda nada. Es el mismo criterio que el freno del
    -- Book -- cuando los datos se contradicen, el sistema para en vez de elegir por su cuenta.
    select c.cotizacion_crudo,
           min(c.agente_id::text)::uuid  as agente_id,
           min(c.oficina_id::text)::uuid as oficina_id
      from lineas_costo c
     where c.reporte_id = p_reporte_id
       and c.cotizacion_crudo is not null
       and c.agente_id is not null
       and c.estado in ('conciliado_auto', 'conciliado_confirmado')
     group by c.cotizacion_crudo
    having count(distinct c.agente_id) = 1
  ), tocadas as (
    update lineas_costo c
       set agente_id = d.agente_id,
           oficina_id = d.oficina_id,
           estado = 'conciliado_auto',
           regla_match = 'misma_cotizacion'
      from dueno d
     where c.reporte_id = p_reporte_id
       and c.cotizacion_crudo = d.cotizacion_crudo
       and c.agente_id is null
       and c.estado in ('sin_identificar', 'pendiente')
    returning c.id
  )
  select count(*) into v_n from tocadas;

  -- La excepcion que se habia abierto para esas filas ya no tiene sentido: se resolvio sola.
  update excepciones e
     set estado = 'resuelta', accion = 'asignar',
         nota = 'Heredado de otra fila de la misma cotizacion', resuelta_en = now()
   where e.estado = 'pendiente'
     and e.linea_costo_id in (
       select c.id from lineas_costo c
        where c.reporte_id = p_reporte_id and c.regla_match = 'misma_cotizacion'
     );

  return v_n;
end $fn$;

comment on function heredar_por_cotizacion is
  'Los cargos sin dueno heredan el agente de otra fila de la MISMA cotizacion. Resuelve a los '
  'conductores que no son el titular: no estan en el Book porque la poliza no es de ellos. No '
  'hereda si las filas de esa cotizacion quedaron con agentes distintos.';

-- ---------------------------------------------------------
-- Que procesar_costos lo llame
-- ---------------------------------------------------------
-- Va DESPUES del cruce fila por fila y ANTES de contar: si contara primero, el reporte se
-- cerraria diciendo que faltan decidir unas filas que ya se resolvieron.
create or replace function procesar_costos(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare
  x uuid;
  v_ok bigint; v_exc bigint; v_total bigint; v_mes date;
begin
  for x in select id from lineas_costo where reporte_id = p_reporte_id loop
    perform matchear_costo(x);
  end loop;

  perform heredar_por_cotizacion(p_reporte_id);

  select count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
         count(*) filter (where l.estado in ('sin_identificar','pendiente')),
         count(*)
    into v_ok, v_exc, v_total
    from lineas_costo l
   where l.reporte_id = p_reporte_id;

  update reportes
     set estado = case when v_exc > 0 then 'matcheado' else 'cerrado' end,
         total_lineas = v_total,
         total_ok = v_ok,
         total_excepciones = v_exc
   where id = p_reporte_id;

  -- El QuoteReport del mismo mes que todavia este suelto se cuelga de este MVR.
  select mes_del_periodo(periodo) into v_mes from reportes where id = p_reporte_id;
  if v_mes is not null then
    update reportes cot
       set subido_con_id = p_reporte_id
     where cot.tipo = 'cotizaciones'
       and cot.subido_con_id is null
       and mes_del_periodo(cot.periodo) = v_mes;
  end if;

  return query
    select l.estado, count(*) from lineas_costo l
     where l.reporte_id = p_reporte_id group by l.estado order by 2 desc;
end $fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Reprocesar lo que ya esta cargado
-- ---------------------------------------------------------
do $do$
declare r record;
begin
  for r in select id from reportes where tipo = 'mvr' loop
    perform procesar_costos(r.id);
  end loop;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'lineas_costo' and column_name = 'cotizacion_crudo')  as columna_cotizacion,
  (select count(*) from pg_proc where proname = 'heredar_por_cotizacion')    as funcion,
  (select count(*) from lineas_costo where regla_match = 'misma_cotizacion') as heredados,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                          as siguen_sin_dueno,
  (select round(sum(monto), 2) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                          as plata_sin_dueno;
