-- =========================================================
-- El ranking del dashboard es por oficina y por prima, no por agente y por comisión
-- =========================================================
-- "Top producing agents" rankeaba agentes por comisión. Arturo pidió otra cosa, tres cambios:
--
--   1. Por OFICINA, no por agente. Ya se sabe a qué oficina pertenece cada agente
--      (agentes.oficina_id), así que se agrupa por ahí: si Heidi e Isabel son las dos de
--      Miami Lakes, Miami Lakes lleva la suma de las dos.
--   2. Por PRIMA, no por comisión. Sus palabras: "si la póliza le costó 3.000 dólares, al 10% yo
--      gano 300. Lo que nosotros estamos mirando son los 3.000 dólares del cliente, quién vendió
--      esos 3.000." Se suma lineas_comision.prima, no lineas_comision.monto.
--   3. Solo negocio nuevo, sin renovaciones. Sus palabras: "cuánto generó el new business esa
--      oficina." Para eso está v_lineas_negocio.negocio_nuevo (migración
--      20260926000005_negocio_nuevo_para_liquidar.sql): true = negocio nuevo, false = renovación,
--      null = no se pudo clasificar.
--
-- Las líneas con negocio_nuevo null quedan AFUERA del ranking a propósito — no se sabe si son
-- nuevas, y sumarlas ahí sería mostrar como "new business" algo que no se sabe si lo es. Para que
-- esa plata no desaparezca sin dejar rastro, prima_sin_clasificar() de acá abajo devuelve cuánta
-- prima quedó sin clasificar en el período, y el dashboard la muestra aparte, como nota.
--
-- v_lineas_negocio sale de lineas_comision directo (no de v_lineas_comision), así que no trae
-- periodo ya resuelto: se calcula igual que en liquidacion_negocio_nuevo, mirando el reporte.
create or replace function ranking_oficinas(p_desde date, p_hasta date, p_limite int default 10)
returns table (oficina_id uuid, oficina text, polizas bigint, prima numeric, comision numeric)
language sql stable as $$
  select o.id as oficina_id,
         coalesce(o.nombre, 'Sin oficina') as oficina,
         count(*) as polizas,
         coalesce(sum(v.prima), 0) as prima,
         coalesce(sum(v.monto), 0) as comision
  from v_lineas_negocio v
  join agentes a on a.id = v.agente_id
  left join oficinas o on o.id = a.oficina_id
  where v.negocio_nuevo is true
    and coalesce(a.es_casa, false) = false
    and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and coalesce(mes_del_periodo(
          (select r.periodo from reportes r where r.id = v.reporte_id)
        ), v.fecha_statement, v.created_at::date) between p_desde and p_hasta
  group by o.id, o.nombre
  order by prima desc
  limit p_limite;
$$;

-- Cuánta prima del período no se pudo clasificar como nueva ni como renovación. Mismos filtros que
-- ranking_oficinas (mismas líneas que cuentan, mismo período), pero mirando negocio_nuevo is null
-- en lugar de is true. Sirve para la nota chica debajo de la tabla: si esto es cero, el ranking de
-- arriba está completo; si no, hay plata sin decidir todavía.
create or replace function prima_sin_clasificar(p_desde date, p_hasta date) returns numeric
language sql stable as $$
  select coalesce(sum(v.prima), 0)
  from v_lineas_negocio v
  join agentes a on a.id = v.agente_id
  where v.negocio_nuevo is null
    and coalesce(a.es_casa, false) = false
    and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and coalesce(mes_del_periodo(
          (select r.periodo from reportes r where r.id = v.reporte_id)
        ), v.fecha_statement, v.created_at::date) between p_desde and p_hasta;
$$;

notify pgrst, 'reload schema';
