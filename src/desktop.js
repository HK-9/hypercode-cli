import { deflateSync } from 'node:zlib';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// A generated RGBA placeholder; replace it with owned artwork before distribution.
function icon() {
  const crc = (data) => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(body));
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(32 * (1 + 32 * 4));
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const offset = y * 129 + 1 + x * 4;
      pixels.set([40, 80, 160, 255], offset);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

export function desktopFiles(name, preset, base) {
  const pkg = JSON.parse(base['package.json']);
  base['src/styles.css'] = 'body { margin: 0; font-family: system-ui, sans-serif; background-color: rgb(240, 244, 248); }\nmain { padding: 2rem; }\n';
  if (preset === 'tauri') {
    pkg.dependencies['@tauri-apps/api'] = '^2.12.4';
    pkg.devDependencies['@tauri-apps/cli'] = '^2.12.4';
    pkg.scripts = {
      ...pkg.scripts, dev: 'tauri dev', 'dev:web': 'vite',
      build: 'tauri build --no-bundle', 'build:web': 'tsc --noEmit && vite build',
      'check:rust': 'cargo check --manifest-path src-tauri/Cargo.toml',
      'test:rust': 'cargo test --manifest-path src-tauri/Cargo.toml',
      'lint:rust': 'cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
      'fmt:rust': 'cargo fmt --manifest-path src-tauri/Cargo.toml -- --check',
    };
    base['src/main.tsx'] = "import './styles.css';\n" + base['src/main.tsx'];
    base['vite.config.ts'] = "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()], server: { port: 1420, strictPort: true } });\n";
    base['src/native/greet.ts'] = "import { invoke } from '@tauri-apps/api/core';\n\nexport function greet(name: string): Promise<string> {\n  return invoke<string>('greet', { name });\n}\n";
    base['src/App.tsx'] = "import { useState } from 'react';\nimport { greet } from './native/greet';\n\nexport function App() {\n  const [message, setMessage] = useState('Ready');\n  const [error, setError] = useState('');\n  async function greetUser() {\n    try {\n      setMessage(await greet('HyperCode'));\n      setError('');\n    } catch (cause) {\n      setError(String(cause));\n    }\n  }\n  return <main><h1>Tauri desktop</h1><button onClick={greetUser}>Greet from Rust</button><p>{message}</p>{error && <p role=\"alert\">{error}</p>}</main>;\n}\n";
    base['test/native.test.ts'] = "import { expect, test, vi } from 'vitest';\nimport { invoke } from '@tauri-apps/api/core';\nimport { greet } from '../src/native/greet';\n\nvi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));\n\ntest('invokes only the typed greet command', async () => {\n  vi.mocked(invoke).mockResolvedValue('Hello, HyperCode!');\n  expect(await greet('HyperCode')).toBe('Hello, HyperCode!');\n  expect(invoke).toHaveBeenCalledWith('greet', { name: 'HyperCode' });\n});\n";
    base['src-tauri/Cargo.toml'] = `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\nname = "desktop_lib"\ncrate-type = ["staticlib", "cdylib", "rlib"]\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`;
    base['src-tauri/build.rs'] = 'fn main() {\n    tauri_build::try_build(\n        tauri_build::Attributes::new()\n            .app_manifest(tauri_build::AppManifest::new().commands(&["greet"])),\n    )\n    .expect("failed to build Tauri application");\n}\n';
    base['src-tauri/src/main.rs'] = '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    desktop_lib::run();\n}\n';
    base['src-tauri/src/lib.rs'] = 'mod commands;\n\npub fn run() {\n    tauri::Builder::default()\n        .invoke_handler(tauri::generate_handler![commands::greet])\n        .run(tauri::generate_context!())\n        .expect("failed to run desktop application");\n}\n';
    base['src-tauri/src/commands.rs'] = '#[tauri::command]\npub fn greet(name: String) -> Result<String, String> {\n    if name.trim().is_empty() || name.chars().count() > 80 {\n        return Err("Name must contain 1 to 80 characters".into());\n    }\n    Ok(format!("Hello, {}!", name.trim()))\n}\n\n#[cfg(test)]\nmod tests {\n    use super::greet;\n\n    #[test]\n    fn validates_and_greets() {\n        assert_eq!(greet("HyperCode".into()), Ok("Hello, HyperCode!".into()));\n        assert!(greet(" ".into()).is_err());\n        assert!(greet("a".repeat(81)).is_err());\n    }\n}\n';
    base['src-tauri/tauri.conf.json'] = json({
      $schema: 'https://schema.tauri.app/config/2', productName: name, version: '0.1.0',
      identifier: `com.example.${name}`,
      build: { beforeDevCommand: 'npm run dev:web', devUrl: 'http://localhost:1420', beforeBuildCommand: 'npm run build:web', frontendDist: '../dist' },
      app: { windows: [{ label: 'main', title: name, width: 900, height: 600 }], security: {
        capabilities: ['main'],
        csp: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ipc: http://ipc.localhost",
        devCsp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost http://localhost:1420 ws://localhost:1420",
      } },
      bundle: { active: false, icon: ['icons/icon.png'] },
    });
    base['src-tauri/capabilities/main.json'] = json({
      $schema: '../gen/schemas/desktop-schema.json', identifier: 'main',
      description: 'Only the main window may greet; no filesystem, shell or remote capabilities.',
      windows: ['main'], permissions: ['allow-greet'],
    });
    const png = icon();
    base['src-tauri/icons/icon.png'] = png;
    const icoHeader = Buffer.alloc(22);
    icoHeader.writeUInt16LE(1, 2);
    icoHeader.writeUInt16LE(1, 4);
    icoHeader[6] = 32;
    icoHeader[7] = 32;
    icoHeader.writeUInt16LE(1, 10);
    icoHeader.writeUInt16LE(32, 12);
    icoHeader.writeUInt32LE(png.length, 14);
    icoHeader.writeUInt32LE(22, 18);
    base['src-tauri/icons/icon.ico'] = Buffer.concat([icoHeader, png]);
  } else {
    pkg.engines.node = '>=22.13.0';
    delete pkg.type;
    pkg.main = '.vite/build/main.cjs';
    pkg.description = `${name} desktop application`;
    pkg.author = 'Project maintainers';
    Object.assign(pkg.devDependencies, pkg.dependencies, {
      electron: '^45.2.1', '@electron-forge/cli': '8.0.1',
      '@electron-forge/plugin-vite': '8.0.1', '@electron-forge/maker-zip': '8.0.1',
      tsx: '^4.20.0',
    });
    delete pkg.dependencies;
    pkg.scripts = { dev: 'electron-forge start', build: 'electron-forge package', make: 'electron-forge make', test: 'vitest run', typecheck: 'tsc --noEmit' };
    delete base['vite.config.ts'];
    delete base['src/main.tsx'];
    delete base['src/App.tsx'];
    base['index.html'] = `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/renderer/main.tsx"></script></body></html>\n`;
    base['forge.config.cjs'] = `module.exports = {
  packagerConfig: { asar: true },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin', 'linux'] }],
  plugins: [{
    name: '@electron-forge/plugin-vite',
    config: {
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.mjs' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mjs' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
    },
  }],
};
`;
    for (const kind of ['main', 'preload']) {
      base[`vite.${kind}.config.mjs`] = "import { defineConfig } from 'vite';\n\nexport default defineConfig({ build: { rollupOptions: { external: ['electron', /^node:/] } } });\n";
    }
    base['vite.renderer.config.mjs'] = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'development-csp',
      transformIndexHtml(html) {
        if (command !== 'serve') return html;
        return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*");
      },
    },
  ],
}));
`;
    base['src/shared/bridge.ts'] = "export interface DesktopBridge {\n  greet(name: string): Promise<string>;\n}\n\ndeclare global {\n  interface Window { desktop: DesktopBridge }\n}\n";
    base['src/main/guards.ts'] = "export function greet(name: unknown): string {\n  if (typeof name !== 'string' || !name.trim() || name.length > 80) {\n    throw new Error('Name must contain 1 to 80 characters');\n  }\n  return `Hello, ${name.trim()}!`;\n}\n\nexport function trustedSender(actual: string | undefined, expected: string): boolean {\n  if (!actual) return false;\n  const candidate = new URL(actual);\n  const trusted = new URL(expected);\n  return candidate.protocol === trusted.protocol && candidate.host === trusted.host && candidate.pathname === trusted.pathname;\n}\n";
    base['src/main/main.ts'] = `import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { greet, trustedSender } from './guards';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

