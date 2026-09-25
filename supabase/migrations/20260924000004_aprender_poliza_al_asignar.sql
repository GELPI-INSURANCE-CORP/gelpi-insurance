-- =========================================================
-- Asignar una línea y que el Book lo aprenda
-- =========================================================
-- Hoy, asignar a mano una línea cuya póliza NO está en el Book arregla ese mes y nada más: la
-- decisión vive en la línea, y la línea se borra al reprocesar. El mes que viene la misma póliza
-- vuelve a caer sin identificar y hay que asignarla de nuevo. Medido: 58 líneas entre United y
-- Progressive están en esa situación.
--
-- El dato que falta lo trae el propio statement — número de póliza, nombre del asegurado y
-- aseguradora. Con eso alcanza para crear la póliza en el Book. A partir de ahí el motor la
-- encuentra sola por número de póliza, que es el paso más confiable que tiene.
--
-- Va en SQL y no en la pantalla por tres razones: usa las mismas funciones de normalización que el
-- resto del sistema (normalizar_nombre, normalizar_poliza) en vez de reimplementarlas en
-- JavaScript y arriesgar que difieran; corre en una sola transacción, así que no puede quedar a
-- medias con la póliza creada y la línea sin asignar; y respeta la unique (aseguradora_id,
-- numero_normalizado) sin carreras.

create or replace function asignar_linea_creando_poliza(
  p_linea_id uuid,
  p_agente_id uuid,
  p_motivo text default null
) returns jsonb language plpgsql security definer as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_of uuid;
  v_cli uuid;
  v_pol polizas%rowtype;
  v_norm text;
  v_creo_poliza boolean := false;
  v_creo_cliente boolean := false;
  v_usr uuid := auth.uid();
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then raise exception 'La línea no existe'; end if;
  if p_agente_id is null then raise exception 'Falta el agente'; end if;
  select * into r from reportes where id = l.reporte_id;
  select oficina_id into v_of from agentes where id = p_agente_id;

  v_norm := normalizar_poliza(l.numero_poliza_crudo);

  -- Sin número de póliza no hay nada que aprender: un ajuste o un fee no es una póliza, y crear
  -- una con número inventado ensuciaría el Book para siempre. Se asigna solo la línea.
  if v_norm is null or r.aseguradora_id is null then
    update lineas_comision
       set estado = 'conciliado_confirmado', agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of), regla_match = 'manual'
     where id = l.id;
    return jsonb_build_object('ok', true, 'poliza_creada', false, 'cliente_creado', false,
      'motivo', 'La línea no trae número de póliza, así que no se pudo guardar en el Book.');
  end if;

  select * into v_pol from polizas
   where aseguradora_id = r.aseguradora_id and numero_normalizado = v_norm;

  if not found then
    -- Se reusa el cliente si ya existe con ese nombre; si no, se crea. Crear un cliente duplicado
    -- por cada statement dejaría el Book lleno de copias del mismo asegurado.
    if coalesce(l.nombre_asegurado_crudo, '') <> '' then
      select id into v_cli from clientes
       where nombre_normalizado = normalizar_nombre(l.nombre_asegurado_crudo)
       order by created_at limit 1;
      if v_cli is null then
        insert into clientes (nombre) values (l.nombre_asegurado_crudo) returning id into v_cli;
        v_creo_cliente := true;
      end if;
    end if;

    insert into polizas (cliente_id, numero_poliza, aseguradora_id, ramo, agente_id, oficina_id,
                         fecha_vigencia, prima, origen)
    values (v_cli, l.numero_poliza_crudo, r.aseguradora_id, coalesce(l.ramo, 'auto'), p_agente_id,
            v_of, l.fecha_vigencia, l.prima, 'alta_manual')
    returning * into v_pol;
    v_creo_poliza := true;
  else
    -- La póliza ya estaba: se le pone el agente, que es lo que faltaba para que matchee sola.
    update polizas set agente_id = p_agente_id, oficina_id = coalesce(oficina_id, v_of)
     where id = v_pol.id;
  end if;

  update lineas_comision
     set estado = 'conciliado_confirmado', agente_id = p_agente_id, oficina_id = v_of,
         poliza_id = v_pol.id, regla_match = 'manual'
   where id = l.id;

  update excepciones
     set estado = 'resuelta', accion = 'asignar_creando_poliza',
         nota = coalesce(p_motivo, 'Asignada a mano; la póliza quedó guardada en el Book.'),
         resuelta_por = v_usr, resuelta_en = now()
   where linea_comision_id = l.id and estado in ('pendiente', 'en_espera');

  insert into auditoria (entidad, entidad_id, accion, campo, valor_nuevo, usuario, motivo)
  values ('polizas', v_pol.id,
          case when v_creo_poliza then 'alta_desde_statement' else 'agente_desde_statement' end,
          'agente_id', p_agente_id::text, v_usr, p_motivo);

  return jsonb_build_object('ok', true, 'poliza_creada', v_creo_poliza,
    'cliente_creado', v_creo_cliente, 'numero_poliza', v_pol.numero_poliza);
end $$;
