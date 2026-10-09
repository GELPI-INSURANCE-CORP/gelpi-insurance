-- =========================================================
-- Los MVR sin dueno se asignan a mano
-- =========================================================
-- Arturo, antes de subir el primer archivo de MVR:
--
--   "Como habia 274 [dolares] que no tenias identificado, si yo quiero a esa gente
--    identificarla manual mediante otro sistema que no voy a subir, lo puedo hacer o no lo
--    puedo hacer? Dejame saber antes de empezar a subir reportes."
--
-- No podia, y es un agujero que deje yo. matchear_costo() marcaba la linea 'sin_identificar' en
-- la base y ahi se quedaba: no abria excepcion, excepciones no tenia columna para costos, y la
-- pantalla de Conciliacion no los leia. Esos cargos quedaban INVISIBLES -- ni sumaban a ninguna
-- oficina ni aparecian en ningun lado para resolverlos.
--
-- Es exactamente el error contra el que escribi la advertencia en 20261008000001:
--
--   "Poner la linea en mismatch sin abrir la excepcion la sacaria del total SIN que aparezca en
--    ninguna pantalla: plata que se esfuma en silencio, que es peor que el error original."
--
-- En el archivo de agosto de Progressive son 47 casos por $274.50: 13 comerciales que vienen con
-- Named Insured = N/A -- el archivo no dice de quien son -- y 34 clientes viejos que no estan en
-- el QuoteReport porque su MVR salio de una renovacion y no de una cotizacion nueva.
--
-- POR QUE VAN POR v_excepciones Y NO POR UNA PANTALLA NUEVA. Porque Conciliacion ya es el lugar
-- donde se resuelve lo que el sistema no pudo repartir, y ya sabe listar, filtrar, buscar el
-- agente y asignar. Una pantalla aparte para 47 renglones seria otro lugar donde mirar.
--
-- PERO EL MONTO VA EN COLUMNA APARTE, Y ESO NO ES UN DETALLE. resumen_kpis() y las pantallas de
-- agentes, oficinas y clientes suman v_excepciones.monto para decir "esto es lo que esta en
-- disputa". Esa plata es comision que a Arturo le DEBEN. Un cargo de MVR es plata que DEBE.
-- Sumarlas daria un numero que no significa nada. Por eso la fila de costo sale con monto = null
-- -- sum() ignora los nulos, asi que ningun total existente cambia ni un centavo -- y su importe
-- viaja en monto_costo, que solo mira quien sabe que esta mirando un costo.

-- ---------------------------------------------------------
-- 1. La excepcion puede colgar de un costo
-- ---------------------------------------------------------
alter table excepciones
  add column if not exists linea_costo_id uuid references lineas_costo(id) on delete cascade;

-- Mismo candado que ya tienen las lineas de comision: una sola excepcion pendiente por costo y
-- tipo, para que reprocesar un archivo no deje la pantalla llena de duplicados.
create unique index if not exists excepciones_costo_tipo_pendiente
  on excepciones (linea_costo_id, tipo)
  where estado = 'pendiente' and linea_costo_id is not null;

comment on column excepciones.linea_costo_id is
  'La excepcion es de un cargo (MVR) y no de una comision. Va aparte de linea_comision_id porque '
  'son plata de signo contrario: una es lo que le deben a la agencia y la otra lo que debe.';

-- ---------------------------------------------------------
-- 2. Abrir la excepcion de un costo
-- ---------------------------------------------------------
-- Funcion propia en vez de tocar abrir_excepcion(): esa la llaman siete caminos distintos del
-- matcheo de comisiones y no hay razon para arriesgarlos por esto.
create or replace function abrir_excepcion_costo(
  p_tipo text, p_linea_costo uuid, p_candidatos jsonb, p_explicacion text
) returns void language plpgsql as $fn$
begin
  insert into excepciones (tipo, linea_costo_id, candidatos, explicacion)
  values (p_tipo, p_linea_costo, p_candidatos, p_explicacion)
  on conflict do nothing;
end $fn$;

