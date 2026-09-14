// Build for GitHub Pages en Windows y Linux sin depender de `cross-env`.
// Setea GITHUB_PAGES=true en process.env y corre `next build` en un proceso
// hijo (heredando ese env), para que next.config.ts arme basePath/assetPrefix.
import { execSync } from "node:child_process";

process.env.GITHUB_PAGES = "true";

execSync("next build", {
  stdio: "inherit",
  env: process.env,
});
