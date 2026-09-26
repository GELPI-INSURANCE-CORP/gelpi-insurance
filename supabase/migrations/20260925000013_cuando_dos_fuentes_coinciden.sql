-- =========================================================
-- Cuando el Book y el statement dicen lo mismo, no hay nada que decidir
-- =========================================================
-- Quedó una incoherencia al agregar el paso del productor. Hoy el sistema hace esto:
--
--   Línea SIN ninguna pista salvo el productor   ->  se asigna sola
--   Línea CON el cliente encontrado en el Book
--     Y con ese mismo agente como productor      ->  queda pendiente de confirmar
--
-- O sea: con más evidencia, menos decisión. Al revés de como debería ser.
--
-- La sugerencia por nombre queda pendiente a propósito, y está bien que así sea: un apellido
-- que coincide no alcanza para pagarle a alguien — hay siete Zamora en el Book. Pero cuando a
-- esa coincidencia se le suma que la compañía declara a ESA MISMA persona como quien escribió
-- el negocio, ya no es un apellido parecido: son dos fuentes independientes diciendo lo mismo.
-- El Book sale de cómo la agencia organiza sus clientes; el productor, de los registros de la
-- aseguradora. Que coincidan no es casualidad.
--
-- Medido sobre GEICO agosto, de las 52 que quedaban sin resolver:
--
--   Coinciden Book y productor     7    (Nadira 4, Marleny 2, Heidi 1)
--   Discrepan                      9    <- estas siguen pendientes, y tienen que seguirlo
--   Sin sugerencia, productor
--     de producción compartida    36    <- Arturo; sin tocar
--
-- Las 9 que discrepan son el caso interesante y la razón por la que esto NO se generaliza: en
-- 6, el archivo dice Greter y el Book dice Marleny. En 2, el archivo dice Arturo y el Book dice
-- Thalia — que es exactamente el problema que motivó todo esto, y el sistema lo está señalando
-- bien. Ahí hay que elegir, y elige una persona.

create or replace function resolver_por_productor(p_reporte_id uuid) returns jsonb
language plpgsql as $BODY$
declare
  rec record;
  v_ag uuid;
  v_of uuid;
  v_compartida boolean;
  n_ok int := 0;
  n_confirmadas int := 0;
  n_compartida int := 0;
  n_sin_agente int := 0;
begin
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

    -- Sin ninguna otra evidencia, el nombre del productor no alcanza para un agente cuya
    -- producción sale bajo el código de otro. Queda para que lo mire una persona.
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

  -- ---------------------------------------------------------
  -- b) Dos fuentes que coinciden: el Book y el productor
  -- ---------------------------------------------------------
  -- Acá SÍ se acepta un agente de producción compartida: la duda con esos era que el nombre del
  -- productor pudiera esconder a otra persona, y el Book —que es independiente del archivo— está
  -- diciendo que no. Si discrepan, la línea no se toca.
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
    'por_productor', n_ok,
    'book_y_productor_coinciden', n_confirmadas,
    'produccion_compartida_sin_evidencia', n_compartida,
    'productor_desconocido', n_sin_agente
  );
end $BODY$;

notify pgrst, 'reload schema';
