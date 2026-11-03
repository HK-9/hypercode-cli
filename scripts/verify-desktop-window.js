import assert from 'node:assert/strict';

const port = Number(process.argv[2]);
const kind = process.argv[3];
if (!Number.isInteger(port) || !['electron', 'tauri'].includes(kind)) {
  throw new Error('Usage: node scripts/verify-desktop-window.js <local-debug-port> <electron|tauri>');
}
let page;
const deadline = Date.now() + 90_000;
while (!page && Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
  } catch (error) {
    if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.cause?.code)) throw error;
  }
  if (!page) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!page) throw new Error('No desktop WebView exposed a debugging page before timeout.');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)));
    else handler.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
};
function send(method, params = {}) {
  const request = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(request); reject(new Error(`Timed out: ${method} ${JSON.stringify(params)}`)); }, 30_000);
    pending.set(request, {
      resolve: (result) => { clearTimeout(timer); resolve(result); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    ws.send(JSON.stringify({ id: request, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  console.log(`Checking desktop page: ${page.url}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate("Boolean(document.querySelector('button'))")) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(await evaluate("document.querySelector('h1')?.textContent"), kind === 'electron' ? 'Electron desktop' : 'Tauri desktop');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(240, 244, 248)', 'Imported CSS blocked or absent');
  await evaluate("document.querySelector('button').click()");
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await evaluate('document.body.innerText')).includes('Hello, HyperCode!')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok((await evaluate('document.body.innerText')).includes('Hello, HyperCode!'), 'Native bridge did not produce the greeting');
  if (kind === 'electron') {
    assert.deepEqual(await evaluate('Object.keys(window.desktop)'), ['greet']);
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    const rejected = await evaluate("window.desktop.greet('').then(() => false, () => true)");
    assert.equal(rejected, true);
  } else {
    const rejected = await evaluate("window.__TAURI_INTERNALS__.invoke('greet', {name: ''}).then(() => false, () => true)");
    assert.equal(rejected, true);
  }
  assert.deepEqual(errors, [], 'Runtime/CSP errors');
  console.log(`${kind} window at ${page.url} rendered and invoked its native bridge, rejected invalid input, and had no runtime/CSP errors.`);
} finally {
  ws.close();
}
