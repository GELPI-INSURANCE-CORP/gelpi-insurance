-- =========================================================
-- Un índice para buscar nombres, y la pasada deja de cortarse
-- =========================================================
-- Medido con el reloj, no a ojo:
--
--   Ping simple a la base                    111 ms
--   Un solo LIKE sobre clientes              457 ms   -> ~350 ms de búsqueda
--   La función completa                      ~600 ms
--   Los 24 chargebacks de Progressive        se corta a los 8 s
--
-- El problema no es la función: es que buscar '%TRAVIESO%' obliga a leer los 2.369 clientes uno
-- por uno, y eso multiplicado por 24 líneas se pasa del límite de tiempo que la base le da a cada
-- pedido. Hacer la función más astuta no alcanza — hay que dejar de recorrer la tabla entera.
--
-- pg_trgm parte cada nombre en grupos de tres letras y los indexa. Con eso un LIKE con comodines a
-- los dos lados deja de ser un recorrido completo y pasa a ser una búsqueda en el índice, que es
-- para lo que existe la extensión.

create extension if not exists pg_trgm;

create index if not exists clientes_nombre_normalizado_trgm
  on clientes using gin (nombre_normalizado gin_trgm_ops);

-- El join que viene después también recorría pólizas entera por cada cliente encontrado.
create index if not exists polizas_cliente_id_idx on polizas (cliente_id);

-- ---------------------------------------------------------
-- Que la consulta pueda aprovechar el índice
-- ---------------------------------------------------------
-- `like all (array)` no le sirve al planificador: con un arreglo armado en tiempo de ejecución no
-- puede decidir usar el índice. Se separa en dos: primero un LIKE contra la palabra más larga
-- —una sola condición, indexable, que deja un puñado de filas— y recién sobre ese puñado se
-- aplica el resto. La palabra más larga es además la más específica: entre "ROSE" y "ARAGON",
-- filtrar por la segunda descarta mucho más.
create or replace function agentes_por_nombre_recortado(p_nombre text, p_aseguradora uuid)
returns table (agente_id uuid, agente text, cliente text, poliza_id uuid)
language sql stable as $FN$
  with partes as (
    select string_to_array(normalizar_nombre(p_nombre), ' ') as todas
  ), datos as (
    select
      (select array_agg('%' || t || '%') from unnest(p.todas) t where length(t) >= 3) as patrones,
      -- La palabra más larga, que es la que va contra el índice.
      (select '%' || t || '%' from unnest(p.todas) t where length(t) >= 3
        order by length(t) desc, t limit 1) as principal,
      (select t from unnest(p.todas) with ordinality as u(t, i)
        where length(t) = 1 order by i desc limit 1) as inicial
    from partes p
  ), candidatos as (
    select c.id, c.nombre
    from clientes c
    cross join datos d
    where d.principal is not null
      and c.nombre_normalizado like d.principal
      and c.nombre_normalizado like all (d.patrones)
      and (
        d.inicial is null
        or c.nombre_normalizado like d.inicial || '%'
        or c.nombre_normalizado like '% ' || d.inicial || '%'
      )
  )
  select distinct on (a.id) a.id, a.nombre, c.nombre, pol.id
  from candidatos c
  join polizas pol on pol.cliente_id = c.id
  join agentes a on a.id = pol.agente_id
  where coalesce(a.es_casa, false) = false
  order by a.id, (pol.aseguradora_id = p_aseguradora) desc nulls last, pol.updated_at desc;
$FN$;

-- Con el índice recién creado, el planificador necesita estadísticas frescas para decidir usarlo.
analyze clientes;
analyze polizas;

notify pgrst, 'reload schema';
