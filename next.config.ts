import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/config";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: BASE_PATH,
  assetPrefix: BASE_PATH,
};

export default nextConfig;
