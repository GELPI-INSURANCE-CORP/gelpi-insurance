-- =========================================================
-- El archivo no decide quien paga el MVR
-- =========================================================
-- Arturo, 9 de octubre de 2026, dos cosas el mismo dia y son la misma cosa:
--
--   "Cuando estoy mirando la parte de cargos por MVR no me deja ni seleccionar por oficina ni
--    que oficina ni quien, y yo tengo que descontarle ese dinero a la agencia. Necesito saber
--    que cantidad le pertenece al Doral, a Miami Lakes, a cada uno."
--
--   "Mucho cuidado con el reporte de National General, porque Thalia hace las cotizaciones y
--    aparece el MVR corrido bajo mi nombre. Es muy importante que matcheen los clientes contra
--    los clientes de Thalia, porque ella puede estar trabajando como usuario y me estas
--    cobrando el MVR a mi."
--
-- La pantalla solo mostraba "sin identificar" porque era TODO lo que habia: los 389 cargos de
-- Progressive entraron sin un solo nombre (eso se arregla en la funcion de extraccion) y, aun
-- con nombres, matchear_costo() se rendia demasiado pronto. Esta migracion arregla el cruce y
-- agrega el reporte por oficina y por agente.

-- ---------------------------------------------------------
-- 1. El productor que viene en el archivo
-- ---------------------------------------------------------
-- Se guarda, pero como PISTA. Que un dato exista no lo hace cierto, y este en particular ya se
-- probo falso en tres compañias: GEICO manda el mismo codigo bajo once nombres distintos,
-- Kemper manda uno solo para toda la agencia, y National General manda el usuario que estaba
-- logueado y no el que vendio.
alter table lineas_costo add column if not exists agente_texto text;

comment on column lineas_costo.agente_texto is
  'Productor tal cual lo trae el archivo de la compania. NO es la verdad sobre quien ordeno el '
  'cargo: se usa solo cuando el cliente no aparece en ninguna cotizacion, y nunca cuando apunta '
  'al usuario compartido. Quien manda es el cruce contra el cliente.';

-- ---------------------------------------------------------
-- 2. El usuario bajo el que cotizan otros
-- ---------------------------------------------------------
-- En vez de escribir "ARTURO GELPI" en el codigo -- que es exactamente el tipo de cosa que
-- despues nadie encuentra -- se marca la condicion: este agente es un usuario que otros usan.
-- Hoy es el de la casa; si mañana una oficina comparte otro, se marca y la regla ya funciona.
alter table agentes add column if not exists productor_compartido boolean not null default false;

comment on column agentes.productor_compartido is
  'Otros agentes cotizan logueados bajo este usuario, asi que los archivos de las compañias le '
  'atribuyen a el trabajo ajeno. Cuando un cargo solo se puede atribuir por el productor del '
  'archivo y el productor es este, el sistema para y pregunta en vez de cobrarselo.';

update agentes set productor_compartido = true where es_casa and not productor_compartido;

