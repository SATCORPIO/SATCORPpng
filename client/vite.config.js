import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 3000,
    // Dev proxy — forwards /api and /socket.io to local backend during development
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    // Increase chunk size warning limit — App.jsx is intentionally large
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ['react', 'react-dom'],
          socketio: ['socket.io-client'],
        },
      },
    },
  },

  // Expose VITE_ prefixed env vars to the client bundle
  // Set VITE_API_URL and VITE_SOCKET_URL in Netlify's environment variables
  envPrefix: 'VITE_',
});
