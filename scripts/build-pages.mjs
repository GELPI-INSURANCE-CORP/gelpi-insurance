// Build para GitHub Pages en Windows y Linux sin depender de `cross-env`.
// La app se publica en la raíz del dominio propio, así que esto es un
// `next build` normal; el script existe para restaurar out/404.html después.
import { execSync } from "node:child_process";

execSync("next build", {
  stdio: "inherit",
  env: process.env,
});

// next build no dispara el hook "postbuild" de npm porque no se invocó vía
// `npm run build`, así que restauramos out/404.html a mano acá también.
execSync("node scripts/copy-404.mjs", {
  stdio: "inherit",
  env: process.env,
});
