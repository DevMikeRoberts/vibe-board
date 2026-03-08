import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// API_URL can override the default proxy target
const apiTarget = process.env.API_URL || 'http://localhost:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 8081,
    allowedHosts: true,
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: apiTarget.replace('http', 'ws'),
        ws: true,
      },
    },
  },
});
