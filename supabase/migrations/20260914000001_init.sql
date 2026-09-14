-- Gelpi Insurance · Módulo Comisiones · esquema inicial
create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

-- =========================================================
-- Catálogos
-- =========================================================
create table oficinas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  codigo text unique,
  direccion text,
  gerente_agente_id uuid,
  pct_override numeric(5,2) not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table agentes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text unique,
  oficina_id uuid references oficinas(id),
  supervisor_id uuid references agentes(id),
  user_id uuid,
  email text,
  telefono text,
  pct_split_default numeric(5,2) not null default 0,
  fecha_alta date default current_date,
  activo boolean not null default true,
  es_casa boolean not null default false,
  created_at timestamptz not null default now()
);
create index agentes_nombre_trgm on agentes using gin (nombre gin_trgm_ops);
alter table oficinas add constraint oficinas_gerente_fk foreign key (gerente_agente_id) references agentes(id);

create table aseguradoras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  codigo text unique,
  formato_esperado text,
  plantilla_mapeo jsonb,
  nivel_atribucion text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table alias_agencia (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  texto_normalizado text generated always as (upper(regexp_replace(texto, '[^A-Za-z0-9]', '', 'g'))) stored,
  aseguradora_id uuid references aseguradoras(id),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (texto_normalizado)
);

create table configuracion (
  clave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now()
);
insert into configuracion (clave, valor) values
  ('umbral_auto', '90'),
  ('umbral_mismatch', '60'),
  ('dias_atrasada', '10'),
  ('ventana_dias_vigencia', '5'),
  ('acceso_agentes_individuales', 'false');

-- =========================================================
-- Clientes y Active Business Book (pólizas)
-- =========================================================
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_normalizado text,
  telefono text,
  email text,
  direccion text,
  created_at timestamptz not null default now()
);
create index clientes_nombre_trgm on clientes using gin (nombre_normalizado gin_trgm_ops);

create table abb_versiones (
  id uuid primary key default gen_random_uuid(),
  fecha_carga timestamptz not null default now(),
  subido_por uuid,
  archivo_path text,
  estado text not null default 'vigente' check (estado in ('vigente','historica')),
  nota text
);

create table polizas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id),
  numero_poliza text not null,
  numero_normalizado text not null,
  aseguradora_id uuid references aseguradoras(id),
  ramo text not null default 'auto' check (ramo in ('auto','hogar','comercial','motocicleta','bote','inquilinos','inundacion','umbrella','vida','otro')),
  agente_id uuid references agentes(id),
  oficina_id uuid references oficinas(id),
  fecha_vigencia date,
  fecha_vencimiento date,
  prima numeric(12,2),
  estado text not null default 'activa' check (estado in ('activa','cancelada','vencida','pendiente')),
  origen text not null default 'alta_manual' check (origen in ('venta_interna','alta_manual','import')),
  abb_version_id uuid references abb_versiones(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (aseguradora_id, numero_normalizado)
);
create index polizas_numero_norm on polizas (numero_normalizado);
create index polizas_agente on polizas (agente_id);
create index polizas_oficina on polizas (oficina_id);

