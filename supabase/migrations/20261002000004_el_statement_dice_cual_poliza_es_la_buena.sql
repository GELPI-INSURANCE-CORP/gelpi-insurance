-- =========================================================
-- El statement dice cual poliza es la buena
-- =========================================================
-- Arturo, frenando una fusion que yo iba a hacer:
--
--   "Tienes que entender que un cliente puede tener hoy una poliza con Response Ins Co y el
--    cliente puede tener una poliza el dia de manana con Progressive o con GEICO. Lo que tienes
--    que ajustar es por el statement, que fue la que pago y la que no pago. En este caso de la
--    poliza que tienes una con Progressive y otra con Response Ins Co, no tienes por que borrar
--    la otra porque deja el historial. [...] Y no me vas a borrar nada sin antes estar claro lo
--    que estas haciendo."
--
-- Tenia razon y la alerta estaba mal planteada. Decia "hay que fusionarlas", que es presumir la
-- respuesta, cuando el sistema no puede saberla. Cruzado contra los statements aparecio que de
-- los 10 casos hay por lo menos uno que NO es un duplicado:
--
--   50024941102, Nancy Lobo
--     fila Kemper    auto       $480.00    sin fecha     la pago Kemper 2026-09 (nueva + endoso)
--     fila Infinity  comercial  $1,923.00  vig 25-09     no la pago nadie
--
-- Un auto de $480 y un comercial de $1,923 no son la misma poliza, y la fila de Infinity ni
-- siquiera tiene cliente. Fusionarlas habria borrado una poliza de verdad.
--
-- Y el de Progressive + Response Ins Co es justo el caso que el describe: el mismo asegurado
-- tuvo una poliza y despues otra. Que la segunda todavia no haya cobrado no la hace falsa --
-- puede cobrar el mes que viene, o cobrar y despues venir el chargeback.
--
-- ASI QUE LA ALERTA DEJA DE PROPONER Y PASA A MOSTRAR. El dato que decide es el que el dio: cual
-- de las dos cobro en un statement. Eso ahora sale en la pantalla, al lado de cada fila, y la
-- decision es de una persona. El sistema no borra nada.

-- ---------------------------------------------------------
-- 1. La alerta, sin presumir la respuesta
-- ---------------------------------------------------------
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

  -- Un solo tipo para los numeros repetidos, y redactado como lo que es: una cosa para mirar,
  -- no una instruccion. Si son del mismo grupo o de companias distintas se sigue viendo en el
  -- detalle, pero ya no cambia lo que la alerta te manda a hacer, porque en los dos casos lo
  -- que hay que hacer es lo mismo: abrir, mirar cual cobro, y decidir.
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
-- 2. El detalle, con lo unico que decide: quien cobro
-- ---------------------------------------------------------
-- La columna nueva es "cobro": que statement le pago a esa fila, o si no le pago nadie. Es el
-- criterio que dio Arturo, y es el unico dato duro -- el resto (prima, ramo, fecha) ayuda a
-- entender, pero quien puso la plata lo dice el statement.
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
