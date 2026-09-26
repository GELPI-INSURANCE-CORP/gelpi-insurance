-- =========================================================
-- Clasificar a mano lo que el archivo no dice
-- =========================================================
-- Hay 242 líneas conciliadas que el sistema no pudo poner en negocio nuevo ni en renovación:
-- $4,415.25 de comisión sobre $34,917.68 de prima. Se ven en Liquidación en la caja de "sin
-- clasificar" y hoy no se pagan, porque adivinar sería pagar de más o de menos.
--
-- Arturo: *"prefiero que en una parte de conciliación me liste esas líneas para que pueda
-- identificar si es un new business o un renewal para poder pagarle a la gente y no deberle
-- dinero."*
--
-- QUÉ SON ESAS LÍNEAS. Casi ninguna es un caso dudoso de "nuevo contra renovación" — son
-- movimientos que por sí solos no dicen a qué término pertenecen:
--
--   cancelación   134     United Automobile   129 líneas   $3,371.77
--   otro           75     Responsive           51 líneas   $1,166.34
--   endoso         32     Kemper               31 líneas  -$1,175.29
--   ajuste          1     National General     31 líneas   $1,052.43
--
-- Una cancelación revierte una venta anterior y un endoso modifica una póliza existente. La regla
-- que ya rige el sistema es que la línea pertenece a donde pertenezca LA PÓLIZA. El problema es
-- que hoy esa consulta solo mira dentro del mismo statement (el CTE por_poliza de la migración
-- 005): el endoso de agosto de una póliza vendida en julio no encuentra nada, porque la evidencia
-- está en otro archivo.
--
-- Esta migración hace dos cosas:
--
--   1. Le da al usuario dónde decidir, y que la decisión no se pierda al reprocesar.
--   2. Le muestra, para cada línea, qué dice la misma póliza en los demás statements — como
--      SUGERENCIA, no como cambio automático.
--
-- POR QUÉ SUGERENCIA Y NO AUTOMÁTICO. Ampliar la regla para que mire todos los statements
-- cambiaría por su cuenta a quién se le paga qué, sin que nadie lo revise. Es plata. Se muestra
-- la evidencia y se acepta de a un clic — o de a cien con un botón — pero la decisión queda
-- registrada como de una persona, con nombre y fecha.

-- ---------------------------------------------------------
-- 1. Dónde vive la decisión
-- ---------------------------------------------------------
-- La clave es (aseguradora, número de póliza normalizado) y NO el id de la línea, porque
-- reprocesar un reporte borra sus líneas y las vuelve a crear con ids nuevos. Es el mismo
-- criterio que ya usa limpiarLineasPrevias() en el Edge Function cuando guarda en la póliza el
-- agente decidido a mano antes de borrar: lo que decidió una persona se guarda contra algo que
-- sobrevive al archivo.
--
-- También es la unidad correcta según la regla del negocio: no se clasifica una línea, se
-- clasifica la póliza, y todas sus líneas la siguen.
create table if not exists clasificacion_negocio_manual (
  aseguradora_id     uuid not null references aseguradoras(id) on delete cascade,
  numero_normalizado text not null,
  negocio_nuevo      boolean not null,
  nota               text,
  decidido_por       uuid,
  decidido_en        timestamptz not null default now(),
  primary key (aseguradora_id, numero_normalizado)
);

comment on table clasificacion_negocio_manual is
  'Pólizas que una persona clasificó a mano como negocio nuevo o renovación, porque el archivo de '
  'la compañía no lo decía. Va por (aseguradora, número de póliza) y no por línea para que '
  'reprocesar el reporte no la borre. Solo se aplica a las líneas que no traen señal propia: '
  'nunca le cambia el veredicto a una línea que el archivo sí clasificó.';

alter table clasificacion_negocio_manual enable row level security;
do $do$
begin
  if not exists (select 1 from pg_policies
                  where tablename = 'clasificacion_negocio_manual' and policyname = 'auth_all') then
    create policy auth_all on clasificacion_negocio_manual
      for all to authenticated using (true) with check (true);
  end if;
end $do$;

