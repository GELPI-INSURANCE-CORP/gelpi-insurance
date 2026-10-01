-- =========================================================
-- Ajustes manuales en el estado de cuenta de la oficina
-- =========================================================
-- Hay plata que el statement de la compañía no explica y que igual hay que pasarle a la oficina.
-- El caso que lo destapó: el statement de Kemper de septiembre trae tres cargos "Fee-UWReports"
-- por -$397.80 en total. El sistema los lee bien y en negativo, pero quedan en estado
-- "cuenta_casa" y el royalty solo mira las líneas conciliadas, así que:
--
--   lo que dice el statement de Kemper     $7,457.71
--   lo que contaba el royalty              $7,855.51
--   diferencia                               $397.80   <- los tres fees
--
-- O sea: se mostraba como ingreso plata que nunca entró, y se cobraba royalty sobre ella.
--
-- Esos fees no se pueden repartir solos porque no traen oficina — el asegurado dice "FL - 23",
-- son cargos de la agencia. Cualquier reparto automático sería inventado. Lo que hacía falta no
-- era adivinar sino poder decirlo a mano, que es lo que pidió Arturo: *"que yo pueda crear un
-- adjustment manual [...] si hay algún ajuste que tenía que descontarle mil dólares, y ese
-- ajuste lleva royalty o no lleva royalty"*.
--
-- EL SIGNO. El monto va firmado: negativo descuenta de lo que se le manda a la oficina
-- (un fee, una devolución), positivo suma (un reintegro, un bono pactado). Un solo campo con
-- signo en vez de un campo "tipo" más un monto siempre positivo: con dos campos siempre llega
-- el día en que alguien guarda "cargo" con monto negativo y el sistema lo suma dos veces.
--
-- SI LLEVA ROYALTY O NO. Es la pregunta que hace la diferencia y por eso es obligatoria, sin
-- default. Con un fee de -$397.80 sobre una oficina al 12%:
--
--   lleva royalty    la base baja a $14,355.25, el royalty baja a $1,722.63
--   no lleva         la base sigue en $14,753.05, el royalty sigue en $1,770.37, y el fee
--                    se descuenta después
--
-- Son $47.74 de diferencia en un solo ajuste. Poner un default sería elegir por el usuario en
-- algo que solo él sabe.

create table if not exists ajustes_oficina (
  id            uuid primary key default gen_random_uuid(),
  oficina_id    uuid not null references oficinas(id) on delete cascade,
  -- El mes al que pertenece, en el mismo formato canónico que reportes.periodo (ver
  -- 20260927000005). Así el estado de cuenta de agosto encuentra los ajustes de agosto sin
  -- tener que interpretar nada.
  periodo       text not null,
  concepto      text not null,
  monto         numeric not null,
  aplica_royalty boolean not null,
  nota          text,
  creado_por    uuid,
  creado_en     timestamptz not null default now()
);

create index if not exists ajustes_oficina_busqueda on ajustes_oficina (oficina_id, periodo);

comment on table ajustes_oficina is
  'Cargos y créditos que la casa matriz le pone a mano al estado de cuenta de una oficina, para '
  'plata que el statement de la compañía no explica por sí solo: fees de la agencia, '
  'devoluciones, acuerdos. El monto va firmado (negativo descuenta) y aplica_royalty decide si '
  'cambia la base sobre la que se calcula el royalty o si se descuenta después.';

alter table ajustes_oficina enable row level security;
do $do$
begin
  if not exists (select 1 from pg_policies where tablename = 'ajustes_oficina' and policyname = 'auth_all') then
    create policy auth_all on ajustes_oficina for all to authenticated using (true) with check (true);
  end if;
end $do$;

-- ---------------------------------------------------------
-- El royalty, ahora con los ajustes que lo tocan
-- ---------------------------------------------------------
-- Solo entran los ajustes marcados con aplica_royalty. Los otros existen igual y salen en el
-- estado de cuenta, pero después del royalty: no cambian la base.
drop function if exists royalty_por_oficina(date, date);

create function royalty_por_oficina(p_desde date, p_hasta date)
returns table (
  oficina_id        uuid,
  oficina           text,
  es_corporativa    boolean,
  comision_generada numeric,
  ajustes_en_base   numeric,
  pct_royalty       numeric,
  royalty           numeric
)
language sql stable as $fn$
  with lineas as (
    select coalesce(v.oficina_id, a.oficina_id) as of_id,
           v.monto,
           coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date) as mes
    from v_lineas_negocio v
    join agentes a on a.id = v.agente_id
    join reportes r on r.id = v.reporte_id
    where v.estado in ('conciliado_auto', 'conciliado_confirmado')
  ),
  comision as (
    select o.id, round(coalesce(sum(l.monto), 0), 2) as generada
    from oficinas o
    left join lineas l on l.of_id = o.id and l.mes between p_desde and p_hasta
    group by o.id
  ),
  -- Los ajustes se buscan por el mes del período, no por el texto: así un estado de cuenta
  -- pedido por rango de fechas encuentra los del mes aunque el período esté escrito distinto.
  ajustes as (
    select aj.oficina_id, round(coalesce(sum(aj.monto), 0), 2) as en_base
    from ajustes_oficina aj
    where aj.aplica_royalty
      and mes_del_periodo(aj.periodo) between p_desde and p_hasta
    group by aj.oficina_id
  )
  select
    o.id,
    o.nombre,
    coalesce(o.es_corporativa, false),
    c.generada,
    coalesce(a.en_base, 0),
    o.pct_royalty,
    case
      when coalesce(o.es_corporativa, false) then 0
      else round((c.generada + coalesce(a.en_base, 0)) * coalesce(o.pct_royalty, 0) / 100, 2)
    end
  from oficinas o
  join comision c on c.id = o.id
  left join ajustes a on a.oficina_id = o.id
  where coalesce(o.activa, true)
  order by 7 desc, 4 desc;
$fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobación: sin ajustes cargados, nada cambia
-- ---------------------------------------------------------
select string_agg(oficina || ' = $' || comision_generada || ' -> royalty $' || royalty, '   |   '
                  order by comision_generada desc) as agosto
from royalty_por_oficina('2026-08-01', '2026-08-31');
