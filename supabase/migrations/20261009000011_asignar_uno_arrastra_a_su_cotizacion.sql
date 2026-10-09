-- =========================================================
-- Asignar uno arrastra a los de su cotizacion
-- =========================================================
-- Arturo, viendo el archivo de Kemper ya cargado:
--
--   "Si te fijas donde dice Quote ID, tienes que machear cuando tenga el mismo Quote ID y ya
--    encontro uno: ya sabes que el otro MVR pertenece a ese mismo. Porque hay veces que no lo
--    va a encontrar en el reporte, porque pueden haber dos o tres drivers. El Quote ID que
--    termina en 3733 de Olga Romero y el que termina en 3733 de Santiago Quintero son del mismo
--    agente: si macheo uno de los dos, ya el otro pertenece a esa misma gente."
--
-- La herencia por cotizacion ya existia (20261009000010) pero corria SOLO al procesar el
-- archivo. Si el cruce automatico no resolvia ninguna fila de esa cotizacion, no habia de quien
-- heredar, y cuando Arturo asignaba una a mano despues, las otras se quedaban huerfanas igual.
-- Su caso exacto: la cotizacion 9261563733 tiene a OLGA ROMERO GUTIERREZ con su CLUE de $1.85 y
-- a SANTIAGO RIOS QUINTERO con su MVR de $8.50, y tuvo que asignar las dos a mano.
--
-- Ahora cada asignacion manual arrastra a las demas filas de su cotizacion. Asignar una es
-- decidir quien es el dueno de esa cotizacion, no de ese renglon.

-- ---------------------------------------------------------
-- 1. Una bandera sola, no dos
-- ---------------------------------------------------------
-- agentes.produccion_compartida ya existia desde 20260914000001 y significa exactamente lo
-- mismo que productor_compartido, que agregue ayer sin verla: "otros producen bajo este codigo,
-- asi que el nombre del productor no alcanza". ARTURO GELPI ya estaba marcado ahi. Dos columnas
-- con el mismo significado es como se empieza a decidir distinto en dos lugares, asi que la
-- nueva se va y queda la que ya estaba.
update agentes set produccion_compartida = true
 where productor_compartido and not produccion_compartida;

