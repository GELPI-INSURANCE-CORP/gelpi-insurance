-- Gelpi Insurance · limpieza del duplicado creado por la migración de siembra
-- La oficina "GELPI INSURANCE CORP" y el agente "ARTURO GELPI" ya existían en
-- producción desde antes (no vienen de estas migraciones); la migración de siembra
-- comparó nombres con case-sensitive y no los reconoció, así que creó una segunda
-- oficina "Gelpi Insurance Corp (Kendall)" y un segundo agente "Arturo Gelpi".
-- Arturo confirmó: la oficina real es "GELPI INSURANCE CORP" y debe tener a
-- Marleny Carmenate, Nadira LLanes, Greter Rodriguez y Janys Guevara (Nadira ya
-- estaba ahí). Este script mueve a los otros tres, borra el agente duplicado y
-- borra la oficina duplicada.

do $$
declare
  v_oficina_real uuid;
  v_oficina_dup uuid;
  v_agente_dup uuid;
begin
  select id into v_oficina_real from oficinas where nombre = 'GELPI INSURANCE CORP';
  select id into v_oficina_dup from oficinas where nombre = 'Gelpi Insurance Corp (Kendall)';
  select id into v_agente_dup from agentes where nombre = 'Arturo Gelpi';

  if v_oficina_real is null or v_oficina_dup is null then
    raise exception 'No se encontraron las oficinas esperadas (real=%, dup=%)', v_oficina_real, v_oficina_dup;
  end if;

  update agentes set oficina_id = v_oficina_real
   where oficina_id = v_oficina_dup
     and nombre in ('Greter Rodriguez', 'Janys Guevara', 'Marleny Carmenate');

  if v_agente_dup is not null then
    delete from agentes where id = v_agente_dup;
  end if;

  delete from oficinas where id = v_oficina_dup;
end $$;
