import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/vazirmatn-variable.woff2', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'حساب طلا',
        short_name: 'حساب طلا',
        description: 'حسابداری طلا و سکه — واحد پایه طلاست، نه ریال',
        lang: 'fa',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf9f7',
        theme_color: '#1c1917',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
      devOptions: {
        // در توسعه سرویس‌ورکر خاموش است تا رفتار HMR گیج‌کننده نشود
        enabled: false,
      },
    }),
  ],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // BigInt به ES2020 به بالا نیاز دارد
    target: 'es2022',
    cssCodeSplit: true,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // ECharts فقط در گزارش‌ها لازم است — از بسته‌ی اولیه بیرون بماند
        manualChunks: {
          echarts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
