-- =========================================================
-- El ranking de oficinas contaba líneas, no pólizas
-- =========================================================
-- ranking_oficinas() (migración 20260926000006_ranking_de_oficinas_por_prima_nueva.sql) traía
-- "polizas" con count(*) sobre v_lineas_negocio, que cuenta LÍNEAS. Una misma póliza puede tener
-- varias líneas en el período — la línea nueva, un endoso, una cancelación — así que el número
-- que se mostraba como "cantidad de pólizas" en realidad era cantidad de líneas, y podía estar
-- inflado. Arturo: "no me interesa ver las líneas [...] ponme la cantidad de póliza que reconoce
-- el sistema como new business."
--
-- El arreglo es contar pólizas distintas: count(distinct v.numero_normalizado). Las líneas sin
-- número de póliza (fees de la compañía, ajustes) tienen numero_normalizado null, y count(distinct)
-- las ignora solas — no hace falta filtrarlas aparte.
--
-- Y de paso se le enseña el mismo criterio de fecha que usa la liquidación. Progressive no corta
-- por mes: su statement de agosto trae transacciones hasta el 30 de septiembre, y para esas
-- compañías el mes al que pertenece una línea sale de la fecha de la transacción y no del período
-- que declara el archivo (ver 20260926000009). Si el dashboard usara un criterio y la liquidación
-- otro, la misma venta aparecería en meses distintos según qué pantalla se mire — que es
-- exactamente lo que hacía que los números no cerraran.
--
-- Esta migración solo reemplaza la función; no toca prima_sin_clasificar() ni nada más de la 006.
create or replace function ranking_oficinas(p_desde date, p_hasta date, p_limite int default 10)
returns table (oficina_id uuid, oficina text, polizas bigint, prima numeric, comision numeric)
language sql stable as $$
  with lineas as (
    select v.*, a.oficina_id as oficina_del_agente,
           case
             when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
               then v.fecha_statement
             else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
           end as mes
    from v_lineas_negocio v
    join agentes a on a.id = v.agente_id
    join reportes r on r.id = v.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    where v.negocio_nuevo is true
      and coalesce(a.es_casa, false) = false
      and v.estado in ('conciliado_auto', 'conciliado_confirmado')
  )
  select o.id as oficina_id,
         coalesce(o.nombre, 'Sin oficina') as oficina,
         count(distinct l.numero_normalizado) as polizas,
         coalesce(sum(l.prima), 0) as prima,
         coalesce(sum(l.monto), 0) as comision
  from lineas l
  left join oficinas o on o.id = l.oficina_del_agente
  where l.mes between p_desde and p_hasta
  group by o.id, o.nombre
  order by prima desc
  limit p_limite;
$$;

-- La nota de prima sin clasificar tiene que contar sobre el mismo período que la tabla de arriba.
create or replace function prima_sin_clasificar(p_desde date, p_hasta date) returns numeric
language sql stable as $$
  select coalesce(sum(v.prima), 0)
  from v_lineas_negocio v
  join agentes a on a.id = v.agente_id
  join reportes r on r.id = v.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  where v.negocio_nuevo is null
    and coalesce(a.es_casa, false) = false
    and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and (case
           when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
             then v.fecha_statement
           else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
         end) between p_desde and p_hasta;
$$;

notify pgrst, 'reload schema';
