# Gelpi Insurance — Panel interno

Dashboard interno para Gelpi Insurance: pólizas, clientes, reclamos y comisiones.

## Stack

- [Next.js 16](https://nextjs.org/) (App Router) + TypeScript
- Tailwind CSS v4
- [Supabase](https://supabase.com/) como backend (aún no conectado — ver abajo)

## Desarrollo

```bash
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## Módulo Comisiones

Conciliación de comisiones de aseguradoras contra el **Active Business Book** (libro maestro de clientes/pólizas con agente y oficina).

- **Resumen** — KPIs del período, excepciones urgentes, comparativo por oficina y por aseguradora.
- **Subir Reportes** — statements de aseguradoras, ventas internas, bonos y Active Business Book; extracción con IA (Edge Function `extraer-reporte`), bloqueo de archivos duplicados por hash.
- **Conciliación** — bandeja de excepciones (Mismatch · Sin identificar · Duplicados · Conflictos de venta) resueltas con un panel lateral y auditoría.
- **Agentes** — ficha con TODAS las comisiones por aseguradora/período, bonos aparte y "por qué se atribuyó".
- **Clientes (Book)** — el Active Business Book: quién es dueño de cada póliza; alta manual, conflictos, snapshots.
- **Oficinas**, **Bonos**, **Configuración** (alias de la agencia, umbrales de score, plantillas por aseguradora).

Esquema y motor de matching en `supabase/migrations/20260914000001_init.sql`; boceto de diseño en `design/`.

## Despliegue

La app se publica como export estático en GitHub Pages: **https://graveranarango.github.io/gelpi-insurance/**

- Cada push a `main` dispara `.github/workflows/deploy.yml`: build (`npm ci` + `npm run build` con `GITHUB_PAGES=true`) → sube `out/` como artifact de Pages → deploy.
- `next.config.ts` arma `basePath`/`assetPrefix` como `/gelpi-insurance` solo cuando `GITHUB_PAGES=true`.
- Localmente podés simular el build de Pages con `npm run build:pages` (usa `scripts/build-pages.mjs`, compatible Windows/Linux sin `cross-env`).
- `public/404.html` redirige rutas no pre-renderizadas hacia el `basePath`, necesario para SPA en Pages.

**Secretos del repo (GitHub → Settings → Secrets and variables → Actions):**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Para rotar llaves: actualizá el valor en Supabase y después `gh secret set NEXT_PUBLIC_SUPABASE_URL --repo graveranarango/gelpi-insurance` (y lo mismo para `NEXT_PUBLIC_SUPABASE_ANON_KEY`), pasando el valor nuevo. El próximo push a `main` (o un re-run manual del workflow) toma el valor actualizado.

**Estado de GitHub Pages:** el repo es privado y la cuenta está en plan Free — GitHub Pages en repos privados requiere plan Pro/Team. Falta decidir: pasar el repo a público (`gh repo edit graveranarango/gelpi-insurance --visibility public --accept-visibility-change-consequences`) o subir de plan. El workflow y los secretos ya están listos; solo falta habilitar Pages (`gh api -X POST repos/graveranarango/gelpi-insurance/pages -f build_type=workflow`) una vez resuelto lo anterior.

## Producción

- Proyecto Supabase: `nivuzhqmxcvnubuwbvoh`
- Edge Function: `extraer-reporte`
- Pendiente: setear el secreto `ANTHROPIC_API_KEY` de la función:

```bash
supabase secrets set ANTHROPIC_API_KEY=... --project-ref nivuzhqmxcvnubuwbvoh
```
