/// <reference types="vitest" />
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [],
  test: {
    globals: true,
    //globalSetup: "./tests/globalSetup.ts",
    include: ["./tests/**/*.test.ts"],
    includeSource: ['src/**/*.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, '../../lib'),
    },
  },
})
