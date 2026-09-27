-- =========================================================
-- El royalty de la franquicia
-- =========================================================
-- Gelpi es una franquicia: cada oficina le paga a Arturo un royalty mensual, y cada una tiene su
-- propio porcentaje. Hasta ahora eso no existía en el sistema — lo llevaba por fuera.
--
-- Arturo: *"yo le cobro a cada oficina un royalty mensual [...] del statement de GEICO de
-- $12,264.48 que ellos van a cobrar, yo les pago eso menos el 12%."*
--
-- OJO CON LA BASE, QUE NO ES LA MISMA QUE LA DEL PAGO A LOS AGENTES. Son dos cuentas distintas
-- y mezclarlas sería pagar y cobrar mal:
--
--   a los agentes  ->  un % de la PRIMA que vendieron, y solo del negocio nuevo
--   a las oficinas ->  un % de la COMISIÓN que generaron, y de TODA: nueva y renovación
--
-- Y el royalty se calcula sobre la comisión BRUTA de la oficina, antes de lo que ella le pague a
-- su gente. Se lo pregunté explícitamente: *"mi royalty no depende de cómo ellos le paguen a sus
-- agentes, yo cobro de todo el ingreso generado sea renovación o sea new business."* Si se
-- calculara sobre lo que les queda, una oficina que le sube el sueldo a su gente le bajaría el
-- royalty a Arturo, que no es el trato.

-- ---------------------------------------------------------
-- 1. El porcentaje de cada oficina
-- ---------------------------------------------------------
-- Campo propio y no reusar pct_override, que ya existe en esta tabla y significa otra cosa (un
-- override del split del agente). Dos números con significados distintos en la misma columna es
-- exactamente el problema que ya hubo con pct_split_default.
alter table oficinas
  add column if not exists pct_royalty numeric,
  add column if not exists es_corporativa boolean not null default false;

comment on column oficinas.pct_royalty is
  'Porcentaje de royalty que esta oficina le paga a la casa matriz, sobre la comisión BRUTA que '
  'genera (nueva y renovación). Nulo = todavía no se definió, y entonces no se cobra nada. No '
  'confundir con pct_override, que es del split del agente.';

comment on column oficinas.es_corporativa is
  'La oficina propia de la casa matriz. No paga royalty: cobrarse a sí mismo inflaría el total '
  'de la franquicia con plata que no entra de nadie.';

-- GELPI INSURANCE CORP es la oficina corporativa: *"esa no cobra nada"*.
update oficinas set es_corporativa = true
 where nombre ilike '%gelpi insurance corp%';

-- ---------------------------------------------------------
-- 2. Lo que genera cada oficina y lo que deja de royalty
-- ---------------------------------------------------------
-- La comisión se atribuye a la oficina de la línea; si la línea no la trae, a la del agente. La
-- de la línea es la que quedó registrada al conciliar, así que es la buena cuando existe.
--
-- Mismo criterio de mes que la liquidación y el dashboard, incluida la regla de las compañías
-- que no cortan por mes calendario (Progressive). Si el royalty usara otro criterio, el mismo
-- statement caería en un mes distinto según qué pantalla se mire.
--
-- Cuenta TODAS las líneas conciliadas de la oficina, sin excluir las de la cuenta de la casa:
-- son parte de lo que esa oficina movió en el mes, y es el mismo número que Arturo aprobó
-- cuando le mostré los totales de agosto.
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
           case
             when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
               then v.fecha_statement
             else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
           end as mes
    from v_lineas_negocio v
    join agentes a on a.id = v.agente_id
    join reportes r on r.id = v.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    where v.estado in ('conciliado_auto', 'conciliado_confirmado')
  )
  select
    o.id,
    o.nombre,
    coalesce(o.es_corporativa, false),
    round(coalesce(sum(l.monto), 0), 2),
    o.pct_royalty,
    -- La corporativa no paga, y una oficina sin porcentaje definido tampoco: coalesce a 0 y
    -- nunca a un default inventado. Un royalty que nadie eligió es plata que no existe.
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

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Qué sale hoy
-- ---------------------------------------------------------
select string_agg(
  oficina || ' -> genera $' || comision_generada
    || case when es_corporativa then '  (corporativa, no paga)'
            when pct_royalty is null then '  (falta ponerle el %)'
            else '  x ' || pct_royalty || '% = $' || royalty end,
  '   ||   ' order by comision_generada desc) as agosto
from royalty_por_oficina('2026-08-01', '2026-08-31');
