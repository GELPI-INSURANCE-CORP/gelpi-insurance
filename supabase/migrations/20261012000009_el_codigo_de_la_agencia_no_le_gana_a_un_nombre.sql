-- =========================================================
-- El codigo de la agencia no le gana a un nombre
-- =========================================================
-- Arturo, antes de cerrar septiembre:
--
--   "El MVR de Progressive del Doral ya esta listo, puedo dormir tranquilo? No hay ningun
--    quote de Thalia asignado a ninguna otra oficina, ni de Thalia ni de Christian?"
--
-- De Thalia no quedaba ninguno: eso lo cerro 20261012000008. De Christian si, y a el no lo
-- habia mirado. Buscando por AGENTE del Doral en vez de por el texto del archivo aparecen dos:
--
--   REYES, DANAY   United Automobile  $8.35  a CORP / Arturo Gelpi
--   NUNEZ, JOSE    Progressive        $8.00  a Miami Lakes / Heidi Vilan
--
-- Son dos casos distintos y se arreglan distinto.
--
-- ---------------------------------------------------------
-- 1. El codigo de la agencia no es prueba de nada
-- ---------------------------------------------------------
-- El cargo de Danay Reyes quedo en CORP por la regla 'codigo_de_la_agencia': el user id 101418
-- de United es el codigo de la OFICINA, no el login de una persona, asi que el sistema no supo
-- de quien era y lo mando a la casa. Pero la cotizacion enganchada SI tiene nombre, y el nombre
-- es Christian Alvarez.
--
-- Eso no es una excepcion del Doral, es un orden de prioridad mal puesto: un codigo que
-- comparten todos no puede ganarle a una cotizacion firmada por una persona. Asi que la regla
-- va general, para cualquier oficina, y no clavada a estas dos filas.
--
-- Hoy toca UNA sola fila en toda la base -- lo verifique antes de escribir esto -- pero queda
-- escrita para que no haya que volver a descubrirla el mes que viene.
--
-- ---------------------------------------------------------
-- 2. Lo que cotiza el Doral es del Doral
-- ---------------------------------------------------------
-- A Jose Nunez lo cotizaron LOS DOS, Christian y Heidi, y el motor eligio a Heidi con score
-- 100. No es un error del cruce: es un empate real, igual que el de GARCIA, ALEXEI en
-- 20261012000008. Se mueve por la misma razon que aquel -- Arturo: "si encuentras algunos
-- creados o cotizados por Thalia pasalo a cobrarselo al Doral ya que Thalia pertenece al
-- Doral" -- y por eso queda escrito aca, por si lo quiere de vuelta en Miami Lakes.
--
-- Esta segunda parte SI va atada al Doral a proposito. La primera es un principio; esta es una
-- decision del dueno sobre una oficina, y mezclarlas haria que un empate en cualquier otro par
-- de oficinas se resolviera solo, sin que nadie lo haya pedido.

do $do$
declare
  r record;
  v_n integer := 0;
begin
  -- ---------- 1. El nombre le gana al codigo ----------
  for r in
    select c.id as linea, q.agente_id
      from lineas_costo c
      join lineas_cotizacion q on q.id = c.cotizacion_id
      join agentes a on a.id = q.agente_id
     where c.regla_match = 'codigo_de_la_agencia'
       and not (a.es_casa or a.produccion_compartida)
       and a.oficina_id is distinct from c.oficina_id
  loop
    perform asignar_costos(
      array[r.linea], r.agente_id,
      'El user id del archivo es el codigo de la agencia, no el login de nadie; la cotizacion '
      || 'enganchada si nombra a un agente de verdad');
    v_n := v_n + 1;
  end loop;
  raise notice 'Por el nombre de la cotizacion en vez del codigo: % cargos', v_n;

  -- ---------- 2. Los empates del Doral, para el Doral ----------
  v_n := 0;
  for r in
    select distinct on (c.id) c.id as linea, ag.id as agente_id
      from lineas_costo c
      left join oficinas o on o.id = c.oficina_id
      join lineas_cotizacion q
        on q.id = c.cotizacion_id
        or (q.apellido_pre13 = c.apellido_pre13
            and q.pila_norm = c.pila_norm
            and coalesce(c.apellido_pre13, '') <> '')
      join agentes ag on ag.id = q.agente_id
      join oficinas od on od.id = ag.oficina_id and od.codigo = 'DORAL'
     where coalesce(o.codigo, '') <> 'DORAL'
     order by c.id, q.fecha desc nulls last
  loop
    perform asignar_costos(
      array[r.linea], r.agente_id,
      'Arturo: lo que cotiza el Doral se le cobra al Doral (12-oct-2026)');
    v_n := v_n + 1;
  end loop;
  raise notice 'Cotizados por el Doral y cobrados afuera: % cargos', v_n;

  -- Un freno. Si alguna vez esto moviera decenas de filas seria senal de que algo cambio en el
  -- cruce, y mover plata a ciegas es justo lo que no se puede hacer.
  if v_n > 10 then
    raise exception 'Movi % cargos y esperaba 1 o 2. Revisar antes de dar esto por bueno.', v_n;
  end if;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
-- Las dos tienen que quedar vacias.
select 'cotizado por el Doral y cobrado afuera' as control,
       coalesce(o.nombre, '(sin oficina)')      as se_le_cobra_a,
       count(*)                                 as cargos,
       round(sum(c.monto), 2)                   as monto
  from lineas_costo c
  left join oficinas o on o.id = c.oficina_id
 where coalesce(o.codigo, '') <> 'DORAL'
   and exists (
     select 1 from lineas_cotizacion q
       join agentes ag on ag.id = q.agente_id
       join oficinas od on od.id = ag.oficina_id and od.codigo = 'DORAL'
      where q.id = c.cotizacion_id
         or (q.apellido_pre13 = c.apellido_pre13
             and q.pila_norm = c.pila_norm
             and coalesce(c.apellido_pre13, '') <> ''))
 group by 1, 2
union all
select 'resuelto por el codigo teniendo un nombre detras',
       coalesce(o.nombre, '(sin oficina)'), count(*), round(sum(c.monto), 2)
  from lineas_costo c
  join lineas_cotizacion q on q.id = c.cotizacion_id
  join agentes a on a.id = q.agente_id
  left join oficinas o on o.id = c.oficina_id
 where c.regla_match = 'codigo_de_la_agencia'
   and not (a.es_casa or a.produccion_compartida)
   and a.oficina_id is distinct from c.oficina_id
 group by 1, 2;
