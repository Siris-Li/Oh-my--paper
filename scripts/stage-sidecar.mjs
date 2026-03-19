import { mkdirSync, copyFileSync } from 'fs';

const src = 'sidecar/dist/index.mjs';
const dest = 'src-tauri/resources/sidecar/dist/index.mjs';

mkdirSync('src-tauri/resources/sidecar/dist', { recursive: true });
copyFileSync(src, dest);
console.log(`Staged ${src} → ${dest}`);
