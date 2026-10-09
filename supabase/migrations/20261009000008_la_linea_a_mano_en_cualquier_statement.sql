-- =========================================================
-- La linea a mano, en cualquier statement
-- =========================================================
-- Arturo, varias veces y con las mismas palabras:
--
--   "Siempre amo la adicion manual para cualquier statement. Yo puedo poner una linea manual.
--    Sea Granada, sea Ascendant, sea que sea."
--
-- Hace falta porque ningun archivo viene completo: la compania se olvida una comision, manda un
-- ajuste por telefono, o paga algo que no figura en el PDF. Hoy la unica salida es no cargarlo,
-- y entonces el statement del sistema no cuadra con el cheque.
--
-- Lo delicado no es insertar la fila: es que SOBREVIVA. Reprocesar un reporte borra sus lineas y
-- las vuelve a sacar del archivo, y una linea que no esta en el archivo no vuelve. Por eso la
-- columna `origen`: todo lo que se escribio a mano queda marcado, y el borrado de reproceso lo
-- respeta. Sin eso, la funcion de arriba seria una forma elegante de perder trabajo.

-- ---------------------------------------------------------
-- 1. De donde salio cada linea
-- ---------------------------------------------------------
alter table lineas_comision
  add column if not exists origen text not null default 'archivo'
  check (origen in ('archivo', 'manual'));

comment on column lineas_comision.origen is
  'archivo = salio del statement de la compania y se puede volver a sacar de ahi. manual = la '
  'escribio una persona y NO esta en ningun archivo, asi que reprocesar el reporte no la puede '
  'borrar: no habria de donde recuperarla.';

create index if not exists lineas_comision_manuales on lineas_comision (reporte_id)
  where origen = 'manual';

-- ---------------------------------------------------------
-- 2. La vista, otra vez
-- ---------------------------------------------------------
-- Va DROP y no "create or replace": la vista empieza con l.*, y como lineas_comision acaba de
-- ganar la columna origen, ese * expande una columna mas y corre de lugar a todas las que
-- siguen. Postgres rechaza un replace que cambie el orden de las columnas. Sin cascade a
-- proposito: si algo dependiera de la vista prefiero que falle y mirarlo, a que se lo lleve
-- puesto en silencio.
drop view if exists v_lineas_comision;

create view v_lineas_comision as
select l.*, r.aseguradora_id, a.nombre as aseguradora, r.nombre_archivo, r.periodo,
       ag.nombre as agente, o.nombre as oficina, p.numero_poliza as poliza_abb, c.nombre as cliente
from lineas_comision l
join reportes r on r.id = l.reporte_id
left join aseguradoras a on a.id = r.aseguradora_id
left join agentes ag on ag.id = l.agente_id
left join oficinas o on o.id = l.oficina_id
left join polizas p on p.id = l.poliza_id
left join clientes c on c.id = p.cliente_id;

-- SIN ESTO LA VISTA QUEDA ABIERTA. La migracion 20260915000001 le puso security_invoker = on,
-- que hace que la RLS se evalue con el usuario que consulta y no con el dueno de la vista. Un
-- DROP se lleva esa propiedad: recrearla sin reponerla dejaria v_lineas_comision devolviendo
-- filas saltandose las politicas, y nadie se enteraria porque la pantalla se veria igual.
alter view v_lineas_comision set (security_invoker = on);

