-- =========================================================
-- Isabel Diaz es Isabel Diaz Castillo
-- =========================================================
-- Arturo: "Isabel Diaz es de Miami Lakes, tiene que decir su nombre al lado de alguien, no es
-- posible."
--
-- Tenia razon y el numero es feo: el QuoteReport de septiembre trae 53 cotizaciones firmadas
-- "Isabel Diaz", y en el sistema la agente se llama "Isabel Diaz Castillo". agente_por_texto()
-- compara el nombre normalizado ENTERO, asi que no engancha, y esas 53 cotizaciones quedaron
-- sin agente: no sirven para identificar ni un solo MVR. Es el mismo tipo de falla que con
-- Greter Gelpi en GEICO, y se arregla igual -- con un alias.
--
-- De paso quedan a la vista los otros dos casos raros que aparecieron mirando esto, que NO son
-- un error del sistema sino algo que Arturo tiene que decidir:
--
--   Nancy Lobo    29 cotizaciones, el archivo las pone en la oficina 64304 (CORP), pero en el
--                 sistema esta cargada en MEDLEY. Sus MVR van a caer en Medley.
--   Luis Manuel   92 cotizaciones y un solo cargo de MVR.

insert into agente_alias (agente_id, texto)
select a.id, 'Isabel Diaz'
  from agentes a
 where normalizar_nombre(a.nombre) = normalizar_nombre('Isabel Diaz Castillo')
   and not exists (select 1 from agente_alias al
                    where al.texto_normalizado = 'ISABELDIAZ')
 limit 1;

-- Las 53 cotizaciones ya estan cargadas: el trigger resuelve el agente al INSERTAR, asi que
-- crear el alias no las arregla solo. Se las vuelve a pasar por agente_por_texto().
update lineas_cotizacion q
   set agente_id = agente_por_texto(q.agente_texto)
 where q.agente_id is null
   and nullif(btrim(coalesce(q.agente_texto,'')),'') is not null
   and agente_por_texto(q.agente_texto) is not null;

update lineas_cotizacion q
   set oficina_id = a.oficina_id
  from agentes a
 where q.agente_id = a.id
   and q.oficina_id is distinct from a.oficina_id;

-- Y los MVR que no se pudieron identificar vuelven a intentarlo, ahora con esas 53 adentro.
do $do$
declare r record;
begin
  for r in select id from reportes where tipo = 'mvr' loop
    perform procesar_costos(r.id);
  end loop;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from lineas_cotizacion where agente_id is null)             as cotizaciones_sin_agente,
  (select count(*) from lineas_cotizacion
    where agente_texto ilike 'Isabel Diaz%' and agente_id is not null)          as isabel_enganchadas,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                            as mvr_sin_dueno,
  (select round(sum(monto),2) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                            as plata_sin_dueno,
  (select count(*) from lineas_costo c join agentes a on a.id = c.agente_id
    where normalizar_nombre(a.nombre) = normalizar_nombre('Isabel Diaz Castillo')) as mvr_de_isabel,
  (select round(sum(monto),2) from lineas_costo)                                as total;
