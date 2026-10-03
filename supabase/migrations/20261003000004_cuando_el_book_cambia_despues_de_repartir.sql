-- =========================================================
-- Cuando el Book cambia despues de repartir
-- =========================================================
-- Auditando los agentes contra el Book aparecieron 3 lineas de 2,484 donde no coinciden. Dos son
-- el mismo caso y es el que importa:
--
--   Kemper 2026-09, polizas 10025617002 y 50031202802, $474.41
--     la linea se concilio    01-10 22:24  -> el Book decia Nadira LLanes (CORP)
--     el Book se actualizo    02-10 13:13  -> ahora dice Lisley Aguilera (FLAGLER)
--
-- Se subio una version nueva del Active Business Book y esas polizas cambiaron de dueno. La
-- comision ya estaba repartida y no se movio.
--
-- Que no se mueva sola esta BIEN: una subida del Book no puede repagarle a nadie en silencio.
-- Lo que esta mal es que no se vea. Y no es solo quien cobra: Nadira esta en CORP, que no paga
-- royalty, y Lisley en Flagler, que si. Mover esas dos lineas cambia tambien lo que se factura.
--
-- La tercera es un override_manual de GEICO ($125.10, Heidi sobre una poliza que el Book tiene a
-- nombre de Thalia). Esa es una decision tomada a mano y tiene que seguir ganandole al Book --
-- para eso se tomo -- asi que la alerta la deja afuera. Lo que se vigila es la deriva que nadie
-- decidio, no la correccion que alguien decidio.

create or replace function alertas_del_libro()
returns table (
  tipo    text,
  titulo  text,
  detalle text,
  n       int,
  monto   numeric
)
language sql stable as $fn$
  select
    'oficina_cruzada'::text,
    a.nombre || ' figura en ' || coalesce(oa.nombre, 'ninguna oficina')
      || ' pero tiene polizas marcadas en ' || coalesce(op.nombre, 'ninguna oficina'),
    count(*) || ' poliza' || case when count(*) = 1 then '' else 's' end
      || ', con ' || coalesce(sum(lc.n), 0) || ' linea'
      || case when coalesce(sum(lc.n), 0) = 1 then '' else 's' end || ' de comision encima',
    count(*)::int,
    round(coalesce(sum(lc.com), 0), 2)
  from polizas p
  join agentes a on a.id = p.agente_id
  left join oficinas oa on oa.id = a.oficina_id
  left join oficinas op on op.id = p.oficina_id
  left join lateral (
    select count(*) as n, coalesce(sum(l.monto), 0) as com
    from lineas_comision l
    where l.poliza_id = p.id
      and l.estado in ('conciliado_auto', 'conciliado_confirmado')
  ) lc on true
  where p.oficina_id is distinct from a.oficina_id
  group by a.nombre, oa.nombre, op.nombre

  union all

  select
    'poliza_duplicada'::text,
    'Hay numeros de poliza cargados dos veces en el Book',
    'En cada caso una cobro en un statement y la otra no. Puede ser la misma poliza escrita de '
      || 'dos maneras, o dos polizas distintas del mismo cliente: eso lo decis vos',
    count(*)::int,
    round(coalesce(sum(d.prima_sin_cobro), 0), 2)
  from (
    select
      p.numero_normalizado,
      sum(coalesce(p.prima, 0)) filter (
        where not exists (select 1 from lineas_comision l where l.poliza_id = p.id)
      ) as prima_sin_cobro
    from polizas p
    group by p.numero_normalizado
    having count(*) > 1
  ) d
  having count(*) > 0

  union all

  -- La deriva: comision ya repartida cuyo agente ya no es el que dice el Book.
  select
    'linea_vs_book'::text,
    'Hay comision repartida a un agente que ya no es el que dice el Book',
    'El Book se actualizo despues de conciliar el statement y esas polizas cambiaron de dueno. '
      || 'La comision no se movio sola, a proposito. Mira cual de las dos version es la buena',
    count(*)::int,
    round(coalesce(sum(lc.monto), 0), 2)
  from lineas_comision lc
  join polizas p on p.id = lc.poliza_id
  where lc.estado in ('conciliado_auto', 'conciliado_confirmado')
    and p.agente_id is not null
    and lc.agente_id is not null
    and p.agente_id <> lc.agente_id
    -- Un override manual es una decision tomada: tiene que ganarle al Book, no ser una alerta.
    and coalesce(lc.regla_match, '') not in ('override_manual', 'manual')
  having count(*) > 0

  union all

  select
    'poliza_sin_dueno'::text,
    'Polizas en el Book sin agente o sin oficina',
    count(*) filter (where agente_id is null) || ' sin agente, '
      || count(*) filter (where oficina_id is null) || ' sin oficina',
    count(*)::int,
    round(coalesce(sum(coalesce(prima, 0)), 0), 2)
  from polizas
  where agente_id is null or oficina_id is null
  having count(*) > 0;
