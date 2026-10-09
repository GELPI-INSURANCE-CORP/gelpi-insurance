-- =========================================================
-- Lo que ya decidiste se recuerda
-- =========================================================
-- Arturo:
--
--   "Si ya identificaste a un cliente en Progressive, y subo el statement de Kemper y tiene el
--    mismo cliente, que me lo cruce. Que me diga: este cliente tambien se cotizo, se le corrio
--    un MVR en Progressive, y pertenece a Heidi, o pertenece a Thalia."
--
-- La idea es buena, pero cruzar un MVR contra otro MVR seria machear un nombre debil contra
-- otro nombre debil, y convertiria un error en una regla: una asignacion equivocada se copiaria
-- sola a las otras tres compañias y a todos los meses siguientes.
--
-- Lo que se guarda, entonces, no es el cargo: es la DECISION sobre el cliente. Y vale la pena
-- mirar por que, porque no todo lo que hoy se identifica hace falta recordarlo:
--
--   - Si el cliente esta en el Book, ya se resuelve solo en las cuatro compañias.
--   - Si esta en el QuoteReport del mes, lo mismo.
--   - Lo UNICO que hoy se pierde es lo que decidio Arturo a mano, y lo que dijo el archivo de
--     una sola compañia (el Quoting Producer de National General). Eso no vive en ningun lado y
--     se vuelve a preguntar todos los meses.
--
-- Por eso el valor no esta tanto en cruzar compañias como en que no le vuelvan a preguntar lo
-- mismo el mes que viene.

create table if not exists cliente_decidido (
  id                 uuid primary key default gen_random_uuid(),
  nombre_normalizado text not null unique,
  nombre_visible     text,
  agente_id          uuid not null references agentes(id) on delete cascade,
  oficina_id         uuid references oficinas(id),
  -- 'vos' = lo asigno una persona. 'archivo' = lo dijo el reporte de una compañia con nombre de
  -- agente propio. Se distinguen porque no valen lo mismo y la pantalla lo dice distinto.
  origen             text not null default 'vos' check (origen in ('vos', 'archivo')),
  aseguradora_id     uuid references aseguradoras(id),
  decidido_por       uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table cliente_decidido is
  'De quien es cada cliente, segun lo que ya se decidio antes. Se escribe cuando alguien asigna '
  'un cargo a mano, y se lee cuando aparece el mismo cliente en otra compañia o en otro mes. No '
  'reemplaza al Book: es memoria de decisiones, para los clientes que no tienen poliza.';

create index if not exists cliente_decidido_trgm
  on cliente_decidido using gin (nombre_normalizado gin_trgm_ops);

alter table cliente_decidido enable row level security;
do $$ begin
  create policy auth_all on cliente_decidido for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- El minimo de parecido para creerle a la memoria. MAS ALTO que el del Book (55) a proposito:
-- aca no hay numero de poliza ni compañia que respalde el nombre, solo el nombre. Si "Toledo
-- Gomez" pego con "OSMEL TOLEDO" al 36%, eso no se guarda ni se usa como verdad.
insert into configuracion (clave, valor)
select 'umbral_memoria', '88'::jsonb
 where not exists (select 1 from configuracion where clave = 'umbral_memoria');

-- ---------------------------------------------------------
-- Escribirla
-- ---------------------------------------------------------
create or replace function recordar_cliente(
  p_nombre text, p_agente_id uuid, p_oficina_id uuid,
  p_origen text default 'vos', p_aseguradora_id uuid default null
) returns void
language plpgsql as $fn$
declare v_norm text;
begin
  v_norm := nullif(btrim(coalesce(normalizar_nombre(p_nombre), '')), '');
  if v_norm is null or p_agente_id is null then return; end if;
  -- Un nombre de una sola palabra no identifica a nadie: "GOMEZ" no es un cliente.
  if position(' ' in v_norm) = 0 then return; end if;

  insert into cliente_decidido (nombre_normalizado, nombre_visible, agente_id, oficina_id,
                                origen, aseguradora_id, decidido_por)
  values (v_norm, btrim(p_nombre), p_agente_id, p_oficina_id, p_origen, p_aseguradora_id, auth.uid())
  on conflict (nombre_normalizado) do update
    set agente_id = excluded.agente_id,
        oficina_id = excluded.oficina_id,
        nombre_visible = excluded.nombre_visible,
        origen = excluded.origen,
        aseguradora_id = excluded.aseguradora_id,
        decidido_por = excluded.decidido_por,
        updated_at = now();
end $fn$;

comment on function recordar_cliente is
  'Guarda de quien es un cliente. La ultima decision pisa a la anterior: si Arturo cambia de '
  'idea, manda la nueva.';

-- ---------------------------------------------------------
-- Leerla: una salida mas en el cruce
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
  end if;

  if v_prod_id is not null then
    select * into v_prod from agentes where id = v_prod_id;

    -- SALIDA 4: el archivo nombra al usuario compartido. NO se le cree. Es el freno que pidio
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

    -- SALIDA 5: el archivo nombra a un agente propio. Vale, y queda dicho de donde salio.
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'productor_del_archivo',
      score = v_score, candidatos = v_cands,
      agente_id = v_prod.id, oficina_id = v_prod.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  -- SALIDA 6: no se pudo. Con candidatos o sin ellos, pero siempre visible.
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
  'mes; (2) contra el Book; (3) contra lo que ya se decidio antes de ese cliente; (4) si el '
  'archivo nombra al usuario compartido, PARA y pregunta; (5) si nombra un agente propio, ese. '
  'Lo asignado a mano no se vuelve a tocar, y cuando no identifica BORRA el agente.';

-- ---------------------------------------------------------
-- Que asignar a mano la escriba
-- ---------------------------------------------------------
-- Aca es donde la memoria se llena. Asignar un cargo deja de ser una decision sobre ese
-- renglon y pasa a ser una decision sobre ese cliente.
create or replace function asignar_costo(
  p_linea_id uuid, p_agente_id uuid, p_motivo text default null
) returns jsonb language plpgsql security definer as $fn$
declare
  c lineas_costo%rowtype;
  v_of uuid; v_prev uuid; v_usr uuid := auth.uid(); v_aseg uuid;
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then raise exception 'Ese cargo no existe'; end if;
  if p_agente_id is null then raise exception 'Falta el agente'; end if;

  select oficina_id into v_of from agentes where id = p_agente_id;
  v_prev := c.agente_id;

  update lineas_costo
     set estado = 'conciliado_confirmado', agente_id = p_agente_id,
         oficina_id = v_of, regla_match = 'manual'
   where id = c.id;

  -- Si el cargo tenia una excepcion esperando en Conciliacion, se cierra sola. Sin esto, el
  -- mismo cargo aparece resuelto en una pantalla y pendiente en la otra.
  update excepciones
     set estado = 'resuelta', accion = 'asignar', nota = p_motivo,
         resuelta_por = v_usr, resuelta_en = now()
   where linea_costo_id = c.id and estado = 'pendiente';

  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
  values ('linea_costo', c.id, 'asignar', 'agente_id', v_prev::text, p_agente_id::text, v_usr, p_motivo);

  -- Y se recuerda, para Kemper, para United y para el mes que viene.
  select aseguradora_id into v_aseg from reportes where id = c.reporte_id;
  perform recordar_cliente(
    coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo),
    p_agente_id, v_of, 'vos', v_aseg);

  return jsonb_build_object('ok', true, 'oficina_id', v_of);
