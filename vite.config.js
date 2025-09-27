import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/jreader/', // <-- IMPORTANT, replace with your repo name
  plugins: [react()],
})
