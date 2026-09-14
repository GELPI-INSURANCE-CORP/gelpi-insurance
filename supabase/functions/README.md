# Edge Functions · Gelpi Insurance

## extraer-reporte

Extrae datos estructurados de un `reporte` subido (CSV/XLSX/PDF/imagen) usando la API de
Claude (Anthropic, modelo `claude-sonnet-5`) y carga el resultado en `lineas_comision`,
`lineas_venta`, `polizas`/`abb_versiones` o `bonos`/`bono_reparto` según `reportes.tipo`.

### Contrato

```
POST /functions/v1/extraer-reporte
Authorization: Bearer <jwt del usuario>
Content-Type: application/json

{ "reporte_id": "<uuid>" }
```

`verify_jwt` está activado (comportamiento por defecto de la CLI, no hay override en
`supabase/config.toml`), así que la función exige un JWT de usuario válido.

### Deploy

```bash
supabase functions deploy extraer-reporte --project-ref nivuzhqmxcvnubuwbvoh
```

(NO usar `--no-verify-jwt`: queremos que el JWT del usuario se siga validando.)

### Secretos requeridos

La función usa automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` que Supabase
inyecta en toda Edge Function. Falta configurar la key de Anthropic:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref nivuzhqmxcvnubuwbvoh
```

Mientras `ANTHROPIC_API_KEY` no esté seteada, la función responde 500 con
`{"error":"Falta configurar ANTHROPIC_API_KEY en Supabase (supabase secrets set ANTHROPIC_API_KEY=...)"}`
y marca el reporte como `estado='error'` con ese mensaje.

### Notas de implementación

- CSV/XLSX: se parsean localmente (XLSX vía `npm:xlsx`/SheetJS, todas las hojas) y sólo se le
  pide a Claude el mapeo de columnas + metadatos (encabezados + primeras 30 filas). El mapeo se
  aplica localmente a TODAS las filas — así un archivo de 500+ filas no depende del modelo fila
  por fila.
- PDF/imagen: se envían completos (base64, máx ~30 MB) y se le pide a Claude el array `filas`
  completo vía tool-use forzado (`tool_choice: {type:"tool", name:"registrar_extraccion"}`).
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
2. `ANTHROPIC_API_KEY` sin configurar (Jose la va a dar).
3. PDFs muy largos no se trocean por páginas; se envían completos (límite ~30 MB / ~600
   páginas). Si en la práctica esto trunca extracciones, se puede agregar chunking por rango
   de páginas.
4. La resolución de aseguradora/agente/oficina por nombre es simple (match exacto o
   substring); para casos ambiguos puede quedar sin asignar y requerir corrección manual
   desde la UI de excepciones.
