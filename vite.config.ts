import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.GITHUB_ACTIONS ? "/backyard-bird-tracker/" : "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Backyard Bird Tracker",
        short_name: "Birds",
        description: "Tap-to-count backyard bird logger with eBird CSV export.",
        theme_color: "#15803d",
        background_color: "#ffffff",
        display: "standalone",
        start_url: base,
        icons: [
          {
            src: `${base}icon-192.png`,
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: `${base}icon-512.png`,
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: `${base}icon-512.png`,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }
            }
          }
        ]
      }
    })
  ]
});
