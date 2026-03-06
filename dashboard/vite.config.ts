import { defineConfig } from "vite"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "path"

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  base: "/dashboard/",
  build: {
    outDir: resolve(__dirname, "../dist/dashboard-static"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4201",
    },
  },
})
