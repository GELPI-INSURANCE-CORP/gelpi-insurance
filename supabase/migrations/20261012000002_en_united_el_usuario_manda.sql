-- =========================================================
-- En United el usuario manda
-- =========================================================
-- Arturo:
--
--   "En United usa el user id como PRIMERA opcion. En United todos trabajan con su user id, no
--    hay fallo, es el mas facil, ahi no hay que hacer nada."
--
-- Es su operacion y el la conoce. Pero vale dejar escrito por que esto NO contradice lo de
-- National General, donde el productor del archivo no vale nada: son dos preguntas distintas y
-- yo las habia mezclado.
--
--   De QUIEN ES EL CLIENTE   -> el login no lo dice. CALVAREZ1 es el usuario de Christian, pero
--                               sus MVR resultaron ser de clientes de Christian, de Heidi y de
--                               Thalia.
--   QUIEN CORRIO EL REPORTE  -> el login lo dice exacto, porque cada uno entra con el suyo.
--
-- Y el cargo por MVR es un gasto que causa el que aprieta el boton. Si Christian corre un MVR
-- para un cliente que despues resulta de Heidi, los $8.35 los causo Christian. Por eso en
-- United el login va primero.
--
-- COMO, sin romper lo demas. Hay una columna aseguradoras.productor_confiable, pero la usa
-- tambien el matcheo de COMISIONES: tocarla moveria plata que nadie pidio mover. Asi que la
-- marca va en el LOGIN y no en la compania. Solo los textos dados de alta aca mandan primero;
-- un "Heidi Vilan" escrito con todas las letras en un archivo de National General sigue
-- resolviendo por nombre y sigue cayendo en el freno del usuario compartido.

alter table agente_alias
  add column if not exists es_usuario_propio boolean not null default false;

comment on column agente_alias.es_usuario_propio is
  'true = este texto es el login personal de un agente en esa compania, y nadie mas lo usa. '
  'Cuando el archivo trae uno de estos, dice con certeza QUIEN corrio el reporte, asi que '
  'manda por encima del cruce por cliente. United: cada agente entra con el suyo.';

-- Los seis de United. Se buscan por nombre y no por id para no depender de los identificadores
-- de una base en particular.
insert into agente_alias (agente_id, texto, es_usuario_propio)
select a.id, v.texto, true
  from (values
    ('Christian Alvarez', 'CALVAREZ1'),
    ('Heidi Vilan',       'HEIDIV'),
    ('Nadira LLanes',     'LLANESN'),
    ('Lisley Aguilera',   'ALISLEY'),
    ('Nancy Lobo',        'NLOBO1'),
    ('Santiago Vidal',    'VIDAL03')
  ) as v(agente, texto)
  join agentes a on normalizar_nombre(a.nombre) = normalizar_nombre(v.agente)
 where not exists (
   select 1 from agente_alias al
    where al.texto_normalizado = upper(regexp_replace(v.texto, '[^A-Za-z0-9]', '', 'g')));

-- Si alguno ya existia como alias comun, se marca.
update agente_alias set es_usuario_propio = true
 where texto_normalizado in ('CALVAREZ1', 'HEIDIV', 'LLANESN', 'ALISLEY', 'NLOBO1', 'VIDAL03')
   and not es_usuario_propio;