-- ---------------------------------------------------------
-- 3. Volver a contar el reporte
-- ---------------------------------------------------------
-- Los contadores del reporte (total_lineas, total_ok, total_excepciones) los escribia solo
-- procesar_matching(), al final de un reproceso completo. Agregar o quitar una linea a mano los
-- deja mintiendo: la lista de archivos diria "120 lineas" sobre 121. Se saca a su propia funcion
-- -- la misma cuenta, palabra por palabra -- para poder llamarla despues de un cambio suelto.
create or replace function recontar_reporte(p_reporte_id uuid) returns void
language sql as $fn$
  update reportes r set
    total_lineas = (select count(*) from lineas_comision where reporte_id = r.id),
    total_ok = (select count(*) from lineas_comision
                 where reporte_id = r.id
                   and estado in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa')),
    total_excepciones = (select count(*) from excepciones e
                          join lineas_comision l on l.id = e.linea_comision_id
                         where l.reporte_id = r.id and e.estado = 'pendiente')
   where r.id = p_reporte_id;
$fn$;

-- ---------------------------------------------------------
-- 4. Escribirla
-- ---------------------------------------------------------
create or replace function agregar_linea_manual(
  p_reporte_id      uuid,
  p_asegurado       text,
  p_numero_poliza   text    default null,
  p_tipo            text    default 'otro',
  p_prima           numeric default null,
  p_tasa            numeric default null,
  p_monto           numeric default 0,
  p_fecha_vigencia  date    default null,
  p_agente_id       uuid    default null,
  p_motivo          text    default null
) returns uuid
language plpgsql security definer as $fn$
declare
  r reportes%rowtype;
  v_id uuid;
  v_fila integer;
  v_poliza polizas%rowtype;
  v_norm text;
  v_agente uuid := p_agente_id;
  v_oficina uuid;
  v_estado text;
  v_usr uuid := auth.uid();
begin
  select * into r from reportes where id = p_reporte_id;
  if not found then raise exception 'No existe ese reporte'; end if;
  if r.tipo <> 'comision_aseguradora' then
    raise exception 'La linea a mano es para statements de comision. Este reporte es de tipo %.', r.tipo;
  end if;
  if coalesce(btrim(p_asegurado), '') = '' then
    raise exception 'Falta el nombre del asegurado: sin eso la linea no se puede reconocer despues.';
  end if;

  -- La poliza, si la escribio y existe en el Book. Sirve para dos cosas: el renglon queda
  -- enganchado al cliente de verdad, y si no eligio agente lo saca de ahi -- que es el mismo
  -- criterio que usa el motor con las lineas del archivo.
  v_norm := normalizar_poliza(p_numero_poliza);
  if coalesce(v_norm, '') <> '' then
    select * into v_poliza from polizas
     where numero_normalizado = v_norm
       and (r.aseguradora_id is null or aseguradora_id = r.aseguradora_id)
     limit 1;
    if found and v_agente is null then v_agente := v_poliza.agente_id; end if;
  end if;

  if v_agente is not null then
    select oficina_id into v_oficina from agentes where id = v_agente;
  end if;

  -- Sin agente la linea NO se esconde: entra como sin identificar y aparece en el filtro de
  -- "Sin asignar" del statement, igual que cualquier otra. Plata sin dueno que no se ve es
  -- plata que alguien termina pagando sin enterarse.
  v_estado := case when v_agente is null then 'sin_identificar' else 'conciliado_confirmado' end;

  select coalesce(max(fila), 0) + 1 into v_fila from lineas_comision where reporte_id = p_reporte_id;

  insert into lineas_comision (
    reporte_id, fila, origen,
    numero_poliza_crudo, nombre_asegurado_crudo,
    tipo_transaccion, prima, tasa, monto,
    fecha_vigencia, fecha_statement,
    poliza_id, agente_id, oficina_id,
    estado, regla_match, confianza, campos_extra
  ) values (
    p_reporte_id, v_fila, 'manual',
    nullif(btrim(coalesce(p_numero_poliza, '')), ''), btrim(p_asegurado),
    coalesce(nullif(btrim(coalesce(p_tipo, '')), ''), 'otro'), p_prima, p_tasa, coalesce(p_monto, 0),
    p_fecha_vigencia, coalesce(mes_del_periodo(r.periodo), current_date),
    v_poliza.id, v_agente, v_oficina,
    v_estado, 'manual', 100,
    jsonb_build_object('nota_manual', nullif(btrim(coalesce(p_motivo, '')), ''))
  )
  returning id into v_id;

  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
  values ('linea_comision', v_id, 'alta_manual', 'monto', null, coalesce(p_monto, 0)::text, v_usr, p_motivo);

  perform recontar_reporte(p_reporte_id);
  return v_id;
end $fn$;

comment on function agregar_linea_manual is
  'Agrega al statement una linea que el archivo no trae. Queda marcada origen = manual, asi que '
  'reprocesar el reporte no la borra. Sin agente entra como sin identificar, para que se vea.';

-- ---------------------------------------------------------
-- 5. Que el reproceso no se la lleve
-- ---------------------------------------------------------
-- Aca esta el punto de toda la migracion. reprocesar_reporte() borra las lineas del reporte y
-- vuelve a leer el archivo; una linea manual no esta en el archivo, asi que no volveria. Igual
-- la funcion de extraccion, que limpia antes de insertar. Filtrar por origen en el .ts de las
-- dos alcanza... hasta que alguien escriba un tercer camino y se olvide. El trigger lo cierra
-- desde el esquema, que es donde no se olvida.
--
-- La excepcion importante: borrar el STATEMENT entero si se las tiene que llevar. En un borrado
-- en cascada el padre ya no esta cuando corre el trigger del hijo, y eso es justamente la senal
-- que lo distingue de un reproceso -- donde el reporte sigue ahi, porque la idea es volver a
-- llenarlo. Sin esto, un statement con una linea a mano no se podria borrar nunca.
create or replace function proteger_lineas_manuales() returns trigger
language plpgsql as $fn$
begin
  if old.origen <> 'manual' then return old; end if;
  if coalesce(current_setting('gelpi.borrando_manual', true), '') = 'si' then return old; end if;
  if not exists (select 1 from reportes where id = old.reporte_id) then return old; end if;

  raise exception 'Esa linea la escribiste a mano y no esta en ningun archivo: reprocesar el '
                  'reporte la borraria para siempre. Si la queres sacar, borrala desde el '
                  'statement.'
    using errcode = 'restrict_violation';
end $fn$;

drop trigger if exists lineas_comision_proteger_manual on lineas_comision;
create trigger lineas_comision_proteger_manual before delete on lineas_comision
  for each row execute function proteger_lineas_manuales();

-- ---------------------------------------------------------
-- 6. Borrarla a proposito
-- ---------------------------------------------------------
-- La unica puerta: levanta la bandera, borra y la baja. Solo acepta manuales -- una linea del
-- archivo no se borra, se descarta o se saca del statement, que deja rastro y se puede deshacer.
-- Esta no tiene archivo detras, asi que borrarla es irreversible, y por eso queda en auditoria
-- con el nombre y el monto que tenia.
create or replace function borrar_linea_manual(p_linea_id uuid, p_motivo text default null)
returns uuid
language plpgsql security definer as $fn$
declare
  l lineas_comision%rowtype;
  v_usr uuid := auth.uid();
begin
  select * into l from lineas_comision where id = p_linea_id;
  if not found then raise exception 'No existe esa linea'; end if;
  if l.origen <> 'manual' then
    raise exception 'Esa linea vino en el archivo de la compania. Descartala o sacala del '
                    'statement, pero no se borra.';
  end if;

  perform set_config('gelpi.borrando_manual', 'si', true);
  delete from excepciones where linea_comision_id = l.id;
  delete from lineas_comision where id = l.id;
  perform set_config('gelpi.borrando_manual', '', true);

  insert into auditoria (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, motivo)
  values ('linea_comision', l.id, 'baja_manual', 'monto', l.monto::text, null, v_usr,
          trim(coalesce(p_motivo, '') || ' [' || coalesce(l.nombre_asegurado_crudo, 'sin nombre') || ']'));

  perform recontar_reporte(l.reporte_id);
  return l.reporte_id;
end $fn$;

comment on function borrar_linea_manual is
  'Borra una linea escrita a mano, y solo esas. Las del archivo se descartan, no se borran.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'lineas_comision' and column_name = 'origen')            as columna_origen,
  (select count(*) from pg_proc
    where proname in ('agregar_linea_manual', 'borrar_linea_manual', 'recontar_reporte')) as funciones_de_3,
  (select count(*) from pg_trigger where tgname = 'lineas_comision_proteger_manual') as trigger_puesto,
  (select count(*) from pg_views
    where viewname = 'v_lineas_comision'
      and definition ilike '%origen%')                                          as origen_en_la_vista,
  -- lo que no se puede perder de vista: que la RLS siga activa despues del DROP
  (select c.reloptions::text from pg_class c where c.relname = 'v_lineas_comision') as opciones_de_la_vista,
  (select count(*) from lineas_comision where origen = 'manual')                as lineas_a_mano;