-- =========================================================
-- Reportes importados y líneas
-- =========================================================
create table reportes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('comision_aseguradora','venta_interna','bono_contingencia','actualizacion_abb','produccion','cancelaciones','renovaciones','chargebacks','resumen_anual','otro')),
  aseguradora_id uuid references aseguradoras(id),
  nombre_archivo text not null,
  storage_path text not null,
  mime text,
  hash_archivo text not null unique,
  subido_por uuid,
  periodo text,
  estado text not null default 'subido' check (estado in ('subido','extrayendo','extraido','matcheado','cerrado','error','bloqueado')),
  total_lineas integer not null default 0,
  total_ok integer not null default 0,
  total_excepciones integer not null default 0,
  confianza_promedio numeric(5,2),
  mapeo_columnas jsonb,
  columnas_detectadas jsonb,
  resumen_ia text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lineas_comision (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references reportes(id) on delete cascade,
  fila integer,
  numero_poliza_crudo text,
  numero_normalizado text,
  nombre_asegurado_crudo text,
  nombre_asegurado_normalizado text,
  productor_crudo text,
  tipo_transaccion text not null default 'otro' check (tipo_transaccion in ('nueva','renovacion','endoso','cancelacion','ajuste','otro')),
  ramo text,
  prima numeric(12,2),
  tasa numeric(6,3),
  monto numeric(12,2) not null default 0,
  fecha_vigencia date,
  fecha_statement date,
  campos_extra jsonb,
  confianza numeric(5,2),
  clave_duplicado text,
  estado text not null default 'pendiente' check (estado in ('pendiente','conciliado_auto','conciliado_confirmado','mismatch','sin_identificar','en_espera','duplicado_sospechoso','descartado','cuenta_casa')),
  regla_match text,
  score numeric(5,2),
  candidatos jsonb,
  poliza_id uuid references polizas(id),
  agente_id uuid references agentes(id),
  oficina_id uuid references oficinas(id),
  linea_original_id uuid references lineas_comision(id),
  es_primera_confirmacion_alias boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lineas_comision_reporte on lineas_comision (reporte_id);
create index lineas_comision_estado on lineas_comision (estado);
create index lineas_comision_agente on lineas_comision (agente_id);
create index lineas_comision_clave on lineas_comision (clave_duplicado);
create index lineas_comision_numero on lineas_comision (numero_normalizado);

create table lineas_venta (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references reportes(id) on delete cascade,
  fila integer,
  agente_nombre_crudo text,
  agente_id uuid references agentes(id),
  oficina_nombre_crudo text,
  oficina_id uuid references oficinas(id),
  cliente_nombre_crudo text,
  telefono text,
  email text,
  numero_poliza text,
  numero_normalizado text,
  aseguradora_nombre_crudo text,
  aseguradora_id uuid references aseguradoras(id),
  ramo text,
  fecha_venta date,
  fecha_vigencia date,
  prima numeric(12,2),
  campos_extra jsonb,
  confianza numeric(5,2),
  estado_en_abb text not null default 'pendiente' check (estado_en_abb in ('pendiente','nuevo','coincide','conflicto')),
  poliza_id uuid references polizas(id),
  created_at timestamptz not null default now()
);

create table excepciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('mismatch','sin_identificar','duplicado','conflicto_venta')),
  linea_comision_id uuid references lineas_comision(id) on delete cascade,
  linea_venta_id uuid references lineas_venta(id) on delete cascade,
  linea_relacionada_id uuid references lineas_comision(id),
  candidatos jsonb,
  explicacion text,
  estado text not null default 'pendiente' check (estado in ('pendiente','resuelta','en_espera')),
  accion text,
  nota text,
  resuelta_por uuid,
  resuelta_en timestamptz,
  created_at timestamptz not null default now()
);
create index excepciones_estado on excepciones (estado, tipo);
create unique index excepciones_linea_tipo_pendiente on excepciones (linea_comision_id, tipo) where estado = 'pendiente' and linea_comision_id is not null;

-- =========================================================
-- Bonos
-- =========================================================
create table bonos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('contingencia_aseguradora','spiff_campana','override_manager','retencion','volumen','otro')),
  nombre text,
  aseguradora_id uuid references aseguradoras(id),
  periodo text,
  monto_total numeric(12,2) not null default 0,
  regla_reparto text not null default 'manual' check (regla_reparto in ('proporcional_produccion','fijo_por_oficina','manual','proporcional_retencion')),
  oficina_id uuid references oficinas(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','repartido','pagado')),
  reporte_id uuid references reportes(id),
  created_at timestamptz not null default now()
);

create table bono_reparto (
  id uuid primary key default gen_random_uuid(),
  bono_id uuid not null references bonos(id) on delete cascade,
  agente_id uuid not null references agentes(id),
  monto numeric(12,2) not null,
  motivo text,
  pagado boolean not null default false,
  created_at timestamptz not null default now()
);

create table auditoria (
  id bigserial primary key,
  entidad text not null,
  entidad_id uuid,
  accion text not null,
  campo text,
  valor_anterior text,
  valor_nuevo text,
  usuario uuid,
  motivo text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Funciones de normalización
-- =========================================================
create or replace function normalizar_poliza(p text) returns text
language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

create or replace function normalizar_nombre(p text) returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(upper(unaccent(coalesce(p,''))), '\y(LLC|INC|CORP|LTD|CO)\y', '', 'g'),
    '[^A-Z0-9 ]|\s+', ' ', 'g')), '');
$$;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger polizas_updated before update on polizas for each row execute function set_updated_at();
create trigger reportes_updated before update on reportes for each row execute function set_updated_at();
create trigger lineas_comision_updated before update on lineas_comision for each row execute function set_updated_at();

create or replace function polizas_normalizar() returns trigger language plpgsql as $$
begin
  new.numero_normalizado := normalizar_poliza(new.numero_poliza);
  return new;
end $$;
create trigger polizas_normalizar_trg before insert or update of numero_poliza on polizas for each row execute function polizas_normalizar();

create or replace function clientes_normalizar() returns trigger language plpgsql as $$
begin new.nombre_normalizado := normalizar_nombre(new.nombre); return new; end $$;
create trigger clientes_normalizar_trg before insert or update of nombre on clientes for each row execute function clientes_normalizar();

