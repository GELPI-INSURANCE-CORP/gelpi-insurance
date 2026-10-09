-- =========================================================
-- El cliente se busca tambien en el Book
-- =========================================================
-- Para que la regla de National General sirva de verdad.
--
-- El archivo de NatGen de agosto trae 73 cargos y 31 de ellos vienen firmados "Arturo Gelpi",
-- que es justo lo que el advirtio: Thalia cotiza logueada con su usuario. El freno que se puso
-- en 20261009000006 los para a los 31, que esta bien -- es mejor parar que cobrarle mal -- pero
-- deja 31 decisiones a mano que en su mayoria la base ya puede resolver sola.
--
-- Porque ademas los Order Date de ese archivo son de JULIO, y el QuoteReport cargado es el de
-- septiembre. Buscando solo contra las cotizaciones del mes, esos clientes no aparecen nunca.
-- Pero si aparecen en el Book: son clientes de la agencia, con su poliza y su agente.
--
-- Asi que el orden pasa a ser: cotizaciones del mes, despues el BOOK, y recien al final el
-- productor del archivo. El productor queda donde tiene que estar -- ultimo -- y "machear los
-- clientes contra los clientes de Thalia", que es lo que pidio, pasa a hacerse de verdad.

create or replace function agente_de_la_poliza_del_cliente(
  p_nombre text, p_aseguradora_id uuid
) returns jsonb
language sql stable as $fn$
  -- Un cliente puede tener polizas con varios agentes (cambio de oficina, un auto con uno y la
  -- casa con otro). Gana la de la misma compania que el cargo, y entre esas la mas reciente:
  -- el MVR se corrio para una poliza de ESA compania, no para otra.
  select jsonb_build_object(
           'cliente_id', t.cliente_id, 'nombre', t.nombre, 'poliza_id', t.poliza_id,
           'agente_id', t.agente_id, 'oficina_id', t.oficina_id, 'score', t.score)
    from (
      select cl.id as cliente_id, cl.nombre_normalizado as nombre, p.id as poliza_id,
             p.agente_id, p.oficina_id,
             round((100 * similarity(cl.nombre_normalizado, p_nombre)
                    + case when p.aseguradora_id = p_aseguradora_id then 12 else 0 end)::numeric, 1) as score
        from clientes cl
        join polizas p on p.cliente_id = cl.id and p.agente_id is not null
       where p_nombre is not null
         and cl.nombre_normalizado % p_nombre
       order by score desc,
                (p.aseguradora_id = p_aseguradora_id) desc nulls last,
                p.fecha_vigencia desc nulls last
       limit 1
    ) t;
$fn$;

comment on function agente_de_la_poliza_del_cliente is
  'Busca un nombre entre los clientes del Book y devuelve el agente y la oficina de su poliza. '
  'Se usa para atribuir un cargo por MVR cuando el cliente no esta en las cotizaciones del mes '
  '-- tipico de renovaciones y de archivos de meses viejos. Devuelve null si no hay parecido.';

-- ---------------------------------------------------------
-- El cruce, ahora con cinco salidas
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
begin
  select * into c from lineas_costo where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = c.reporte_id;

  v_compania := coalesce((select a.nombre from aseguradoras a where a.id = r.aseguradora_id), 'la compania');
  v_quien := coalesce(nullif(btrim(coalesce(c.asegurado_crudo, '')), ''), c.conductor_crudo, 'sin nombre');
  v_nombre := nullif(coalesce(c.nombre_normalizado, c.conductor_norm, ''), '');

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

  -- SALIDA 2: el cliente esta en el Book.
  --
  -- Segunda y no tercera: el Book dice de quien es el cliente, y eso vale mas que lo que diga
  -- el archivo de la compania sobre quien aprieto el boton. Es ademas la unica salida para los
  -- MVR de renovaciones y para los archivos de meses viejos -- el de National General de agosto
  -- tiene las ordenes en julio y el QuoteReport cargado es de septiembre, asi que por las
  -- cotizaciones no aparece ni uno.
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

    -- SALIDA 3: el archivo nombra al usuario compartido. NO se le cree.
    --
    -- El freno que pidio Arturo. Cuando el archivo nombra a un agente cualquiera le creemos,
    -- porque nadie cotiza logueado bajo el usuario de otro agente. Cuando nombra al usuario
    -- compartido -- el de la casa, donde se loguea todo el mundo -- es justo el caso en que el
    -- archivo miente, y creerle seria cobrarle a Arturo el trabajo de Thalia. Se para.
    if v_prod.es_casa or v_prod.productor_compartido then
      update lineas_costo set estado = 'sin_identificar', regla_match = 'productor_compartido',
        score = v_score, candidatos = v_cands where id = c.id;
      perform abrir_excepcion_costo('sin_identificar', c.id, v_cands,
        format('MVR de %s por $%s. El archivo de %s dice que lo ordeno %s, pero ese es el usuario '
               || 'compartido: otros agentes cotizan logueados ahi, asi que el cargo saldria a '
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

comment on function matchear_costo is
  'Decide de quien es un cargo por MVR, en este orden: (1) el cliente contra las cotizaciones '
  'del mes; (2) el cliente contra el Book; (3) si no aparece en ninguno y el archivo nombra un '
  'productor propio, ese; (4) si nombra al usuario compartido, PARA y pregunta, porque ahi es '
  'donde el archivo miente. Sin nombre no se adivina: se abre excepcion.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Reprocesar
-- ---------------------------------------------------------
-- Esto si sirve de verdad ahora: los cargos ya tienen nombre, asi que volver a cruzar puede
-- rescatar contra el Book los que habian quedado sin dueno.
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
  coalesce(c.regla_match, '(sin regla)')                as por_que,
  count(*)                                              as cargos,
  round(sum(c.monto), 2)                                as monto
from lineas_costo c
group by 1
order by 2 desc;
