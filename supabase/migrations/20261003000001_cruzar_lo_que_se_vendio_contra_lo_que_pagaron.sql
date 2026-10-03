-- =========================================================
-- Cruzar lo que se vendio contra lo que pagaron
-- =========================================================
-- Arturo: *"arreglame que se haga el cruce por lo que subo de QQ: que falta con relacion a QQ y
-- que falta con relacion a los statements, y que hagan cruces viceversa."*
--
-- La prueba a mano que hicimos con el reporte de ventas de Nadira de agosto mostro por que hace
-- falta. QQ decia 59 polizas por $87,222.06 y el sistema $79,684.08, y la diferencia no era un
-- error del sistema sino tres cosas distintas que solo se ven cruzando:
--
--   52 clientes en los dos lados          QQ $77,228.70   statements $70,039.62
--   solo en QQ (vendido, no cobrado)      6 clientes      $9,993.36
--   solo en los statements                56 clientes     $9,644.46
--
-- Y al mirar los 6 "solo en QQ" uno por uno aparecio lo que importa de verdad: tres son polizas
-- COMERCIALES -- Commercial Auto, Professional Liability, General Liability -- de companias de
-- las que nunca se subio un statement. Son $6,432.48 de produccion de una sola agente en un solo
-- mes por los que puede que nadie haya cobrado. Eso es lo que este cruce tiene que gritar todos
-- los meses.
--
-- LOS TRES ESTADOS, que son las dos direcciones que pidio:
--
--   solo_venta      se vendio y ninguna compania pago comision -> plata por reclamar
--   en_ambos        se vendio y se cobro -> se comparan las dos primas
--   solo_statement  cobro comision y no esta en el reporte de ventas -> o es de un mes
--                   anterior (cuotas, comisiones de primer ano) o no se cargo en QQ
--
-- COMO SE EMPAREJAN. Por el nombre del cliente, porque el export de ventas de QQ no trae numero
-- de poliza. Se normaliza con normalizar_nombre() -- que ya saca acentos y los LLC/INC/CORP -- y
-- ademas:
--
--   * se ordenan las palabras, para que "Gonzalez Diaz, Luis" y "Luis Gonzalez Diaz" sean el
--     mismo cliente;
--   * se tiran las palabras de UNA letra. Esto no es un detalle: en la prueba a mano,
--     "RAFAEL A RODRIGUEZ PLAZA" (QQ) no emparejo con "RAFAEL RODRIGUEZ PLAZA" (United) y quedo
--     reportado como venta sin cobrar cuando en realidad SI se habia cobrado. Una inicial del
--     medio no puede costar un falso positivo.

create or replace function llave_cliente(p text) returns text
language sql immutable as $fn$
  select string_agg(w, ' ' order by w)
  from unnest(string_to_array(normalizar_nombre(p), ' ')) w
  where length(w) > 1;
$fn$;

comment on function llave_cliente is
  'Nombre de cliente reducido a algo comparable entre fuentes distintas: sin acentos, sin '
  'LLC/INC/CORP, con las palabras ordenadas (para que el orden nombre/apellido no importe) y sin '
  'las iniciales sueltas del medio.';

create or replace function cruce_ventas_statements(p_desde date, p_hasta date)
returns table (
  estado        text,
  cliente       text,
  agente        text,
  oficina       text,
  ramo          text,
  companias     text,
  fecha_venta   date,
  prima_vendida numeric,
  prima_cobrada numeric,
  comision      numeric,
  polizas       text
)
language sql stable as $fn$
  with ventas as (
    -- Lo que dice el reporte de ventas que se vendio. Se filtra por la fecha de vigencia, que es
    -- cuando empieza la poliza: es la fecha con la que piensa el que vendio.
    select
      llave_cliente(lv.cliente_nombre_crudo) as llave,
      coalesce(a.id, agente_por_texto(lv.agente_nombre_crudo)) as ag,
      max(lv.cliente_nombre_crudo) as cliente,
      string_agg(distinct coalesce(lv.ramo, '-'), ', ') as ramo,
      min(coalesce(lv.fecha_vigencia, lv.fecha_venta)) as fecha,
      sum(coalesce(lv.prima, 0)) as prima,
      string_agg(distinct nullif(lv.numero_poliza, ''), ', ') as polizas
    from lineas_venta lv
    left join agentes a on a.id = lv.agente_id
    where coalesce(lv.fecha_vigencia, lv.fecha_venta) between p_desde and p_hasta
      and llave_cliente(lv.cliente_nombre_crudo) is not null
    group by 1, 2
  ),
  cobros as (
    -- Lo que las companias pagaron como negocio nuevo en ese mismo mes, con la misma regla de
    -- corte que usa la liquidacion (Progressive por fecha de transaccion, el resto por el
    -- periodo del statement).
    select
      llave_cliente(coalesce(c.nombre, v.nombre_asegurado_crudo)) as llave,
      v.agente_id as ag,
      max(coalesce(c.nombre, v.nombre_asegurado_crudo)) as cliente,
      string_agg(distinct coalesce(asg.nombre, 'sin compania'), ', ') as companias,
      sum(coalesce(v.prima, 0)) as prima,
      sum(v.monto) as comision,
      string_agg(distinct nullif(v.numero_poliza_crudo, ''), ', ') as polizas
    from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    left join polizas p on p.id = v.poliza_id
    left join clientes c on c.id = p.cliente_id
    where v.negocio_nuevo
      and v.estado in ('conciliado_auto', 'conciliado_confirmado')
      and v.agente_id is not null
      and (case
             when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
               then v.fecha_statement
             else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
           end) between p_desde and p_hasta
      and llave_cliente(coalesce(c.nombre, v.nombre_asegurado_crudo)) is not null
    group by 1, 2
  )
  select
    case
      when co.llave is null then 'solo_venta'
      when ve.llave is null then 'solo_statement'
      else 'en_ambos'
    end,
    coalesce(ve.cliente, co.cliente),
    coalesce(ag.nombre, 'sin agente'),
    coalesce(o.nombre, 'sin oficina'),
    coalesce(ve.ramo, '-'),
    coalesce(co.companias, 'ninguna pago'),
    ve.fecha,
    coalesce(ve.prima, 0),
    coalesce(co.prima, 0),
    coalesce(co.comision, 0),
    coalesce(nullif(concat_ws(' / ', nullif(ve.polizas, ''), nullif(co.polizas, '')), ''), '-')
  -- full outer join: las dos direcciones en una sola pasada, que es lo que pidio.
  from ventas ve
  full outer join cobros co on co.llave = ve.llave and co.ag is not distinct from ve.ag
  left join agentes ag on ag.id = coalesce(ve.ag, co.ag)
  left join oficinas o on o.id = ag.oficina_id
  order by 1, coalesce(ve.prima, 0) + coalesce(co.prima, 0) desc;
$fn$;

comment on function cruce_ventas_statements is
  'Cruza el reporte de ventas (lineas_venta, lo que se vendio) contra lo que las companias '
  'pagaron como negocio nuevo (lineas_comision), en las dos direcciones: vendido sin cobrar, '
  'cobrado sin estar en ventas, y lo que esta en los dos con sus dos primas.';

notify pgrst, 'reload schema';
