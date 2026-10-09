-- =========================================================
-- MVR, cotizaciones y reportes manuales
-- =========================================================
-- Arturo, mandando el Excel con el que le liquida a Miami Lakes:
--
--   "Yo le cobro el royalty de todas las ganancias. De los gastos yo no le cobro el royalty.
--    Si ellos ganan $10,000, ellos me tienen que pagar a mi el royalty de los $10,000, no importa
--    si ellos tuvieron $50,000 o $1,000 en MVR."
--
-- Su planilla cuadra al centavo y deja el modelo sin ambiguedad:
--
--   GEICO 12,264.48 + PROGRESSIVE 3,755.46 + NATGEN 463.70 + KEMPER 1,709.43
--   + UNITED AUTO 4,847.39 + RESPONSIVE 946.13 + HEALTH 2,925.00  =  26,911.59   <- bruto
--   ROYALTY 12%                                                   =   3,229.39
--   TOTAL BEFORE SOFTWARES                                        =  23,682.20
--   POS & SOFTWARES & MVR                                         =   1,833.18
--   PAYMENT                                                       =  21,849.02
--
-- O sea: el royalty sale del BRUTO, y los gastos se restan DESPUES. Un gasto nunca baja la base
-- del royalty. Eso ya existe en el sistema y se llama ajustes_oficina.aplica_royalty = false
-- (migracion 20261001000001), asi que aca no se toca una sola linea de royalty.
--
-- LO QUE SI FALTA. La columna de gastos de ese Excel se escribe a mano todos los meses, y la
-- mitad son MVR de CUATRO companias distintas:
--
--   MVR UNITED 367.40   MVR PROGRESSIVE 601.00   MVR KEMPER 0.00   MVR RESPONSIVE 456.00
--
-- Esos cuatro numeros salen de cuatro archivos que las companias mandan, con un renglon por
-- CONDUCTOR, sin decir de que oficina es ninguno. Hoy se cruzan a mano. Esta migracion es para
-- que se crucen solos.
--
-- Los otros gastos -- VONIX 105.35, OFFICE 60.00, APIZEAL 20.00, VERTAFORE 323.43 -- y los
-- creditos entre oficinas -- GEICO BONUS FROM DORAL (100.00) -- se siguen poniendo a mano en
-- ajustes_oficina, que es exactamente para eso y ya funciona.
--
-- POR QUE UNA TABLA NUEVA Y NO lineas_comision. Porque lineas_comision.monto alimenta el
-- royalty, el pago del agente, el ranking y todos los KPI. Un cargo de $8 por un MVR no es
-- comision, y meterlo ahi corrompe cada numero del sistema. Ya paso: el MVR FEE de Progressive
-- de $1,812.80 entro como linea de comision, se le pego a CORP y le estuvo restando produccion
-- a una oficina tres meses seguidos (ver 20261003000003). La diferencia es que aquel habia que
-- sacarlo de las oficinas y estos hay que repartirlos a proposito.

-- ---------------------------------------------------------
-- 1. Reportes manuales y dos tipos nuevos
-- ---------------------------------------------------------
-- Arturo: "quiero crearlo manual, quiero poner statement de comisiones, quiero poner Ascendant,
-- y si no le quiero subir reporte no subirselo [...] si es un statement de tres lineas, a lo
-- mejor lo puedo hacer manual, y lo que quiero es llevar el record como tal."
--
-- Hoy reportes exige archivo: storage_path y hash_archivo son not null. Un statement tecleado a
-- mano no tiene archivo ni hash, asi que las dos columnas pasan a aceptar nulo y una columna
-- nueva dice de donde vino, para que la pantalla no ofrezca "descargar el archivo" de algo que
-- no existe. El unique de hash_archivo se queda: en Postgres un unique admite varios nulos.

alter table reportes alter column storage_path drop not null;
alter table reportes alter column hash_archivo drop not null;

alter table reportes add column if not exists origen text not null default 'archivo';
do $$ begin
  alter table reportes add constraint reportes_origen_check
    check (origen in ('archivo', 'manual'));
exception when duplicate_object then null; end $$;

