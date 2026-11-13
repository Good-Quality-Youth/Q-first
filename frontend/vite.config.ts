import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` → dist-single/index.html 한 파일(미리보기 공유용)
export default defineConfig(({ mode }) => ({
  base: './',
  server: { proxy: { '/api/v1': 'http://127.0.0.1:18091' } },
  assetsInclude: ['**/*.glb'],
  plugins: [react(), tailwindcss(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: mode === 'single' ? { outDir: 'dist-single' } : undefined,
}))