-- ---------------------------------------------------------
-- 3. El cruce, con las cinco salidas en orden
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
  v_compania text;
  v_score numeric := 0;
  v_prod_id uuid;
  v_prod agentes%rowtype;
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = c.reporte_id;

  v_compania := coalesce((select a.nombre from aseguradoras a where a.id = r.aseguradora_id), 'la compania');
  v_quien := coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo, 'sin nombre');

  -- SALIDA 0: no hay nombre ninguno.
  -- Antes se salia aca con cualquier cargo marcado "comercial", y era demasiado pronto:
  -- "comercial" solo quiere decir que el asegurado viene en blanco, y el conductor -- que es una
  -- persona real y aparece en las cotizaciones igual que cualquier otra -- se tiraba a la
  -- basura. Con National General eso seria el archivo ENTERO: no trae asegurado, trae Drivers
  -- Name y nada mas. Ahora se para solo cuando de verdad no hay con que buscar.
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

  -- Candidatos: el cliente del cargo contra los clientes de las cotizaciones del mes. El
  -- coalesce del nombre es lo que hace que un cargo sin asegurado se busque por el conductor en
  -- vez de compararse contra vacio y sacar cero siempre.
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
               100 * similarity(coalesce(q.nombre_normalizado, ''),
                                coalesce(c.nombre_normalizado, c.conductor_norm, ''))
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

    -- SALIDA 1: el cliente aparece en las cotizaciones. Esta es la buena y la que manda.
    if v_score >= v_umbral then
      update lineas_costo set estado = 'conciliado_auto', regla_match = 'cotizacion',
        score = v_score, candidatos = v_cands, cotizacion_id = v_best.cotizacion_id,
        agente_id = v_best.agente_id, oficina_id = v_best.oficina_id
       where id = c.id;
      return 'conciliado_auto';
    end if;
  end if;

  -- El productor del archivo: ultimo recurso, y solo si el cliente no aparecio.
  if nullif(btrim(coalesce(c.agente_texto, '')), '') is not null then
    v_prod_id := agente_por_texto(c.agente_texto);
  end if;

  if v_prod_id is not null then
    select * into v_prod from agentes where id = v_prod_id;

    -- SALIDA 2: el archivo nombra al usuario compartido. NO se le cree.
    --
    -- Este es el freno que pidio Arturo. Cuando el archivo nombra a un agente cualquiera le
    -- creemos, porque nadie cotiza logueado bajo el usuario de otro agente. Cuando nombra al
    -- usuario compartido -- el de la casa, donde se loguea todo el mundo -- es justo el caso en
    -- que el archivo miente, y creerle seria cobrarle a Arturo el trabajo de Thalia. Se para.
    if v_prod.es_casa or v_prod.productor_compartido then
      update lineas_costo set estado = 'sin_identificar', regla_match = 'productor_compartido',
        score = v_score, candidatos = v_cands where id = c.id;
      perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
        format('MVR de %s por $%s. El archivo de %s dice que lo ordeno %s, pero ese es el usuario '
               || 'compartido: otros agentes cotizan logueados ahi, asi que el cargo saldria a '
               || 'nombre de la casa aunque el trabajo sea de otro. El cliente tampoco aparece en '
               || 'las cotizaciones. Decidi vos de quien es.',
               v_quien, c.monto, v_compania, v_prod.nombre));
      return 'sin_identificar';
    end if;

    -- SALIDA 3: el archivo nombra a un agente propio. Vale, y queda dicho de donde salio.
    update lineas_costo set estado = 'conciliado_auto', regla_match = 'productor_del_archivo',
      score = v_score, candidatos = v_cands,
      agente_id = v_prod.id, oficina_id = v_prod.oficina_id
     where id = c.id;
    return 'conciliado_auto';
  end if;

  -- SALIDA 4: no se pudo. Con candidatos o sin ellos, pero siempre visible.
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

  update lineas_costo set estado = 'sin_identificar', regla_match = 'score_bajo',
    score = v_score, candidatos = v_cands where id = c.id;
  perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
    format('MVR de %s por $%s. El parecido mas alto contra las cotizaciones es %s%%, por debajo '
           || 'del minimo para asignarlo solo. Mira los candidatos y confirma.',
           v_quien, c.monto, v_score));
  return 'sin_identificar';
end $fn$;

comment on function matchear_costo is
  'Decide de quien es un cargo por MVR, en este orden: (1) el cliente contra las cotizaciones '
  'del mes; (2) si el cliente no aparece y el archivo nombra un productor propio, ese; (3) si '
  'nombra al usuario compartido, PARA y pregunta, porque ahi es donde el archivo miente. Sin '
  'nombre no se adivina: se abre excepcion.';


