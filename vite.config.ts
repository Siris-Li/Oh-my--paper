import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          if (id.includes("react-pdf") || id.includes("pdfjs-dist")) {
            return "pdf";
          }
          if (id.includes("pdf-lib")) {
            return "pdfgen";
          }
          if (id.includes("@uiw/react-codemirror") || id.includes("@codemirror")) {
            return "editor";
          }
          if (id.includes("node_modules")) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
})
