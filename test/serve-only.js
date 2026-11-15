import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { url } = await startServer(root);
console.log(`编辑器已启动: ${url}`);
