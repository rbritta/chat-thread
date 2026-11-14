// Builds dist/chat-thread.global.js (a classic <script> that defines window.ChatThread),
// dist/chat-thread.mjs (the same code as one ES module) and copies the stylesheet.
// No bundler: the two source modules are small and flat.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const core = await readFile(`${root}src/core.js`, 'utf8');
const chat = await readFile(`${root}src/chat-thread.js`, 'utf8');

const names = (src) => [...src.matchAll(/^export (?:const|function|class|async function) (\w+)/gm)].map((m) => m[1]);
const all = [...names(chat), ...names(core)];

// Both files share one scope in the bundle: a top-level name in both would shadow the other
// one silently (a function) or break the script (a const). Refuse to build instead.
const declared = (src) => [...src.matchAll(/^(?:export )?(?:const|let|var|function|class|async function) (\w+)/gm)].map((m) => m[1]);
const clash = declared(chat).filter((name) => declared(core).includes(name));
if (clash.length) throw new Error(`src/core.js and src/chat-thread.js both declare: ${clash.join(', ')}`);

const strip = (src) => src.split(String.fromCharCode(13)).join('')
  .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
  .replace(/^export \* from '[^']+';\n/gm, '')
  .replace(/^export default \w+;\n/gm, '')
  .replace(/^export (const|function|class|async function) /gm, '$1 ');

const banner = `/*! chat-thread v${pkg.version} | MIT | ${pkg.homepage} */`;
const body = `${strip(core)}\n${strip(chat)}`;

const global = `${banner}
(function (global) {
'use strict';
${body}
global.ChatThread = { ${all.join(', ')} };
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
const esm = `${banner}
${body}
export { ${all.join(', ')} };
export default createChat;
`;

await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/chat-thread.global.js`, global);
await writeFile(`${root}dist/chat-thread.mjs`, esm);
await copyFile(`${root}src/chat-thread.css`, `${root}dist/chat-thread.css`);
console.log(`dist/chat-thread.global.js (${(global.length / 1024).toFixed(1)} kB), dist/chat-thread.mjs, dist/chat-thread.css`);
