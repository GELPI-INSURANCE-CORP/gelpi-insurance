-- =========================================================
-- Borrar un statement que se subió mal
-- =========================================================
-- Arturo: *"si el statement yo lo subí y está dando error, o está mal subido, quiero borrar el
-- statement para volver a hacerlo de nuevo [...] no debe estar el statement ahí para toda la
-- vida si está mal."*
--
-- Hasta ahora no había forma: un archivo mal cargado se quedaba, ensuciando los totales de su
-- mes para siempre. Reprocesar tampoco alcanzaba, porque vuelve a leer el mismo archivo.
--
-- Tres cosas hay que cuidar para que borrar no rompa nada más:
--
-- 1. EL TRABAJO MANUAL NO SE PUEDE PERDER. Si alguien asignó agentes a mano en ese statement,
--    borrar las líneas se lleva ese trabajo. El Edge Function ya resuelve esto al reprocesar:
--    antes de borrar, escribe el agente decidido a mano en la PÓLIZA, y el motor lo vuelve a
--    encontrar solo por número de póliza. Acá se hace lo mismo. Sin esto, borrar y volver a
--    subir sería empezar de cero.
--
-- 2. QUEDA REGISTRO, CON EL MOTIVO. Borrar un mes entero de comisiones sin dejar rastro es
--    justo la clase de cosa que después nadie puede explicar. Se exige un motivo y se guarda
--    en la tabla de auditoría junto con el resumen de lo que se llevó.
--
-- 3. HAY REFERENCIAS QUE NO CASCADEAN. Las líneas y sus excepciones sí se van solas, pero
--    excepciones.linea_relacionada_id (el par de un duplicado) y bonos.reporte_id
--    apuntan sin cascade y bloquearían el borrado. Se limpian primero.
--
-- Y una consecuencia buena: reportes.hash_archivo es unique, así que al borrar el registro se
-- libera el hash y el mismo archivo se puede volver a subir. Sin borrarlo, el sistema lo
-- rechazaría por duplicado.

create or replace function borrar_reporte(p_reporte_id uuid, p_motivo text)
returns table (lineas_borradas int, excepciones_borradas int, polizas_preservadas int)
language plpgsql volatile as $fn$
declare
  v_rep          reportes%rowtype;
  v_lineas       int;
  v_exc          int;
  v_preservadas  int;
  v_resumen      text;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Hay que decir por qué se borra el statement.';
  end if;

  select * into v_rep from reportes where id = p_reporte_id;
  if not found then
    raise exception 'Ese statement ya no existe.';
  end if;

  -- 1. Lo decidido a mano se guarda en la póliza antes de que se vaya la línea.
  with manuales as (
    select l.poliza_id, l.agente_id, l.oficina_id
    from lineas_comision l
    where l.reporte_id = p_reporte_id
      and l.poliza_id is not null
      and l.agente_id is not null
      and l.regla_match in ('manual','override_manual','alta_manual','cuenta_casa','no_es_de_este_mes')
  ), guardadas as (
    update polizas p
       set agente_id = m.agente_id,
           oficina_id = coalesce(m.oficina_id, p.oficina_id)
      from manuales m
     where p.id = m.poliza_id
    returning 1
  )
  select count(*) into v_preservadas from guardadas;

  select count(*) into v_lineas from lineas_comision where reporte_id = p_reporte_id;
  select count(*) into v_exc
    from excepciones e
    join lineas_comision l on l.id = e.linea_comision_id
   where l.reporte_id = p_reporte_id;

  v_resumen := coalesce(v_rep.nombre_archivo,'(sin nombre)')
            || ' · período ' || coalesce(v_rep.periodo,'(sin período)')
            || ' · ' || v_lineas || ' líneas'
            || ' · ' || v_exc || ' excepciones'
            || ' · ' || v_preservadas || ' asignaciones manuales guardadas en el Book';

  -- 2. El registro va ANTES del borrado: si algo falla después, igual queda constancia de que
  --    se intentó y por qué.
  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, usuario, motivo)
  values ('reporte', p_reporte_id, 'borrado', 'statement completo', v_resumen, auth.uid(), btrim(p_motivo));

  -- 3. Las referencias que no cascadean.
  update excepciones e
     set linea_relacionada_id = null
    from lineas_comision l
   where l.id = e.linea_relacionada_id
     and l.reporte_id = p_reporte_id;

  -- La tabla es bonos, no bono_reparto. Lo primero que escribi fue bono_reparto, leyendo mal el
  -- esquema, y la funcion reventaba justo aca: no se podia borrar NINGUN statement. El error
  -- decia "column reporte_id does not exist", que suena a otra cosa — la columna existe, la que
  -- no existe es la tabla, y Postgres lo reporta por la columna.
  update bonos set reporte_id = null where reporte_id = p_reporte_id;

  -- Las líneas y sus excepciones se van en cascada con el reporte.
  delete from reportes where id = p_reporte_id;

  return query select v_lineas, v_exc, v_preservadas;
end $fn$;

comment on function borrar_reporte is
  'Borra un statement mal subido y todo lo que colgaba de él. Exige un motivo, que queda en '
  'auditoria junto con el resumen de lo borrado. Antes de borrar guarda en las pólizas los '
  'agentes que se habían asignado a mano, para que volver a subir el archivo no empiece de '
  'cero. Al irse el registro se libera hash_archivo y el mismo archivo se puede resubir.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Ojo al correr esto a mano
-- ---------------------------------------------------------
-- Si se prueba la funcion con la tecnica de "llamarla y despues raise exception para que se
-- revierta", NO se puede poner el create or replace en el mismo script. El rollback se lleva
-- tambien la definicion de la funcion, asi que el arreglo parece haber funcionado (la prueba
-- pasa) y en la base queda la version vieja. Paso exactamente eso: la prueba en seco dijo
-- "AHORA SI CORRE" y al borrar de verdad volvio a fallar con el mismo error.
--
-- Primero se corre el create or replace solo. Despues, en otra corrida, la prueba.