create or replace function matchear_costo(p_linea_id uuid) returns text
language plpgsql as $fn$
declare
  c lineas_costo%rowtype;
  r reportes%rowtype;
  v_umbral numeric := cfg_num('umbral_costo', 55);
  v_best record;
  v_cands jsonb;
  v_quien text;
  v_nombre text;
  v_compania text;
  v_score numeric := 0;
  v_book jsonb;
  v_book_score numeric;
  v_prod_id uuid;
  v_prod agentes%rowtype;
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = c.reporte_id;

  v_compania := coalesce((select a.nombre from aseguradoras a where a.id = r.aseguradora_id), 'la compania');
  v_quien := coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo, 'sin nombre');
  v_nombre := nullif(coalesce(c.nombre_normalizado, c.conductor_norm, ''), '');

  -- Lo que se decidio a mano no se vuelve a decidir. Antes el reproceso pisaba las asignaciones
  -- manuales porque el bucle recorre TODAS las lineas: alcanzaba con volver a leer el archivo
  -- para perder el trabajo de una tarde.
  if c.regla_match in ('manual', 'cuenta_casa') and c.estado = 'conciliado_confirmado' then
    return 'conciliado_confirmado';
  end if;

  -- SALIDA 0: no hay nombre ninguno.
  if coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''),
              nullif(btrim(coalesce(c.conductor_crudo, '')), '')) is null then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'sin_nombre',
      agente_id = null, oficina_id = null where id = c.id;
    perform abrir_excepcion_costo('sin_identificar', c.id, null,
      format('Cargo de %s por $%s sin un solo nombre en el renglon: ni asegurado ni conductor. '
             || 'Asi no hay con que identificarlo. Mira el archivo o asignalo a mano.',
             v_compania, c.monto));
    return 'sin_identificar';
  end if;

  -- Candidatos entre las cotizaciones del mes.
  select jsonb_agg(
           jsonb_build_object(
             'cotizacion_id', s.id, 'agente_id', s.agente_id, 'oficina_id', s.oficina_id,
             'nombre', s.nombre, 'carrier', s.carrier, 'score', s.score)
           order by s.score desc)
    into v_cands
  from (
    select q.id, q.agente_id, q.oficina_id,
           q.nombre_normalizado as nombre, q.carrier_texto as carrier,
           round((
               100 * similarity(coalesce(q.nombre_normalizado, ''), coalesce(v_nombre, ''))
             + case when r.aseguradora_id is not null
                     and q.carrier_texto ilike '%' || (select a.nombre from aseguradoras a where a.id = r.aseguradora_id) || '%'
                    then 12 else 0 end
             - case when q.fecha is null or c.fecha_orden is null then 5
                    else least(abs(q.fecha - c.fecha_orden) / 10.0, 15) end
           )::numeric, 1) as score
      from lineas_cotizacion q
     where q.agente_id is not null
       and (
             (coalesce(c.apellido_pre13, '') <> '' and q.apellido_norm like c.apellido_pre13 || '%')
          or (coalesce(q.apellido_pre13, '') <> '' and c.apellido_norm like q.apellido_pre13 || '%')
          or (c.conductor_norm is not null and q.nombre_normalizado % c.conductor_norm)
       )
     order by score desc
     limit 5
  ) s;

  if v_cands is not null then
    select (v_cands->0->>'score')::numeric as score,
           (v_cands->0->>'cotizacion_id')::uuid as cotizacion_id,
           (v_cands->0->>'agente_id')::uuid as agente_id,
           (v_cands->0->>'oficina_id')::uuid as oficina_id into v_best;
    v_score := coalesce(v_best.score, 0);

    -- SALIDA 1: el cliente aparece en las cotizaciones del mes. La mejor.
    if v_score >= v_umbral then
      update lineas_costo set estado = 'conciliado_auto', regla_match = 'cotizacion',
        score = v_score, candidatos = v_cands, cotizacion_id = v_best.cotizacion_id,
        agente_id = v_best.agente_id, oficina_id = v_best.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- SALIDA 2: el cliente esta en el Book. Vale mas que lo que diga el archivo sobre quien
  -- aprieto el boton, y es la unica salida para renovaciones y archivos de meses viejos.
  if v_nombre is not null then
    v_book := agente_de_la_poliza_del_cliente(v_nombre, r.aseguradora_id);
    v_book_score := coalesce((v_book->>'score')::numeric, 0);
    if v_book is not null and v_book_score >= v_umbral then
      update lineas_costo set estado = 'conciliado_auto', regla_match = 'book',
        score = v_book_score, candidatos = v_cands,
        poliza_id = (v_book->>'poliza_id')::uuid,
        agente_id = (v_book->>'agente_id')::uuid,
        oficina_id = (v_book->>'oficina_id')::uuid
       where id = c.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- El productor del archivo: ultimo recurso, y solo si el cliente no aparecio en ningun lado.
  if nullif(btrim(coalesce(c.agente_texto, '')), '') is not null then
    v_prod_id := agente_por_texto(c.agente_texto);
  end if;

  if v_prod_id is not null then
    select * into v_prod from agentes where id = v_prod_id;

    -- SALIDA 3: el archivo nombra al usuario compartido. NO se le cree. Es el freno que pidio
    -- Arturo: Thalia cotiza logueada bajo su usuario y el cargo le caeria a el.
    if v_prod.es_casa or v_prod.produccion_compartida then
      update lineas_costo set estado = 'sin_identificar', regla_match = 'productor_compartido',
        score = v_score, candidatos = v_cands where id = c.id;
      perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
        format('MVR de %s por $%s. El archivo de %s dice que lo ordeno %s, pero ese es el usuario '
               || 'compartido: otros agentes trabajan logueados ahi, asi que el cargo saldria a '
               || 'nombre de la casa aunque el trabajo sea de otro. El cliente tampoco aparece ni '
               || 'en las cotizaciones ni en el Book. Decidi vos de quien es.',
               v_quien, c.monto, v_compania, v_prod.nombre));
      return 'sin_identificar';
    end if;

    -- SALIDA 4: el archivo nombra a un agente propio. Vale, y queda dicho de donde salio.
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'productor_del_archivo',
      score = v_score, candidatos = v_cands,
      agente_id = v_prod.id, oficina_id = v_prod.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  -- SALIDA 5: no se pudo. Con candidatos o sin ellos, pero siempre visible.
  if v_cands is null then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'sin_candidato',
      score = 0, candidatos = null where id = c.id;
    perform abrir_excepcion_costo('sin_identificar', c.id, null,
      format('MVR de %s por $%s. No aparece ni en las cotizaciones del mes ni entre los clientes '
             || 'del Book, asi que no hay forma de saber que agente lo ordeno. Asignalo a mano.',
             v_quien, c.monto));
    return 'sin_identificar';
  end if;

  update lineas_costo set estado = 'sin_identificar', regla_match = 'score_bajo',
    score = v_score, candidatos = v_cands where id = c.id;
  perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
    format('MVR de %s por $%s. El parecido mas alto contra las cotizaciones es %s%%, por debajo '
           || 'del minimo para asignarlo solo, y en el Book tampoco aparece. Mira los candidatos '
           || 'y confirma.',
           v_quien, c.monto, v_score));
  return 'sin_identificar';
