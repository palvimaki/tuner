import { defineConfig } from "vite";

export default defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        app: new URL("./app/index.html", import.meta.url).pathname,
      },
    },
  },
});
