-- =========================================================
-- Appalachian Underwriters
-- =========================================================
-- Arturo mando el statement para que el sistema pueda procesarlos.
--
-- El papel se firma "Appalachian Underwriters, Inc." y en el sistema la compania esta cargada
-- como "Appalachian Ins Co", con 16 polizas en el Book y ningun reporte subido todavia. Se
-- registran los alias para que el nombre del documento enganche con la compania que ya existe,
-- en vez de que alguien cree una segunda.
--
-- Como viene el statement, para que quede escrito en algun lado:
--
--   Policy Number | Insured | Effective Date | Total Premium | Collected |
--   Collected Premium Due | Agent Rate | Agent Comm | Previous Paid | Net Comm Due
--
-- Las dos cosas que hay que mirar, y que estan explicadas en el prompt de extraccion:
--
--   1. La comision sale de "Collected", NO de "Total Premium". Una poliza de $808 con $209.47
--      cobrados al 15% paga $31.42. Si se tomara la prima total, se le pagaria al agente por
--      plata que el cliente todavia no puso.
--   2. Lo que deben este periodo es "Net Comm Due" = Agent Comm - Previous Paid. En una poliza
--      que paga en cuotas, "Agent Comm" es el acumulado: tomarlo cobraria la misma comision
--      todos los meses.
--
-- El statement de agosto de 2026 (Agent ID P73362, pagado el 18/8 por EFT) trae 5 polizas,
-- $4,047.00 de prima y $251.30 de comision.

insert into aseguradora_alias (aseguradora_id, texto)
select a.id, v.texto
  from (values
    ('Appalachian Underwriters'),
    ('Appalachian Underwriters, Inc.')   -- sin la puntuacion queda APPALACHIANUNDERWRITERSINC,
                                         -- asi que 'Appalachian Underwriters Inc' seria el
                                         -- mismo alias y chocaria contra si mismo
  ) as v(texto)
  join aseguradoras a on normalizar_nombre(a.nombre) = normalizar_nombre('Appalachian Ins Co')
 where not exists (
   select 1 from aseguradora_alias al
    where al.texto_normalizado = upper(regexp_replace(v.texto, '[^A-Za-z0-9]', '', 'g')));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select a.nombre                                  as compania,
       coalesce(string_agg(al.texto, ' | '), '(sin alias)') as alias,
       (select count(*) from polizas p where p.aseguradora_id = a.id) as polizas_en_el_book
  from aseguradoras a
  left join aseguradora_alias al on al.aseguradora_id = a.id
 where a.nombre ilike '%appalachian%'
 group by a.id, a.nombre;
