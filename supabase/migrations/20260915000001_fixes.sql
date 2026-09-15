-- Gelpi Insurance · Módulo Comisiones · fixes de auditoría 2026-09-15
-- Hallazgos corregidos:
--  1) matchear_linea(): el Paso 7 (compuerta de duplicados) no cortaba el flujo (faltaba
--     update de estado + return), así que una línea duplicada terminaba también
--     'conciliado_auto' (o heredando un chargeback dos veces) mientras la excepción
--     'duplicado' quedaba pendiente aparte.
--  2) resolver_excepcion(), acción 'mantener_ambas': dependía de un estado
--     'duplicado_sospechoso' que el Paso 7 nunca asignaba, y al no registrar el par
--     ya aceptado, el re-match (matchear_linea) volvía a detectar el mismo duplicado
--     y reabría la excepción en un loop.
--  3) resolver_excepcion(), acción 'descartar_duplicado': sólo resolvía la excepción
--     recibida; una excepción hermana (mismatch/sin_identificar) pendiente o en espera
--     sobre la misma línea quedaba huérfana apuntando a una línea ya 'descartado'.
--  4) resumen_kpis(): 'conciliado' incluye el estado 'cuenta_casa' pero 'por_oficina' y
--     'por_aseguradora' no, así que el total general no cuadraba con la suma de las
--     tarjetas por oficina/aseguradora. Además resolver_excepcion() nunca poblaba
--     oficina_id al resolver a cuenta_casa, así que ese monto no podía aparecer en
--     ninguna oficina aunque se corrigiera el filtro.
--  5) matchear_linea() Paso 2 y procesar_ventas(): la condición de aseguradora tenía
--     una cláusula `aseguradora_id is null` duplicada que dejaba matchear cualquier
--     póliza del ABB sin aseguradora asignada contra un reporte de aseguradora
--     conocida, sin relación real con la aseguradora del reporte/venta.
--  6) RLS "auth_all" (using (true)) en todas las tablas: cualquier autenticado veía
--     y editaba todo vía REST/RPC directo, sin relación con la pantalla de
--     Configuración (que sólo desaconseja por texto crear logins de agente, sin
--     restringir nada a nivel de base). Se acota por agentes.user_id: hoy ningún
--     agente tiene user_id (todos los logins son "de casa"), así que esto no cambia
--     nada del comportamiento actual; el día que se vincule un login a un agente,
--     ese agente queda limitado a su propia info en las tablas sensibles.

-- =========================================================
-- Fix 1/2: par de duplicados aceptados explícitamente por el usuario
-- =========================================================
alter table lineas_comision add column if not exists duplicado_par_id uuid references lineas_comision(id);

