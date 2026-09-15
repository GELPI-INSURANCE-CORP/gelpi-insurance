// Restaura out/404.html desde public/404.html después de `next build`.
//
// Con output:'export' y sin src/app/not-found.tsx, Next.js primero copia
// public/ (incluido nuestro 404.html con el redirect a basePath) a out/,
// pero luego genera su propia página estática para la ruta interna
// "_not-found" y la escribe también como out/404.html, pisando la copia
// de public/404.html. El resultado en GitHub Pages es la página genérica
// de Next ("This page could not be found") en vez del redirect a
// /gelpi-insurance/ que necesita el export estático.
//
// Este script se corre después del build (hook "postbuild" de npm y, para
// build:pages en Windows, desde scripts/build-pages.mjs) y vuelve a copiar
// public/404.html sobre out/404.html para que el redirect quede como
// fallback real.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "public", "404.html");
const dest = path.join(root, "out", "404.html");

if (!existsSync(src)) {
  console.warn("[copy-404] public/404.html no existe, se omite.");
  process.exit(0);
}

if (!existsSync(dest)) {
  // No hay out/ (build falló o no es un export estático): nada que hacer.
  console.warn("[copy-404] out/404.html no existe, se omite.");
  process.exit(0);
}

copyFileSync(src, dest);
console.log("[copy-404] out/404.html restaurado desde public/404.html.");
