-- =========================================================
-- El costo no era buscar: era revisar permisos fila por fila
-- =========================================================
-- Medido después de poner el índice, que no cambió nada:
--
--   Traer 1 cliente                        99 ms   <- puro viaje de red
--   Traer 1000 clientes                   295 ms
--   Buscar con LIKE (devuelve 2)          407 ms
--
-- Recorrer las 2.369 filas cuesta ~300 ms haga lo que haga. Eso no es la búsqueda: es la política
-- de seguridad de la tabla, que se evalúa una vez por fila y en cada una llama a mi_agente_id(),
-- que a su vez consulta la tabla de agentes. Dos mil trescientas consultas internas por cada
-- nombre que se busca. Por eso el índice no ayudó — el costo está antes de llegar a buscar.
--
-- La función pasa a 'security definer': corre con los permisos de su dueño y no vuelve a
-- preguntarse fila por fila si quien llama puede ver cada cliente.
--
-- Es seguro hacerlo acá, y conviene decir por qué:
--
--  * No recibe una consulta, recibe un nombre. No hay forma de pedirle "traeme todos los
--    clientes": siempre filtra por las palabras de ese nombre.
--  * Devuelve solo nombre de agente, nombre de cliente e identificadores. Ni primas, ni
--    comisiones, ni teléfonos, ni nada de lo que las políticas protegen.
--  * Es la misma decisión que ya tomó el sistema con mi_agente_id() y con las funciones que
--    resuelven excepciones: el motor necesita ver todo el Book para poder cruzar, y por eso esas
--    piezas corren como dueño mientras las consultas normales siguen con sus permisos intactos.
--  * search_path fijo, para que nadie pueda anteponer un esquema propio y hacerle ejecutar otra
--    cosa con permisos prestados.
--
-- Los índices de la migración anterior se dejan: hoy no cambian nada porque el cuello está en otro
-- lado, pero con el Book creciendo van a hacer falta, y ya están.

create or replace function agentes_por_nombre_recortado(p_nombre text, p_aseguradora uuid)
returns table (agente_id uuid, agente text, cliente text, poliza_id uuid)
language sql stable security definer set search_path = public as $FN$
  with partes as (
    select string_to_array(normalizar_nombre(p_nombre), ' ') as todas
  ), datos as (
    select
      (select array_agg('%' || t || '%') from unnest(p.todas) t where length(t) >= 3) as patrones,
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

notify pgrst, 'reload schema';