-- ---------------------------------------------------------
-- 4. El reporte que hay que poder sacar
-- ---------------------------------------------------------
-- Una fila por oficina y agente, con lo que hay que descontarle a cada uno. Y lo que todavia no
-- se sabe de quien es VIENE EN EL MISMO REPORTE, no en otra pantalla: sacar plata de un total
-- sin que se vea en ningun lado ya paso dos veces en este sistema y las dos se tuvo que dar
-- cuenta Arturo. Si falta decidir algo, que se vea al lado de lo decidido.
--
-- El agrupado va en una subconsulta y el orden afuera porque "repartido / cuenta de la casa /
-- falta decidir" no ordena bien por alfabeto, y ordenar por el estado crudo no se puede: no
-- esta en el group by.
create or replace function mvr_reparto(p_desde date, p_hasta date)
returns table (
  oficina_id uuid,
  oficina    text,
  agente_id  uuid,
  agente     text,
  compania   text,
  reparto    text,
  cargos     bigint,
  con_cargo  bigint,
  personas   bigint,
  monto      numeric
)
language sql stable as $fn$
  select t.oficina_id, t.oficina, t.agente_id, t.agente, t.compania, t.reparto,
         t.cargos, t.con_cargo, t.personas, t.monto
    from (
      select
        l.oficina_id                                              as oficina_id,
        coalesce(o.nombre, 'FALTA DECIDIR LA OFICINA')            as oficina,
        l.agente_id                                               as agente_id,
        coalesce(a.nombre, 'Falta decidir el agente')             as agente,
        coalesce(asg.nombre, 'Sin compania')                      as compania,
        case when l.estado in ('conciliado_auto', 'conciliado_confirmado') then 'repartido'
             when l.estado = 'cuenta_casa' then 'cuenta de la casa'
             else 'falta decidir' end                             as reparto,
        count(*)                                                  as cargos,
        count(*) filter (where l.monto > 0)                       as con_cargo,
        count(distinct coalesce(l.nombre_normalizado,
                                l.conductor_norm))                as personas,
        round(coalesce(sum(l.monto), 0), 2)                       as monto
      from lineas_costo l
      join reportes r on r.id = l.reporte_id
      left join aseguradoras asg on asg.id = r.aseguradora_id
      left join oficinas o on o.id = l.oficina_id
      left join agentes a on a.id = l.agente_id
      where l.estado <> 'descartado'
        and coalesce(mes_del_periodo(r.periodo), l.fecha_orden, l.created_at::date)
            between p_desde and p_hasta
      group by 1, 2, 3, 4, 5, 6
    ) t
   order by case t.reparto when 'repartido' then 0
                           when 'cuenta de la casa' then 1
                           else 2 end,
            t.oficina, t.monto desc;
$fn$;

comment on function mvr_reparto is
  'Cuanto MVR le toca a cada oficina y a cada agente en un rango de fechas, con lo que todavia '
  'falta decidir incluido en el mismo reporte para que no desaparezca de ningun total.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- 5. Reprocesar lo que ya esta cargado
-- ---------------------------------------------------------
-- Ojo: esto vuelve a CRUZAR, no vuelve a LEER el archivo. Los 389 cargos de Progressive estan en
-- la base sin nombre, y el nombre no esta en ningun lado para recuperarlo: lineas_costo no
-- guarda la fila cruda. Ese archivo hay que volver a subirlo con la funcion ya corregida. Esto
-- sirve para los que si tienen nombre y para todo lo que entre de ahora en adelante.
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
  (select count(*) from information_schema.columns
    where table_name = 'lineas_costo' and column_name = 'agente_texto')      as col_agente_texto,
  (select count(*) from information_schema.columns
    where table_name = 'agentes' and column_name = 'productor_compartido')   as col_prod_compartido,
  (select string_agg(nombre, ', ') from agentes where productor_compartido)  as usuario_compartido,
  (select count(*) from pg_proc where proname = 'mvr_reparto')               as funcion_del_reporte,
  (select count(*) from lineas_costo)                                        as cargos_cargados,
  (select count(*) from lineas_costo
    where asegurado_crudo is not null or conductor_crudo is not null)        as cargos_con_nombre;
