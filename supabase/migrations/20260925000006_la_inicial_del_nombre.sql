-- =========================================================
-- Usar la inicial del nombre, que es lo que descarta
-- =========================================================
-- La búsqueda por nombre recortado encontraba al cliente por el apellido y nada más. Eso alcanza
-- para proponer, pero deja pasar un caso que medí en Progressive julio:
--
--   Statement:  "ULLOA E."
--   Book:       "Daniel Alonso Diaz Ulloa"   (de Thalia Rodriguez)
--
-- El apellido coincide. La inicial no: dice E y Daniel empieza con D. No es la misma persona, y el
-- sistema la iba a sugerir igual.
--
-- Progressive manda "APELLIDO(S) INICIAL." y esa letra es la del nombre de pila. Exigirla no hace
-- que se encuentren más personas — hace que las que se encuentran sean las correctas. Y como
-- descarta bien, recién ahí se puede aflojar la otra condición: ya no hace falta que el cliente
-- tenga una póliza de ESTA compañía. Si el agente maneja a esa persona en United, es su cliente
-- también en Progressive; lo que antes sostenía esa restricción ahora lo sostiene la inicial.
--
-- Cuando el nombre no trae inicial (otras compañías mandan el nombre completo) no se exige nada
-- extra: la condición solo se aplica si hay una inicial que verificar.

create or replace function agentes_por_nombre_recortado(p_nombre text, p_aseguradora uuid)
returns table (agente_id uuid, agente text, cliente text, poliza_id uuid)
language sql stable as $$
  with partes as (
    select string_to_array(normalizar_nombre(p_nombre), ' ') as todas
  ), datos as (
    select
      -- Las palabras de tres letras o más: son las que identifican. Las cortas (la inicial suelta,
      -- DE, Y) están en medio Book y no distinguen a nadie.
      (select array_agg(t) from unnest(p.todas) t where length(t) >= 3) as tokens,
      -- La inicial: una sola letra al final del nombre. Si no hay, queda null y no se exige.
      (select t from unnest(p.todas) with ordinality as u(t, i)
        where length(t) = 1 order by i desc limit 1) as inicial
    from partes p
  )
  select distinct on (a.id) a.id, a.nombre, c.nombre, pol.id
  from clientes c
  join polizas pol on pol.cliente_id = c.id
  join agentes a on a.id = pol.agente_id
  cross join datos d
  where d.tokens is not null
    and array_length(d.tokens, 1) >= 1
    and (select bool_and(c.nombre_normalizado like '%' || t || '%') from unnest(d.tokens) t)
    -- La inicial tiene que ser la primera letra de alguna palabra del nombre en el Book.
    and (
      d.inicial is null
      or exists (
        select 1 from unnest(string_to_array(c.nombre_normalizado, ' ')) w
        where left(w, 1) = d.inicial
      )
    )
    and coalesce(a.es_casa, false) = false
  -- La compania ya no filtra, pero sigue pesando: entre las polizas de esa persona se elige
  -- primero una de la misma compania del statement, que es la mas relevante para esta linea.
  order by a.id, (pol.aseguradora_id = p_aseguradora) desc nulls last, pol.updated_at desc;
$$;

notify pgrst, 'reload schema';
