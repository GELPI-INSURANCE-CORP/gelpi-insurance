-- =========================================================
-- Que el dashboard y la lista digan la verdad
-- =========================================================
-- Tres cosas distintas que se ven como una sola: números que no cuadran.
--
--  1. Primas negativas. asignar_linea_creando_poliza copiaba la prima de la línea del statement a
--     la póliza nueva. Las líneas de cancelación traen la prima en negativo, así que cada
--     cancelación asignada a mano creaba una póliza con prima negativa. Medido: 10 pólizas
--     sumando -$41,971, y la oficina GELPI INSURANCE CORP mostrando "Prima activa -$17,942.66".
--
--  2. Contadores congelados. reportes.total_ok y total_excepciones se escriben cuando se lee el
--     archivo y nunca más. Responsive terminado hace un día seguía diciendo "38 OK · 14
--     excepciones" cuando en realidad son 52 OK y 0 pendientes, y la pantalla avisaba "15 filas
--     sin cuadrar" porque los números no sumaban.
--
--  3. La limpieza de lo que ya quedó mal, que si no seguiría ensuciando el dashboard para siempre.

-- ---------------------------------------------------------
-- 1. La prima de una póliza nunca es negativa
-- ---------------------------------------------------------
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
  v_prima numeric;
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

  -- La prima de la línea sirve para la póliza solo si es positiva. Una cancelación trae la prima
  -- en negativo (es una devolución), y guardarla así deja el Book con pólizas de prima negativa
  -- que después el dashboard suma. Ante la duda, mejor sin prima que con una prima falsa.
  v_prima := case when coalesce(l.prima, 0) > 0 then l.prima else null end;

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
            v_of, l.fecha_vigencia, v_prima, 'alta_manual')
    returning * into v_pol;
    v_creo_poliza := true;
  else
    -- La póliza ya estaba: se le pone el agente, que es lo que faltaba para que matchee sola. La
    -- prima solo se completa si la póliza no tenía ninguna; el Book manda sobre el statement.
    update polizas
       set agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of),
           prima = coalesce(prima, v_prima)
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

-- ---------------------------------------------------------
-- 2. Limpiar las primas negativas que ya quedaron guardadas
-- ---------------------------------------------------------
-- Se pasan a NULL y no a cero: cero diría "esta póliza no cobra prima", que es una afirmación
-- falsa. NULL dice "no sabemos", que es la verdad, y además no arrastra el promedio.
update polizas set prima = null where prima < 0;

-- ---------------------------------------------------------
-- 3. Contadores que no se pueden desactualizar
-- ---------------------------------------------------------
-- En vez de recalcular los contadores cada vez que cambia una línea (y confiar en que nadie se
-- olvide de hacerlo), se calculan al leerlos. Así no existe la posibilidad de que queden viejos.
--
-- Los reportes de Book y de ventas internas no tienen líneas de comisión, así que para esos se
-- conserva lo que ya estaba guardado en vez de mostrar cero.
create or replace view v_reportes as
select r.*,
       case when coalesce(c.lineas, 0) > 0 then c.lineas else r.total_lineas end as lineas_reales,
       case when coalesce(c.lineas, 0) > 0 then c.ok else r.total_ok end as ok_reales,
       case when coalesce(c.lineas, 0) > 0 then c.pendientes else r.total_excepciones end as pendientes_reales,
       coalesce(c.fuera, 0) as fuera_reales
from reportes r
left join lateral (
  select count(*) as lineas,
         count(*) filter (
           where l.estado in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa')
         ) as ok,
         count(*) filter (
           where l.estado not in ('conciliado_auto', 'conciliado_confirmado', 'cuenta_casa', 'descartado')
         ) as pendientes,
         count(*) filter (where l.estado = 'descartado') as fuera
  from lineas_comision l
  where l.reporte_id = r.id
) c on true;

-- Igual que las otras vistas del sistema: la vista no puede saltearse el RLS de quien consulta.
alter view v_reportes set (security_invoker = on);
