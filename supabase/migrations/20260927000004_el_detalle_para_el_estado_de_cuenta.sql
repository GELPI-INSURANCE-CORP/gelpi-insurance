-- =========================================================
-- Lo que le falta al detalle por compañía para ser un estado de cuenta
-- =========================================================
-- royalty_detalle_por_compania() se hizo para cuadrar un total contra una planilla, así que
-- devolvía cuántas LÍNEAS había. Para el documento que se le manda a la oficina eso no sirve:
-- a nadie le importa cuántos renglones trajo el archivo de GEICO, le importa cuántas pólizas
-- son y cuánta prima representan.
--
-- Una misma póliza puede traer varias líneas en el mes — la venta, un endoso, una cancelación —
-- así que contar líneas y llamarlo "pólizas" daría un número inflado. count(distinct) sobre el
-- número normalizado lo resuelve, y las líneas sin número de póliza (fees de la compañía) se
-- ignoran solas porque count(distinct) no cuenta nulls.
--
-- Mismo criterio de mes que royalty_por_oficina(): el período del statement, que es cuando la
-- oficina cobra. Si el detalle usara otro, la suma de las compañías no daría el total del
-- estado de cuenta y el documento se contradiría a sí mismo.

-- Cambia las columnas que devuelve, asi que hay que soltarla antes: Postgres no deja cambiarle
-- el tipo de retorno a una funcion con create or replace.
drop function if exists royalty_detalle_por_compania(date, date);

create function royalty_detalle_por_compania(p_desde date, p_hasta date)
returns table (
  oficina_id  uuid,
  oficina     text,
  compania    text,
  lineas      bigint,
  polizas     bigint,
  prima       numeric,
  comision    numeric
)
language sql stable as $fn$
  select
    o.id,
    o.nombre,
    coalesce(asg.nombre, 'Sin compañía'),
    count(*),
    count(distinct v.numero_normalizado),
    round(coalesce(sum(v.prima), 0), 2),
    round(sum(v.monto), 2)
  from v_lineas_negocio v
  join agentes a on a.id = v.agente_id
  join reportes r on r.id = v.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  join oficinas o on o.id = coalesce(v.oficina_id, a.oficina_id)
  where v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
        between p_desde and p_hasta
  group by o.id, o.nombre, asg.nombre
  order by o.nombre, 7 desc;
$fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Cómo se vería el estado de cuenta de Doral en agosto
-- ---------------------------------------------------------
select string_agg(
         compania || ': ' || polizas || ' pólizas, prima $' || prima || ', comisión $' || comision,
         '   |   ' order by comision desc) as doral_agosto
from royalty_detalle_por_compania('2026-08-01', '2026-08-31')
where oficina ilike '%DORAL%';
