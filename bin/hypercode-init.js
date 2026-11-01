#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { runCli } from '../src/cli.js';

let rl;
let pendingQuestion = false;
const abort = new AbortController();
const cancel = () => abort.abort();

try {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  await runCli(process.argv.slice(2), {
    version,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    log: console.log,
    finishPrompt: () => rl?.close(),
    question: async (prompt) => {
      if (!rl) {
        rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.once('SIGINT', cancel);
        rl.once('close', () => { if (pendingQuestion) cancel(); });
      }
      pendingQuestion = true;
      try {
        return await rl.question(prompt, { signal: abort.signal });
      } finally {
        pendingQuestion = false;
      }
    },
  });
} catch (error) {
  console.error(`hypercode-init: ${abort.signal.aborted ? 'Cancelled before generation.' : error.message}`);
  process.exitCode = abort.signal.aborted ? 130 : 1;
} finally {
  rl?.close();
}