end $fn$;

-- ---------------------------------------------------------
-- 2. Heredar tambien desde lo asignado a mano
-- ---------------------------------------------------------
-- Antes el dueno se tomaba solo de las filas conciliadas por el motor. Si ninguna de esa
-- cotizacion habia pegado, no habia de quien heredar -- y es justo el caso en que Arturo
-- termina asignando a mano. Ahora una asignacion manual tambien es un dueno valido, y de hecho
-- es el mejor: lo decidio una persona mirando.
create or replace function heredar_por_cotizacion(p_reporte_id uuid) returns integer
language plpgsql as $fn$
declare
  v_n integer := 0;
begin
  with dueno as (
    -- Un dueno por cotizacion, y solo si NO hay discusion: si dos filas de la misma cotizacion
    -- quedaron con agentes distintos, no se hereda nada. Mismo criterio que el freno del Book:
    -- cuando los datos se contradicen, el sistema para en vez de elegir por su cuenta.
    select c.cotizacion_crudo,
           min(c.agente_id::text)::uuid  as agente_id,
           min(c.oficina_id::text)::uuid as oficina_id
      from lineas_costo c
     where c.reporte_id = p_reporte_id
       and c.cotizacion_crudo is not null
       and c.agente_id is not null
       and c.estado in ('conciliado_auto', 'conciliado_confirmado')
     group by c.cotizacion_crudo
    having count(distinct c.agente_id) = 1
  ), tocadas as (
    update lineas_costo c
       set agente_id = d.agente_id,
           oficina_id = d.oficina_id,
           estado = 'conciliado_auto',
           regla_match = 'misma_cotizacion'
      from dueno d
     where c.reporte_id = p_reporte_id
       and c.cotizacion_crudo = d.cotizacion_crudo
       and c.agente_id is null
       and c.estado in ('sin_identificar', 'pendiente')
    returning c.id
  )
  select count(*) into v_n from tocadas;

  update excepciones e
     set estado = 'resuelta', accion = 'asignar',
         nota = 'Heredado de otra fila de la misma cotizacion', resuelta_en = now()
   where e.estado = 'pendiente'
     and e.linea_costo_id in (
       select c.id from lineas_costo c
        where c.reporte_id = p_reporte_id and c.regla_match = 'misma_cotizacion'
     );

  return v_n;
end $fn$;

