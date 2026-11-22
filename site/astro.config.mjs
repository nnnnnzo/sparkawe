import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://sparkawe.vercel.app",
  trailingSlash: "always",
  build: { format: "directory" },
  i18n: {
    locales: ["en", "fr"],
    defaultLocale: "en",
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap()],
  vite: {
    server: {
      fs: { allow: [".."] },
    },
  },
});
