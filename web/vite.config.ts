import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // 请确认你的后端是否运行在 3000 端口，如果是其他端口(如 8000)请在此修改
        target: 'http://localhost:3000', 
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  }
})