create or replace function lineas_comision_normalizar() returns trigger language plpgsql as $$
begin
  new.numero_normalizado := normalizar_poliza(new.numero_poliza_crudo);
  new.nombre_asegurado_normalizado := normalizar_nombre(new.nombre_asegurado_crudo);
  new.clave_duplicado := md5(concat_ws('|',
    (select aseguradora_id::text from reportes where id = new.reporte_id),
    coalesce(new.numero_normalizado,''), coalesce(new.nombre_asegurado_normalizado,''),
    coalesce(new.fecha_vigencia::text,''), new.tipo_transaccion, coalesce(new.monto::text,'')));
  return new;
end $$;
create trigger lineas_comision_normalizar_trg before insert or update of numero_poliza_crudo, nombre_asegurado_crudo, fecha_vigencia, tipo_transaccion, monto on lineas_comision
  for each row execute function lineas_comision_normalizar();

create or replace function lineas_venta_normalizar() returns trigger language plpgsql as $$
begin new.numero_normalizado := normalizar_poliza(new.numero_poliza); return new; end $$;
create trigger lineas_venta_normalizar_trg before insert or update of numero_poliza on lineas_venta for each row execute function lineas_venta_normalizar();

create or replace function es_alias_agencia(p text) returns boolean
language sql stable as $$
  select exists (select 1 from alias_agencia a where a.activo and a.texto_normalizado = upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')));
$$;

create or replace function cfg_num(p_clave text, p_default numeric) returns numeric
language sql stable as $$
  select coalesce((select (valor #>> '{}')::numeric from configuracion where clave = p_clave), p_default);
$$;

-- =========================================================
-- Motor de matching
-- =========================================================
create or replace function abrir_excepcion(p_tipo text, p_linea uuid, p_candidatos jsonb, p_explicacion text, p_relacionada uuid default null)
returns void language plpgsql as $$
begin
  insert into excepciones (tipo, linea_comision_id, candidatos, explicacion, linea_relacionada_id)
  values (p_tipo, p_linea, p_candidatos, p_explicacion, p_relacionada)
  on conflict do nothing;
end $$;

create or replace function matchear_linea(p_linea_id uuid) returns text
language plpgsql as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_umbral_auto numeric := cfg_num('umbral_auto', 90);
  v_umbral_mismatch numeric := cfg_num('umbral_mismatch', 60);
  v_ventana int := cfg_num('ventana_dias_vigencia', 5)::int;
  v_pol polizas%rowtype;
  v_n int;
  v_alias boolean;
  v_primera boolean;
  v_dup uuid;
  v_orig lineas_comision%rowtype;
  v_cands jsonb;
  v_best record;
  v_estado text;
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = l.reporte_id;

  -- Paso 7 (compuerta): duplicado exacto en los últimos 12 meses (otra línea con la misma clave)
  select id into v_dup from lineas_comision
   where clave_duplicado = l.clave_duplicado and id <> l.id and estado <> 'descartado'
     and created_at > now() - interval '12 months'
   order by created_at limit 1;
  if v_dup is not null then
    perform abrir_excepcion('duplicado', l.id,
      jsonb_build_object('linea_relacionada_id', v_dup),
      'Misma aseguradora, póliza, asegurado, vigencia, tipo y monto que otra línea ya cargada.', v_dup);
  end if;

  -- Paso 6: chargebacks / ajustes heredan de la línea original
  if l.monto < 0 or l.tipo_transaccion in ('cancelacion','ajuste') then
    select * into v_orig from lineas_comision
     where numero_normalizado = l.numero_normalizado and id <> l.id and monto > 0
       and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') and agente_id is not null
     order by created_at desc limit 1;
    if found then
      update lineas_comision set estado = 'conciliado_auto', regla_match = 'herencia_chargeback', score = 100,
        poliza_id = v_orig.poliza_id, agente_id = v_orig.agente_id, oficina_id = v_orig.oficina_id, linea_original_id = v_orig.id
       where id = l.id;
      return 'conciliado_auto';
    else
      update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original' where id = l.id;
      return 'en_espera';
    end if;
  end if;

  v_alias := es_alias_agencia(l.productor_crudo);

  -- Paso 2: match exacto por número de póliza
  if l.numero_normalizado is not null then
    select * into v_pol from polizas
     where numero_normalizado = l.numero_normalizado
       and (r.aseguradora_id is null or aseguradora_id = r.aseguradora_id or aseguradora_id is null)
     order by (aseguradora_id = r.aseguradora_id) desc nulls last, updated_at desc limit 1;
    if found then
      if v_pol.agente_id is null then
        update lineas_comision set estado = 'sin_identificar', regla_match = 'poliza_sin_agente', score = 100, poliza_id = v_pol.id where id = l.id;
        perform abrir_excepcion('sin_identificar', l.id, jsonb_build_object('poliza_id', v_pol.id),
          'La póliza existe en el Active Business Book pero no tiene agente ni oficina asignados.');
        return 'sin_identificar';
      end if;
      -- Paso 3: alias de agencia → primera vez pide confirmación
      v_primera := v_alias and not exists (
        select 1 from lineas_comision x where x.numero_normalizado = l.numero_normalizado and x.id <> l.id
          and x.estado in ('conciliado_confirmado','conciliado_auto') and x.es_primera_confirmacion_alias);
      if v_primera then
        update lineas_comision set estado = 'mismatch', regla_match = 'poliza_exacta_alias_primera_vez', score = 96,
          poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id, es_primera_confirmacion_alias = true,
          candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 96))
         where id = l.id;
        perform abrir_excepcion('mismatch', l.id,
          jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 96)),
          format('El número de póliza matcheó exacto, pero el Productor del reporte (%s) es un alias de la agencia y es la primera vez que esta póliza se reporta a nombre de la agencia. Confirmá la reasignación; las próximas conciliarán solas.', l.productor_crudo));
        return 'mismatch';
      end if;
      update lineas_comision set estado = 'conciliado_auto', regla_match = 'poliza_exacta', score = 100,
        poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id where id = l.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- Paso 4: asegurado + aseguradora + vigencia ±ventana
  if l.nombre_asegurado_normalizado is not null then
    select count(*) into v_n from polizas p join clientes c on c.id = p.cliente_id
     where c.nombre_normalizado = l.nombre_asegurado_normalizado
       and (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
       and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
    if v_n = 1 then
      select p.* into v_pol from polizas p join clientes c on c.id = p.cliente_id
       where c.nombre_normalizado = l.nombre_asegurado_normalizado
         and (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
         and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
      update lineas_comision set estado = 'mismatch', regla_match = 'asegurado_aseguradora_vigencia', score = 92,
        poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id,
        candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 92))
       where id = l.id;
      perform abrir_excepcion('mismatch', l.id,
        jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 92)),
        'El número de póliza no coincide exacto, pero el asegurado, la aseguradora y la fecha de vigencia sí. Confirmá en 1 clic.');
      return 'mismatch';
    end if;
  end if;

  -- Paso 5: fuzzy con score compuesto
  select jsonb_agg(jsonb_build_object('poliza_id', s.id, 'agente_id', s.agente_id, 'oficina_id', s.oficina_id, 'score', s.score, 'numero_poliza', s.numero_poliza, 'cliente', s.cliente) order by s.score desc)
    into v_cands
  from (
    select p.id, p.agente_id, p.oficina_id, p.numero_poliza, c.nombre as cliente,
      round((((
        0.55 * coalesce(similarity(c.nombre_normalizado, l.nombre_asegurado_normalizado), 0) +
        0.30 * coalesce(similarity(p.numero_normalizado, l.numero_normalizado), 0) +
        0.15 * case when l.fecha_vigencia is null or p.fecha_vigencia is null then 0.5
                    when abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana then 1 else 0 end
      ) * 100)::numeric), 1) as score
    from polizas p left join clientes c on c.id = p.cliente_id
    where (r.aseguradora_id is null or p.aseguradora_id = r.aseguradora_id)
      and (c.nombre_normalizado % coalesce(l.nombre_asegurado_normalizado,'') or p.numero_normalizado % coalesce(l.numero_normalizado,''))
    order by score desc limit 5
  ) s;

  select (v_cands->0->>'score')::numeric as score, (v_cands->0->>'poliza_id')::uuid as poliza_id,
         (v_cands->0->>'agente_id')::uuid as agente_id, (v_cands->0->>'oficina_id')::uuid as oficina_id,
         jsonb_array_length(coalesce(v_cands,'[]'::jsonb)) as n into v_best;

  if v_best.score is not null and v_best.score >= v_umbral_mismatch then
    update lineas_comision set estado = 'mismatch', regla_match = 'fuzzy', score = v_best.score, candidatos = v_cands,
      poliza_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.poliza_id else null end,
      agente_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.agente_id else null end,
      oficina_id = case when v_best.score >= v_umbral_auto and v_best.n = 1 then v_best.oficina_id else null end
     where id = l.id;
    perform abrir_excepcion('mismatch', l.id, v_cands,
      format('Coincidencia parcial (%s%%). Elegí el candidato correcto del Active Business Book o reasigná a mano.', v_best.score));
    return 'mismatch';
  end if;

  update lineas_comision set estado = 'sin_identificar', regla_match = 'sin_candidato', score = coalesce(v_best.score, 0), candidatos = v_cands where id = l.id;
  perform abrir_excepcion('sin_identificar', l.id, v_cands,
    'No se encontró ningún candidato en el Active Business Book (score < ' || v_umbral_mismatch || '%). Asigná a mano o dá de alta el cliente y la póliza.');
  return 'sin_identificar';
