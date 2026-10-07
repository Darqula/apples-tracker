import { DEFAULT_API_PORT } from "../scripts/ports.mjs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT ?? DEFAULT_API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
