-- =========================================================
-- Lo que el dashboard necesita saber: producción y ranking
-- =========================================================
-- El dashboard mostraba nueve números en fila y ninguno contestaba lo que uno se pregunta al
-- abrirlo. Faltaban dos cosas que la agencia sí mira: cómo viene la producción mes a mes, y quién
-- está produciendo.
--
-- Las dos se calculan en la base y no en la pantalla. Traerse 2.345 pólizas y 705 líneas al
-- navegador para sumarlas ahí funciona hoy y deja de funcionar el año que viene, cuando sean
-- 20.000; y además cada pantalla que quiera el mismo número tendría que volver a sumarlo igual.

-- ---------------------------------------------------------
-- Pólizas nuevas por mes
-- ---------------------------------------------------------
-- Se cuenta por fecha_vigencia — cuándo la póliza empezó a cubrir — y no por cuándo se cargó el
-- archivo al sistema. Una póliza de agosto es de agosto aunque el Book se haya subido en
-- septiembre; contarla por la carga haría que un mes sin subir archivos figure como un mes sin
-- ventas.
create or replace function polizas_por_mes(p_desde date, p_hasta date)
returns table (mes date, polizas bigint, prima numeric)
language sql stable as $$
  select date_trunc('month', p.fecha_vigencia)::date as mes,
         count(*) as polizas,
         coalesce(sum(p.prima), 0) as prima
  from polizas p
  where p.fecha_vigencia is not null
    and p.fecha_vigencia between p_desde and p_hasta
    and p.estado = 'activa'
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------
-- Quién produjo, y cuánto
-- ---------------------------------------------------------
-- Ordenado por comisión y no por cantidad de líneas: un agente con 159 líneas chicas trajo menos
-- plata que uno con 121 grandes, y lo que se reparte es plata. Medido hoy, es exactamente el caso
-- de Heidi contra Nadira.
--
-- La cuenta de la casa queda afuera. Ahí van los MVR y los ajustes que la compañía le cobra a la
-- agencia, así que su total es negativo: mezclarla en un ranking de producción haría que el último
-- puesto sea siempre el dueño, en rojo, lo cual no informa nada.
create or replace function ranking_agentes(p_desde date, p_hasta date, p_limite int default 10)
returns table (agente_id uuid, agente text, oficina text, lineas bigint, comision numeric)
language sql stable as $$
  select l.agente_id,
         a.nombre as agente,
         o.nombre as oficina,
         count(*) as lineas,
         coalesce(sum(l.monto), 0) as comision
  from v_lineas_comision l
  join agentes a on a.id = l.agente_id
  left join oficinas o on o.id = a.oficina_id
  where l.agente_id is not null
    and coalesce(a.es_casa, false) = false
    and l.estado in ('conciliado_auto', 'conciliado_confirmado')
    and coalesce(mes_del_periodo(l.periodo), l.fecha_statement, l.created_at::date)
        between p_desde and p_hasta
  group by l.agente_id, a.nombre, o.nombre
  order by comision desc
  limit p_limite;
$$;

notify pgrst, 'reload schema';
