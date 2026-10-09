-- =========================================================
-- El QuoteReport se anida solo
-- =========================================================
-- Arturo, por tercera vez, y con razon:
--
--   "Igual me siguen saliendo los dos externos aqui afuera. No soporto que me esten saliendo
--    los dos externos afuera."
--
-- La columna subido_con_id existe y la lista ya sabe dibujar anidado. Lo que falla es QUIEN la
-- llena: hoy solo el formulario, y solo cuando los dos archivos van en la MISMA subida. Si se
-- suben por separado -- o si se resubio uno de los dos, que es justo lo que paso -- el enlace
-- nunca se hace y vuelven a salir sueltos.
--
-- Depender de por donde entro el archivo es fragil. Un QuoteReport de septiembre pertenece al
-- MVR de septiembre, se haya subido junto, aparte, antes o despues. Eso lo sabe la base y no el
-- formulario, asi que el enlace se hace aca.

create or replace function procesar_cotizaciones(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare
  v_ok bigint; v_exc bigint; v_total bigint; r uuid; v_mvr uuid; v_mes date;
begin
  select count(*) filter (where q.agente_id is not null),
         count(*) filter (where q.agente_id is null),
         count(*)
    into v_ok, v_exc, v_total
    from lineas_cotizacion q
   where q.reporte_id = p_reporte_id;

  update reportes
     set estado = 'cerrado',
         total_lineas = v_total,
         total_ok = v_ok,
         total_excepciones = v_exc
   where id = p_reporte_id;

  -- Colgarse del MVR del mismo mes, para que la lista lo muestre adentro y no al lado. El mas
  -- reciente si hubiera varios: con Progressive, United, Kemper y Responsive mandando cada uno
  -- el suyo, un mes puede tener cuatro MVR y un solo QuoteReport que les sirve a todos. Se
  -- anida bajo uno -- tiene que vivir en algun lado -- y sigue sirviendo para los cuatro.
  select mes_del_periodo(periodo) into v_mes from reportes where id = p_reporte_id;
  if v_mes is not null then
    select id into v_mvr
      from reportes
     where tipo = 'mvr' and mes_del_periodo(periodo) = v_mes
     order by created_at desc
     limit 1;
    if v_mvr is not null then
      update reportes set subido_con_id = v_mvr where id = p_reporte_id;
    end if;
  end if;

  for r in select distinct c.reporte_id from lineas_costo c where c.estado = 'sin_identificar' loop
    perform procesar_costos(r);
  end loop;

  return query
    select case when q.agente_id is null then 'sin agente' else 'con agente' end, count(*)
      from lineas_cotizacion q where q.reporte_id = p_reporte_id
     group by 1 order by 2 desc;
end $fn$;

-- Y al reves: si el MVR llega DESPUES del QuoteReport, el que tiene que buscar es el MVR.
create or replace function procesar_costos(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare
  x uuid;
  v_ok bigint; v_exc bigint; v_total bigint; v_mes date;
begin
  for x in select id from lineas_costo where reporte_id = p_reporte_id loop
    perform matchear_costo(x);
  end loop;

  select count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
         count(*) filter (where l.estado in ('sin_identificar','pendiente')),
         count(*)
    into v_ok, v_exc, v_total
    from lineas_costo l
   where l.reporte_id = p_reporte_id;

  update reportes
     set estado = case when v_exc > 0 then 'matcheado' else 'cerrado' end,
         total_lineas = v_total,
         total_ok = v_ok,
         total_excepciones = v_exc
   where id = p_reporte_id;

  -- El QuoteModelo del mismo mes que todavia este suelto se cuelga de este MVR.
  select mes_del_periodo(periodo) into v_mes from reportes where id = p_reporte_id;
  if v_mes is not null then
    update reportes cot
       set subido_con_id = p_reporte_id
     where cot.tipo = 'cotizaciones'
       and cot.subido_con_id is null
       and mes_del_periodo(cot.periodo) = v_mes;
  end if;

  return query
    select l.estado, count(*) from lineas_costo l
     where l.reporte_id = p_reporte_id group by l.estado order by 2 desc;
end $fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Enganchar los que ya estan sueltos, y reprocesar
-- ---------------------------------------------------------
-- Las cotizaciones ya reconocen a sus agentes (1340 de 1393 en el archivo de septiembre), pero
-- el MVR se cruzo ANTES de ese arreglo y por eso sigue con sus 389 sin dueno. Reprocesarlo
-- ahora los cruza contra las cotizaciones buenas.
do $do$
declare r record;
begin
  update reportes cot
     set subido_con_id = mvr.id
    from reportes mvr
   where cot.tipo = 'cotizaciones'
     and cot.subido_con_id is null
     and mvr.tipo = 'mvr'
     and mes_del_periodo(mvr.periodo) = mes_del_periodo(cot.periodo);

  for r in select id from reportes where tipo = 'mvr' loop
    perform procesar_costos(r.id);
  end loop;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  r.tipo,
  coalesce(a.nombre, 'sin compania')                                        as compania,
  r.periodo,
  r.total_lineas,
  r.total_ok                                                                as con_dueno,
  r.total_excepciones                                                       as sin_dueno,
  case when r.subido_con_id is null then 'suelto' else 'anidado' end        as en_la_lista,
  (select round(coalesce(sum(c.monto),0),2) from lineas_costo c
    where c.reporte_id = r.id and c.estado in ('conciliado_auto','conciliado_confirmado')) as repartido
from reportes r
left join aseguradoras a on a.id = r.aseguradora_id
where r.tipo in ('mvr','cotizaciones')
order by r.created_at desc;
