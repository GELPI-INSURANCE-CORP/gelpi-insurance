-- =========================================================
-- Que el sistema pare si el libro se contradice
-- =========================================================
-- Arturo, sobre Thalia y Heidi:
--
--   "Si la poliza viene de la oficina Miami Lake y dice Thalia, esta mal, el sistema tiene que
--    parar, porque Thalia no pertenece a Miami Lake. [...] Thalia antes trabajaba para Miami
--    Lake, entonces va a suceder que viene una poliza que dice Miami Lake Thalia, pero la poliza
--    ya no le pertenece a Thalia, esa poliza se tiene que quedar con Heidi."
--
-- Revisado hoy: no esta pasando. Cero polizas con la oficina cruzada, cero lineas de comision
-- con la oficina cruzada, y cero lineas de GEICO asignadas por el nombre del productor (GEICO
-- tiene productor_confiable = false desde la migracion 20260926000004, justo porque su archivo
-- llama "THALIA RODRIGUEZ" al mismo codigo que en otro reporte llama "HEIDI VILAN").
--
-- Pero la alarma que el pide no existia, y el caso que describe es real y va a llegar: el dia
-- que un agente cambie de oficina, sus polizas viejas se quedan con la oficina anterior y nadie
-- se entera. No hay nada en el sistema que lo note.
--
-- POR QUE UNA ALARMA Y NO UN FRENO EN EL MATCHEO. Porque la contradiccion no nace ahi.
-- matchear_linea() copia agente Y oficina de la MISMA fila de polizas, asi que entre esos dos
-- nunca pueden discrepar. La contradiccion solo puede entrar por el Book: un archivo que trae
-- una oficina distinta de la del agente, o un agente al que le cambian la oficina despues.
-- Frenar el matcheo seria poner el candado en la puerta que no es.
--
-- Donde si sirve es ANTES DE PAGAR, que es cuando el error cuesta plata. Por eso esto es una
-- funcion que la pantalla de pago consulta y muestra arriba de todo cuando hay algo.

create or replace function alertas_del_libro()
returns table (
  tipo    text,
  titulo  text,
  detalle text,
  n       int,
  monto   numeric
)
language sql stable as $fn$
  -- ---------------------------------------------------------
  -- 1. La oficina de la poliza no es la del agente
  -- ---------------------------------------------------------
  -- El caso de Thalia: si figura en Doral pero tiene polizas marcadas en Miami Lakes, o esas
  -- polizas ya no son de ella, o la oficina quedo vieja. Las dos cosas hay que mirarlas a mano
  -- antes de pagar, porque el royalty de la oficina sale de aca.
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

  -- ---------------------------------------------------------
  -- 2. La misma poliza cargada dos veces bajo companias del mismo grupo
  -- ---------------------------------------------------------
  -- Kemper compro Infinity, asi que la misma poliza llega como "Infinity" en el Book y como
  -- "Kemper" en el statement. Las polizas se identifican por (numero, aseguradora), y como son
  -- dos aseguradoras distintas entran dos veces. El numero 50024941102 de Nancy Lobo es el que
  -- lo destapo: aparece como Infinity (comercial, sin cliente) y como Kemper (auto, con
  -- cliente).
  --
  -- No parte la comision -- las lineas se cuelgan siempre de una sola de las dos filas -- pero
  -- infla la prima del Book, y deja la historia de la poliza dividida en dos, que es justo lo
  -- que la regla del endoso necesita entera.
  select
    'poliza_duplicada'::text,
    'La misma poliza esta cargada dos veces bajo companias del mismo grupo',
    string_agg(distinct d.companias, ' / ' order by d.companias),
    count(*)::int,
    round(coalesce(sum(d.prima_de_mas), 0), 2)
  from (
    select
      p.numero_normalizado,
      string_agg(distinct coalesce(asg.nombre, 'sin compania'), ' + ' order by coalesce(asg.nombre, 'sin compania')) as companias,
      -- Lo que sobra es la prima de las filas que no tienen ni una linea de comision: esas son
      -- las copias, y su prima se esta sumando al Book dos veces.
      sum(coalesce(p.prima, 0)) filter (
        where not exists (select 1 from lineas_comision l where l.poliza_id = p.id)
      ) as prima_de_mas
    from polizas p
    left join aseguradoras asg on asg.id = p.aseguradora_id
    group by p.numero_normalizado
    having count(*) > 1
  ) d

  union all

  -- ---------------------------------------------------------
  -- 3. Polizas sin dueno
  -- ---------------------------------------------------------
  -- Una poliza sin agente no se le paga a nadie, y una sin oficina no entra en el royalty de
  -- ninguna. Hoy son cero; si alguna vez dejan de serlo, que se vea.
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

comment on function alertas_del_libro is
  'Contradicciones del Active Business Book que hay que mirar ANTES de pagar: la oficina de una '
  'poliza que no es la de su agente (el caso de un agente que cambio de oficina y dejo las '
  'polizas viejas atras), la misma poliza cargada dos veces bajo companias del mismo grupo '
  '(Kemper/Infinity), y polizas sin agente o sin oficina. Devuelve cero filas cuando no hay nada '
  'que mirar, que es lo normal.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select coalesce(string_agg(tipo || ': ' || titulo || ' -> ' || detalle, '   |   '), 'sin alertas')
  as estado_del_libro
from alertas_del_libro();
