-- =========================================================
-- Ver las polizas que la alerta denuncia
-- =========================================================
-- Arturo, mirando el banner rojo que le puse arriba del pago:
--
--   "Me estas dando la alerta pero no me estas diciendo donde tengo que tocar para verlas."
--
-- Tiene razon, y es el mismo error que ya habia cometido con la columna "Sin clasificar": avisar
-- de un problema sin dar donde resolverlo. Una alerta que dice "hay 9 polizas mal" y no te deja
-- ver cuales son no es una alerta, es una preocupacion.
--
-- Esta funcion devuelve las filas una por una, con las dos mitades del duplicado enfrentadas,
-- para que se pueda ver de un vistazo cual tiene la comision y cual tiene la fecha.

create or replace function detalle_alertas_del_libro(p_tipo text default null)
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
  agente         text,
  oficina        text,
  -- La fila que tiene las lineas de comision colgadas. Es la que se queda si alguna vez se
  -- fusionan: nunca se toca algo de lo que cuelga plata.
  se_queda       boolean
)
language sql stable as $fn$
  with conteo as (
    select p.id,
           (select count(*) from lineas_comision l where l.poliza_id = p.id) as n,
           (select coalesce(sum(l.monto), 0) from lineas_comision l where l.poliza_id = p.id) as com
    from polizas p
  ),
  dup as (
    select p.numero_normalizado,
           count(*) as filas,
           count(distinct coalesce(a.grupo, a.id::text)) as grupos
    from polizas p
    left join aseguradoras a on a.id = p.aseguradora_id
    group by p.numero_normalizado
    having count(*) > 1
  ),
  filas as (
    -- Duplicadas, separadas igual que en alertas_del_libro(): mismo grupo es una sola poliza
    -- cargada dos veces, grupos distintos pueden ser dos polizas de verdad.
    select
      case when d.grupos = 1 then 'poliza_duplicada_grupo' else 'poliza_duplicada_cruzada' end as tipo,
      p.numero_normalizado as clave,
      p.id as poliza_id,
      coalesce(a.nombre, 'sin compania') as compania,
      coalesce(a.grupo, 'sin grupo') as grupo,
      p.origen,
      coalesce(c.nombre, 'sin cliente') as cliente,
      coalesce(p.ramo, '-') as ramo,
      p.fecha_vigencia,
      p.prima,
      co.n::int as lineas,
      round(co.com, 2) as comision,
      coalesce(g.nombre, 'sin agente') as agente,
      coalesce(o.nombre, 'sin oficina') as oficina,
      co.n > 0 as se_queda
    from polizas p
    join dup d on d.numero_normalizado = p.numero_normalizado
    join conteo co on co.id = p.id
    left join aseguradoras a on a.id = p.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join agentes g on g.id = p.agente_id
    left join oficinas o on o.id = p.oficina_id

    union all

    -- La oficina de la poliza no es la del agente. Hoy no hay ninguna; el dia que muevan a
    -- alguien de oficina y le queden las polizas viejas atras, aca se ven.
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
      co.n::int,
      round(co.com, 2),
      coalesce(g.nombre, 'sin agente'),
      coalesce(o.nombre, 'sin oficina'),
      null::boolean
    from polizas p
    join conteo co on co.id = p.id
    join agentes g on g.id = p.agente_id
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
      co.n::int,
      round(co.com, 2),
      coalesce(g.nombre, 'sin agente'),
      coalesce(o.nombre, 'sin oficina'),
      null::boolean
    from polizas p
    join conteo co on co.id = p.id
    left join aseguradoras a on a.id = p.aseguradora_id
    left join clientes c on c.id = p.cliente_id
    left join agentes g on g.id = p.agente_id
    left join oficinas o on o.id = p.oficina_id
    where p.agente_id is null or p.oficina_id is null
  )
  select * from filas
  where p_tipo is null or filas.tipo = p_tipo
  -- Las dos mitades de cada duplicado van juntas y primero la que tiene la comision, que es la
  -- que se queda. Asi se lee de corrido: esta se queda, esta se va.
  order by filas.tipo, filas.clave, filas.se_queda desc nulls last, filas.compania;
$fn$;

comment on function detalle_alertas_del_libro is
  'Las polizas detras de cada alerta de alertas_del_libro(), una por una. Para los duplicados '
  'devuelve las dos filas del par, marcando con se_queda = true la que tiene las lineas de '
  'comision colgadas.';

notify pgrst, 'reload schema';
