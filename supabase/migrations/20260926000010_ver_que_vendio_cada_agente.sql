-- =========================================================
-- Ver de dónde sale lo que se le paga a cada agente
-- =========================================================
-- En Liquidación se ve un número por agente y nada más. Para saber de dónde sale hay que ir
-- statement por statement y filtrar por ese agente en cada uno — y una venta del mismo mes puede
-- estar repartida entre GEICO, Progressive y Kemper.
--
-- Esto devuelve, para un agente y un período, TODAS sus líneas de todas las compañías juntas, con
-- la fecha, la póliza, el cliente y si cuenta como negocio nuevo. Es lo que pidió Arturo: *"si yo
-- le diera un clic ahí, él pudiera mostrarme todas las pólizas completas que vendió, no importa
-- el statement que haya sido"*.
--
-- Usa exactamente el mismo criterio de mes que liquidacion_negocio_nuevo(), incluida la regla de
-- las compañías que no cortan por mes calendario. Si usara otro, el detalle no sumaría el total
-- de arriba y no se podría confiar en ninguno de los dos.
--
-- Solo lee. No cambia ni una línea de lo que ya está cargado.
create or replace function detalle_liquidacion_agente(
  p_agente uuid,
  p_desde date,
  p_hasta date
)
returns table (
  fecha date,
  compania text,
  numero_poliza text,
  cliente text,
  tipo text,
  negocio_nuevo boolean,
  prima numeric,
  comision numeric,
  statement text
)
language sql stable as $$
  select
    case
      when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
        then v.fecha_statement
      else coalesce(v.fecha_statement, mes_del_periodo(r.periodo), v.created_at::date)
    end as fecha,
    coalesce(asg.nombre, 'Sin compañía'),
    coalesce(v.numero_poliza_crudo, '—'),
    coalesce(c.nombre, v.nombre_asegurado_crudo, '—'),
    v.tipo_transaccion,
    v.negocio_nuevo,
    v.prima,
    v.monto,
    coalesce(r.periodo, r.nombre_archivo)
  from v_lineas_negocio v
  join reportes r on r.id = v.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  left join polizas p on p.id = v.poliza_id
  left join clientes c on c.id = p.cliente_id
  where v.agente_id = p_agente
    and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and (case
           when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
             then v.fecha_statement
           else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
         end) between p_desde and p_hasta
  order by 1 desc, 2, 3;
$$;

notify pgrst, 'reload schema';
