import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // vitest 运行时读取该字段；类型来自 vitest/config，这里避免引入它内嵌的 vite 类型副本
  ...({ test: { setupFiles: './src/test/setup.ts' } } as object),
} satisfies UserConfig)
