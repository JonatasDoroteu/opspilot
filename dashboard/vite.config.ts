import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
