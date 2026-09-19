import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/config";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: BASE_PATH,
  assetPrefix: BASE_PATH,
  // next dev がコーディングエージェント検出時に AGENTS.md / CLAUDE.md を自動生成・追記するのを止める。
  // CLAUDE.md はこのリポジトリの規約文書として手書きで管理する。
  agentRules: false,
};

export default nextConfig;