-- =========================================================
-- matchear_linea(): Paso 7 ahora corta el flujo (update + return) y excluye el par
-- ya aceptado vía 'mantener_ambas'; Paso 2 ya no tiene la cláusula de aseguradora
-- duplicada.
-- =========================================================
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

  -- Paso 7 (compuerta): duplicado exacto en los últimos 12 meses (otra línea con la
  -- misma clave), salvo que el usuario ya haya aceptado explícitamente este par con
  -- 'mantener_ambas' (duplicado_par_id en cualquiera de las dos direcciones).
  select id into v_dup from lineas_comision
   where clave_duplicado = l.clave_duplicado and id <> l.id and estado <> 'descartado'
     and created_at > now() - interval '12 months'
     and id <> coalesce(l.duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(duplicado_par_id, '00000000-0000-0000-0000-000000000000'::uuid) <> l.id
   order by created_at limit 1;
  if v_dup is not null then
    update lineas_comision set estado = 'duplicado_sospechoso', regla_match = 'duplicado_exacto' where id = l.id;
    perform abrir_excepcion('duplicado', l.id,
      jsonb_build_object('linea_relacionada_id', v_dup),
      'Misma aseguradora, póliza, asegurado, vigencia, tipo y monto que otra línea ya cargada.', v_dup);
    return 'duplicado_sospechoso';
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
       and (r.aseguradora_id is null or aseguradora_id = r.aseguradora_id)
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

-- =========================================================
-- procesar_ventas(): misma cláusula de aseguradora duplicada que en el Paso 2 de
-- matchear_linea(), corregida igual.
-- =========================================================
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

    select * into v_pol from polizas where numero_normalizado = v.numero_normalizado and (v_as is null or aseguradora_id = v_as) limit 1;
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
-- resolver_excepcion(): 'mantener_ambas' ahora registra el par aceptado
-- (duplicado_par_id en ambas direcciones) y vuelve a 'pendiente' para que el
-- re-match no vuelva a chocar con la compuerta del Paso 7; 'descartar_duplicado'
-- cierra también cualquier excepción hermana (mismatch/sin_identificar) que haya
-- quedado pendiente o en espera sobre la misma línea; 'cuenta_casa' ahora también
-- setea oficina_id para que la producción de la cuenta casa aparezca en su oficina.
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
    select id, oficina_id into v_casa, v_of from agentes where es_casa limit 1;
    update lineas_comision set estado = 'cuenta_casa', agente_id = v_casa, oficina_id = coalesce(oficina_id, v_of), regla_match = 'cuenta_casa' where id = l.id;

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
    -- cierra excepciones hermanas (mismo linea_comision_id) que hayan quedado
    -- huérfanas apuntando a una línea que ahora está descartada
    update excepciones set estado = 'resuelta', accion = 'cerrada_por_descartar_duplicado',
      nota = coalesce(nota, 'Cerrada automáticamente: la línea se descartó por duplicado.'),
      resuelta_por = v_usr, resuelta_en = now()
      where linea_comision_id = l.id and estado in ('pendiente','en_espera') and id <> e.id;
  elsif p_accion = 'mantener_ambas' then
    update lineas_comision set estado = 'pendiente', duplicado_par_id = e.linea_relacionada_id where id = l.id;
    if e.linea_relacionada_id is not null then
      update lineas_comision set duplicado_par_id = l.id where id = e.linea_relacionada_id;
    end if;
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

-- =========================================================
-- resumen_kpis(): 'por_oficina' y 'por_aseguradora' ahora incluyen 'cuenta_casa'
-- igual que el total 'conciliado', para que los desgloses cuadren con el total.
-- =========================================================
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
                    left join (select oficina_id, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') group by oficina_id) s on s.oficina_id = o.id
                    left join (select oficina_sugerida_id, count(*) n, round(avg(antiguedad_dias)) dias from ex group by oficina_sugerida_id) x on x.oficina_sugerida_id = o.id),
    'por_aseguradora', (select coalesce(jsonb_agg(jsonb_build_object('aseguradora', aseguradora, 'comision', monto) order by monto desc), '[]'::jsonb)
                        from (select aseguradora, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') group by aseguradora) t),
    'agentes_con_comision', (select count(distinct agente_id) from lc where agente_id is not null)
  );
$$;

-- =========================================================
-- Fix 6: RLS real por agente (agentes.user_id), no sólo "auth_all using (true)".
-- mi_agente_id() resuelve el usuario logueado -> agentes.id. Si no hay match (todos
-- los logins de hoy son "de casa"/admin, ninguno con agentes.user_id seteado) el
-- resultado es null y las políticas quedan igual de abiertas que hoy: cero cambio
-- de comportamiento para el uso actual. Sólo cuando exista un login vinculado a un
-- agentes.user_id ese agente queda acotado a su propia info. Las escrituras que
-- necesita el flujo actual pasan por RPCs `security definer` (resolver_excepcion,
-- reasignar_linea, matchear_linea vía procesar_matching/procesar_ventas ejecutados
-- por el admin) y no se ven afectadas; un agente individual queda sin permiso de
-- escritura directa por REST fuera de su propio alcance (with check), que es la
-- postura segura por defecto hasta que se diseñe ese flujo.
-- =========================================================
create or replace function mi_agente_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from agentes where user_id = auth.uid() limit 1;
$$;

drop policy if exists "auth_all" on public.agentes;
create policy "auth_all" on public.agentes for all to authenticated
  using (mi_agente_id() is null or id = mi_agente_id())
  with check (mi_agente_id() is null or id = mi_agente_id());

drop policy if exists "auth_all" on public.clientes;
create policy "auth_all" on public.clientes for all to authenticated
  using (mi_agente_id() is null or exists (
    select 1 from polizas p where p.cliente_id = clientes.id and p.agente_id = mi_agente_id()
  ))
  with check (mi_agente_id() is null);

drop policy if exists "auth_all" on public.polizas;
create policy "auth_all" on public.polizas for all to authenticated
  using (mi_agente_id() is null or agente_id = mi_agente_id())
  with check (mi_agente_id() is null or agente_id = mi_agente_id());

drop policy if exists "auth_all" on public.lineas_comision;
create policy "auth_all" on public.lineas_comision for all to authenticated
  using (mi_agente_id() is null or agente_id = mi_agente_id())
  with check (mi_agente_id() is null or agente_id = mi_agente_id());

drop policy if exists "auth_all" on public.lineas_venta;
create policy "auth_all" on public.lineas_venta for all to authenticated
  using (mi_agente_id() is null or agente_id = mi_agente_id())
  with check (mi_agente_id() is null or agente_id = mi_agente_id());

drop policy if exists "auth_all" on public.excepciones;
create policy "auth_all" on public.excepciones for all to authenticated
  using (
    mi_agente_id() is null
    or exists (select 1 from lineas_comision l where l.id = excepciones.linea_comision_id and l.agente_id = mi_agente_id())
    or exists (select 1 from lineas_venta v where v.id = excepciones.linea_venta_id and v.agente_id = mi_agente_id())
  )
  with check (mi_agente_id() is null);

drop policy if exists "auth_all" on public.bonos;
create policy "auth_all" on public.bonos for all to authenticated
  using (mi_agente_id() is null or oficina_id is null or oficina_id = (select oficina_id from agentes where id = mi_agente_id()))
  with check (mi_agente_id() is null);

drop policy if exists "auth_all" on public.bono_reparto;
create policy "auth_all" on public.bono_reparto for all to authenticated
  using (mi_agente_id() is null or agente_id = mi_agente_id())
  with check (mi_agente_id() is null);

drop policy if exists "auth_all" on public.auditoria;
create policy "auth_all" on public.auditoria for all to authenticated
  using (mi_agente_id() is null or usuario = auth.uid())
  with check (mi_agente_id() is null or usuario = auth.uid());

-- Las vistas deben evaluar RLS con el rol que consulta (no con el dueño de la
-- vista); sin esto, la restricción de arriba no se aplicaría al leer por vista.
alter view v_lineas_comision set (security_invoker = on);
alter view v_excepciones set (security_invoker = on);
alter view v_polizas set (security_invoker = on);