-- El check de "tipo" se creo inline, asi que Postgres le puso nombre solo. Si ese nombre no es
-- exactamente reportes_tipo_check, un "drop constraint if exists" no borra nada, el check viejo
-- sigue rechazando 'mvr' y el error no aparece hasta que alguien intente subir el archivo. Por
-- eso se busca por contenido y se borra el que sea.
do $$
declare v_nombre text;
begin
  for v_nombre in
    select con.conname from pg_constraint con
     where con.conrelid = 'reportes'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%comision_aseguradora%'
  loop
    execute format('alter table reportes drop constraint %I', v_nombre);
  end loop;
end $$;

alter table reportes add constraint reportes_tipo_check check (tipo in (
  'comision_aseguradora', 'venta_interna', 'bono_contingencia', 'actualizacion_abb',
  'produccion', 'cancelaciones', 'renovaciones', 'chargebacks', 'resumen_anual', 'otro',
  -- nuevos
  'mvr',          -- el archivo de cargos por MVR que manda cada compania
  'cotizaciones'  -- el QuoteReport: quien cotizo a quien, que es lo que identifica al MVR
));

comment on column reportes.origen is
  'De donde salio el reporte: "archivo" si se subio un papel, "manual" si se tecleo. Un reporte '
  'manual no tiene storage_path ni hash_archivo. Sirve para companias que mandan statements de '
  'tres lineas -- Ascendant, Granada, Appalachian -- donde subir un archivo es mas trabajo que '
  'escribirlas.';

-- ---------------------------------------------------------
-- 2. Cotizaciones
-- ---------------------------------------------------------
-- El archivo de MVR dice el nombre del asegurado, pero NO dice que agente lo cotizo. El unico
-- lugar donde eso consta es el QuoteReport. Sin esta tabla el cruce no se puede automatizar.
-- De yapa: con las cotizaciones adentro sale el close ratio por agente, que hoy no existe.

create table if not exists lineas_cotizacion (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null references reportes(id) on delete cascade,
  fila            integer,
  nombre_crudo    text,
  nombre_normalizado text,
  apellido_crudo  text,
  pila_crudo      text,
  -- El apellido del archivo de MVR viene cortado a 13 caracteres, asi que para comparar hace
  -- falta guardar el apellido entero Y su prefijo de 13.
  apellido_norm   text,
  apellido_pre13  text,
  pila_norm       text,
  agente_texto    text,          -- QuoteCreatedBy, tal cual viene
  oficina_texto   text,          -- AgencyName, tal cual viene
  agente_id       uuid references agentes(id),
  oficina_id      uuid references oficinas(id),
  carrier_texto   text,
  estado_cotizacion text,        -- Submitted / Quoted / Sold / Incomplete
  fecha           date,
  created_at      timestamptz not null default now()
);

create index if not exists lineas_cotizacion_reporte on lineas_cotizacion (reporte_id);
create index if not exists lineas_cotizacion_pre13   on lineas_cotizacion (apellido_pre13);
create index if not exists lineas_cotizacion_trgm    on lineas_cotizacion using gin (nombre_normalizado gin_trgm_ops);

comment on table lineas_cotizacion is
  'El QuoteReport: quien cotizo a quien. Es la unica fuente que dice que agente ordeno un MVR, '
  'porque el archivo de la compania solo trae el nombre del asegurado.';

-- ---------------------------------------------------------
-- 3. Costos (MVR)
-- ---------------------------------------------------------
-- Un renglon por CONDUCTOR, no por poliza: una familia de cuatro conductores son cuatro cargos.
-- En el archivo de agosto de Progressive eran 389 renglones para 190 casos.
--
-- La maquina de estados es la misma que lineas_comision a proposito, para que la pantalla de
-- Conciliacion y abrir_excepcion() sirvan igual y no haya que inventar pantalla nueva.