-- ---------------------------------------------------------
-- El cruce, con el login personal primero
-- ---------------------------------------------------------
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
  v_mem record;
  v_es_codigo boolean;
  v_compartido boolean;
  v_alias record;
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


  -- SALIDA 1: el archivo trae un login personal, o el numero de la agencia.
  --
  -- Primero de todo, y solo para los textos dados de alta como tales. En United cada agente
  -- entra con su propio user id, asi que el archivo dice con certeza QUIEN corrio el reporte --
  -- y el cargo por MVR lo causa el que aprieta el boton, no el dueno del cliente. El 101418 es
  -- el numero de la agencia: nadie en particular, o sea la casa.
  --
  -- Esto NO afecta a las otras compañias: un "Heidi Vilan" escrito con todas las letras en un
  -- archivo de National General no es un alias, resuelve por nombre, y sigue cayendo mas abajo
  -- en el freno del usuario compartido.
  if nullif(btrim(coalesce(c.agente_texto, '')), '') is not null then
    select al.agente_id, al.es_usuario_propio, al.es_codigo_de_oficina
      into v_alias
      from agente_alias al
     where al.texto_normalizado = upper(regexp_replace(c.agente_texto, '[^A-Za-z0-9]', '', 'g'))
     limit 1;

    if found and (v_alias.es_usuario_propio or v_alias.es_codigo_de_oficina) then
      select * into v_prod from agentes where id = v_alias.agente_id;
      update lineas_costo set estado = 'conciliado_auto',
        regla_match = case when v_alias.es_codigo_de_oficina
                           then 'codigo_de_la_agencia' else 'usuario_del_archivo' end,
        score = 100, agente_id = v_prod.id, oficina_id = v_prod.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;
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

    -- SALIDA 2: el cliente aparece en las cotizaciones del mes. La mejor... casi siempre.
    if v_score >= v_umbral then
      -- Salvo que la cotizacion sea de un usuario compartido. Ahi deja de ser definitiva: el
      -- QuoteReport sale del sistema de la agencia, donde si alguien cotiza logueado como otro
      -- el reporte lo firma con el nombre del otro. Se le pregunta primero al Book, que es el
      -- registro oficial de quien es cada cliente.
      select ag2.es_casa or ag2.produccion_compartida into v_compartido
        from agentes ag2 where ag2.id = v_best.agente_id;

      if coalesce(v_compartido, false) and v_nombre is not null then
        v_book := agente_de_la_poliza_del_cliente(v_nombre, r.aseguradora_id);
        v_book_score := coalesce((v_book->>'score')::numeric, 0);
        if v_book is not null and v_book_score >= v_umbral
           and (v_book->>'agente_id')::uuid is distinct from v_best.agente_id
           -- Y solo si el Book esta seguro: si tiene dos clientes con ese nombre de agentes
           -- distintos, no es mejor evidencia que la cotizacion, es otra duda.
           and not coalesce((v_book->>'en_disputa')::boolean, false) then
          update lineas_costo set estado = 'conciliado_auto', regla_match = 'book_sobre_cotizacion',
            score = v_book_score, candidatos = v_cands, cotizacion_id = v_best.cotizacion_id,
            poliza_id = (v_book->>'poliza_id')::uuid,
            agente_id = (v_book->>'agente_id')::uuid,
            oficina_id = (v_book->>'oficina_id')::uuid
           where id = c.id;
          return 'conciliado_auto';
        end if;
      end if;

      -- Se queda con la cotizacion. Si la firmo el usuario compartido queda marcado distinto,
      -- para poder mirarlos aparte en la pantalla: no se esconde que ese nombre puede no ser
      -- el que trabajo.
      update lineas_costo set estado = 'conciliado_auto',
        regla_match = case when coalesce(v_compartido, false) then 'cotizacion_compartida' else 'cotizacion' end,
        score = v_score, candidatos = v_cands, cotizacion_id = v_best.cotizacion_id,
        agente_id = v_best.agente_id, oficina_id = v_best.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- SALIDA 3: el cliente esta en el Book. Vale mas que lo que diga el archivo sobre quien
  -- aprieto el boton, y es la unica salida para renovaciones y archivos de meses viejos.
  if v_nombre is not null then
    v_book := agente_de_la_poliza_del_cliente(v_nombre, r.aseguradora_id);
    v_book_score := coalesce((v_book->>'score')::numeric, 0);

    -- Pero si en el Book hay otro cliente con casi el mismo nombre y de OTRO agente, el nombre
    -- no alcanza para elegir. Antes se tomaba el primero y listo: 20 de los 202 cargos
    -- asignados por el Book se habian decidido asi. Ahora se para y se muestran los dos.
    if v_book is not null and v_book_score >= v_umbral
       and coalesce((v_book->>'en_disputa')::boolean, false) then
      update lineas_costo set estado = 'sin_identificar', regla_match = 'varios_con_el_mismo_nombre',
        agente_id = null, oficina_id = null,
        score = v_book_score, candidatos = (v_book->'disputan') where id = c.id;
      perform abrir_excepcion_costo('sin_identificar', c.id, (v_book->'disputan'),
        format('MVR de %s por $%s. En el Book hay mas de un cliente con ese nombre y son de '
               || 'agentes distintos (%s). El nombre solo no alcanza para saber cual es, y '
               || 'elegir al azar seria cobrarle a la oficina equivocada. Decidi vos.',
               v_quien, c.monto,
               coalesce((select string_agg(d->>'agente', ', ')
                           from jsonb_array_elements(v_book->'disputan') d), 'varios')));
      return 'sin_identificar';
    end if;

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


  -- SALIDA 4: ya se decidio antes quien es este cliente.
  --
  -- Va DESPUES del Book a proposito: el Book es el registro oficial de la agencia y esto es
  -- memoria de decisiones. Si algun dia se contradicen, gana el Book -- igual que el freno de
  -- Mayra Lopez Herrera, donde la poliza mandaba sobre lo que decia el archivo.
  --
  -- Y el minimo es 88 y no 55: aca no hay poliza ni compañia que respalde el nombre.
  if v_nombre is not null then
    select cd.*, round((100 * similarity(cd.nombre_normalizado, v_nombre))::numeric, 1) as parecido
      into v_mem
      from cliente_decidido cd
     where cd.nombre_normalizado % v_nombre
     order by similarity(cd.nombre_normalizado, v_nombre) desc
     limit 1;

    if found and v_mem.parecido >= cfg_num('umbral_memoria', 88) then
      update lineas_costo
         set estado = 'conciliado_auto',
             regla_match = case when v_mem.origen = 'vos' then 'memoria_tuya' else 'memoria_archivo' end,
             score = v_mem.parecido, candidatos = v_cands,
             agente_id = v_mem.agente_id, oficina_id = v_mem.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- El productor del archivo: ultimo recurso, y solo si el cliente no aparecio en ningun lado.
  if nullif(btrim(coalesce(c.agente_texto, '')), '') is not null then
    v_prod_id := agente_por_texto(c.agente_texto);
    -- Y si lo que vino no es el nombre de una persona sino el numero de la agencia.
    select al.es_codigo_de_oficina into v_es_codigo
      from agente_alias al
     where al.texto_normalizado = upper(regexp_replace(c.agente_texto, '[^A-Za-z0-9]', '', 'g'))
     limit 1;
  end if;

  if v_prod_id is not null then
    select * into v_prod from agentes where id = v_prod_id;

    -- SALIDA 5: el archivo trae el NUMERO DE LA AGENCIA, no una persona.
    --
    -- "El User Id 101418 es el codigo de la oficina, esos MVR son de nosotros". No frena como
    -- un usuario compartido, porque no hay nada que preguntar: el cliente no aparecio en las
    -- cotizaciones, ni en el Book, ni en lo ya decidido, y el archivo dice que lo corrio la
    -- agencia. Eso ES la respuesta. Las filas de ese mismo codigo cuyo cliente SI se identifico
    -- ya se repartieron antes entre sus agentes y no llegan hasta aca.
    if coalesce(v_es_codigo, false) then
      update lineas_costo set estado = 'conciliado_auto', regla_match = 'codigo_de_la_agencia',
        score = v_score, candidatos = v_cands,
        agente_id = v_prod.id, oficina_id = v_prod.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;

    -- SALIDA 6: el archivo nombra al usuario compartido. NO se le cree. Es el freno que pidio
    -- Arturo: Thalia cotiza logueada bajo su usuario y el cargo le caeria a el.
    if v_prod.es_casa or v_prod.produccion_compartida then
      update lineas_costo set estado = 'sin_identificar', regla_match = 'productor_compartido',
        agente_id = null, oficina_id = null,
        score = v_score, candidatos = v_cands where id = c.id;
      perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
        format('MVR de %s por $%s. El archivo de %s dice que lo ordeno %s, pero ese es el usuario '
               || 'compartido: otros agentes trabajan logueados ahi, asi que el cargo saldria a '
               || 'nombre de la casa aunque el trabajo sea de otro. El cliente tampoco aparece ni '
               || 'en las cotizaciones ni en el Book. Decidi vos de quien es.',
               v_quien, c.monto, v_compania, v_prod.nombre));
      return 'sin_identificar';
    end if;

    -- SALIDA 7: el archivo nombra a un agente propio. Vale, y queda dicho de donde salio.
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'productor_del_archivo',
      score = v_score, candidatos = v_cands,
      agente_id = v_prod.id, oficina_id = v_prod.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  -- SALIDA 8: no se pudo. Con candidatos o sin ellos, pero siempre visible.
  if v_cands is null then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'sin_candidato',
      agente_id = null, oficina_id = null,
      score = 0, candidatos = null where id = c.id;
    perform abrir_excepcion_costo('sin_identificar', c.id, null,
      format('MVR de %s por $%s. No aparece ni en las cotizaciones del mes ni entre los clientes '
             || 'del Book, asi que no hay forma de saber que agente lo ordeno. Asignalo a mano.',
             v_quien, c.monto));
    return 'sin_identificar';
  end if;

  update lineas_costo set estado = 'sin_identificar', regla_match = 'score_bajo',
    agente_id = null, oficina_id = null,
    score = v_score, candidatos = v_cands where id = c.id;
  perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
    format('MVR de %s por $%s. El parecido mas alto contra las cotizaciones es %s%%, por debajo '
           || 'del minimo para asignarlo solo, y en el Book tampoco aparece. Mira los candidatos '
           || 'y confirma.',
           v_quien, c.monto, v_score));
  return 'sin_identificar';
