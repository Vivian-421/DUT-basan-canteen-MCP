import { build as serverBuild } from 'esbuild';
import { build as webBuild } from 'vite';
await serverBuild({ entryPoints: ['src/http.ts', 'src/stdio.ts', 'src/lib.ts'],
  outdir: 'dist/server', bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
await webBuild();
