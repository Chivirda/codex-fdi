import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
const ui = await build({ entryPoints: ['src/ui/index.ts'], bundle: true, write: false, format: 'iife', target: 'es2020' });
const css = await readFile('src/ui/style.css', 'utf8');
const html = (await readFile('src/ui/index.html', 'utf8'))
  .replace(/<link\b[^>]*href=["']\.\/style\.css["'][^>]*>/, () => `<style>${css}</style>`)
  .replace(/<script\b[^>]*src=["']\.\/index\.ts["'][^>]*><\/script>/, () => `<script>${ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
if (/src=["']\.\/index\.ts|href=["']\.\/style\.css/.test(html)) throw new Error('UI assets were not inlined');
await writeFile('dist/ui.html', html);
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/code.js', bundle: true, format: 'iife', target: 'es2020' });
console.log('Built dist/code.js and dist/ui.html');
