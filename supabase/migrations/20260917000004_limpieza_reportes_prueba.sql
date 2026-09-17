-- Gelpi Insurance · limpieza de los reportes de prueba de esta semana
-- Borra los 2 reportes que se subieron mientras probábamos el sistema:
--   - "Active Book of Business by Class United.pdf" (quedó en error, nunca cargó nada:
--     polizas sigue en 0 filas, no hay nada más que limpiar de éste).
--   - "101418_August_statement (1).PDF" (se subió/reintentó varias veces por los timeouts
--     de esa época; quedó contaminado con líneas repetidas — de ahí los ~155 "duplicados
--     sospechosos" y ~106 "en_espera").
-- No toca agentes, oficinas, ni ninguna configuración — solo estos 2 reportes y lo que
-- generaron (sus líneas de comisión y las excepciones abiertas sobre ellas).

delete from excepciones
 where linea_comision_id in (
   select id from lineas_comision
    where reporte_id in (
      select id from reportes where nombre_archivo in (
        'Active Book of Business by Class United.pdf',
        '101418_August_statement (1).PDF'
      )
    )
 );

delete from lineas_comision
 where reporte_id in (
   select id from reportes where nombre_archivo in (
     'Active Book of Business by Class United.pdf',
     '101418_August_statement (1).PDF'
   )
 );

delete from reportes
 where nombre_archivo in (
   'Active Book of Business by Class United.pdf',
   '101418_August_statement (1).PDF'
 );
