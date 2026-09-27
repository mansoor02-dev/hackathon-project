import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.BACKEND_PROXY_TARGET;

  if (!backendTarget) {
    throw new Error("Set BACKEND_PROXY_TARGET in frontend/.env.local");
  }

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      proxy: {
        "/health": backendTarget,
        "/api": backendTarget,
      },
    },
  };
});