-- ---------------------------------------------------------
-- 2. La vista, con la decisión manual como último recurso
-- ---------------------------------------------------------
-- El orden importa y es deliberado:
--
--   1º  lo que dice la propia línea                    — el archivo manda
--   2º  lo que dicen sus hermanas del mismo statement  — la póliza manda
--   3º  lo que decidió una persona                     — solo si no hubo nada de lo anterior
--
-- Con la decisión manual en tercer lugar, marcar una póliza NO PUEDE cambiar ningún número que
-- hoy ya esté bien: solo convierte nulls. Si mañana hace falta corregir una línea que el archivo
-- clasificó mal, eso es otro problema y otra pantalla — este cambio no puede causarlo.
create or replace view v_lineas_negocio as
with base as (
  select l.*, senal_negocio_nuevo(l.campos_extra, l.tipo_transaccion) as senal
  from lineas_comision l
),
por_poliza as (
  select reporte_id, numero_normalizado,
         bool_or(senal is true) as hay_nueva,
         bool_or(senal is false) as hay_renovacion
  from base
  where numero_normalizado is not null
  group by 1, 2
)
select b.*,
  case
    when b.senal is not null then b.senal
    when p.hay_nueva and not p.hay_renovacion then true
    when p.hay_renovacion and not p.hay_nueva then false
    when m.negocio_nuevo is not null then m.negocio_nuevo
    else null
  end as negocio_nuevo
from base b
left join por_poliza p
  on p.reporte_id = b.reporte_id and p.numero_normalizado = b.numero_normalizado
left join reportes r
  on r.id = b.reporte_id
left join clasificacion_negocio_manual m
  on m.aseguradora_id = r.aseguradora_id and m.numero_normalizado = b.numero_normalizado;

-- ---------------------------------------------------------
-- 3. La lista, con lo que se sabe de cada póliza en otros statements
-- ---------------------------------------------------------
-- Para cada línea sin clasificar busca la MISMA póliza en el resto de los statements de la misma
-- compañía — o de su grupo, porque Kemper y National General mandan varias compañías bajo un
-- mismo paraguas y la misma póliza aparece con nombres distintos (migración 001).
--
-- Solo sugiere cuando la evidencia es unánime. Si la misma póliza aparece como nueva en un lado y
-- como renovación en otro, no sugiere nada: ahí el sistema no sabe, y decirlo es más útil que
-- inventar.
create or replace function lineas_sin_clasificar(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  linea_id           uuid,
  compania           text,
  periodo            text,
  fecha              date,
  numero_poliza      text,
  numero_normalizado text,
  cliente            text,
  tipo               text,
  prima              numeric,
  comision           numeric,
  agente             text,
  agente_id          uuid,
  sugerencia         boolean,
  sugerencia_motivo  text
)
language sql stable as $fn$
  with cia as (
    -- Las compañías del mismo grupo comparten clave, así la evidencia cruza entre ellas.
    select id, coalesce(grupo, id::text) as clave, nombre from aseguradoras
  ),
  evidencia as (
    select c.clave,
           v.numero_normalizado as num,
           bool_or(v.negocio_nuevo) as hay_nueva,
           bool_or(not v.negocio_nuevo) as hay_renovacion,
           count(*) as n,
           min(coalesce(r.periodo, r.nombre_archivo)) as donde
    from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    join cia c on c.id = r.aseguradora_id
    where v.negocio_nuevo is not null
      and v.numero_normalizado is not null
      and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    group by 1, 2
  ),
  pendientes as (
    select v.*,
           r.aseguradora_id,
           coalesce(r.periodo, r.nombre_archivo) as periodo_txt,
           case
             when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
               then v.fecha_statement
             else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
           end as mes
    from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    left join aseguradoras asg on asg.id = r.aseguradora_id
    where v.negocio_nuevo is null
      and v.estado in ('conciliado_auto', 'conciliado_confirmado')
  )
  select
    x.id,
    coalesce(c.nombre, 'Sin compañía'),
    x.periodo_txt,
    x.mes,
    coalesce(x.numero_poliza_crudo, '—'),
    x.numero_normalizado,
    coalesce(cl.nombre, x.nombre_asegurado_crudo, '—'),
    x.tipo_transaccion,
    x.prima,
    x.monto,
    coalesce(a.nombre, 'Sin agente'),
    x.agente_id,
    case
      when e.hay_nueva and not e.hay_renovacion then true
      when e.hay_renovacion and not e.hay_nueva then false
      else null
    end,
    case
      when e.hay_nueva and not e.hay_renovacion
        then 'La misma póliza es negocio nuevo en ' || e.donde ||
             ' (' || e.n || ' línea' || case when e.n = 1 then '' else 's' end || ')'
      when e.hay_renovacion and not e.hay_nueva
        then 'La misma póliza es renovación en ' || e.donde ||
             ' (' || e.n || ' línea' || case when e.n = 1 then '' else 's' end || ')'
      when e.clave is not null
        then 'La misma póliza aparece como nueva en un statement y como renovación en otro'
      when x.numero_normalizado is null
        then 'La línea no trae número de póliza'
      else 'Esta póliza no aparece en ningún otro statement'
    end
  from pendientes x
  join cia c on c.id = x.aseguradora_id
  left join evidencia e on e.clave = c.clave and e.num = x.numero_normalizado
  left join agentes a on a.id = x.agente_id
  left join polizas p on p.id = x.poliza_id
  left join clientes cl on cl.id = p.cliente_id
  where (p_desde is null or x.mes >= p_desde)
    and (p_hasta is null or x.mes <= p_hasta)
  order by x.mes desc, c.nombre, x.numero_normalizado;
