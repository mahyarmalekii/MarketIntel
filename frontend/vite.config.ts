import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // In dev, proxy /api calls to the local backend so CORS is not an issue
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:2860",
        changeOrigin: true,
      },
      "/ws": {
        target: (process.env.VITE_BACKEND_URL ?? "http://localhost:2860").replace("http", "ws"),
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
