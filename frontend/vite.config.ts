import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "android" ? "./" : loadEnv(mode, ".").VITE_BASE_PATH || "/",
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
}));
