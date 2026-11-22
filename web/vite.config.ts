import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util"], globals: { Buffer: true } })],
  server: { port: Number(process.env.WEB_PORT || 5199), fs: { allow: [".."] } },
  build: { outDir: "../dist", emptyOutDir: true },
});
