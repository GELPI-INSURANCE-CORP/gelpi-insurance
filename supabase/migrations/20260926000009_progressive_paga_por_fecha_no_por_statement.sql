-- =========================================================
-- Cuando el ciclo de la compañía no es el mes calendario
-- =========================================================
-- Progressive no corta por mes. Su statement de "agosto" arranca a mitad de agosto y llega hasta
-- mitad de septiembre, y lo paga el 10 de septiembre. Medido sobre los archivos cargados:
--
--   Progressive agosto   transacciones del 27-jun al 30-SEP
--   Progressive julio    transacciones del 29-may al 17-SEP
--   Responsive agosto    transacciones del 11-ago al 10-SEP
--   GEICO agosto         transacciones del 13-jun al 31-ago
--
-- Hasta ahora la liquidación tomaba el PERÍODO QUE DECLARA EL STATEMENT: todo lo que venía en el
-- archivo de agosto se pagaba como agosto, aunque la venta fuera del 20 de septiembre. Arturo lo
-- dijo claro: *"yo le voy a pagar a la gente lo que vendió de Progressive de agosto primero hasta
-- agosto 31, no lo que hizo el próximo mes."*
--
-- Así que para esas compañías el mes de liquidación sale de la FECHA DE LA TRANSACCIÓN de cada
-- línea, no del período del archivo.
--
-- POR QUÉ ES POR COMPAÑÍA Y NO PARA TODAS. Porque no todas traen una fecha en la que se pueda
-- confiar. National General no tiene columna de fecha de transacción: sus 31 líneas quedaron
-- fechadas el 1 de enero porque el período venía escrito "Agosto 2026" y JavaScript, que no
-- entiende "Agosto", devolvió el año con enero por defecto. Si se liquidara por fecha, esas 31
-- se irían a enero y desaparecerían de agosto sin que nadie lo note. Una fecha inventada es peor
-- que no tener fecha.
--
-- Arranca prendida solo para Progressive, que es el caso concreto que trajo Arturo. Se puede
-- prender para otra compañía con un update, cuando se verifique que su fecha es de verdad.

alter table aseguradoras
  add column if not exists liquidar_por_fecha_transaccion boolean not null default false;

comment on column aseguradoras.liquidar_por_fecha_transaccion is
  'true = el mes que se le paga al agente sale de la fecha de transacción de cada línea, no del '
  'período que declara el statement. Para compañías cuyo ciclo cruza meses (Progressive corta a '
  'mitad de mes). Solo prenderlo cuando se verificó que la compañía manda una fecha real por '
  'línea: si no la manda, el sistema pone una de relleno y liquidar por ella manda la comisión '
  'al mes equivocado.';

update aseguradoras set liquidar_por_fecha_transaccion = true
 where nombre ilike '%progressive%';

-- ---------------------------------------------------------
-- El mes al que pertenece una línea para liquidar
-- ---------------------------------------------------------
-- Un solo lugar donde se decide, para que la liquidación, el dashboard y cualquier reporte
-- futuro usen exactamente el mismo criterio. Antes esta expresión estaba copiada en tres lados.
create or replace function mes_de_liquidacion(p_linea_id uuid) returns date
language sql stable as $$
  select case
    when coalesce(asg.liquidar_por_fecha_transaccion, false) and l.fecha_statement is not null
      then l.fecha_statement
    else coalesce(mes_del_periodo(r.periodo), l.fecha_statement, l.created_at::date)
  end
  from lineas_comision l
  join reportes r on r.id = l.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  where l.id = p_linea_id;
$$;

-- ---------------------------------------------------------
-- La liquidación, ya con el criterio nuevo
-- ---------------------------------------------------------
create or replace function liquidacion_negocio_nuevo(p_desde date, p_hasta date)
returns table (
  agente_id uuid,
  agente text,
  oficina text,
  pct numeric,
  comision_nuevo numeric,
  comision_renovacion numeric,
  comision_sin_clasificar numeric,
  a_pagar numeric
)
language sql stable as $$
  with lineas as (
    select v.agente_id, v.monto, v.negocio_nuevo,
           case
             when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
               then v.fecha_statement
             else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
           end as mes
    from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    where v.estado in ('conciliado_auto', 'conciliado_confirmado')
      and v.agente_id is not null
  )
  select
    a.id,
    a.nombre,
    coalesce(o.nombre, 'Sin oficina'),
    a.pct_split_default,
    round(coalesce(sum(l.monto) filter (where l.negocio_nuevo is true), 0), 2),
    round(coalesce(sum(l.monto) filter (where l.negocio_nuevo is false), 0), 2),
    round(coalesce(sum(l.monto) filter (where l.negocio_nuevo is null), 0), 2),
    round(coalesce(sum(l.monto) filter (where l.negocio_nuevo is true), 0) * a.pct_split_default / 100, 2)
  from agentes a
  left join oficinas o on o.id = a.oficina_id
  left join lineas l on l.agente_id = a.id and l.mes between p_desde and p_hasta
  where coalesce(a.es_casa, false) = false
  group by a.id, a.nombre, o.nombre, a.pct_split_default
  order by 5 desc;
$$;

-- ---------------------------------------------------------
-- Qué cambia con esto
-- ---------------------------------------------------------
select
  (select string_agg(nombre, ', ' order by nombre) from aseguradoras where liquidar_por_fecha_transaccion)
    as companias_que_liquidan_por_fecha,
  (select count(*) from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    join aseguradoras asg on asg.id = r.aseguradora_id
   where asg.liquidar_por_fecha_transaccion
     and v.estado in ('conciliado_auto','conciliado_confirmado')
     and mes_del_periodo(r.periodo) between '2026-08-01' and '2026-08-31'
     and v.fecha_statement not between '2026-08-01' and '2026-08-31')
    as lineas_que_salen_de_agosto,
  '$' || round(coalesce((select sum(v.monto) from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    join aseguradoras asg on asg.id = r.aseguradora_id
   where asg.liquidar_por_fecha_transaccion
     and v.estado in ('conciliado_auto','conciliado_confirmado')
     and mes_del_periodo(r.periodo) between '2026-08-01' and '2026-08-31'
     and v.fecha_statement not between '2026-08-01' and '2026-08-31'), 0), 2)::text
    as plata_que_se_mueve;

notify pgrst, 'reload schema';