end $fn$;

comment on function matchear_costo is
  'Decide de quien es un cargo por MVR, en orden: (1) si el archivo trae un login personal dado '
  'de alta o el numero de la agencia, ese manda -- dice quien corrio el reporte; (2) el cliente '
  'contra las cotizaciones del mes, y si esa cotizacion la firmo un usuario compartido el Book '
  'le gana; (3) el cliente contra el Book, parando si hay dos con el mismo nombre de agentes '
  'distintos; (4) contra lo ya decidido de ese cliente; (5-7) el productor del archivo, con '
  'freno si es un usuario compartido. Lo asignado a mano no se vuelve a tocar.';

notify pgrst, 'reload schema';

do $do$
declare r record;
begin
  for r in select id from reportes where tipo = 'mvr' loop
    perform procesar_costos(r.id);
  end loop;
end $do$;

-- ---------------------------------------------------------
-- Comprobacion: United, antes y despues
-- ---------------------------------------------------------
-- Antes de este cambio United repartia asi: CORP $158.65 (29), DORAL $125.25 (21),
-- FALTA DECIDIR $16.70 (12), FLAGLER $16.70 (2), MEDLEY / MIAMI LAKES / PALMETTO BAY $0.00.
select coalesce(o.nombre, 'FALTA DECIDIR') as oficina,
       count(*)                            as cargos,
       round(sum(c.monto), 2)              as monto,
       count(*) filter (where c.regla_match = 'usuario_del_archivo')  as por_el_login,
       count(*) filter (where c.regla_match = 'codigo_de_la_agencia') as por_la_agencia
  from lineas_costo c
  join reportes r on r.id = c.reporte_id
  join aseguradoras a on a.id = r.aseguradora_id
  left join oficinas o on o.id = c.oficina_id
 where a.nombre ilike '%United%'
 group by 1
 order by 3 desc;
