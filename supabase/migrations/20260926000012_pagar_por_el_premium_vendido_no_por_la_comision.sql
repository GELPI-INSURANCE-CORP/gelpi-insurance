-- =========================================================
-- Pagar por el premium vendido, no por la comisión que cobra la agencia
-- =========================================================
-- Hasta ahora el pago del agente salía de la COMISIÓN que la agencia recibió por su negocio
-- nuevo: a_pagar = comision_nuevo × pct. Arturo lo miró en pantalla y vio el problema:
--
--   *"me está calculando el 10%, pero del dinero generado, y no es lo que yo quiero. Lo que yo
--   quiero es el porcentaje de todo el premium que esa persona vendió. Si vendió $100,000, yo a
--   lo mejor voy a cobrar $15,000 porque la compañía está al 15%, pero a ella le voy a pagar el
--   1% de los $100,000."*
--
-- Y tiene razón, porque la base vieja hace que lo que gana el agente dependa de cuánto le paga
-- la compañía a la agencia, no de cuánto vendió él:
--
--   vende $100.000 de GEICO   la compañía paga 15%  ->  $15.000  ->  10% = $1.500 = 1,5% del premium
--   vende $100.000 de United  la compañía paga 10%  ->  $10.000  ->  10% = $1.000 = 1,0% del premium
--
-- La misma venta, distinto pago. Lo que decide cuánto gana el agente termina siendo el contrato
-- de la agencia con la compañía, que no tiene nada que ver con su trabajo.
--
-- Esta migración agrega la base correcta — el PREMIUM DE NEGOCIO NUEVO — y su propio porcentaje.
--
-- POR QUÉ UN CAMPO NUEVO Y NO REUSAR EL QUE YA ESTÁ. Los agentes tienen hoy guardado un
-- pct_split_default que significa "% de la comisión" (valores como 10 o 20). Si se cambiara la
-- base sin cambiar el campo, ese mismo 10 pasaría a significar "10% del premium": alrededor de
-- diez veces más plata, de un día para el otro y sin que nadie lo note. El campo nuevo arranca
-- NULO a propósito. Un agente sin porcentaje sobre prima paga $0 por esa vía y la pantalla lo
-- dice; es preferible a que cobre de más por un default que nadie eligió. Arturo: *"yo defino el
-- % luego, lo que necesito que salga ahí es el total premium vendido."*
--
-- Los dos cálculos conviven. La pantalla muestra el nuevo y, al lado, el viejo, para poder
-- compararlos los primeros meses antes de confiar del todo en el cambio.

alter table agentes
  add column if not exists pct_sobre_prima numeric;

comment on column agentes.pct_sobre_prima is
  'Porcentaje que se le paga al agente sobre el PREMIUM de negocio nuevo que vendió. Es la base '
  'correcta de pago: no depende de cuánto le pague la compañía a la agencia. Nulo = todavía no '
  'se definió, y entonces no se paga por esta vía. No confundir con pct_split_default, que es el '
  'porcentaje viejo sobre la comisión recibida y se conserva solo para comparar.';

-- ---------------------------------------------------------
-- La liquidación, ahora con el premium
-- ---------------------------------------------------------
-- Cambia la lista de columnas que devuelve, así que hay que soltar la función antes: Postgres no
-- deja cambiarle el tipo de retorno a una función con create or replace.
drop function if exists liquidacion_negocio_nuevo(date, date);

create function liquidacion_negocio_nuevo(p_desde date, p_hasta date)
returns table (
  agente_id               uuid,
  agente                  text,
  oficina                 text,
  pct                     numeric,
  comision_nuevo          numeric,
  comision_renovacion     numeric,
  comision_sin_clasificar numeric,
  a_pagar                 numeric,
  -- La base nueva.
  prima_nuevo             numeric,
  prima_renovacion        numeric,
  prima_sin_clasificar    numeric,
  pct_prima               numeric,
  a_pagar_prima           numeric
)
language sql stable as $fn$
  with lineas as (
    select v.agente_id, v.monto, v.prima, v.negocio_nuevo,
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
    round(coalesce(sum(l.monto) filter (where l.negocio_nuevo is true), 0) * a.pct_split_default / 100, 2),
    -- El premium vendido, con el mismo corte por tipo de negocio. Las cancelaciones traen prima
    -- negativa y restan solas, que es lo correcto: una venta que se cayó no se paga.
    round(coalesce(sum(l.prima) filter (where l.negocio_nuevo is true), 0), 2),
    round(coalesce(sum(l.prima) filter (where l.negocio_nuevo is false), 0), 2),
    round(coalesce(sum(l.prima) filter (where l.negocio_nuevo is null), 0), 2),
    a.pct_sobre_prima,
    -- Sin porcentaje definido no se paga por esta vía. coalesce a 0 y no a pct_split_default: ese
    -- número significa otra cosa y usarlo acá sería pagar diez veces de más sin avisar.
    round(coalesce(sum(l.prima) filter (where l.negocio_nuevo is true), 0)
          * coalesce(a.pct_sobre_prima, 0) / 100, 2)
  from agentes a
  left join oficinas o on o.id = a.oficina_id
  left join lineas l on l.agente_id = a.id and l.mes between p_desde and p_hasta
  where coalesce(a.es_casa, false) = false
  group by a.id, a.nombre, o.nombre, a.pct_split_default, a.pct_sobre_prima
  order by 9 desc;
$fn$;

-- ---------------------------------------------------------
-- El recibo congelado también guarda la base nueva
-- ---------------------------------------------------------
-- Sin esto, cerrar un mes guardaría el pago por comisión y perdería el premium sobre el que se
-- calculó. Los meses ya cerrados quedan como están: estas columnas les quedan nulas, que es la
-- verdad — en esos meses no existía este cálculo.
alter table liquidacion_agente
  add column if not exists prima_nuevo   numeric,
  add column if not exists pct_prima     numeric,
  add column if not exists a_pagar_prima numeric;

comment on column liquidacion_agente.prima_nuevo is
  'Premium de negocio nuevo sobre el que se calculó el pago en el mes que se cerró. Nulo en los '
  'meses cerrados antes de que existiera el pago por premium.';

-- ---------------------------------------------------------
-- Qué cambia con esto
-- ---------------------------------------------------------
select
  count(*) filter (where pct_prima is not null)  as agentes_con_pct_sobre_prima_definido,
  count(*) filter (where pct_prima is null)      as agentes_a_los_que_hay_que_ponerles_el_pct,
  '$' || round(coalesce(sum(prima_nuevo), 0), 2)::text    as premium_nuevo_del_mes,
  '$' || round(coalesce(sum(comision_nuevo), 0), 2)::text as comision_nueva_del_mes,
  '$' || round(coalesce(sum(a_pagar), 0), 2)::text        as se_pagaria_con_el_calculo_viejo,
  '$' || round(coalesce(sum(a_pagar_prima), 0), 2)::text  as se_pagaria_con_el_nuevo
from liquidacion_negocio_nuevo('2026-08-01', '2026-08-31');

notify pgrst, 'reload schema';
