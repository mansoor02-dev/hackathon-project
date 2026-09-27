import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendTarget = env.BACKEND_PROXY_TARGET;

  if (command === "serve" && !backendTarget) {
    throw new Error("Set BACKEND_PROXY_TARGET in frontend/.env.local");
  }

  const config = {
    plugins: [react()],
  };

  if (command === "serve") {
    config.server = {
      host: "0.0.0.0",
      proxy: {
        "/health": backendTarget,
        "/api": backendTarget,
      },
    };
  }

  return config;
});