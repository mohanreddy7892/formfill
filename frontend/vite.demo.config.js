import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-file offline demo: one JS bundle + one CSS file, inlined into demo.html by build_demo.py
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist-demo", assetsInlineLimit: 100000000, cssCodeSplit: false,
           rollupOptions: { input: "src/demo-main.jsx", output: { entryFileNames: "demo.js", assetFileNames: "demo.[ext]", inlineDynamicImports: true } } },
});
