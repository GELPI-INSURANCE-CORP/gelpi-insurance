-- =========================================================
-- El royalty va por el statement, no por la fecha de la transacción
-- =========================================================
-- Arturo comparó el dashboard contra sus registros y no le daba:
--
--   Miami Lakes    el sistema $24,473.48    él $23,986.59
--   Doral          el sistema $14,687.94    él $14,493.44
--
-- Era un error mío. Cuando escribí royalty_por_oficina() le copié el criterio de mes de la
-- liquidación, que para Progressive toma la FECHA DE LA TRANSACCIÓN y no el período del archivo.
-- Esa regla existe porque Arturo paga a los agentes por lo que vendieron del 1 al 31, y el
-- statement de Progressive cruza meses.
--
-- Pero el royalty no mide lo que se vendió: mide LO QUE LA OFICINA COBRÓ, y eso llega con el
-- statement completo. Sus palabras al explicarlo: *"del statement de GEICO de $12,264.48 que
-- ellos van a cobrar, yo les pago eso menos el 12%."* Es el statement, no la venta.
--
-- Medido: con el período del statement, Miami Lakes da $23,986.59 — el número de Arturo, exacto
-- al centavo. Eso confirma cuál de los dos criterios es el correcto acá.
--
-- Doral queda en $14,753.05 contra sus $14,493.44. Esos $259.61 NO son de la regla: se descartó
-- una por una que fueran líneas de cuenta de casa (las 5 de agosto son de CORP o sin oficina,
-- ninguna de Doral), agentes marcados como casa (no hay), líneas cuya oficina difiera de la de
-- su agente (cero en todo agosto) o una línea suelta de ese monto (no existe). La diferencia
-- está fuera del sistema. Por eso la función devuelve ahora también el desglose por compañía:
-- para poder pararlo al lado de su planilla y encontrarlo.
--
-- Las dos reglas conviven a propósito y NO hay que unificarlas:
--
--   pago al agente  ->  cuándo VENDIÓ      ->  fecha de transacción (Progressive)
--   royalty         ->  cuándo se COBRÓ    ->  período del statement

create or replace function royalty_por_oficina(p_desde date, p_hasta date)
returns table (
  oficina_id        uuid,
  oficina           text,
  es_corporativa    boolean,
  comision_generada numeric,
  pct_royalty       numeric,
  royalty           numeric
)
language sql stable as $fn$
  with lineas as (
    select coalesce(v.oficina_id, a.oficina_id) as of_id,
           v.monto,
           -- Sin la excepción de liquidar_por_fecha_transaccion: acá manda el archivo.
           coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date) as mes
    from v_lineas_negocio v
    join agentes a on a.id = v.agente_id
    join reportes r on r.id = v.reporte_id
    where v.estado in ('conciliado_auto', 'conciliado_confirmado')
  )
  select
    o.id,
    o.nombre,
    coalesce(o.es_corporativa, false),
    round(coalesce(sum(l.monto), 0), 2),
    o.pct_royalty,
    case
      when coalesce(o.es_corporativa, false) then 0
      else round(coalesce(sum(l.monto), 0) * coalesce(o.pct_royalty, 0) / 100, 2)
    end
  from oficinas o
  left join lineas l on l.of_id = o.id and l.mes between p_desde and p_hasta
  where coalesce(o.activa, true)
  group by o.id, o.nombre, o.es_corporativa, o.pct_royalty
  order by 6 desc, 4 desc;
$fn$;

-- ---------------------------------------------------------
-- El desglose, para poder cuadrarlo contra la planilla
-- ---------------------------------------------------------
-- Un total que no coincide y no se puede abrir es un callejón sin salida. Esto devuelve, por
-- oficina y compañía, cuánto sumó y de cuántas líneas sale, con el mismo criterio de arriba.
create or replace function royalty_detalle_por_compania(p_desde date, p_hasta date)
returns table (
  oficina_id  uuid,
  oficina     text,
  compania    text,
  lineas      bigint,
  comision    numeric
)
language sql stable as $fn$
  select
    o.id,
    o.nombre,
    coalesce(asg.nombre, 'Sin compañía'),
    count(*),
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
  order by o.nombre, 5 desc;
$fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobación
-- ---------------------------------------------------------
select string_agg(oficina || ' = $' || comision_generada, '   |   ' order by comision_generada desc)
         as agosto_con_la_regla_corregida
from royalty_por_oficina('2026-08-01', '2026-08-31');
