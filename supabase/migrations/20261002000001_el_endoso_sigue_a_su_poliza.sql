-- =========================================================
-- El endoso sigue a su poliza, y se puede ver por que
-- =========================================================
-- Arturo, hoy, poniendo la regla por escrito:
--
--   "Si una poliza, por ejemplo de Arturo, es un New Business y tiene un endorsement, se lo vamos
--    a pagar porque es el endorsement tambien. Pero si la poliza es una renovacion y la
--    renovacion tiene un endorsement, no se lo vamos a pagar. [...] igual todas las companias te
--    dicen cuando es renewal o cuando es new business; ya si tiene un endorsement, por el numero
--    de poliza, si match, ya sabes que pertenece a un new business."
--
-- Eso ya estaba calculado en el sistema, pero solo como SUGERENCIA: la migracion 011 buscaba la
-- misma poliza en los otros statements y lo mostraba en una pantalla para aceptarlo a mano. En su
-- momento fue lo correcto -- cambiar por cuenta propia a quien se le paga que, sin que nadie lo
-- revise, no se hace con plata ajena. Pero el dueno ya dio la regla, y nadie acepto una sola
-- sugerencia en seis dias: a agosto le quedan 242 lineas sin clasificar, $34,917.68 de prima, y
-- de "decidido a mano" hay exactamente cero.
--
-- Asi que la inferencia pasa de sugerencia a regla. Con tres candados:
--
--   1. SOLO SI LA EVIDENCIA ES UNANIME. Si la misma poliza aparece como nueva en un statement y
--      como renovacion en otro, sigue sin clasificar. Ahi el sistema no sabe, y decirlo es mas
--      util que inventar.
--   2. SOLO LLENA VACIOS. Va en el ultimo lugar del orden, asi que no puede cambiar ninguna linea
--      que hoy ya tenga veredicto. Lo que esta bien hoy sigue igual manana.
--   3. LA PERSONA MANDA. La decision manual va ANTES que la inferencia, asi que marcar una poliza
--      a mano le gana al sistema. Si la inferencia se equivoca, se corrige y la correccion queda.
--
-- No toca el royalty: ese suma toda la comision conciliada, nueva y renovacion por igual, asi que
-- clasificar mejor no le mueve un centavo. Ver 20260927000002.

-- ---------------------------------------------------------
-- 1. La vista, con la poliza completa como ultimo recurso
-- ---------------------------------------------------------
-- El orden, ahora de cuatro escalones:
--
--   1o  lo que dice la propia linea                      -- el archivo manda
--   2o  lo que dicen sus hermanas del mismo statement    -- la poliza manda, dentro del archivo
--   3o  lo que decidio una persona                       -- la persona le gana al sistema
--   4o  lo que dice la misma poliza en OTROS statements  -- el endoso sigue a su poliza
--
-- El escalon 4 no puede consultarse a si mismo (una vista no se referencia), asi que la evidencia
-- se arma desde los escalones 1 a 3 en el CTE "firme". Es deliberado y ademas es lo correcto: la
-- evidencia tiene que venir de lo que se SABE, no de lo que ya se infirio, o una inferencia
-- alimentaria a la siguiente y un solo error se propagaria por toda una compania.
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
),
cia as (
  -- Kemper y National General mandan varias companias bajo un mismo paraguas y la misma poliza
  -- aparece con nombres distintos, asi que la evidencia cruza dentro del grupo (migracion 001).
  select id, coalesce(grupo, id::text) as clave from aseguradoras
),
firme as (
  select b.id,
         r.aseguradora_id,
         b.numero_normalizado,
         b.estado,
         case
           when b.senal is not null then b.senal
           when p.hay_nueva and not p.hay_renovacion then true
           when p.hay_renovacion and not p.hay_nueva then false
           when m.negocio_nuevo is not null then m.negocio_nuevo
           else null
         end as veredicto
  from base b
  left join reportes r on r.id = b.reporte_id
  left join por_poliza p
    on p.reporte_id = b.reporte_id and p.numero_normalizado = b.numero_normalizado
  left join clasificacion_negocio_manual m
    on m.aseguradora_id = r.aseguradora_id and m.numero_normalizado = b.numero_normalizado
),
entre_statements as (
  -- Solo lineas conciliadas: es la misma base de evidencia que ya venia mostrando la pantalla de
  -- sugerencias, asi que lo que el sistema proponia ayer es exactamente lo que aplica hoy.
  select c.clave,
         f.numero_normalizado as num,
         bool_or(f.veredicto) as hay_nueva,
         bool_or(not f.veredicto) as hay_renovacion
  from firme f
  join cia c on c.id = f.aseguradora_id
  where f.veredicto is not null
    and f.numero_normalizado is not null
    and f.estado in ('conciliado_auto', 'conciliado_confirmado')
  group by 1, 2
)
select b.*,
  coalesce(
    f.veredicto,
    case
      when e.hay_nueva and not e.hay_renovacion then true
      when e.hay_renovacion and not e.hay_nueva then false
      else null
    end
  ) as negocio_nuevo
