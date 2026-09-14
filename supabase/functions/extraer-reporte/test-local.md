# Probar extraer-reporte localmente

1. Levantar Supabase local (Postgres + Studio + Storage + Edge Runtime):

   ```bash
   supabase start
   ```

2. Setear los secretos que la función necesita en local (además de
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, que la CLI inyecta sola):

   ```bash
   # crear supabase/.env.local (NO commitear) con:
   # ANTHROPIC_API_KEY=sk-ant-...
   supabase functions serve extraer-reporte --env-file supabase/.env.local
   ```

   Por defecto `serve` valida el JWT (igual que en producción). Si sólo querés probar la
   lógica sin pelear con auth, agregá `--no-verify-jwt` (SOLO local, nunca en el deploy real).

3. Crear un reporte de prueba y subir un archivo al bucket `reportes` (con Storage local o
   contra el Studio en `http://localhost:54323`):

   ```sql
   insert into reportes (tipo, nombre_archivo, storage_path, mime, hash_archivo)
   values ('comision_aseguradora', 'progressive_agosto.csv', 'test/progressive_agosto.csv', 'text/csv', 'hash-de-prueba-1')
   returning id;
   ```

   (Subí el archivo real a esa `storage_path` en el bucket `reportes`, por ejemplo con el
   Studio local o `supabase storage cp`.)

4. Conseguir un JWT de un usuario autenticado (o el `anon`/`service_role` key local si
   corriste `serve` con `--no-verify-jwt`) y llamar la función:

   ```bash
   curl -i -X POST http://127.0.0.1:54321/functions/v1/extraer-reporte \
     -H "Authorization: Bearer <jwt>" \
     -H "Content-Type: application/json" \
     -d '{"reporte_id":"<uuid del paso 3>"}'
   ```

5. Verificar en la base:

   ```sql
   select estado, error, total_lineas, mapeo_columnas, resumen_ia from reportes where id = '<uuid>';
   select * from lineas_comision where reporte_id = '<uuid>' order by fila limit 20;
   select * from v_excepciones where reporte_id = '<uuid>';
   ```

## Probar sólo CORS (sin tocar la base)

```bash
curl -i -X OPTIONS http://127.0.0.1:54321/functions/v1/extraer-reporte
# esperado: 200 con Access-Control-Allow-Origin: *
```

## Notas

- `supabase functions serve` recompila con hot-reload (`policy = "per_worker"` en
  `config.toml`), así que podés editar `index.ts` y volver a pegarle al endpoint sin reiniciar.
- Si falta `ANTHROPIC_API_KEY`, la función responde 500 con un mensaje explícito y marca el
  reporte en `estado='error'` — es el comportamiento esperado hasta que Jose dé la key.
