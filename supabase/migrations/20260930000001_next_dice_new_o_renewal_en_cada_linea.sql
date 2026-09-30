-- =========================================================
-- NEXT dice "New" o "Renewal" en cada línea
-- =========================================================
-- El statement de NEXT Insurance trae una columna "New Renewal" con el valor literal "New" o
-- "Renewal" en cada póliza. Es de las señales más limpias que manda una compañía — mejor que el
-- código de transacción, que hay que interpretar, y comparable al "Renewal Count" de Progressive.
--
-- Sin esto, sus 16 líneas caerían en "sin clasificar" y habría que decidirlas a mano una por una
-- cuando el archivo ya lo dice.
--
-- Se lee desde campos_extra: el mapeo de columnas manda al campo `tipo_transaccion` el código de
-- movimiento, y esta columna es otra cosa — dice a qué término pertenece la póliza, no qué pasó
-- con ella. Las dos conviven: una póliza puede ser "Renewal" y traer una cancelación.
--
-- El orden de las señales no cambia: esta se lee antes del tipo de la línea y después del
-- "Renewal Count" de Progressive y de la sección de GEICO, que son igual de explícitas.

create or replace function senal_negocio_nuevo(
  p_campos_extra jsonb,
  p_tipo text
) returns boolean
language plpgsql immutable as $fn$
declare
  v_rc text;
  v_sec text;
  v_nr text;
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

  -- NEXT: columna "New Renewal", con el valor escrito tal cual. Se aceptan variantes del nombre
  -- de la columna porque el exportador de la compañía puede cambiarle el guion o el espacio de
  -- un mes a otro, y perder la señal por eso mandaría el statement entero a "sin clasificar".
  v_nr := btrim(coalesce(
    p_campos_extra->>'New Renewal',
    p_campos_extra->>'New/Renewal',
    p_campos_extra->>'New-Renewal',
    p_campos_extra->>'NewRenewal',
    ''
  ));
  if v_nr <> '' then
    if v_nr ilike 'new%' then return true; end if;
    if v_nr ilike 'renew%' or v_nr ilike 'renov%' then return false; end if;
  end if;

  -- El resto: lo que diga el tipo de la propia línea. Endoso, cancelación y ajuste no dicen
  -- nada por sí mismos — se resuelven mirando la póliza, en v_lineas_negocio.
  if p_tipo = 'nueva' then return true; end if;
  if p_tipo = 'renovacion' then return false; end if;
  return null;
end $fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Que no se haya movido nada de lo que ya estaba clasificado
-- ---------------------------------------------------------
-- La señal nueva solo se consulta cuando las dos de arriba no dijeron nada, así que ninguna
-- línea existente debería cambiar de lado. Esto lo comprueba en vez de suponerlo.
select
  count(*) filter (where negocio_nuevo is true)  as negocio_nuevo,
  count(*) filter (where negocio_nuevo is false) as renovacion,
  count(*) filter (where negocio_nuevo is null)  as sin_clasificar
from v_lineas_negocio
where estado in ('conciliado_auto', 'conciliado_confirmado');
