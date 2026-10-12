-- =========================================================
-- Lo que cotiza Thalia es del Doral
-- =========================================================
-- Arturo:
--
--   "Revisa que no hayan en los MVR quotes que digan Thalia Rodriguez y esten asignados a
--    Kendall, que acabo de encontrar un cliente cotizado por Thalia Rodriguez en el location
--    Kendall. Si encuentras algunos creados o cotizados por Thalia pasalo a cobrarselo al
--    Doral ya que Thalia pertenece al Doral."
--
-- "Kendall" es GELPI INSURANCE CORP: la oficina se llamo "Gelpi Insurance Corp (Kendall)" al
-- principio (20260916000002) y se fusiono con CORP en 20260917000001. Hoy no existe ninguna
-- oficina Kendall, asi que lo que Arturo vio en esa columna es CORP.
--
-- Buscando por los dos caminos -- el cargo enganchado a una cotizacion de Thalia, y el cargo
-- cuyo cliente aparece cotizado por Thalia aunque haya enganchado por otra regla -- aparecen
-- DOS cargos fuera del Doral. Los 73 restantes ya estaban bien (70 a nombre de ella y 3 de
-- Christian Alvarez, que tambien es Doral).
--
--   1. CRESPO RODRIGUEZ, CRISTHIAN -- United Automobile -- se le cobraba a CORP / Arturo Gelpi.
--      Regla: 'codigo_de_la_agencia'. Ese es el user id 101418, que es el codigo de la OFICINA,
--      no el login personal de nadie: el sistema no supo de quien era y lo mando a la casa. La
--      cotizacion si tiene nombre, y el nombre es Thalia. Caso limpio.
--
--   2. GARCIA, ALEXEI -- Progressive -- se le cobraba a Miami Lakes / Heidi Vilan.
--      Regla: 'cotizacion', score 99.90. Este cliente lo cotizaron LAS DOS, Heidi y Thalia, y
--      el sistema eligio a Heidi. No es un error del cruce: es un empate real. Se mueve porque
--      Arturo lo pidio asi, y queda escrito aca por si lo quiere de vuelta en Miami Lakes.
--
-- Se mueve con asignar_costos(), que es la misma funcion que usa el boton de la pantalla: abre
-- la auditoria, cierra la excepcion si la hay, y arrastra a los demas cargos del mismo Quote ID.

do $do$
declare
  v_thalia uuid;
  v_ids    uuid[];
  v_n      integer;
begin
  select id into v_thalia
    from agentes
   where normalizar_nombre(nombre) like '%THALIA%'
     and normalizar_nombre(nombre) like '%RODRIGUEZ%'
   limit 1;

  if v_thalia is null then
    raise exception 'No encuentro a Thalia Rodriguez en agentes';
  end if;

  select array_agg(c.id) into v_ids
    from lineas_costo c
    left join oficinas o on o.id = c.oficina_id
   where coalesce(o.codigo, '') <> 'DORAL'
     and (
       c.cotizacion_id in (select id from lineas_cotizacion where agente_texto ilike '%thal%')
       or exists (
            select 1 from lineas_cotizacion q
             where q.agente_texto ilike '%thal%'
               and q.apellido_pre13 = c.apellido_pre13
               and q.pila_norm      = c.pila_norm
               and coalesce(c.apellido_pre13, '') <> '')
     );

  if v_ids is null then
    raise notice 'No quedaba ningun cargo de Thalia fuera del Doral';
    return;
  end if;

  -- Un freno: si manana esta consulta empezara a traer decenas de filas seria senal de que algo
  -- cambio en el cruce, y mover plata a ciegas es justo lo que no se puede hacer.
  if array_length(v_ids, 1) > 10 then
    raise exception 'Esperaba 2 cargos y encontre %. Parar y mirar.', array_length(v_ids, 1);
  end if;

  select asignar_costos(
           v_ids, v_thalia,
           'Arturo: "si encuentras algunos creados o cotizados por Thalia pasalo a cobrarselo al '
           || 'Doral ya que Thalia pertenece al Doral" (12-oct-2026)')
    into v_n;

  raise notice 'Movidos % cargos al Doral', v_n;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
-- Tiene que quedar vacio: ni un solo cargo tocado por una cotizacion de Thalia fuera del Doral.
select coalesce(o.nombre, '(sin oficina)') as oficina,
       coalesce(ag.nombre, '-')            as se_le_cobra_a,
       count(*)                            as cargos,
       round(sum(c.monto), 2)              as monto
  from lineas_costo c
  left join oficinas o  on o.id  = c.oficina_id
  left join agentes  ag on ag.id = c.agente_id
 where c.cotizacion_id in (select id from lineas_cotizacion where agente_texto ilike '%thal%')
    or exists (select 1 from lineas_cotizacion q
                where q.agente_texto ilike '%thal%'
                  and q.apellido_pre13 = c.apellido_pre13
                  and q.pila_norm      = c.pila_norm
                  and coalesce(c.apellido_pre13, '') <> '')
 group by 1, 2
 order by 1, 2;