$fn$;

-- ---------------------------------------------------------
-- El detalle, con las dos versiones enfrentadas
-- ---------------------------------------------------------
drop function if exists detalle_alertas_del_libro(text);

create function detalle_alertas_del_libro(p_tipo text default null)
returns table (
  tipo           text,
  clave          text,
  poliza_id      uuid,
  compania       text,
  grupo          text,
  origen         text,
  cliente        text,
  ramo           text,
  fecha_vigencia date,
  prima          numeric,
  lineas         int,
  comision       numeric,
  cobro          text,
  agente         text,
  oficina        text,
  se_queda       boolean
)
language sql stable as $fn$
  with pagos as (
    select l.poliza_id,
           count(*) as n,
           coalesce(sum(l.monto), 0) as com,
           string_agg(distinct asg.nombre || ' ' || coalesce(r.periodo, '?'), ', ') as quien
    from lineas_comision l
    join reportes r on r.id = l.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    group by l.poliza_id
  ),
  dup as (
    select p.numero_normalizado
    from polizas p
    group by p.numero_normalizado
    having count(*) > 1
  ),
  filas as (
    select
      'poliza_duplicada'::text as tipo,
      p.numero_normalizado as clave,
      p.id as poliza_id,
      coalesce(a.nombre, 'sin compania') as compania,
      coalesce(a.grupo, 'sin grupo') as grupo,
      p.origen,
      coalesce(c.nombre, 'sin cliente') as cliente,
      coalesce(p.ramo, '-') as ramo,
      p.fecha_vigencia,
      p.prima,
      coalesce(pg.n, 0)::int as lineas,
      round(coalesce(pg.com, 0), 2) as comision,
      coalesce(pg.quien, 'no cobro en ningun statement') as cobro,
      coalesce(g.nombre, 'sin agente') as agente,
      coalesce(o.nombre, 'sin oficina') as oficina,
      coalesce(pg.n, 0) > 0 as se_queda
    from polizas p
    join dup d on d.numero_normalizado = p.numero_normalizado
    left join pagos pg on pg.poliza_id = p.id
    left join aseguradoras a on a.id = p.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join agentes g on g.id = p.agente_id
    left join oficinas o on o.id = p.oficina_id

    union all

    -- Dos renglones por caso, como los duplicados: lo que dice la linea y lo que dice el Book.
    -- Enfrentarlos es lo unico que deja decidir cual de los dos esta bien.
    select
      'linea_vs_book',
      coalesce(lc.numero_poliza_crudo, p.numero_poliza),
      p.id,
      coalesce(asg.nombre, 'sin compania') || ' ' || coalesce(r.periodo, '?'),
      'la comision esta aca',
      coalesce(lc.regla_match, '-'),
      coalesce(c.nombre, lc.nombre_asegurado_crudo, 'sin cliente'),
      coalesce(p.ramo, '-'),
      p.fecha_vigencia,
      lc.prima,
      1,
      round(lc.monto, 2),
      coalesce(asg.nombre, '?') || ' ' || coalesce(r.periodo, '?'),
      coalesce(gl.nombre, 'sin agente'),
      coalesce(ol.nombre, 'sin oficina'),
      true
    from lineas_comision lc
    join polizas p on p.id = lc.poliza_id
    join reportes r on r.id = lc.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join agentes gl on gl.id = lc.agente_id
    left join oficinas ol on ol.id = gl.oficina_id
    where lc.estado in ('conciliado_auto', 'conciliado_confirmado')
      and p.agente_id is not null and lc.agente_id is not null
      and p.agente_id <> lc.agente_id
      and coalesce(lc.regla_match, '') not in ('override_manual', 'manual')

    union all

    select
      'linea_vs_book',
      coalesce(lc.numero_poliza_crudo, p.numero_poliza),
      p.id,
      'Book ' || to_char(p.updated_at, 'DD-MM HH24:MI'),
      'el Book dice otra cosa',
      p.origen,
      coalesce(c.nombre, 'sin cliente'),
      coalesce(p.ramo, '-'),
      p.fecha_vigencia,
      p.prima,
      0,
      0,
      'actualizado despues de conciliar',
      coalesce(gp.nombre, 'sin agente'),
      coalesce(op.nombre, 'sin oficina'),
      false
    from lineas_comision lc
    join polizas p on p.id = lc.poliza_id
    left join clientes c on c.id = p.cliente_id
    left join agentes gp on gp.id = p.agente_id
    left join oficinas op on op.id = gp.oficina_id
    where lc.estado in ('conciliado_auto', 'conciliado_confirmado')
      and p.agente_id is not null and lc.agente_id is not null
      and p.agente_id <> lc.agente_id
      and coalesce(lc.regla_match, '') not in ('override_manual', 'manual')

    union all

    select
      'oficina_cruzada',
      coalesce(g.nombre, 'sin agente'),
      p.id,
      coalesce(a.nombre, 'sin compania'),
      coalesce(a.grupo, 'sin grupo'),
      p.origen,
      coalesce(c.nombre, 'sin cliente'),
      coalesce(p.ramo, '-'),
      p.fecha_vigencia,
      p.prima,
      coalesce(pg.n, 0)::int,
      round(coalesce(pg.com, 0), 2),
      coalesce(pg.quien, 'no cobro en ningun statement'),
      coalesce(g.nombre, 'sin agente'),
      coalesce(o.nombre, 'sin oficina'),
      null::boolean
    from polizas p
    join agentes g on g.id = p.agente_id
    left join pagos pg on pg.poliza_id = p.id
    left join aseguradoras a on a.id = p.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join oficinas o on o.id = p.oficina_id
    where p.oficina_id is distinct from g.oficina_id

    union all

    select
      'poliza_sin_dueno',
      coalesce(p.numero_poliza, '-'),
      p.id,
      coalesce(a.nombre, 'sin compania'),
      coalesce(a.grupo, 'sin grupo'),
      p.origen,
      coalesce(c.nombre, 'sin cliente'),
      coalesce(p.ramo, '-'),
      p.fecha_vigencia,
      p.prima,
      coalesce(pg.n, 0)::int,
      round(coalesce(pg.com, 0), 2),
      coalesce(pg.quien, 'no cobro en ningun statement'),
      coalesce(g.nombre, 'sin agente'),
      coalesce(o.nombre, 'sin oficina'),
      null::boolean
    from polizas p
    left join pagos pg on pg.poliza_id = p.id
    left join aseguradoras a on a.id = p.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join agentes g on g.id = p.agente_id
    left join oficinas o on o.id = p.oficina_id
    where p.agente_id is null or p.oficina_id is null
  )
  select * from filas
  where p_tipo is null or filas.tipo = p_tipo
  order by filas.tipo, filas.clave, filas.se_queda desc nulls last, filas.compania;
$fn$;

notify pgrst, 'reload schema';
