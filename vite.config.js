import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'terser' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    terserOptions: {
      compress: {
        drop_console: true,      // 移除 console.log
        drop_debugger: true,     // 移除 debugger
        pure_funcs: ['console.info', 'console.debug', 'console.warn'],
      },
      mangle: {
        toplevel: true,          // 混淆顶级变量名
        safari10: true,
      },
      format: {
        comments: false,         // 移除所有注释
      },
    },
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'mantine': ['@mantine/core', '@mantine/hooks'],
          'icons': ['lucide-react'],
          'tauri': [
            '@tauri-apps/api',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-fs',
            '@tauri-apps/plugin-opener',
            '@tauri-apps/plugin-process',
            '@tauri-apps/plugin-shell',
            '@tauri-apps/plugin-updater'
          ],
          'i18n': ['i18next', 'react-i18next'],
        }
      }
    },
    // 大项目可关闭压缩报告加速构建
    reportCompressedSize: false,
  },
})