end $$;

create or replace function procesar_matching(p_reporte_id uuid) returns jsonb
language plpgsql as $$
declare
  rec record; res text; cnt jsonb := '{}'::jsonb;
begin
  for rec in select id from lineas_comision where reporte_id = p_reporte_id and estado = 'pendiente' order by fila loop
    res := matchear_linea(rec.id);
    cnt := jsonb_set(cnt, array[res], to_jsonb(coalesce((cnt->>res)::int, 0) + 1));
  end loop;
  update reportes r set estado = 'matcheado',
    total_lineas = (select count(*) from lineas_comision where reporte_id = r.id),
    total_ok = (select count(*) from lineas_comision where reporte_id = r.id and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    total_excepciones = (select count(*) from excepciones e join lineas_comision l on l.id = e.linea_comision_id where l.reporte_id = r.id and e.estado = 'pendiente')
   where id = p_reporte_id;
  return cnt;
end $$;

-- Ventas internas → Active Business Book
create or replace function procesar_ventas(p_reporte_id uuid) returns jsonb
language plpgsql as $$
declare
  v lineas_venta%rowtype; v_pol polizas%rowtype; v_cli uuid; v_ag uuid; v_of uuid; v_as uuid;
  n_nuevo int := 0; n_coincide int := 0; n_conf int := 0;
begin
  for v in select * from lineas_venta where reporte_id = p_reporte_id and estado_en_abb = 'pendiente' loop
    v_ag := v.agente_id; v_of := v.oficina_id; v_as := v.aseguradora_id;
    if v_ag is null and v.agente_nombre_crudo is not null then
      select id, oficina_id into v_ag, v_of from agentes where normalizar_nombre(nombre) = normalizar_nombre(v.agente_nombre_crudo) and activo limit 1;
      if v_ag is null then
        select id, oficina_id into v_ag, v_of from agentes where activo order by similarity(normalizar_nombre(nombre), normalizar_nombre(v.agente_nombre_crudo)) desc limit 1;
        if v_ag is not null and similarity(normalizar_nombre((select nombre from agentes where id = v_ag)), normalizar_nombre(v.agente_nombre_crudo)) < 0.6 then v_ag := null; v_of := null; end if;
      end if;
    end if;
    if v_of is null and v.oficina_nombre_crudo is not null then
      select id into v_of from oficinas order by similarity(normalizar_nombre(nombre), normalizar_nombre(v.oficina_nombre_crudo)) desc limit 1;
    end if;
    if v_as is null and v.aseguradora_nombre_crudo is not null then
      select id into v_as from aseguradoras order by similarity(normalizar_nombre(nombre), normalizar_nombre(v.aseguradora_nombre_crudo)) desc limit 1;
    end if;

    select * into v_pol from polizas where numero_normalizado = v.numero_normalizado and (v_as is null or aseguradora_id = v_as or aseguradora_id is null) limit 1;
    if found then
      if v_pol.agente_id is not null and v_ag is not null and v_pol.agente_id <> v_ag then
        update lineas_venta set estado_en_abb = 'conflicto', poliza_id = v_pol.id, agente_id = v_ag, oficina_id = v_of, aseguradora_id = v_as where id = v.id;
        insert into excepciones (tipo, linea_venta_id, candidatos, explicacion)
          values ('conflicto_venta', v.id, jsonb_build_object('poliza_id', v_pol.id, 'agente_actual', v_pol.agente_id, 'agente_reclamado', v_ag),
            'El reporte de ventas reclama esta póliza para otro agente distinto al que figura en el Active Business Book.');
        n_conf := n_conf + 1;
      else
        update lineas_venta set estado_en_abb = 'coincide', poliza_id = v_pol.id, agente_id = coalesce(v_ag, v_pol.agente_id), oficina_id = coalesce(v_of, v_pol.oficina_id), aseguradora_id = v_as where id = v.id;
        if v_pol.agente_id is null and v_ag is not null then
          update polizas set agente_id = v_ag, oficina_id = coalesce(v_of, oficina_id) where id = v_pol.id;
        end if;
        n_coincide := n_coincide + 1;
      end if;
    else
      insert into clientes (nombre, telefono, email) values (coalesce(v.cliente_nombre_crudo, 'Sin nombre'), v.telefono, v.email) returning id into v_cli;
      insert into polizas (cliente_id, numero_poliza, aseguradora_id, ramo, agente_id, oficina_id, fecha_vigencia, prima, origen)
        values (v_cli, coalesce(v.numero_poliza, 'PENDIENTE-' || left(v.id::text, 8)), v_as,
          case when v.ramo in ('auto','hogar','comercial','motocicleta','bote','inquilinos','inundacion','umbrella','vida') then v.ramo else 'otro' end,
          v_ag, v_of, coalesce(v.fecha_vigencia, v.fecha_venta), v.prima, 'venta_interna')
        returning * into v_pol;
      update lineas_venta set estado_en_abb = 'nuevo', poliza_id = v_pol.id, agente_id = v_ag, oficina_id = v_of, aseguradora_id = v_as where id = v.id;
      n_nuevo := n_nuevo + 1;
    end if;
  end loop;
  update reportes set estado = case when n_conf > 0 then 'matcheado' else 'cerrado' end,
    total_lineas = (select count(*) from lineas_venta where reporte_id = p_reporte_id),
    total_ok = n_nuevo + n_coincide, total_excepciones = n_conf where id = p_reporte_id;
  -- re-intentar líneas de comisión que esperaban estas pólizas
  perform matchear_linea(l.id) from lineas_comision l
    where l.estado in ('sin_identificar','en_espera') and l.numero_normalizado in (select numero_normalizado from lineas_venta where reporte_id = p_reporte_id);
  return jsonb_build_object('nuevo', n_nuevo, 'coincide', n_coincide, 'conflicto', n_conf);
end $$;

-- =========================================================
-- Resolución de excepciones
-- =========================================================
create or replace function resolver_excepcion(
  p_excepcion_id uuid, p_accion text,
  p_agente_id uuid default null, p_oficina_id uuid default null, p_poliza_id uuid default null,
  p_motivo text default null, p_cliente jsonb default null
) returns jsonb language plpgsql security definer as $$
declare
  e excepciones%rowtype; l lineas_comision%rowtype; v_pol polizas%rowtype; v_cli uuid; v_casa uuid; v_usr uuid := auth.uid();
  v_of uuid;
begin
  select * into e from excepciones where id = p_excepcion_id for update;
  if not found then raise exception 'Excepción inexistente'; end if;
  if e.linea_comision_id is not null then select * into l from lineas_comision where id = e.linea_comision_id; end if;

  if p_accion = 'confirmar' then
    if e.tipo = 'conflicto_venta' then raise exception 'Usá elegir_dueno para conflictos de venta'; end if;
    if l.agente_id is null then raise exception 'No hay sugerencia para confirmar'; end if;
    update lineas_comision set estado = 'conciliado_confirmado' where id = l.id;
    if l.es_primera_confirmacion_alias then update polizas set agente_id = l.agente_id, oficina_id = l.oficina_id where id = l.poliza_id and agente_id is null; end if;

  elsif p_accion = 'reasignar' or p_accion = 'asignar' then
    if p_agente_id is null then raise exception 'Falta el agente'; end if;
    if p_accion = 'reasignar' and coalesce(p_motivo,'') = '' then raise exception 'El motivo es obligatorio al reasignar'; end if;
    select oficina_id into v_of from agentes where id = p_agente_id;
    update lineas_comision set estado = 'conciliado_confirmado', agente_id = p_agente_id, oficina_id = coalesce(p_oficina_id, v_of),
      poliza_id = coalesce(p_poliza_id, poliza_id), regla_match = 'manual' where id = l.id;
    if coalesce(p_poliza_id, l.poliza_id) is not null then
      update polizas set agente_id = p_agente_id, oficina_id = coalesce(p_oficina_id, v_of) where id = coalesce(p_poliza_id, l.poliza_id);
    end if;

  elsif p_accion = 'cuenta_casa' then
    select id into v_casa from agentes where es_casa limit 1;
    update lineas_comision set estado = 'cuenta_casa', agente_id = v_casa, regla_match = 'cuenta_casa' where id = l.id;

  elsif p_accion = 'crear_poliza' then
    if p_cliente is null or p_agente_id is null then raise exception 'Faltan datos del cliente o el agente'; end if;
    select oficina_id into v_of from agentes where id = p_agente_id;
    insert into clientes (nombre, telefono, email) values (coalesce(p_cliente->>'nombre', l.nombre_asegurado_crudo), p_cliente->>'telefono', p_cliente->>'email') returning id into v_cli;
    insert into polizas (cliente_id, numero_poliza, aseguradora_id, ramo, agente_id, oficina_id, fecha_vigencia, prima, origen)
      values (v_cli, coalesce(p_cliente->>'numero_poliza', l.numero_poliza_crudo), (select aseguradora_id from reportes where id = l.reporte_id),
        coalesce(nullif(p_cliente->>'ramo',''), coalesce(l.ramo,'auto')), p_agente_id, coalesce(p_oficina_id, v_of), l.fecha_vigencia, l.prima, 'alta_manual')
      returning * into v_pol;
    update lineas_comision set estado = 'conciliado_confirmado', poliza_id = v_pol.id, agente_id = p_agente_id, oficina_id = coalesce(p_oficina_id, v_of), regla_match = 'alta_manual' where id = l.id;

  elsif p_accion = 'pendiente' then
    update excepciones set estado = 'en_espera', nota = p_motivo where id = e.id;
    return jsonb_build_object('ok', true, 'estado', 'en_espera');

  elsif p_accion = 'descartar_duplicado' then
    update lineas_comision set estado = 'descartado', regla_match = 'duplicado_descartado' where id = l.id;
  elsif p_accion = 'mantener_ambas' then
    if l.estado = 'duplicado_sospechoso' then update lineas_comision set estado = 'pendiente' where id = l.id; end if;
  elsif p_accion = 'reclasificar_ajuste' then
    update lineas_comision set tipo_transaccion = 'ajuste' where id = l.id;

  elsif p_accion = 'elegir_dueno' then
    if p_agente_id is null then raise exception 'Falta el agente dueño'; end if;
    select oficina_id into v_of from agentes where id = p_agente_id;
    update polizas set agente_id = p_agente_id, oficina_id = coalesce(p_oficina_id, v_of) where id = (e.candidatos->>'poliza_id')::uuid;
    update lineas_venta set estado_en_abb = 'coincide' where id = e.linea_venta_id;
  else
    raise exception 'Acción desconocida: %', p_accion;
  end if;

  update excepciones set estado = 'resuelta', accion = p_accion, nota = coalesce(p_motivo, nota), resuelta_por = v_usr, resuelta_en = now() where id = e.id;
  insert into auditoria (entidad, entidad_id, accion, valor_nuevo, usuario, motivo)
    values ('excepcion', e.id, p_accion, jsonb_build_object('agente_id', p_agente_id, 'oficina_id', p_oficina_id, 'poliza_id', p_poliza_id)::text, v_usr, p_motivo);
  if l.id is not null and p_accion in ('mantener_ambas') then perform matchear_linea(l.id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Reasignar una línea ya conciliada (desde la ficha del agente)
create or replace function reasignar_linea(p_linea_id uuid, p_agente_id uuid, p_motivo text) returns void
language plpgsql security definer as $$
declare v_of uuid; v_prev uuid;
begin
  if coalesce(p_motivo,'') = '' then raise exception 'El motivo es obligatorio'; end if;
  select agente_id into v_prev from lineas_comision where id = p_linea_id;
  select oficina_id into v_of from agentes where id = p_agente_id;
  update lineas_comision set agente_id = p_agente_id, oficina_id = v_of, estado = 'conciliado_confirmado', regla_match = 'manual' where id = p_linea_id;
  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
    values ('linea_comision', p_linea_id, 'reasignar', 'agente_id', v_prev::text, p_agente_id::text, auth.uid(), p_motivo);
end $$;

-- =========================================================
-- Vistas y KPIs
-- =========================================================
create or replace view v_lineas_comision as
select l.*, r.aseguradora_id, a.nombre as aseguradora, r.nombre_archivo, r.periodo,
       ag.nombre as agente, o.nombre as oficina, p.numero_poliza as poliza_abb, c.nombre as cliente
from lineas_comision l
join reportes r on r.id = l.reporte_id
left join aseguradoras a on a.id = r.aseguradora_id
left join agentes ag on ag.id = l.agente_id
left join oficinas o on o.id = l.oficina_id
left join polizas p on p.id = l.poliza_id
left join clientes c on c.id = p.cliente_id;

create or replace view v_excepciones as
select e.*, l.reporte_id, l.numero_poliza_crudo, l.nombre_asegurado_crudo, l.productor_crudo, l.monto, l.fecha_statement, l.score, l.regla_match,
       l.estado as estado_linea, l.agente_id as agente_sugerido_id, ag.nombre as agente_sugerido, l.oficina_id as oficina_sugerida_id, o.nombre as oficina_sugerida,
       a.nombre as aseguradora, r.aseguradora_id,
       (current_date - e.created_at::date) as antiguedad_dias,
       ((current_date - e.created_at::date) >= cfg_num('dias_atrasada', 10)) as atrasada,
       lv.cliente_nombre_crudo as venta_cliente, lv.agente_nombre_crudo as venta_agente, lv.numero_poliza as venta_poliza
from excepciones e
left join lineas_comision l on l.id = e.linea_comision_id
left join reportes r on r.id = coalesce(l.reporte_id, (select reporte_id from lineas_venta where id = e.linea_venta_id))
left join aseguradoras a on a.id = r.aseguradora_id
left join agentes ag on ag.id = l.agente_id
left join oficinas o on o.id = l.oficina_id
left join lineas_venta lv on lv.id = e.linea_venta_id;

create or replace view v_polizas as
select p.*, c.nombre as cliente, c.telefono, c.email, a.nombre as aseguradora, ag.nombre as agente, o.nombre as oficina
from polizas p
left join clientes c on c.id = p.cliente_id
left join aseguradoras a on a.id = p.aseguradora_id
left join agentes ag on ag.id = p.agente_id
left join oficinas o on o.id = p.oficina_id;

create or replace function resumen_kpis(p_desde date default date_trunc('month', current_date)::date, p_hasta date default (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
returns jsonb language sql stable as $$
  with lc as (
    select * from v_lineas_comision where coalesce(fecha_statement, created_at::date) between p_desde and p_hasta
  ), ex as (select * from v_excepciones where estado = 'pendiente')
  select jsonb_build_object(
    'conciliado', (select coalesce(sum(monto),0) from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    'sin_identificar', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='sin_identificar'), 'n', (select count(*) from ex where tipo='sin_identificar')),
    'mismatch', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='mismatch'), 'n', (select count(*) from ex where tipo='mismatch')),
    'duplicados', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='duplicado'), 'n', (select count(*) from ex where tipo='duplicado')),
    'conflictos', (select count(*) from ex where tipo='conflicto_venta'),
    'total_disputa', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex), 'n', (select count(*) from ex)),
    'por_oficina', (select coalesce(jsonb_agg(jsonb_build_object('oficina', o.nombre, 'oficina_id', o.id, 'comision', coalesce(s.monto,0), 'excepciones', coalesce(x.n,0), 'antiguedad', coalesce(x.dias,0)) order by o.nombre), '[]'::jsonb)
                    from oficinas o
                    left join (select oficina_id, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado') group by oficina_id) s on s.oficina_id = o.id
                    left join (select oficina_sugerida_id, count(*) n, round(avg(antiguedad_dias)) dias from ex group by oficina_sugerida_id) x on x.oficina_sugerida_id = o.id),
    'por_aseguradora', (select coalesce(jsonb_agg(jsonb_build_object('aseguradora', aseguradora, 'comision', monto) order by monto desc), '[]'::jsonb)
                        from (select aseguradora, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado') group by aseguradora) t),
    'agentes_con_comision', (select count(distinct agente_id) from lc where agente_id is not null)
  );
$$;

-- =========================================================
-- Seguridad: single-tenant, usuarios autenticados
-- =========================================================
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format('create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('reportes', 'reportes', false) on conflict do nothing;
create policy "reportes_auth_rw" on storage.objects for all to authenticated using (bucket_id = 'reportes') with check (bucket_id = 'reportes');

-- =========================================================
-- Semilla mínima (la casa + aseguradoras habituales + alias)
-- =========================================================
insert into oficinas (nombre, codigo) values ('Gelpi Insurance (casa matriz)', 'CASA');
insert into agentes (nombre, codigo, oficina_id, es_casa) values ('Jose Gelpi (cuenta de la casa)', 'CASA', (select id from oficinas where codigo = 'CASA'), true);
insert into aseguradoras (nombre, codigo) values
  ('Progressive','PRG'), ('GEICO','GEICO'), ('Citizens','CIT'), ('Bristol West','BW'), ('National General','NG'),
  ('Travelers','TRV'), ('Infinity','INF'), ('Kemper','KMP'), ('United Automobile','UAIC'), ('Universal Property','UPC'),
  ('Heritage','HRT'), ('Tower Hill','TH'), ('Foremost','FMS'), ('Safeco','SAF'), ('Liberty Mutual','LM'), ('Allstate','ALL'), ('State Farm','SF'), ('Mercury','MRC'), ('Direct Auto','DA'), ('Assurance America','AA');
insert into alias_agencia (texto) values ('Jose Gelpi'), ('Gelpi Insurance LLC'), ('Gelpi Insurance'), ('Jose A Gelpi'), ('Gelpi Insurance Inc');
