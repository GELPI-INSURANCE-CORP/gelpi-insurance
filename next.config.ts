import type { NextConfig } from "next";

// La app se sirve en la raíz del dominio propio (app.insurancegelpi.com), así
// que por defecto no hay prefijo de ruta. PAGES_BASE_PATH queda como escape
// por si alguna vez hay que publicarla bajo un subdirectorio.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
