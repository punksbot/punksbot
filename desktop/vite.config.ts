import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => {
  return {
    plugins: [react()],
    publicDir: false,
    build: {
      emptyOutDir: true,
      outDir: path.resolve(__dirname, "dist"),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@features-manifest": path.resolve(
          __dirname,
          "../preview-features.json",
        ),
        "@model-capabilities-manifest": path.resolve(
          __dirname,
          "../scripts/model-capabilities.json",
        ),
      },
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: parseInt(process.env.VITE_PORT || "1420", 10),
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: parseInt(process.env.VITE_HMR_PORT || "1421", 10),
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
