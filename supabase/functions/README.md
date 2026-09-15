# Edge Functions · Gelpi Insurance

## extraer-reporte

Extrae datos estructurados de un `reporte` subido (CSV/XLSX/PDF/imagen) usando la API de
OpenAI (Responses API, modelo configurable — por defecto `gpt-4o-mini` — **con la llave del
cliente**) y carga el resultado en `lineas_comision`, `lineas_venta`, `polizas`/`abb_versiones`
o `bonos`/`bono_reparto` según `reportes.tipo`.

### Contrato

```
POST /functions/v1/extraer-reporte
Authorization: Bearer <jwt del usuario>
Content-Type: application/json

{ "reporte_id": "<uuid>" }
```

`verify_jwt` está activado (comportamiento por defecto de la CLI, no hay override en
`supabase/config.toml`), así que la función exige un JWT de usuario válido.

#### Modo de prueba de conexión

Para el botón "Probar conexión" de Configuración → Conexión de IA:

```
POST /functions/v1/extraer-reporte
Authorization: Bearer <jwt del usuario>
Content-Type: application/json

{ "test_ai": true }
```

Devuelve **siempre HTTP 200** con `{ ok: true, model, latency_ms }` o `{ ok: false, error }`.
También acepta probar una llave/modelo ANTES de guardarlos:

```json
{ "test_ai": true, "api_key": "sk-...", "model": "gpt-4o-mini" }
```

### Deploy

```bash
supabase functions deploy extraer-reporte --project-ref nivuzhqmxcvnubuwbvoh
```

(NO usar `--no-verify-jwt`: queremos que el JWT del usuario se siga validando.)

### Origen de la llave/modelo de OpenAI

La función busca, en este orden:

1. Tabla `configuracion` (claves `openai_api_key` y `openai_model`, valores jsonb) — esto es
   lo que llena la pantalla Configuración → Conexión de IA cuando el cliente pega su propia
   llave.
2. Secreto de proyecto `OPENAI_API_KEY` (fallback), como respaldo/uso interno:

   ```bash
   supabase secrets set OPENAI_API_KEY=sk-... --project-ref nivuzhqmxcvnubuwbvoh
   ```

3. Si no hay modelo configurado, se usa `gpt-4o-mini` por defecto.

Si no hay ninguna llave disponible (ni en `configuracion` ni en el secreto), la función
responde 500 con
`{"error":"Falta configurar la llave de OpenAI en Configuración → Conexión de IA"}`
y marca el reporte como `estado='error'` con ese mensaje (el modo `test_ai` devuelve el mismo
texto en `error`, pero con status 200).

### Notas de implementación

- CSV/XLSX: se parsean localmente (XLSX vía `npm:xlsx`/SheetJS, todas las hojas) y sólo se le
  pide al modelo el mapeo de columnas + metadatos (encabezados + primeras 30 filas). El mapeo
  se aplica localmente a TODAS las filas — así un archivo de 500+ filas no depende del modelo
  fila por fila.
- PDF: se manda como `input_file` (Responses API) con `filename` + `file_data` en data URL
  base64 (`data:application/pdf;base64,...`). Imagen: como `input_image` con `image_url` en
  data URL. Se pide el array `filas` completo.
- Salida estructurada vía `text.format = { type: "json_schema", name: "registrar_extraccion",
  strict: true, schema }`, reutilizando el mismo esquema de datos que antes tenía la tool
  `registrar_extraccion` de Anthropic (y su variante de ventas), para que el resto del código
  (inserción en `lineas_comision`/`lineas_venta`/`polizas`/`bonos` y las RPC) no cambie. Como
  OpenAI en modo `strict` no soporta objetos de forma libre, `mapeo_columnas` y `campos_extra`
  viajan como STRING con JSON codificado y se parsean en `normalizarExtraccion()`.
- Si el modelo devuelve JSON inválido (poco probable con `strict:true`, pero puede pasar por
  truncamiento), se reintenta UNA vez pidiendo explícitamente sólo JSON.
- Fechas normalizadas a ISO `YYYY-MM-DD`; montos a número (negativos para chargebacks).
- Todo lo que no matchea a un campo conocido se guarda en `campos_extra` de cada fila.
- Resolución de agente/oficina en `actualizacion_abb` y `bono_contingencia`: comparación de
  texto normalizado (sin acentos, mayúsculas, sólo alfanumérico) en JS — exacta o por
  inclusión. No hay fuzzy matching real (Levenshtein); si el nombre del archivo difiere mucho
  del nombre en `agentes`/`oficinas`, queda sin asignar.

### Pendientes / limitaciones conocidas

1. Verificación end-to-end en vivo **bloqueada**: el proyecto Supabase
   (`nivuzhqmxcvnubuwbvoh`) está actualmente restringido por Supabase
   (`exceed_storage_size_quota`, HTTP 402 en todas las rutas, incluida esta función) — hay que
   resolver el billing/spend cap del proyecto antes de poder probar en vivo.
2. Ninguna llave de OpenAI configurada todavía (ni en `configuracion` ni como secreto) — el
   cliente la va a cargar desde Configuración → Conexión de IA.
3. PDFs muy largos no se trocean por páginas; se envían completos (límite ~30 MB). Si en la
   práctica esto trunca extracciones, se puede agregar chunking por rango de páginas.
4. La resolución de aseguradora/agente/oficina por nombre es simple (match exacto o
   substring); para casos ambiguos puede quedar sin asignar y requerir corrección manual
   desde la UI de excepciones.
