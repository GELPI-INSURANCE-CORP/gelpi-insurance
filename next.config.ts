import type { NextConfig } from "next";

const isPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: isPages ? "/gelpi-insurance" : "",
  assetPrefix: isPages ? "/gelpi-insurance/" : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
