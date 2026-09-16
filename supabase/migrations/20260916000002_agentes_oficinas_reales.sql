-- Gelpi Insurance · Módulo Comisiones · alta de oficinas y agentes reales
-- La tabla de agentes solo tenía la cuenta de la casa (CASA/Jose Gelpi); ningún
-- agente real de la agencia, ni las oficinas reales, habían sido cargados nunca.
-- Por eso "Nadira Llanes" y el resto no aparecían en ninguna pantalla (Agentes,
-- Reasignar, Conciliación, etc.) — no era un bug de asignación, faltaba la data.
-- Carga el roster de la sección 7 de la especificación. Zoila Gelpi queda afuera
-- a propósito: la spec la marca explícitamente como CSR, no como agente/productor.

insert into oficinas (nombre, codigo)
select 'Gelpi Insurance Doral', 'DORAL'
where not exists (select 1 from oficinas where codigo = 'DORAL');

insert into oficinas (nombre, codigo)
select 'Gelpi Insurance Miami Lakes', 'MIAMI_LAKES'
where not exists (select 1 from oficinas where codigo = 'MIAMI_LAKES');

insert into oficinas (nombre, codigo)
select 'Gelpi Insurance Palmetto Bay', 'PALMETTO_BAY'
where not exists (select 1 from oficinas where codigo = 'PALMETTO_BAY');

insert into oficinas (nombre, codigo)
select 'Gelpi Insurance Corp (Kendall)', 'KENDALL'
where not exists (select 1 from oficinas where codigo = 'KENDALL');

insert into agentes (nombre, oficina_id)
select v.nombre, o.id
from (values
  ('Thalia Rodriguez', 'DORAL'),
  ('Christian Alvarez', 'DORAL'),
  ('Heidi Vilan', 'MIAMI_LAKES'),
  ('Isabel Diaz Castillo', 'MIAMI_LAKES'),
  ('Santiago Vidal', 'PALMETTO_BAY'),
  ('Nadira LLanes', 'KENDALL'),
  ('Arturo Gelpi', 'KENDALL'),
  ('Marleny Carmenate', 'KENDALL'),
  ('Greter Rodriguez', 'KENDALL'),
  ('Janys Guevara', 'KENDALL')
) as v(nombre, oficina_codigo)
join oficinas o on o.codigo = v.oficina_codigo
where not exists (select 1 from agentes a where a.nombre = v.nombre);
