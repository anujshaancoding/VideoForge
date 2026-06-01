#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dev.mjs — one-command full-stack dev (Pipeline.md §2.5).
//
// Spawns apps/web (Vite :5173), apps/api (Fastify :4000), and the containerized
// render-worker concurrently, interleaving their output with colored prefixes.
// Ctrl-C tears all three down. If any process exits non-zero, the others are
// stopped and dev.mjs exits with that code.
//
//   node scripts/dev.mjs        (or: pnpm dev:all / make dev)
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';

const PNPM = ['corepack', 'pnpm@9.12.0'];

// label, color, command (argv). The worker runs in its container via compose.
const procs = [
  { name: 'web', color: '\x1b[36m', argv: [...PNPM, 'dev:web'] }, // cyan
  { name: 'api', color: '\x1b[35m', argv: [...PNPM, 'dev:api'] }, // magenta
  { name: 'worker', color: '\x1b[33m', argv: ['docker', 'compose', 'up', 'render-worker'] }, // yellow
];

const RESET = '\x1b[0m';
const pad = Math.max(...procs.map((p) => p.name.length));

/** Prefix every line of a chunk with the colored process label. */
function prefixer(name, color, stream) {
  const tag = `${color}[${name.padEnd(pad)}]${RESET} `;
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) stream.write(`${tag}${line}\n`);
  };
}

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  }
  // Give children a moment to exit cleanly, then force-exit.
  setTimeout(() => process.exit(code), 500).unref();
}

for (const { name, color, argv } of procs) {
  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', prefixer(name, color, process.stdout));
  child.stderr.on('data', prefixer(name, color, process.stderr));

  child.on('error', (err) => {
    process.stderr.write(`${color}[${name.padEnd(pad)}]${RESET} spawn failed: ${err.message}\n`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    process.stderr.write(`${color}[${name.padEnd(pad)}]${RESET} exited (${reason})\n`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
