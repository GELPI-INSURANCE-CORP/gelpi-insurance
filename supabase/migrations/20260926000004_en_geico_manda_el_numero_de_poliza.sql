-- =========================================================
-- En GEICO manda el número de póliza, no el nombre del productor
-- =========================================================
-- El nombre del productor que manda GEICO no es confiable, y ahora hay cómo probarlo. El MISMO
-- código de agente aparece con nombres DISTINTOS según qué reporte se saque de GEICO:
--
--   I037573  ->  "ARTURO GELPI"      en el statement general (190 líneas)
--            ->  "THALIA RODRIGUEZ"  en el reporte de la oficina de Doral (121 líneas)
--
--   I073983  ->  "HEIDI VILAN"       en el statement general (158 líneas)
--            ->  "THALIA RODRIGUEZ"  en el reporte de la oficina de Doral (26 líneas)
--
-- O sea que no es que Thalía no tenga código: su producción viaja bajo el código de otros, y
-- GEICO le pone un nombre u otro según el reporte. El nombre no identifica a nadie.
--
-- Auditadas las 59 líneas que se habían asignado por ese nombre ($611,68), contra lo que dice el
-- Book para ese mismo cliente:
--
--   el Book dice OTRO agente     8
--   el Book dice el mismo        3
--   el cliente no está en el Book 48   (no se puede verificar)
--
-- De las 11 verificables, 8 estaban mal. Casos reales: cinco líneas de PEDRO BARRIOS y una de
-- CARLISY ABREU asignadas a Greter cuando el Book dice Marleny; y JONNATHAN RIOS ($166,56) a
-- Heidi cuando el Book dice Thalía — esa misma línea es parte de los $386,74 que faltaban en la
-- liquidación de Doral.
--
-- Con ese porcentaje de error, las 48 que no se pueden verificar tampoco merecen confianza.
-- Preferir "pendiente" antes que "asignado al que no es" no es ser más lento: es la diferencia
-- entre revisar una línea y tener que pedirle plata de vuelta a alguien.
--
-- Esto NO se generaliza a todas las compañías. En National General el productor viene en cada
-- fila y es el dato con el que paga la compañía; en Kemper directamente no viene. Es una
-- propiedad de cada aseguradora, no una regla del sistema.

alter table aseguradoras
  add column if not exists productor_confiable boolean not null default true;

comment on column aseguradoras.productor_confiable is
  'false = el nombre del productor que trae el statement de esta compañía no alcanza para '
  'asignarle la comisión a nadie, ni siquiera como último recurso. Caso GEICO: el mismo código '
  'de agente aparece con nombres distintos según el reporte, así que el nombre no identifica. '
  'Para esas compañías manda el número de póliza contra el Book.';

update aseguradoras set productor_confiable = false
 where nombre ilike '%geico%';

-- ---------------------------------------------------------
-- Que el paso del productor lo respete
-- ---------------------------------------------------------
create or replace function resolver_por_productor(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record;
  v_ag uuid;
  v_of uuid;
  v_compartida boolean;
  v_confiable boolean;
  n_ok int := 0;
  n_confirmadas int := 0;
  n_compartida int := 0;
  n_sin_agente int := 0;
begin
  -- Si la compañía del reporte no tiene un nombre de productor confiable, este paso no corre.
  select coalesce(a.productor_confiable, true) into v_confiable
    from reportes r left join aseguradoras a on a.id = r.aseguradora_id
   where r.id = p_reporte_id;

  if coalesce(v_confiable, true) then
    -- ---------------------------------------------------------
    -- a) Sin ninguna pista: el productor que declara el statement
    -- ---------------------------------------------------------
    for rec in
      select l.* from lineas_comision l
       where l.reporte_id = p_reporte_id
         and l.regla_match in ('sin_candidato', 'chargeback_sin_original')
         and l.estado not in ('conciliado_confirmado', 'cuenta_casa', 'descartado')
         and l.agente_id is null
       order by l.fila
    loop
      v_ag := agente_por_texto(rec.productor_crudo);
      if v_ag is null then
        n_sin_agente := n_sin_agente + 1;
        continue;
      end if;

      select a.produccion_compartida, a.oficina_id into v_compartida, v_of
        from agentes a where a.id = v_ag;

      if coalesce(v_compartida, false) then
        n_compartida := n_compartida + 1;
        continue;
      end if;

      update lineas_comision
         set agente_id = v_ag, oficina_id = coalesce(oficina_id, v_of),
             estado = 'conciliado_auto', regla_match = 'productor_del_statement',
             score = 80, candidatos = null
       where id = rec.id;

      update excepciones
         set estado = 'resuelta', accion = 'productor_del_statement',
             nota = format('Asignada al productor que declara el statement (%s).', rec.productor_crudo),
             resuelta_en = now()
       where linea_comision_id = rec.id and estado in ('pendiente', 'en_espera');

      n_ok := n_ok + 1;
    end loop;
  end if;

  -- ---------------------------------------------------------
  -- b) Dos fuentes que coinciden: el Book y el productor
  -- ---------------------------------------------------------
  -- Este sí corre siempre. Que el nombre no alcance POR SÍ SOLO no quiere decir que no valga
  -- como confirmación: si el Book —que es independiente del archivo— señala a la misma persona,
  -- no hay nada que decidir. Es justamente el caso en que el nombre no se está inventando nada.
  for rec in
    select l.* from lineas_comision l
     where l.reporte_id = p_reporte_id
       and l.agente_id is not null
       and l.estado not in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa', 'descartado')
       and l.agente_id = agente_por_texto(l.productor_crudo)
     order by l.fila
  loop
    select a.oficina_id into v_of from agentes a where a.id = rec.agente_id;

    update lineas_comision
       set oficina_id = coalesce(oficina_id, v_of),
           estado = 'conciliado_auto', regla_match = 'book_y_productor_coinciden',
           score = 95, candidatos = null
     where id = rec.id;

    update excepciones
       set estado = 'resuelta', accion = 'book_y_productor_coinciden',
           nota = format('El Book y el statement señalan al mismo agente (%s), así que no hacía '
                      || 'falta elegir.', rec.productor_crudo),
           resuelta_en = now()
     where linea_comision_id = rec.id and estado in ('pendiente', 'en_espera');

    n_confirmadas := n_confirmadas + 1;
  end loop;

  return jsonb_build_object(
    'productor_confiable', coalesce(v_confiable, true),
    'por_productor', n_ok,
    'book_y_productor_coinciden', n_confirmadas,
    'produccion_compartida_sin_evidencia', n_compartida,
    'productor_desconocido', n_sin_agente
  );
end $BODY$;

select
  (select string_agg(nombre, ', ' order by nombre) from aseguradoras where productor_confiable = false)
    as companias_cuyo_productor_no_manda,
  (select count(*) from aseguradoras where productor_confiable) as companias_donde_si_manda;

notify pgrst, 'reload schema';
