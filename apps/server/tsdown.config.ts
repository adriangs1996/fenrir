import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin.ts", "src/mcp/browserLabRunner.ts", "src/mcp/remoteHostRunner.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: (id) => id.startsWith("@fenrir/"),
  inlineOnly: false,
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