-- ---------------------------------------------------------
-- 3. Que la asignacion a mano lo dispare
-- ---------------------------------------------------------
-- asignar_costos() se deja como estaba -- llama a asignar_costo() una vez por linea, que cierra
-- la excepcion y escribe la auditoria con el agente anterior -- y solo se le agrega el arrastre
-- al final. Reescribirla entera para sumar tres lineas seria arriesgar lo que ya funciona.
create or replace function asignar_costos(
  p_lineas uuid[], p_agente_id uuid, p_motivo text default null
) returns integer language plpgsql security definer as $fn$
declare x uuid; n integer := 0; r record;
begin
  foreach x in array coalesce(p_lineas, '{}') loop
    perform asignar_costo(x, p_agente_id, p_motivo);
    n := n + 1;
  end loop;

  -- Asignar una fila es decidir de quien es esa COTIZACION, no ese renglon: los demas cargos
  -- del mismo Quote ID siguen al mismo dueno. Una vez por reporte tocado.
  for r in select distinct reporte_id from lineas_costo where id = any(p_lineas) loop
    perform heredar_por_cotizacion(r.reporte_id);
  end loop;

  return n;
end $fn$;

comment on function asignar_costos is
  'Asigna cargos a un agente y arrastra a los que compartan Quote ID con ellos: si una fila de '
  'una cotizacion es de alguien, las otras de esa misma cotizacion tambien.';

-- Lo mismo entrando por Conciliacion, que es la otra puerta para resolver un cargo a mano.
create or replace function resolver_costo(
  p_excepcion_id uuid, p_accion text,
  p_agente_id uuid default null, p_oficina_id uuid default null, p_motivo text default null
) returns jsonb language plpgsql security definer as $fn$
declare
  e excepciones%rowtype;
  c lineas_costo%rowtype;
  v_of uuid; v_casa uuid; v_prev uuid; v_usr uuid := auth.uid();
begin
  select * into e from excepciones where id = p_excepcion_id for update;
  if not found then raise exception 'Excepcion inexistente'; end if;
  if e.linea_costo_id is null then
    raise exception 'Esta excepcion no es de un cargo. Usa resolver_excepcion.';
  end if;
  select * into c from lineas_costo where id = e.linea_costo_id;
  v_prev := c.agente_id;

  if p_accion in ('asignar', 'reasignar') then
    if p_agente_id is null then raise exception 'Falta el agente'; end if;
    select oficina_id into v_of from agentes where id = p_agente_id;
    update lineas_costo
       set estado = 'conciliado_confirmado', agente_id = p_agente_id,
           oficina_id = coalesce(p_oficina_id, v_of), regla_match = 'manual'
     where id = c.id;

  elsif p_accion = 'cuenta_casa' then
    select id into v_casa from agentes where es_casa limit 1;
    update lineas_costo
       set estado = 'cuenta_casa', agente_id = v_casa, oficina_id = null, regla_match = 'cuenta_casa'
     where id = c.id;

  elsif p_accion = 'descartar' then
    update lineas_costo set estado = 'descartado', regla_match = 'descartado' where id = c.id;

  else
    raise exception 'Accion no valida para un cargo: %. Use asignar, cuenta_casa o descartar.', p_accion;
  end if;

  update excepciones
     set estado = 'resuelta', accion = p_accion, nota = p_motivo,
         resuelta_por = v_usr, resuelta_en = now()
   where id = e.id;

  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
  values ('linea_costo', c.id, p_accion, 'agente_id', v_prev::text, p_agente_id::text, v_usr, p_motivo);

  if p_accion in ('asignar', 'reasignar') then
    perform heredar_por_cotizacion(c.reporte_id);
  end if;

  return jsonb_build_object('ok', true, 'linea_costo_id', c.id, 'accion', p_accion);
end $fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- 4. Reprocesar y arrastrar lo que ya esta decidido
-- ---------------------------------------------------------
-- Arranca por el caso de Arturo: la cotizacion 9261563733, donde el ya asigno las dos filas a
-- mano. De aca en adelante le va a alcanzar con una.
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
  (select count(*) from agentes where produccion_compartida)                    as usuarios_compartidos,
  (select string_agg(nombre, ', ') from agentes where produccion_compartida)    as quienes,
  (select count(*) from lineas_costo where regla_match = 'misma_cotizacion')    as heredados,
  (select count(*) from lineas_costo where regla_match = 'manual')              as a_mano,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                            as sin_dueno,
  (select round(sum(monto),2) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                            as plata_sin_dueno,
  (select round(sum(monto),2) from lineas_costo)                                as total_cargado;