end $fn$;

-- Y lo mismo entrando por Conciliacion.
create or replace function resolver_costo(
  p_excepcion_id uuid, p_accion text,
  p_agente_id uuid default null, p_oficina_id uuid default null, p_motivo text default null
) returns jsonb language plpgsql security definer as $fn$
declare
  e excepciones%rowtype;
  c lineas_costo%rowtype;
  v_of uuid; v_casa uuid; v_prev uuid; v_usr uuid := auth.uid(); v_aseg uuid;
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
    select aseguradora_id into v_aseg from reportes where id = c.reporte_id;
    perform recordar_cliente(
      coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo),
      p_agente_id, coalesce(p_oficina_id, v_of), 'vos', v_aseg);

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
-- Sembrar con lo que ya esta decidido
-- ---------------------------------------------------------
-- Lo que Arturo ya asigno a mano en los cuatro archivos cargados, y lo que una compañia dijo
-- con nombre de agente propio. No se siembra 'misma_cotizacion': eso es una deduccion de otra
-- fila, y guardar deducciones como si fueran decisiones encadena errores.
do $do$
declare r record;
begin
  for r in
    select coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo) as nombre,
           c.agente_id, c.oficina_id,
           case when c.regla_match = 'manual' then 'vos' else 'archivo' end as origen,
           rep.aseguradora_id,
           c.updated_at
      from lineas_costo c
      join reportes rep on rep.id = c.reporte_id
     where c.agente_id is not null
       and c.regla_match in ('manual', 'productor_del_archivo')
     order by c.updated_at asc   -- la decision mas nueva pisa a la mas vieja
  loop
    perform recordar_cliente(r.nombre, r.agente_id, r.oficina_id, r.origen, r.aseguradora_id);
  end loop;
end $do$;

-- Y reprocesar, para que la memoria recien sembrada rescate lo que pueda.
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
  (select count(*) from cliente_decidido)                                      as clientes_recordados,
  (select count(*) from cliente_decidido where origen = 'vos')                 as decididos_por_vos,
  (select count(*) from lineas_costo where regla_match = 'memoria_tuya')       as rescatados_por_vos,
  (select count(*) from lineas_costo where regla_match = 'memoria_archivo')    as rescatados_por_archivo,
  (select count(*) from lineas_costo where regla_match = 'misma_cotizacion')   as heredados,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                           as sin_dueno,
  (select round(sum(monto),2) from lineas_costo
    where estado in ('sin_identificar','pendiente'))                           as plata_sin_dueno,
  (select count(*) from lineas_costo
    where estado in ('sin_identificar','pendiente') and agente_id is not null) as contradictorias;
