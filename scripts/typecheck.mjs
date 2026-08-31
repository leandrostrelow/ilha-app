import { spawn } from 'node:child_process';
import path from 'node:path';
import { exists, projectRoot, relative, walk } from './project-files.mjs';

const executable = process.platform === 'win32'
  ? path.join(projectRoot, 'node_modules', '.bin', 'deno.cmd')
  : path.join(projectRoot, 'node_modules', 'deno', 'deno');

if (!await exists(executable)) {
  console.error('Deno local ausente. Execute pnpm install antes do typecheck.');
  process.exit(1);
}

const entries = (await walk())
  .filter((file) => /supabase\/functions\/[^/]+\/index\.ts$/.test(relative(file)))
  .sort();

function check(entry) {
  return new Promise((resolve, reject) => {
    const cwd = path.dirname(entry);
    const child = spawn(executable, ['check', '--quiet', 'index.ts'], { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${relative(entry)} falhou com codigo ${code}.`)));
  });
}

const failures = [];
for (const entry of entries) {
  try {
    await check(entry);
  } catch (error) {
    failures.push(error.message);
  }
}
if (failures.length) {
  console.error(`Typecheck falhou em ${failures.length} Edge Function(s):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Typecheck concluido: ${entries.length} Edge Functions.`);
}