create table if not exists lineas_costo (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null references reportes(id) on delete cascade,
  fila            integer,
  tipo_costo      text not null default 'mvr',
  -- Named Insured: viene "APELLIDO, NOMBRE" y el apellido cortado a 13 caracteres.
  asegurado_crudo text,
  apellido_norm   text,
  apellido_pre13  text,
  pila_norm       text,
  nombre_normalizado text,
  -- Driver Name: a veces es el unico dato util, sobre todo en las comerciales, que vienen con
  -- Named Insured = N/A.
  conductor_crudo text,
  conductor_norm  text,
  es_comercial    boolean not null default false,
  estado_us       text,           -- FL / TX / NJ / NY / KY: la tarifa depende del estado
  fecha_orden     date,
  monto           numeric(12,2) not null default 0,
  agente_id       uuid references agentes(id),
  oficina_id      uuid references oficinas(id),
  -- "on delete set null" en las dos, y no es un detalle: el reporte de cotizaciones se vuelve a
  -- subir todos los meses, y si un cargo de MVR apunta a una cotizacion vieja, borrar ese
  -- reporte reventaria con un error de llave foranea. Asi el cargo sobrevive sin su cotizacion
  -- -- que es lo correcto: la plata ya se cobro, lo unico que se pierde es de donde salio.
  cotizacion_id   uuid references lineas_cotizacion(id) on delete set null,
  poliza_id       uuid references polizas(id) on delete set null,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','conciliado_auto','conciliado_confirmado',
                                    'sin_identificar','cuenta_casa','descartado')),
  regla_match     text,
  score           numeric(5,2),
  candidatos      jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists lineas_costo_reporte on lineas_costo (reporte_id);
create index if not exists lineas_costo_estado  on lineas_costo (estado);
create index if not exists lineas_costo_oficina on lineas_costo (oficina_id);
create index if not exists lineas_costo_pre13   on lineas_costo (apellido_pre13);

drop trigger if exists lineas_costo_touch on lineas_costo;
create trigger lineas_costo_touch before update on lineas_costo
  for each row execute function set_updated_at();

comment on table lineas_costo is
  'Cargos que una compania le pasa a la agencia y que SI son de alguien: hoy los MVR. Un renglon '
  'por conductor. No es comision y por eso no vive en lineas_comision: no paga al agente ni '
  'cambia la base del royalty, solo se le descuenta a la oficina despues del royalty, igual que '
  'en el Excel de Arturo.';

-- ---------------------------------------------------------
-- 4. Normalizar al insertar
-- ---------------------------------------------------------
create or replace function lineas_costo_normalizar() returns trigger
language plpgsql as $fn$
declare
  v_ap text; v_pi text;
begin
  new.es_comercial := coalesce(nullif(trim(coalesce(new.asegurado_crudo,'')), ''), 'N/A') = 'N/A';

  v_ap := normalizar_nombre(split_part(coalesce(new.asegurado_crudo,''), ',', 1));
  v_pi := normalizar_nombre(substr(coalesce(new.asegurado_crudo,''),
            length(split_part(coalesce(new.asegurado_crudo,''), ',', 1)) + 2));

  new.apellido_norm  := v_ap;
  new.apellido_pre13 := left(coalesce(v_ap,''), 13);
  new.pila_norm      := split_part(coalesce(v_pi,''), ' ', 1);
  new.nombre_normalizado := nullif(trim(coalesce(v_pi,'') || ' ' || coalesce(v_ap,'')), '');
  new.conductor_norm := normalizar_nombre(
    substr(coalesce(new.conductor_crudo,''),
           length(split_part(coalesce(new.conductor_crudo,''), ',', 1)) + 2)
    || ' ' || split_part(coalesce(new.conductor_crudo,''), ',', 1));
  return new;
end $fn$;

drop trigger if exists lineas_costo_norm on lineas_costo;
create trigger lineas_costo_norm before insert or update on lineas_costo
  for each row execute function lineas_costo_normalizar();

create or replace function lineas_cotizacion_normalizar() returns trigger
language plpgsql as $fn$
begin
  new.apellido_norm  := normalizar_nombre(new.apellido_crudo);
  new.apellido_pre13 := left(coalesce(new.apellido_norm,''), 13);
  new.pila_norm      := split_part(coalesce(normalizar_nombre(new.pila_crudo),''), ' ', 1);
  new.nombre_normalizado := nullif(trim(coalesce(normalizar_nombre(new.pila_crudo),'')
                              || ' ' || coalesce(new.apellido_norm,'')), '');
  if new.agente_id is null and new.agente_texto is not null then
    new.agente_id := agente_por_texto(new.agente_texto);
  end if;
  if new.oficina_id is null and new.agente_id is not null then
    select oficina_id into new.oficina_id from agentes where id = new.agente_id;
  end if;
  return new;