-- ---------------------------------------------------------
-- 3. matchear_costo(), ahora avisando cuando no puede
-- ---------------------------------------------------------
create or replace function matchear_costo(p_linea_id uuid) returns text
language plpgsql as $fn$
declare
  c lineas_costo%rowtype;
  r reportes%rowtype;
  v_umbral numeric := cfg_num('umbral_costo', 55);
  v_best record;
  v_cands jsonb;
  v_n int;
  v_quien text;
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = c.reporte_id;

  v_quien := coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo, 'sin nombre');

  -- Comercial sin asegurado: el archivo no dice de quien es. No se adivina, pero AHORA se avisa:
  -- son 13 de los 47 casos de agosto y hasta hoy no aparecian en ninguna pantalla.
  if c.es_comercial then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'comercial_sin_asegurado',
      agente_id = null, oficina_id = null where id = c.id;
    perform abrir_excepcion_costo('sin_identificar', c.id, null,
      format('Cargo comercial de %s por $%s. La compania lo manda con el asegurado en blanco '
             || '("N/A") y solo el nombre del conductor: %s. No hay con que identificarlo solo. '
             || 'Elegi vos de quien es.',
             coalesce((select a.nombre from aseguradoras a where a.id = r.aseguradora_id), 'la compania'),
             c.monto, coalesce(c.conductor_crudo, 'sin nombre')));
    return 'sin_identificar';
  end if;

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
             (c.apellido_pre13 <> '' and q.apellido_norm like c.apellido_pre13 || '%')
          or (q.apellido_pre13 <> '' and c.apellido_norm like q.apellido_pre13 || '%')
          or (c.conductor_norm is not null and q.nombre_normalizado % c.conductor_norm)
       )
     order by score desc
     limit 5
  ) s;

  if v_cands is null then
    update lineas_costo set estado = 'sin_identificar', regla_match = 'sin_candidato',
      score = 0, candidatos = null where id = c.id;
    perform abrir_excepcion_costo('sin_identificar', c.id, null,
      format('MVR de %s por $%s. No aparece en el reporte de cotizaciones, asi que no hay forma '
             || 'de saber que agente lo ordeno. Suele pasar con clientes viejos: el MVR salio de '
             || 'una renovacion y no de una cotizacion nueva. Asignalo a mano.',
             v_quien, c.monto));
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

  -- Hay candidatos pero ninguno convence. Se guardan igual: la pantalla los ofrece y asignar
  -- pasa a ser un clic en vez de una busqueda.
  update lineas_costo set estado = 'sin_identificar', regla_match = 'score_bajo',
    score = v_best.score, candidatos = v_cands where id = c.id;
  perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
    format('MVR de %s por $%s. El parecido mas alto contra las cotizaciones es %s%%, por debajo '
           || 'del minimo para asignarlo solo. Mira los candidatos y confirma.',
           v_quien, c.monto, v_best.score));
  return 'sin_identificar';
end $fn$;

-- ---------------------------------------------------------
-- 4. La vista, con los costos adentro y el monto aparte
-- ---------------------------------------------------------
-- Va DROP y no "create or replace": la vista empieza con e.*, y como excepciones acaba de ganar
-- la columna linea_costo_id, ese * expande una columna mas y corre de lugar a todas las que
-- siguen. Postgres rechaza un replace que cambie el orden o el nombre de las columnas
-- ("cannot change name of view column"). Sin cascade a proposito: si algo dependiera de la
-- vista, prefiero que falle y mirarlo a que se lo lleve puesto en silencio.
drop view if exists v_excepciones;

create view v_excepciones as
select e.*,
       coalesce(l.reporte_id, lc.reporte_id)                              as reporte_id,
       l.numero_poliza_crudo,
       coalesce(l.nombre_asegurado_crudo, lc.asegurado_crudo, lc.conductor_crudo) as nombre_asegurado_crudo,
       l.productor_crudo,
       l.monto,
       coalesce(l.fecha_statement, lc.fecha_orden)                        as fecha_statement,
       coalesce(l.score, lc.score)                                        as score,
       coalesce(l.regla_match, lc.regla_match)                            as regla_match,
       coalesce(l.estado, lc.estado)                                      as estado_linea,
       coalesce(l.agente_id, lc.agente_id)                                as agente_sugerido_id,
       coalesce(ag.nombre, agc.nombre)                                    as agente_sugerido,
       coalesce(l.oficina_id, lc.oficina_id)                              as oficina_sugerida_id,
       coalesce(o.nombre, oc.nombre)                                      as oficina_sugerida,
       coalesce(a.nombre, ac.nombre)                                      as aseguradora,
       coalesce(r.aseguradora_id, rc.aseguradora_id)                      as aseguradora_id,
       (current_date - e.created_at::date) as antiguedad_dias,
       ((current_date - e.created_at::date) >= cfg_num('dias_atrasada', 10)) as atrasada,
       lv.cliente_nombre_crudo as venta_cliente, lv.agente_nombre_crudo as venta_agente, lv.numero_poliza as venta_poliza,
       -- El importe del cargo viaja SOLO aca. monto se queda nulo para que ningun total que hoy
       -- suma v_excepciones.monto cambie: esa columna es comision que deben, esta es un gasto.
       lc.monto                                                           as monto_costo,
       lc.conductor_crudo                                                 as costo_conductor,
       lc.estado_us                                                       as costo_estado_us,
       lc.es_comercial                                                    as costo_es_comercial
