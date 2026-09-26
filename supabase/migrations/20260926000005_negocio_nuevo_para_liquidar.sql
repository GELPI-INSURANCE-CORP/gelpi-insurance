-- =========================================================
-- Saber qué línea es negocio nuevo y cuál es renovación
-- =========================================================
-- A los agentes se les paga un porcentaje SOLO del negocio nuevo. Las renovaciones no se pagan.
-- Hasta ahora la liquidación tomaba la comisión entera del agente y le aplicaba el porcentaje,
-- así que estaba pagando renovaciones sin querer.
--
-- Lo primero es poder distinguirlas, y el dato tiene que salir del archivo de la compañía — no
-- de una suposición del sistema. Cada una lo dice a su manera:
--
--   Progressive  ->  columna "Renewal Count": 0 = primer término, 1 o más = ya renovó.
--                    Es la mejor señal de todas porque viene en CADA línea, incluidos los
--                    endosos y las cancelaciones. Medido en agosto: 147 líneas en 0 y 31 en 1+.
--   GEICO        ->  el rótulo de sección: "First Year Commission" contra "Renewal Year
--                    Commission". También viene en cada línea.
--   Kemper, National General, United  ->  el código de transacción de la propia línea
--                    (New / Renewal). Pero sus endosos y cancelaciones no dicen a qué término
--                    pertenecen, así que para esos hay que mirar la póliza.
--
-- LA REGLA DE FONDO, que es la que pidió Arturo: una línea pertenece a negocio nuevo o a
-- renovación SEGÚN LA PÓLIZA, no según la línea. Si la póliza es nueva, todo lo que le pase ese
-- mes cuenta — el endoso que le suma y la cancelación que le resta. Si es renovación, no cuenta
-- nada.
--
-- Lo que NO se puede clasificar queda en null a propósito, y la pantalla de liquidación lo
-- muestra aparte. Adivinar acá sería pagarle de más o de menos a alguien sin que nadie se entere.

-- ---------------------------------------------------------
-- 1. La señal que trae cada línea por sí misma
-- ---------------------------------------------------------
create or replace function senal_negocio_nuevo(
  p_campos_extra jsonb,
  p_tipo text
) returns boolean
language plpgsql immutable as $$
declare
  v_rc text;
  v_sec text;
begin
  -- Progressive: "Renewal Count". Se lee con cuidado porque puede venir vacío o con texto.
  v_rc := btrim(coalesce(p_campos_extra->>'Renewal Count', ''));
  if v_rc <> '' and v_rc ~ '^[0-9]+$' then
    return v_rc::int = 0;
  end if;

  -- GEICO: el rótulo de la sección del archivo.
  v_sec := coalesce(p_campos_extra->>'_seccion_del_reporte', '');
  if v_sec ilike '%first year%' or v_sec ilike '%new business%' then return true; end if;
  if v_sec ilike '%renewal%' or v_sec ilike '%renovac%' then return false; end if;

  -- El resto: lo que diga el tipo de la propia línea. Endoso, cancelación y ajuste no dicen
  -- nada por sí mismos — se resuelven mirando la póliza, en la vista de abajo.
  if p_tipo = 'nueva' then return true; end if;
  if p_tipo = 'renovacion' then return false; end if;
  return null;
end $$;

-- ---------------------------------------------------------
-- 2. La clasificación final, con la póliza como desempate
-- ---------------------------------------------------------
-- Si la línea no lo dice, se mira si alguna OTRA línea de la misma póliza en el mismo statement
-- lo dice. Así el endoso de una póliza nueva cuenta como nuevo, y el de una renovación no.
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
    else null
  end as negocio_nuevo
from base b
left join por_poliza p
  on p.reporte_id = b.reporte_id and p.numero_normalizado = b.numero_normalizado;

-- ---------------------------------------------------------
-- 3. Lo que hay que pagarle a cada agente en un período
-- ---------------------------------------------------------
-- Devuelve las tres cifras por separado en vez de una sola, para que la pantalla pueda mostrar
-- qué se está pagando y qué no. La que se paga es la primera; las otras dos están para que se
-- vean, sobre todo "sin_clasificar": si eso tiene plata, hay algo que revisar antes de pagar.
--
-- Los fees de la compañía (MVR, informes de suscripción) y los ajustes no entran en ninguna:
-- van a la cuenta de la casa y los absorbe la agencia, no se le descuentan a nadie.
create or replace function liquidacion_negocio_nuevo(p_desde date, p_hasta date)
returns table (
  agente_id uuid,
  agente text,
  oficina text,
  pct numeric,
  comision_nuevo numeric,
  comision_renovacion numeric,
  comision_sin_clasificar numeric,
  a_pagar numeric
)
language sql stable as $$
  select
    a.id,
    a.nombre,
    coalesce(o.nombre, 'Sin oficina'),
    a.pct_split_default,
    round(coalesce(sum(v.monto) filter (where v.negocio_nuevo is true), 0), 2),
    round(coalesce(sum(v.monto) filter (where v.negocio_nuevo is false), 0), 2),
    round(coalesce(sum(v.monto) filter (where v.negocio_nuevo is null), 0), 2),
    round(coalesce(sum(v.monto) filter (where v.negocio_nuevo is true), 0) * a.pct_split_default / 100, 2)
  from agentes a
  left join oficinas o on o.id = a.oficina_id
  left join v_lineas_negocio v
    on v.agente_id = a.id
   and v.estado in ('conciliado_auto', 'conciliado_confirmado')
   and coalesce(mes_del_periodo(
         (select r.periodo from reportes r where r.id = v.reporte_id)
       ), v.fecha_statement, v.created_at::date) between p_desde and p_hasta
  where coalesce(a.es_casa, false) = false
  group by a.id, a.nombre, o.nombre, a.pct_split_default
  order by 5 desc;
$$;

notify pgrst, 'reload schema';
