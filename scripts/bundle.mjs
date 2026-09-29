// Bundles the server into one file, dist/mcp-multi-gmail.mjs, with all
// libraries inside: the user needs only Node.js, no npm install, and
// Miládka's folder gets one file instead of thousands in node_modules.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/mcp-multi-gmail.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'eof',
  define: { __MG_VERSION__: JSON.stringify(version) },
  // Some bundled CommonJS libraries call require(); give them one.
  banner: { js: "import { createRequire as __mgCreateRequire } from 'node:module'; const require = __mgCreateRequire(import.meta.url);" },
});
console.log(`dist/mcp-multi-gmail.mjs ${version}`);