$fn$;

-- ---------------------------------------------------------
-- 4. Guardar la decisión
-- ---------------------------------------------------------
-- Recibe líneas y guarda la decisión contra la PÓLIZA de cada una, que es lo que sobrevive a un
-- reproceso. Las líneas sin número de póliza no se pueden guardar en ningún lado: se cuentan
-- aparte y se devuelven, para que la pantalla lo diga en vez de fingir que se guardaron.
--
-- Sin tabla temporal a propósito. Una temp table con "on commit drop" revienta si la función se
-- llama dos veces en la misma transacción, y desde PostgREST eso puede pasar.
create or replace function clasificar_negocio(
  p_lineas uuid[],
  p_negocio_nuevo boolean,
  p_nota text default null
)
returns table (polizas_guardadas int, lineas_alcanzadas int, lineas_sin_poliza int)
language sql volatile as $fn$
  with obj as (
    select distinct r.aseguradora_id as asg, l.numero_normalizado as num
    from lineas_comision l
    join reportes r on r.id = l.reporte_id
    where l.id = any(p_lineas)
      and l.numero_normalizado is not null
  ),
  ins as (
    insert into clasificacion_negocio_manual
      (aseguradora_id, numero_normalizado, negocio_nuevo, nota, decidido_por)
    select o.asg, o.num, p_negocio_nuevo, p_nota, auth.uid()
    from obj o
    on conflict (aseguradora_id, numero_normalizado) do update
      set negocio_nuevo = excluded.negocio_nuevo,
          nota          = excluded.nota,
          decidido_por  = excluded.decidido_por,
          decidido_en   = now()
    returning 1
  )
  select
    (select count(*) from ins)::int,
    -- Cuántas líneas quedan cubiertas de verdad: la misma póliza puede tener varias, y marcar una
    -- resuelve todas sus hermanas.
    (select count(*) from lineas_comision l
       join reportes r on r.id = l.reporte_id
       join obj o on o.asg = r.aseguradora_id and o.num = l.numero_normalizado)::int,
    (select count(*) from lineas_comision l
      where l.id = any(p_lineas) and l.numero_normalizado is null)::int;
$fn$;

-- Deshacer una decisión, por si se marcó mal.
create or replace function desclasificar_negocio(p_lineas uuid[])
returns int
language plpgsql volatile as $fn$
declare v_n int;
begin
  delete from clasificacion_negocio_manual m
  using lineas_comision l
  join reportes r on r.id = l.reporte_id
  where l.id = any(p_lineas)
    and m.aseguradora_id = r.aseguradora_id
    and m.numero_normalizado = l.numero_normalizado;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ---------------------------------------------------------
-- Qué hay para clasificar ahora mismo
-- ---------------------------------------------------------
select
  count(*)                                           as lineas_sin_clasificar,
  '$' || round(coalesce(sum(comision), 0), 2)::text  as comision_en_juego,
  count(*) filter (where sugerencia is not null)     as el_sistema_ya_sabe_cual_es,
  '$' || round(coalesce(sum(comision) filter (where sugerencia is not null), 0), 2)::text
                                                     as comision_con_sugerencia,
  count(*) filter (where sugerencia is null)         as hay_que_mirarlas_a_mano,
  count(*) filter (where numero_normalizado is null) as sin_numero_de_poliza
from lineas_sin_clasificar();

notify pgrst, 'reload schema';
