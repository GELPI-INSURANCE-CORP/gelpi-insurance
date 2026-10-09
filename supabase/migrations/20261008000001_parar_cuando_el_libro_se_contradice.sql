-- =========================================================
-- Parar cuando el libro se contradice
-- =========================================================
-- Arturo, sobre la poliza de MAYRA LOPEZ HERRERA en el statement de GEICO de septiembre:
--
--   "La poliza de Mayra Lopez Herrera estaba puesta bajo Thalia. El sistema lo capto pero tienes
--    que entrenarlo para que no lo haga mas, porque vino con el Book de Miami Lakes y con la
--    agente de Thalia. Tienes que parar cuando eso pase para yo hacerlo manual, porque Thalia no
--    esta en Miami Lakes y esas cosas joden el sistema."
--
-- LO QUE PASO DE VERDAD. La poliza 6249493203 entro al Book con oficina = Miami Lakes y
-- agente = Thalia Rodriguez, que esta en Doral. matchear_linea() la concilio sola, copiando de
-- la fila del Book el agente (Thalia) Y la oficina (Miami Lakes). Y ahi la plata se partio en
-- dos, porque las dos funciones que reparten NO miran la misma oficina:
--
--   liquidacion_negocio_nuevo()   ->  join oficinas on id = a.oficina_id      ->  la del AGENTE
--   royalty_por_oficina()         ->  coalesce(v.oficina_id, a.oficina_id)    ->  la de la POLIZA
--
-- Resultado: el royalty se lo cobraba Miami Lakes y el pago del agente se lo llevaba Doral. Una
-- sola poliza pagandole a dos oficinas. Son 7 lineas, y su neto es $0 -- tres pares de +/-213.96
-- mas un -27.21 -- asi que no se veia en ningun total: solo aparecia al cuadrar oficina por
-- oficina, que es lo que Arturo estaba haciendo a mano cuando lo encontro.
--
-- POR QUE AHORA SI VA UN FRENO Y NO SOLO UNA ALARMA. La migracion 20261002000002 creo la alerta
-- 'oficina_cruzada' y decidio a proposito no frenar el matcheo, con este razonamiento:
--
--   "matchear_linea() copia agente Y oficina de la MISMA fila de polizas, asi que entre esos dos
--    nunca pueden discrepar. Frenar el matcheo seria poner el candado en la puerta que no es."
--
-- Eso es cierto para la LINEA, y era un buen argumento. Lo que no vio es que la FILA DEL BOOK
-- puede venir contradictoria de fabrica: agente de una oficina, oficina de otra. Copiar los dos
-- campos fielmente de una fila incoherente produce una linea incoherente. El candado estaba en
-- la puerta de al lado, y por esta entro la poliza de Mayra.
--
-- La alarma sigue sirviendo y no se toca: avisa antes de pagar sobre lo que YA esta cargado.
-- Esto es lo otro -- que no entre mas -- y las dos cosas se necesitan.
--
-- POR QUE 'mismatch' Y NO OTRO ESTADO. Porque frena la plata en los DOS lados: tanto
-- liquidacion_negocio_nuevo() como royalty_por_oficina() y royalty_detalle_por_compania()
-- filtran estado in ('conciliado_auto','conciliado_confirmado'). Una linea en 'mismatch' no le
-- paga al agente ni le da royalty a ninguna oficina hasta que Arturo decida.
--
-- POR QUE ADEMAS abrir_excepcion() Y NO SOLO EL ESTADO. Porque la pantalla de Conciliacion lee
-- v_excepciones con estado = 'pendiente' (src/lib/queries/conciliacion.ts). Poner la linea en
-- 'mismatch' sin abrir la excepcion la sacaria del total SIN que aparezca en ninguna pantalla:
-- plata que se esfuma en silencio, que es peor que el error original. Por eso esto va dentro de
-- matchear_linea(), donde los dos pasos ya van siempre juntos, y no como trigger.
--
-- QUE SE TOCA Y QUE NO. Solo las TRES salidas que concilian solas -- 'herencia_chargeback',
-- 'chargeback_por_book' y 'poliza_exacta'. Los pasos 4 (asegurado+vigencia) y 5 (fuzzy) quedan
-- identicos letra por letra: ya devuelven 'mismatch' y ya abren excepcion, asi que esa plata ya
-- estaba frenada y no hay nada que arreglar ahi.