async function createWindow() {
  const window = new BrowserWindow({
    width: 900, height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  const expected = MAIN_WINDOW_VITE_DEV_SERVER_URL || 'app://bundle/index.html';
  ipcMain.removeHandler('desktop:greet');
  ipcMain.handle('desktop:greet', (event, name: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        !trustedSender(event.senderFrame?.url, expected)) {
      throw new Error('Untrusted IPC sender');
    }
    return greet(name);
  });
  await window.loadURL(expected);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const root = path.resolve(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME);
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      const relative = path.relative(root, file);
      if (url.host !== 'bundle' || relative.startsWith('..') || path.isAbsolute(relative)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(file).href);
    });
  }
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => { console.error(error); app.exit(1); });
    }
  });
}).catch((error) => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`;
    base['src/preload/preload.ts'] = "import { contextBridge, ipcRenderer } from 'electron';\nimport type { DesktopBridge } from '../shared/bridge';\n\nconst bridge: DesktopBridge = {\n  greet: (name) => ipcRenderer.invoke('desktop:greet', name),\n};\ncontextBridge.exposeInMainWorld('desktop', bridge);\n";
    base['src/renderer/main.tsx'] = "import '../styles.css';\nimport { StrictMode, useState } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport type {} from '../shared/bridge';\n\nfunction App() {\n  const [message, setMessage] = useState('Ready');\n  const [error, setError] = useState('');\n  async function greetUser() {\n    try {\n      setMessage(await window.desktop.greet('HyperCode'));\n      setError('');\n    } catch (cause) { setError(String(cause)); }\n  }\n  return <main><h1>Electron desktop</h1><button onClick={greetUser}>Greet from main</button><p>{message}</p>{error && <p role=\"alert\">{error}</p>}</main>;\n}\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n";
    base['test/ipc.test.ts'] = "import { expect, test } from 'vitest';\nimport { greet, trustedSender } from '../src/main/guards';\n\ntest('validates payloads', () => {\n  expect(greet('HyperCode')).toBe('Hello, HyperCode!');\n  for (const value of ['', ' ', 42, 'a'.repeat(81)]) expect(() => greet(value)).toThrow();\n});\n\ntest('restricts IPC to the expected local document', () => {\n  expect(trustedSender('app://bundle/index.html', 'app://bundle/index.html')).toBe(true);\n  expect(trustedSender('https://evil.test/index.html', 'app://bundle/index.html')).toBe(false);\n  expect(trustedSender('app://bundle/other.html', 'app://bundle/index.html')).toBe(false);\n  expect(trustedSender(undefined, 'app://bundle/index.html')).toBe(false);\n});\n";
  }
  base['package.json'] = json(pkg);
  base['index.html'] = base['index.html'].replace('<title>', '<link rel="icon" href="data:,"><title>');
  return base;
}

export function desktopReadme(name, preset) {
  const electron = preset === 'electron';
  return `# ${name}

${electron ? 'Electron + Forge + Vite + React' : 'Tauri 2 + Vite + React'} desktop foundation, created with HyperCodeLabs.

## Development

Requires Node.js ${electron ? '22.13+' : '22.12+'} and npm. Install from the repository root with \`npm install\`; commit the resulting npm lockfile. Run \`npm test\`, \`npm run typecheck\`, and \`npm run dev\` within this project (or select this npm workspace from the root).

${electron ? 'Run `npm run build` to package a host-platform executable under `out/`; `npm run make` creates an unsigned ZIP. Forge Vite is officially experimental and Forge versions are pinned. All shipped JS dependencies are bundled; runtime native dependencies must be installed on disk and externalized explicitly. Monorepos include a root `.npmrc` with `install-strategy=nested` to preserve physical workspace dependencies for Forge. Do not switch to Plug-and-Play or hoist native runtime dependencies without verifying a package.' : 'Native development requires Rust/Cargo and platform prerequisites: Windows MSVC C++ Build Tools plus WebView2; macOS Xcode command-line tools; Linux WebKitGTK and the other official system packages. The bootstrapper installs none of these. Run `rustc --version`, `cargo --version`, and `npm exec tauri info` to inspect the toolchain. Run `npm run build:web`, `npm run fmt:rust`, `npm run check:rust`, `npm run lint:rust`, `npm run test:rust`, and `npm run build`. The latter builds an unsigned native executable without an installer. Commit `src-tauri/Cargo.lock` for the app. Static Vite assets, not a Next.js server, are embedded.'}

## Boundaries and security

${electron ? 'Keep lifecycle, native access and validated IPC in `src/main`; expose only named typed functions through `src/preload`; keep React UI in `src/renderer` with no Node access. The main window explicitly enables context isolation and sandboxing and disables Node integration. The sample validates IPC payload and main-frame sender, denies permissions, navigation, popups and webviews, and serves packaged assets through a constrained custom app protocol. Production CSP disallows inline scripts; development relaxes inline scripts and localhost WebSockets for React refresh only. No external URL opener is exposed. Do not expose raw ipcRenderer, arbitrary channel names, filesystem paths or shell commands.' : 'Keep frontend features in `src`, typed invoke wrappers in `src/native`, and Rust commands in `src-tauri/src/commands.rs`. TypeScript return types are not runtime validation: Rust validates input and returns explicit errors. The build manifest registers command permissions; only the main window receives `allow-greet`. No filesystem, shell, remote-origin or broad core permissions are enabled. Capabilities do not protect against insecure Rust implementations. Review each new command and capability together.'}

## Distribution checklist (owner setup, not implemented)

Choose an owned application identifier/product name, artwork and license. ${electron ? 'Review Electron fuses and update the Electron runtime promptly.' : 'Replace `com.example.*` in tauri.conf.json and the generated placeholder icon before distributing.'} Set up Windows signing, macOS signing/notarization on appropriate hosts, entitlements, installer/store requirements, and CI secrets. Define update signing/trust, feed hosting, rollback and release channels before adding an auto-updater. No signing identity, notarization, updater, store integration or publishing credentials are generated. Test each target OS; host packaging is not proof of cross-platform support.

Document native permissions, data storage, crash/log handling and migrations in the root operations guide. Record changes to process/IPC boundaries or capability policy in an ADR; use the changelog for user-visible desktop changes and migration/update notes. See the root docs and contribution conventions.

Development-only CSP allows inline scripts for React refresh and inline styles for Vite CSS HMR, plus localhost WebSockets. Production retains self-only script/style sources. Do not copy development CSP to distribution builds.
`;
}