end $fn$;

drop trigger if exists lineas_cotizacion_norm on lineas_cotizacion;
create trigger lineas_cotizacion_norm before insert or update on lineas_cotizacion
  for each row execute function lineas_cotizacion_normalizar();

-- ---------------------------------------------------------
-- 5. El cruce
-- ---------------------------------------------------------
-- Las reglas salieron de cruzar a mano el archivo de agosto de Progressive (389 MVR) contra el
-- QuoteReport. Sin ellas el cruce pega 0; con ellas pego el 87.9% del dinero:
--
--   a) El apellido del Named Insured viene CORTADO A 13 CARACTERES ("AGUILAR CARDE",
--      "ALTUNAGA OROZ", "VILLAVICENCIO"). Hay que comparar por prefijo, nunca por igualdad.
--   b) Si no pega por asegurado, se intenta por CONDUCTOR. Asi apareieron 6.
--   c) Hay typos en el QuoteReport. Amanda Comellas esta cargada "AMNADA". Por eso el desempate
--      final es similarity() de pg_trgm y no igualdad.
--   d) Se prefiere la cotizacion de la MISMA compania que el archivo de MVR y la mas cercana en
--      fecha a la orden.
--   e) Las comerciales vienen con Named Insured = N/A y solo el conductor. Esas no pegan nunca
--      contra cotizaciones y se quedan en cuenta de la casa, marcadas.

create or replace function matchear_costo(p_linea_id uuid) returns text
language plpgsql as $fn$
declare
  c lineas_costo%rowtype;
  r reportes%rowtype;
  v_umbral numeric := cfg_num('umbral_costo', 55);
  v_best record;
  v_cands jsonb;
  v_n int;
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = c.reporte_id;

  -- Comercial sin asegurado: el archivo no dice de quien es. No se adivina.
  if c.es_comercial then
    update lineas_costo set estado = 'cuenta_casa', regla_match = 'comercial_sin_asegurado',
      agente_id = null, oficina_id = null where id = c.id;
    return 'cuenta_casa';
  end if;

  -- Candidatos: cotizaciones cuyo apellido comparte el prefijo cortado, puntuadas por parecido
  -- del nombre completo, con premio si la compania coincide y castigo por distancia en dias.
  -- El score se calcula UNA vez en el subquery de adentro y se usa para ordenar y para armar el
  -- json. La primera version lo escribia dos veces y ordenaba por x->>'score', que es TEXTO:
  -- asi "9.5" le ganaba a "100.0" y el mejor candidato quedaba segundo.
  select jsonb_agg(
           jsonb_build_object(
             'cotizacion_id', s.id, 'agente_id', s.agente_id, 'oficina_id', s.oficina_id,
             'nombre', s.nombre, 'carrier', s.carrier, 'score', s.score)
           order by s.score desc),
         count(*)
    into v_cands, v_n
  from (
    select q.id, q.agente_id, q.oficina_id,
           q.nombre_normalizado as nombre, q.carrier_texto as carrier,
           round((
               100 * similarity(coalesce(q.nombre_normalizado,''), coalesce(c.nombre_normalizado,''))
             + case when r.aseguradora_id is not null
                     and q.carrier_texto ilike '%' || (select a.nombre from aseguradoras a where a.id = r.aseguradora_id) || '%'
                    then 12 else 0 end
             - case when q.fecha is null or c.fecha_orden is null then 5
                    else least(abs(q.fecha - c.fecha_orden) / 10.0, 15) end
           )::numeric, 1) as score
      from lineas_cotizacion q
     where q.agente_id is not null
       and (
             -- (a) el apellido del MVR es prefijo del apellido de la cotizacion, o al reves
             (c.apellido_pre13 <> '' and q.apellido_norm like c.apellido_pre13 || '%')
          or (q.apellido_pre13 <> '' and c.apellido_norm like q.apellido_pre13 || '%')
             -- (b) o pega el conductor
          or (c.conductor_norm is not null and q.nombre_normalizado % c.conductor_norm)
       )
     order by score desc
     limit 5
  ) s;

  if v_cands is null then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'sin_candidato',
      score = 0, candidatos = null where id = c.id;
    return 'sin_identificar';
  end if;

  select (v_cands->0->>'score')::numeric as score,
         (v_cands->0->>'cotizacion_id')::uuid as cotizacion_id,
         (v_cands->0->>'agente_id')::uuid as agente_id,
         (v_cands->0->>'oficina_id')::uuid as oficina_id into v_best;

  if v_best.score >= v_umbral then
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'cotizacion',
      score = v_best.score, candidatos = v_cands, cotizacion_id = v_best.cotizacion_id,
      agente_id = v_best.agente_id, oficina_id = v_best.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  update lineas_costo set estado = 'sin_identificar', regla_match = 'score_bajo',
    score = v_best.score, candidatos = v_cands where id = c.id;
  return 'sin_identificar';
