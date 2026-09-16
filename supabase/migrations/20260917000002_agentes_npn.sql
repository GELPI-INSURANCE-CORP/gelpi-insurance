-- Gelpi Insurance · agrega NPN (National Producer Number) al agente
-- Campo de licencia que Apizeal captura al dar de alta un usuario; lo agregamos
-- para poder llevarlo también aquí, sin invitación/login (eso queda para más
-- adelante) — por ahora "Nuevo agente" sigue siendo solo un registro interno.

alter table agentes add column if not exists npn text;
