import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

<<<<<<< HEAD
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
=======
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    define: {
      'import.meta.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'import.meta.env.OPENAI_API_BASE': JSON.stringify(env.OPENAI_API_BASE),
    }
>>>>>>> main
  }
})