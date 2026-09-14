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

## Estado actual

El panel corre hoy con datos de ejemplo (`src/lib/mock-data.ts`) para poder ver la UI completa sin depender de una base de datos. Los módulos:

- **Dashboard** — KPIs (pólizas activas, clientes, reclamos abiertos, comisiones pendientes) y pólizas recientes.
- **Pólizas** — listado completo con prima, vigencia y estado.
- **Clientes** — contacto y pólizas activas por cliente.
- **Reclamos** — seguimiento de estado (abierto, en revisión, aprobado, pagado, rechazado).
- **Comisiones** — comisiones por agente, período y estado de pago.

## Conectar Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com).
2. Copiá `.env.example` a `.env.local` y completá `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. `src/lib/supabase.ts` ya expone un cliente listo para usar (`supabase`, y `isSupabaseConfigured` para chequear si están las variables).
4. Reemplazar los imports de `src/lib/mock-data.ts` por consultas reales a Supabase en cada página, una por una.