-- ---------------------------------------------------------
-- El guardia
-- ---------------------------------------------------------
create or replace function libro_contradice_oficina(p_poliza_id uuid) returns text
language sql stable as $fn$
  select format(
           'El Book se contradice con esta poliza: esta marcada en %s, pero su agente %s figura '
           'en %s. O la poliza ya no es de ese agente, o la oficina quedo vieja. Mientras no se '
           'resuelva, el royalty lo cobraria una oficina y el pago del agente se lo llevaria la '
           'otra, asi que esta linea no cuenta para ninguna de las dos. Elegi a mano de quien es.',
           coalesce(op.nombre, 'ninguna oficina'),
           a.nombre,
           coalesce(oa.nombre, 'ninguna oficina'))
    from polizas p
    join agentes a on a.id = p.agente_id
    left join oficinas op on op.id = p.oficina_id
    left join oficinas oa on oa.id = a.oficina_id
   where p.id = p_poliza_id
     and p.oficina_id is distinct from a.oficina_id;
$fn$;

comment on function libro_contradice_oficina is
  'Devuelve el motivo si la fila del Book para esa poliza es incoherente -- la oficina de la '
  'poliza no es la del agente que la tiene -- y null si esta bien. Caso real: la poliza de Mayra '
  'Lopez Herrera, marcada en Miami Lakes con Thalia Rodriguez (Doral) como agente.';

