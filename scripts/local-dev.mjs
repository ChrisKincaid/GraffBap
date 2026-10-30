import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_USE_EMULATORS: 'true' },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