end $fn$;

create or replace function procesar_costos(p_reporte_id uuid)
returns table (estado text, n bigint)
language plpgsql as $fn$
declare x uuid;
begin
  for x in select id from lineas_costo where reporte_id = p_reporte_id loop
    perform matchear_costo(x);
  end loop;
  return query
    select l.estado, count(*) from lineas_costo l
     where l.reporte_id = p_reporte_id group by l.estado order by 2 desc;
end $fn$;

-- ---------------------------------------------------------
-- 6. Sacarlos por oficina
-- ---------------------------------------------------------
-- Esto es la columna de gastos del Excel, pero calculada. Devuelve el renglon
-- "MVR PROGRESSIVE 601.00" de cada oficina, por compania y por mes.

create or replace function costos_por_oficina(p_desde date, p_hasta date)
returns table (
  oficina_id uuid,
  oficina    text,
  compania   text,
  cargos     bigint,
  con_cargo  bigint,
  casos      bigint,
  monto      numeric
)
language sql stable as $fn$
  select
    o.id,
    o.nombre,
    coalesce(asg.nombre, 'Sin compania'),
    count(*),
    count(*) filter (where l.monto > 0),
    count(distinct coalesce(l.nombre_normalizado, l.conductor_norm)),
    round(coalesce(sum(l.monto), 0), 2)
  from lineas_costo l
  join reportes r on r.id = l.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  join oficinas o on o.id = l.oficina_id
  where l.estado in ('conciliado_auto', 'conciliado_confirmado')
    and coalesce(mes_del_periodo(r.periodo), l.fecha_orden, l.created_at::date)
        between p_desde and p_hasta
  group by o.id, o.nombre, asg.nombre
  order by o.nombre, 7 desc;
$fn$;

comment on function costos_por_oficina is
  'Los MVR ya identificados, por oficina y por compania. Es la columna de gastos del Excel con '
  'que Arturo le liquida a cada oficina ("MVR PROGRESSIVE 601.00"), pero calculada en vez de '
  'tecleada. No toca el royalty: el gasto se descuenta despues, igual que en su planilla.';

-- ---------------------------------------------------------
-- 7. Permisos (la RLS del proyecto es toda "to authenticated")
-- ---------------------------------------------------------
alter table lineas_costo      enable row level security;
alter table lineas_cotizacion enable row level security;
do $$ begin
  create policy auth_all on lineas_costo      for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy auth_all on lineas_cotizacion for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_name in ('lineas_costo','lineas_cotizacion')) as tablas_nuevas_de_2,
  (select count(*) from information_schema.columns
    where table_name = 'reportes' and column_name = 'origen') as columna_origen,
  (select is_nullable from information_schema.columns
    where table_name = 'reportes' and column_name = 'storage_path') as storage_path_acepta_nulo,
  (select count(*) from pg_proc
    where proname in ('matchear_costo','procesar_costos','costos_por_oficina')) as funciones_nuevas_de_3,
  -- lo que de verdad importa: que el check de tipo ya acepte los dos tipos nuevos
  (select count(*) from pg_constraint
    where conrelid = 'reportes'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%''mvr''%'
      and pg_get_constraintdef(oid) like '%''cotizaciones''%') as tipo_acepta_mvr_y_cotizaciones;
