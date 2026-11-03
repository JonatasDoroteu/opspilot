import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
  server: {
    proxy: {
      // Para produção, troque o destino para https://opspilot-yme6.onrender.com.
      '/incidents': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/runbooks': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