-- ---------------------------------------------------------
-- matchear_linea() con el freno en las tres salidas que concilian solas
-- ---------------------------------------------------------
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
  v_contra text;
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then return 'no_existe'; end if;
  select * into r from reportes where id = l.reporte_id;

  -- Paso 7 (compuerta): duplicado exacto en los últimos 12 meses (otra línea con la
  -- misma clave), salvo que el usuario ya haya aceptado explícitamente este par con
  -- 'mantener_ambas' (duplicado_par_id en cualquiera de las dos direcciones).
  select id into v_dup from lineas_comision
   where clave_duplicado = l.clave_duplicado and id <> l.id and estado <> 'descartado'
     -- Dentro del mismo archivo, lo que la compañía manda dos veces lo pagó dos veces y está
     -- en su total: marcarlo obliga a revisar a mano plata ya declarada. Lo que esta regla
     -- tiene que atrapar es el mismo statement subido dos veces, y eso sigue igual.
     and reporte_id <> l.reporte_id
     and created_at > now() - interval '12 months'
     and id <> coalesce(l.duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid) <> l.id
   order by created_at limit 1;
  if v_dup is not null then
    update lineas_comision set estado = 'duplicado_sospechoso', regla_match = 'duplicado_exacto' where id = l.id;
    perform abrir_excepcion('duplicado', l.id,
      jsonb_build_object('linea_relacionada_id', v_dup),
      'Misma aseguradora, póliza, asegurado, vigencia, tipo y monto que una línea de OTRO reporte ya cargado.', v_dup);
    return 'duplicado_sospechoso';
  end if;

  -- Paso 6: chargebacks / ajustes heredan de la línea original
  if l.monto < 0 or l.tipo_transaccion in ('cancelacion','ajuste') then
    select * into v_orig from lineas_comision
     where numero_normalizado = l.numero_normalizado and id <> l.id and monto > 0
       and estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') and agente_id is not null
     order by created_at desc limit 1;
    if found then
      -- FRENO 1: no heredar de una línea colgada de una póliza que el Book tiene incoherente.
      v_contra := libro_contradice_oficina(v_orig.poliza_id);
      if v_contra is not null then
        update lineas_comision set estado = 'mismatch', regla_match = 'libro_contradice_oficina', score = 100,
          poliza_id = v_orig.poliza_id, linea_original_id = v_orig.id,
          candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_orig.poliza_id, 'agente_id', v_orig.agente_id, 'oficina_id', v_orig.oficina_id, 'score', 100))
         where id = l.id;
        perform abrir_excepcion('mismatch', l.id,
          jsonb_build_array(jsonb_build_object('poliza_id', v_orig.poliza_id, 'agente_id', v_orig.agente_id, 'oficina_id', v_orig.oficina_id, 'score', 100)),
          'Es una cancelación o ajuste que iba a heredar de la línea original. ' || v_contra, v_orig.id);
        return 'mismatch';
      end if;
      update lineas_comision set estado = 'conciliado_auto', regla_match = 'herencia_chargeback', score = 100,
        poliza_id = v_orig.poliza_id, agente_id = v_orig.agente_id, oficina_id = v_orig.oficina_id, linea_original_id = v_orig.id
       where id = l.id;
      return 'conciliado_auto';
    end if;

    -- Sin línea original: el Book sabe de quién es la póliza. Antes esto devolvía 'en_espera'
    -- directamente y la plata quedaba sin dueño teniendo el dato a la vista.
    if l.numero_normalizado is not null then
      select * into v_pol from polizas
       where numero_normalizado = l.numero_normalizado
         and (r.aseguradora_id is null or mismo_grupo(aseguradora_id, r.aseguradora_id))
       order by (aseguradora_id = r.aseguradora_id) desc nulls last, updated_at desc limit 1;
      if found and v_pol.agente_id is not null then
        -- FRENO 2: el Book dice de quién es, pero se contradice a sí mismo.
        v_contra := libro_contradice_oficina(v_pol.id);
        if v_contra is not null then
          update lineas_comision set estado = 'mismatch', regla_match = 'libro_contradice_oficina', score = 95,
            poliza_id = v_pol.id,
            candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 95))
           where id = l.id;
          perform abrir_excepcion('mismatch', l.id,
            jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 95)),
            'Es una cancelación o ajuste sin línea original. ' || v_contra);
          return 'mismatch';
        end if;
        update lineas_comision set estado = 'conciliado_auto', regla_match = 'chargeback_por_book', score = 95,
          poliza_id = v_pol.id, agente_id = v_pol.agente_id, oficina_id = v_pol.oficina_id
         where id = l.id;
        return 'conciliado_auto';
      end if;
      -- La póliza está en el Book pero sin agente: eso no es "esperar", es un dato que falta y
      -- que el usuario puede completar. Se dice cuál es el problema en vez de dejarla muda.
      if found then
        update lineas_comision set estado = 'sin_identificar', regla_match = 'chargeback_poliza_sin_agente',
          score = 90, poliza_id = v_pol.id where id = l.id;
        perform abrir_excepcion('sin_identificar', l.id, jsonb_build_object('poliza_id', v_pol.id),
          'Es una cancelación o ajuste. La póliza está en el Active Business Book pero no tiene agente asignado.');
        return 'sin_identificar';
      end if;
    end if;

    update lineas_comision set estado = 'en_espera', regla_match = 'chargeback_sin_original' where id = l.id;
    return 'en_espera';
  end if;
  v_alias := es_alias_agencia(l.productor_crudo);

  -- Paso 2: match exacto por número de póliza
  if l.numero_normalizado is not null then
    select * into v_pol from polizas
     where numero_normalizado = l.numero_normalizado
       and (r.aseguradora_id is null or mismo_grupo(aseguradora_id, r.aseguradora_id))
     order by (aseguradora_id = r.aseguradora_id) desc nulls last, updated_at desc limit 1;
    if found then
      if v_pol.agente_id is null then
        update lineas_comision set estado = 'sin_identificar', regla_match = 'poliza_sin_agente', score = 100, poliza_id = v_pol.id where id = l.id;
        perform abrir_excepcion('sin_identificar', l.id, jsonb_build_object('poliza_id', v_pol.id),
          'La póliza existe en el Active Business Book pero no tiene agente ni oficina asignados.');
        return 'sin_identificar';
      end if;
      -- FRENO 3: el número matcheó exacto, pero la fila del Book es incoherente. Este es el caso
      -- de Mayra Lopez Herrera, y el que más plata mueve porque es la ruta normal de GEICO.
      v_contra := libro_contradice_oficina(v_pol.id);
      if v_contra is not null then
        update lineas_comision set estado = 'mismatch', regla_match = 'libro_contradice_oficina', score = 100,
          poliza_id = v_pol.id,
          candidatos = jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 100))
         where id = l.id;
        perform abrir_excepcion('mismatch', l.id,
          jsonb_build_array(jsonb_build_object('poliza_id', v_pol.id, 'agente_id', v_pol.agente_id, 'oficina_id', v_pol.oficina_id, 'score', 100)),
          'El número de póliza matcheó exacto. ' || v_contra);
        return 'mismatch';
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
     where (c.nombre_normalizado = l.nombre_asegurado_normalizado
            or c.nombre_ordenado = normalizar_nombre_ordenado(l.nombre_asegurado_crudo))
       and (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
       and (l.fecha_vigencia is null or p.fecha_vigencia is null or abs(p.fecha_vigencia - l.fecha_vigencia) <= v_ventana);
    if v_n = 1 then
      select p.* into v_pol from polizas p join clientes c on c.id = p.cliente_id
       where (c.nombre_normalizado = l.nombre_asegurado_normalizado
            or c.nombre_ordenado = normalizar_nombre_ordenado(l.nombre_asegurado_crudo))
         and (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
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
    where (r.aseguradora_id is null or mismo_grupo(p.aseguradora_id, r.aseguradora_id))
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

comment on function matchear_linea is
  'Reparte una línea de comisión contra el Active Business Book. Antes de conciliar sola contra '
  'una póliza, frena si el Book se contradice para esa póliza (la oficina de la póliza no es la '
  'del agente): la deja en "mismatch" y abre excepción, porque si no el royalty lo cobra una '
  'oficina y el pago del agente se lo lleva la otra. Ver 20261008000001.';

-- ---------------------------------------------------------
-- Que hay cargado hoy con este problema
-- ---------------------------------------------------------
-- Solo informa. NO reprocesa nada: mover lineas ya conciliadas ahora mismo le cambiaria los
-- totales a Arturo en medio del cierre de septiembre, y eso lo decide el.
-- El agrupado va en un subquery y el string_agg afuera. La primera version los tenia juntos
-- -- count(*) y sum() DENTRO del string_agg -- y Postgres lo rechaza entero con
-- "42803: aggregate function calls cannot be nested". Un agregado no puede contener otro.
select
  coalesce((
    select string_agg(t.linea, '   |   ')
      from (
        select a.nombre || ' (' || coalesce(oa.nombre, 'sin oficina') || ') tiene '
                 || count(*) || ' poliza' || case when count(*) = 1 then '' else 's' end
                 || ' marcada' || case when count(*) = 1 then '' else 's' end
                 || ' en ' || coalesce(op.nombre, 'sin oficina')
                 || ', con ' || coalesce(sum(lc.n), 0)
                 || ' linea' || case when coalesce(sum(lc.n), 0) = 1 then '' else 's' end
                 || ' conciliada' || case when coalesce(sum(lc.n), 0) = 1 then '' else 's' end
                 || ' encima por $' || round(coalesce(sum(lc.com), 0), 2) as linea
          from polizas p
          join agentes a on a.id = p.agente_id
          left join oficinas oa on oa.id = a.oficina_id
          left join oficinas op on op.id = p.oficina_id
          left join lateral (
            select count(*) as n, coalesce(sum(x.monto), 0) as com
              from lineas_comision x
             where x.poliza_id = p.id
               and x.estado in ('conciliado_auto', 'conciliado_confirmado')
          ) lc on true
         where p.oficina_id is distinct from a.oficina_id
         group by a.nombre, oa.nombre, op.nombre
      ) t
  ), 'ninguna: el Book no se contradice en ninguna poliza') as lo_que_ya_estaba_cargado;

notify pgrst, 'reload schema';