from base b
join firme f on f.id = b.id
left join reportes r on r.id = b.reporte_id
left join cia c on c.id = r.aseguradora_id
left join entre_statements e on e.clave = c.clave and e.num = b.numero_normalizado;

-- ---------------------------------------------------------
-- 2. Poder ver de donde salio cada veredicto
-- ---------------------------------------------------------
-- Arturo: *"como yo puedo entrar a cada una de esas policies de sin clasificar para ver si las
-- ajusto y son clasificadas? Necesito ver esa clasificacion."*
--
-- El detalle del agente ahora devuelve tres cosas mas: el id de la linea (para poder clasificarla
-- desde ahi mismo, sin tener que ir a buscarla a otra pantalla), como se supo el veredicto, y --
-- para las que siguen sin veredicto -- por que no se pudo saber.
--
-- "Como se supo" no es decoracion. Cuando el pago sale de que una linea este de un lado y no del
-- otro, hay que poder contestar "y esto por que se paga?" sin abrir el Excel de la compania.
drop function if exists detalle_liquidacion_agente(uuid, date, date);

create function detalle_liquidacion_agente(
  p_agente uuid,
  p_desde date,
  p_hasta date
)
returns table (
  linea_id      uuid,
  fecha         date,
  compania      text,
  numero_poliza text,
  cliente       text,
  tipo          text,
  negocio_nuevo boolean,
  prima         numeric,
  comision      numeric,
  statement     text,
  origen        text,
  motivo        text
)
language sql stable as $fn$
  with cia as (
    select id, coalesce(grupo, id::text) as clave, nombre from aseguradoras
  ),
  -- Las mismas capas que la vista, para poder contar cual de ellas decidio.
  senales as (
    select l.id, l.reporte_id, l.numero_normalizado,
           senal_negocio_nuevo(l.campos_extra, l.tipo_transaccion) as senal
    from lineas_comision l
  ),
  por_poliza as (
    select reporte_id, numero_normalizado,
           bool_or(senal is true) as hay_nueva,
           bool_or(senal is false) as hay_renovacion
    from senales
    where numero_normalizado is not null
    group by 1, 2
  ),
  evidencia as (
    select c.clave, v.numero_normalizado as num, count(*) as n
    from v_lineas_negocio v
    join reportes r on r.id = v.reporte_id
    join cia c on c.id = r.aseguradora_id
    where v.negocio_nuevo is not null
      and v.numero_normalizado is not null
      and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    group by 1, 2
  )
  select
    v.id,
    case
      when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
        then v.fecha_statement
      else coalesce(v.fecha_statement, mes_del_periodo(r.periodo), v.created_at::date)
    end as fecha,
    coalesce(asg.nombre, 'Sin compania'),
    coalesce(v.numero_poliza_crudo, '-'),
    coalesce(cl.nombre, v.nombre_asegurado_crudo, '-'),
    v.tipo_transaccion,
    v.negocio_nuevo,
    v.prima,
    v.monto,
    coalesce(r.periodo, r.nombre_archivo),
    case
      when v.negocio_nuevo is null then 'sin_clasificar'
      when s.senal is not null then 'archivo'
      when coalesce(pp.hay_nueva, false) <> coalesce(pp.hay_renovacion, false) then 'mismo_statement'
      when m.negocio_nuevo is not null then 'a_mano'
      else 'otros_statements'
    end,
    case
      when v.negocio_nuevo is not null then null
      when v.numero_normalizado is null then 'La linea no trae numero de poliza'
      when ev.clave is not null
        then 'La misma poliza aparece como nueva en un statement y como renovacion en otro'
      else 'Esta poliza no aparece clasificada en ningun otro statement'
    end
  from v_lineas_negocio v
  join reportes r on r.id = v.reporte_id
  left join aseguradoras asg on asg.id = r.aseguradora_id
  left join cia c on c.id = r.aseguradora_id
  left join senales s on s.id = v.id
  left join por_poliza pp
    on pp.reporte_id = v.reporte_id and pp.numero_normalizado = v.numero_normalizado
  left join clasificacion_negocio_manual m
    on m.aseguradora_id = r.aseguradora_id and m.numero_normalizado = v.numero_normalizado
  left join evidencia ev on ev.clave = c.clave and ev.num = v.numero_normalizado
  left join polizas p on p.id = v.poliza_id
  left join clientes cl on cl.id = p.cliente_id
  where v.agente_id = p_agente
    and v.estado in ('conciliado_auto', 'conciliado_confirmado')
    and (case
           when coalesce(asg.liquidar_por_fecha_transaccion, false) and v.fecha_statement is not null
             then v.fecha_statement
           else coalesce(mes_del_periodo(r.periodo), v.fecha_statement, v.created_at::date)
         end) between p_desde and p_hasta
  order by 2 desc, 3, 4;
$fn$;

notify pgrst, 'reload schema';
