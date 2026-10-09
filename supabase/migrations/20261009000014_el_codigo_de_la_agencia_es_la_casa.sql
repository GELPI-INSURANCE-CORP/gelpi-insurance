-- =========================================================
-- El codigo de la agencia es la casa
-- =========================================================
-- Arturo, sobre el archivo de United:
--
--   "El User Id que dice 101418 es el codigo de la oficina. Pertenece a Gelpi Insurance Corp,
--    esta bajo mi nombre. Esos MVR son de nosotros: cuando veas un MVR con ese codigo, ya sabes
--    que es de nosotros."
--
-- Antes de darlo por hecho se verifico en los datos, mirando a que agente resultaron pertenecer
-- las filas de cada User Id que SI se identificaron por cliente. El resultado obliga a tratarlo
-- distinto de como suena:
--
--   101418     22 filas, 18 identificadas -> Arturo, Christian Alvarez, Greter Gelpi, Thalia
--   CALVAREZ1  22 filas, 20 identificadas -> Christian Alvarez, Heidi Vilan, Thalia Rodriguez
--   LLANESN    15 filas, 12 identificadas -> Lisley Aguilera, Nadira LLanes
--   HEIDIV      5 filas,  1 identificada  -> Heidi Vilan
--   VIDAL03     2 filas,  2 identificadas -> Santiago Vidal
--
-- O sea: en United tambien se comparten los logins. CALVAREZ1 es el usuario de Christian, pero
-- sus MVR resultaron ser de Christian, de Heidi Y de Thalia. Mapear CALVAREZ1 -> Christian y
-- asignar solo le cobraria a Christian el trabajo de las otras dos. Los User Id NO se dan de
-- alta como alias de nadie.
--
-- El 101418 es otra cosa y por eso si entra: no es el login de una persona, es el numero de la
-- agencia (en el archivo aparece como "001-1-101418 GELPI INSURANCE CORP"). No dice "lo hizo
-- Arturo", dice "lo hizo la agencia". Para las 18 filas donde el cliente SI se identifico, el
-- cruce manda y las reparte bien entre los cuatro agentes. Para las 4 que no, "es de la casa"
-- es la respuesta correcta -- y es la que pidio Arturo.
--
-- Por eso el codigo de agencia se marca aparte: cuando el cruce por cliente ya fallo, en vez de
-- frenar como con un usuario compartido, asigna a la casa y lo dice.

alter table agente_alias
  add column if not exists es_codigo_de_oficina boolean not null default false;

comment on column agente_alias.es_codigo_de_oficina is
  'true = este texto no es el nombre ni el login de una persona, es el numero de la agencia en '
  'esa compania (United: 101418). No identifica a nadie en particular, asi que solo vale como '
  'ultima respuesta: cuando el cliente no aparece en ningun lado, el cargo es de la casa.';

insert into agente_alias (agente_id, texto, es_codigo_de_oficina)
select a.id, '101418', true
  from agentes a
 where a.es_casa
   and not exists (select 1 from agente_alias al
                    where al.texto_normalizado = '101418')
 limit 1;

-- Si ya existia como alias comun, se marca.
update agente_alias set es_codigo_de_oficina = true
 where texto_normalizado = '101418' and not es_codigo_de_oficina;

-- ---------------------------------------------------------
-- El cruce, con el codigo de agencia como salida propia
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


  -- SALIDA 3: ya se decidio antes quien es este cliente.
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

    -- SALIDA 4: el archivo trae el NUMERO DE LA AGENCIA, no una persona.
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

    -- SALIDA 5: el archivo nombra al usuario compartido. NO se le cree. Es el freno que pidio
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

    -- SALIDA 6: el archivo nombra a un agente propio. Vale, y queda dicho de donde salio.
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'productor_del_archivo',
      score = v_score, candidatos = v_cands,
      agente_id = v_prod.id, oficina_id = v_prod.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  -- SALIDA 7: no se pudo. Con candidatos o sin ellos, pero siempre visible.
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
  'Decide de quien es un cargo por MVR, en orden: (1) el cliente contra las cotizaciones del '
  'mes; (2) contra el Book; (3) contra lo ya decidido de ese cliente; (4) si el archivo trae el '
  'numero de la agencia, es de la casa; (5) si trae el usuario compartido de una persona, PARA '
  'y pregunta; (6) si trae un agente propio, ese. Lo asignado a mano no se vuelve a tocar, y '
  'cuando no identifica BORRA el agente.';

notify pgrst, 'reload schema';

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
  (select count(*) from agente_alias where es_codigo_de_oficina)              as codigos_de_agencia,
  (select count(*) from lineas_costo where regla_match = 'codigo_de_la_agencia') as por_codigo_de_agencia,
  (select count(*) from lineas_costo where regla_match = 'memoria_tuya')      as memoria_tuya,
  (select count(*) from lineas_costo where regla_match = 'memoria_archivo')   as memoria_archivo,
  (select count(*) from lineas_costo where regla_match = 'misma_cotizacion')  as misma_cotizacion,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                          as sin_dueno,
  (select round(sum(monto),2) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                          as plata_sin_dueno,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente') and agente_id is not null) as contradictorias,
  (select round(sum(monto),2) from lineas_costo)                              as total;