from excepciones e
left join lineas_comision l on l.id = e.linea_comision_id
left join lineas_costo lc on lc.id = e.linea_costo_id
left join reportes r on r.id = coalesce(l.reporte_id, (select reporte_id from lineas_venta where id = e.linea_venta_id))
left join reportes rc on rc.id = lc.reporte_id
left join aseguradoras a on a.id = r.aseguradora_id
left join aseguradoras ac on ac.id = rc.aseguradora_id
left join agentes ag on ag.id = l.agente_id
left join agentes agc on agc.id = lc.agente_id
left join oficinas o on o.id = l.oficina_id
left join oficinas oc on oc.id = lc.oficina_id
left join lineas_venta lv on lv.id = e.linea_venta_id;

-- SIN ESTO LA VISTA QUEDA ABIERTA. La migracion 20260915000001 le puso security_invoker = on,
-- que hace que la RLS se evalue con el usuario que consulta y no con el dueno de la vista. Un
-- DROP se lleva esa propiedad: recrearla sin reponerla dejaria v_excepciones devolviendo filas
-- saltandose las politicas, y nadie se enteraria porque la pantalla se veria igual.
alter view v_excepciones set (security_invoker = on);

-- ---------------------------------------------------------
-- 5. Resolverla
-- ---------------------------------------------------------
-- resolver_excepcion() la llama toda la pantalla de Conciliacion y maneja siete acciones sobre
-- comisiones. Los costos entran por una rama que sale por la puerta de adelante ANTES de tocar
-- nada de eso: el camino de las comisiones queda igual, letra por letra.
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
    -- Se lo come la agencia. Sin oficina, igual que un cargo de la compania (20261003000003):
    -- si no se sabe quien lo pidio, no se le puede descontar a nadie.
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

  return jsonb_build_object('ok', true, 'linea_costo_id', c.id, 'accion', p_accion);
end $fn$;

comment on function resolver_costo is
  'Resuelve a mano una excepcion de un cargo (MVR): asignar a un agente, mandarlo a cuenta de la '
  'casa, o descartarlo. Separada de resolver_excepcion() a proposito: esa maneja comisiones y no '
  'hay razon para arriesgarla.';

-- ---------------------------------------------------------
-- 6. Lo que ya se cargo y quedo mudo
-- ---------------------------------------------------------
-- Si ya habia costos sin identificar de antes de esta migracion, se les abre la excepcion ahora.
-- Hoy esto no toca nada (no hay ningun MVR cargado todavia), pero deja el sistema consistente si
-- alguien subio uno entre las dos migraciones.
insert into excepciones (tipo, linea_costo_id, candidatos, explicacion)
select 'sin_identificar', c.id, c.candidatos,
       format('MVR de %s por $%s sin identificar.',
              coalesce(nullif(btrim(coalesce(c.asegurado_crudo,'')),''), c.conductor_crudo, 'sin nombre'),
              c.monto)
  from lineas_costo c
 where c.estado = 'sin_identificar'
   and not exists (select 1 from excepciones x
                    where x.linea_costo_id = c.id and x.estado = 'pendiente');

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_name = 'excepciones' and column_name = 'linea_costo_id')      as columna_en_excepciones,
  (select count(*) from information_schema.columns
    where table_name = 'v_excepciones' and column_name = 'monto_costo')       as monto_costo_en_la_vista,
  (select count(*) from pg_proc
    where proname in ('abrir_excepcion_costo', 'resolver_costo'))             as funciones_nuevas_de_2,
  (select count(*) from excepciones where linea_costo_id is not null)         as excepciones_de_costo_abiertas,
  -- lo que importa: que ningun total existente se haya movido
  (select count(*) from v_excepciones where monto is not null)                as filas_con_monto_de_comision;
