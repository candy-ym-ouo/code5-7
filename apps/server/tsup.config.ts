import { defineConfig } from 'tsup';

// 工作区包（contracts/game-core）只有 .ts 源码与 .d.ts 产物，
// 运行 dist 的纯 Node 环境没有 tsx 加载器，因此只把这两个工作区包打进 bundle；
// 第三方依赖保持外置，node:sqlite 由构建后脚本改写为内置模块。
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  noExternal: [/@shanhai\//]
});
