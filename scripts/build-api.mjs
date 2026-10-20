import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('api', { recursive: true });

await build({
  entryPoints: ['serverless-api-entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: 'tsconfig.json',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});
