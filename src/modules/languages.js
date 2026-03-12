import { state } from './state.js';
import { updateStatus } from './statusbar.js';

// ── Lazy Language Loader ─────────────────────────────────────────────────────
// Languages are only downloaded when a file with that extension is first opened.

const languageRegistry = {
  // ── Plain languages (no Emmet) ──────────────────────────────────
  js:   () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  ts:   () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  md:   () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  py:   () => Promise.all([import('@codemirror/lang-python'), import('@codemirror/language')]).then(([m, l]) => new l.LanguageSupport(m.pythonLanguage, [])),
  rs:   () => import('@codemirror/lang-rust').then(m => m.rust()),
  cpp:  () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  c:    () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),

  // ── Emmet-enabled languages ──────────────────────────────────────
  html: () => Promise.all([
    import('@codemirror/lang-html'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([htmlMod, emmetMod]) => [
    htmlMod.html(),
    emmetMod.abbreviationTracker({ syntax: 'html' }),
  ]),
  htm:  () => languageRegistry.html(),
  vue:  () => Promise.all([
    import('@codemirror/lang-html'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([htmlMod, emmetMod]) => [
    htmlMod.html(),
    emmetMod.abbreviationTracker({ syntax: 'html' }),
  ]),
  php:  () => Promise.all([
    import('@codemirror/lang-php'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([phpMod, emmetMod]) => [
    phpMod.php(),
    emmetMod.abbreviationTracker({ syntax: 'html' }),
  ]),
  css:  () => Promise.all([
    import('@codemirror/lang-css'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([cssMod, emmetMod]) => [
    cssMod.css(),
    emmetMod.abbreviationTracker({ syntax: 'css' }),
  ]),
  scss: () => Promise.all([
    import('@codemirror/lang-css'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([cssMod, emmetMod]) => [
    cssMod.css(),
    emmetMod.abbreviationTracker({ syntax: 'scss' }),
  ]),
  less: () => Promise.all([
    import('@codemirror/lang-css'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([cssMod, emmetMod]) => [
    cssMod.css(),
    emmetMod.abbreviationTracker({ syntax: 'less' }),
  ]),
  jsx:  () => Promise.all([
    import('@codemirror/lang-javascript'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([jsMod, emmetMod]) => [
    jsMod.javascript({ jsx: true }),
    emmetMod.abbreviationTracker({ syntax: 'jsx' }),
  ]),
  tsx:  () => Promise.all([
    import('@codemirror/lang-javascript'),
    import('@emmetio/codemirror6-plugin'),
  ]).then(([jsMod, emmetMod]) => [
    jsMod.javascript({ jsx: true, typescript: true }),
    emmetMod.abbreviationTracker({ syntax: 'jsx' }),
  ]),
};

const loadedLanguages = new Map();

export async function getLanguageExtension(ext) {
  ext = ext?.toLowerCase();
  if (loadedLanguages.has(ext)) return loadedLanguages.get(ext);
  const loader = languageRegistry[ext];
  if (!loader) return [];
  try {
    const langExt = await loader();
    loadedLanguages.set(ext, langExt);
    return langExt;
  } catch (e) {
    console.error(`Failed to load language extension for .${ext}:`, e);
    return [];
  }
}

// ── Shared LSP Pattern (VS Code Style) ──────────────────────────────────────────
// Instead of spawning one server process per tab, we create a single client 
// for the entire workspace and attach multiple documentUri plugins to it.

const LSP_MAP = {
  py:  { id: 'pyright', ws: 'pyright', lang: 'python' },
  js:  { id: 'vtsls',   ws: 'vtsls',   lang: 'javascript' },
  jsx: { id: 'vtsls',   ws: 'vtsls',   lang: 'javascript' },
  ts:  { id: 'vtsls',   ws: 'vtsls',   lang: 'typescript' },
  tsx: { id: 'vtsls',   ws: 'vtsls',   lang: 'typescript' },
  mjs: { id: 'vtsls',   ws: 'vtsls',   lang: 'javascript' },
  cjs: { id: 'vtsls',   ws: 'vtsls',   lang: 'javascript' },
};

const lspClients = new Map(); // serverId -> LanguageServerClient

export async function getLspExtension(filePath) {
  if (!filePath) return [];
  const ext = filePath.split('.').pop()?.toLowerCase();
  const cfg = LSP_MAP[ext];
  if (!cfg) return [];

  try {
    const { LanguageServerClient, languageServerWithTransport } = await import('codemirror-languageserver');
    const { WebSocketTransport } = await import('@open-rpc/client-js');
    const { invoke } = await import('@tauri-apps/api/core');

    let client = lspClients.get(cfg.id);
    if (!client) {
      const port = await invoke('get_lsp_port');
      const wsUrl = `ws://127.0.0.1:${port}/${cfg.wsPath || cfg.ws}`;
      
      const transport = new WebSocketTransport(wsUrl);
      
      // Setup Root URI
      let rootUri = null;
      if (state.rootDirPath) {
        let rPath = state.rootDirPath.replace(/\\/g, '/');
        while (rPath.startsWith('/')) rPath = rPath.slice(1);
        rootUri = 'file:///' + encodeURI(rPath);
      }

      client = new LanguageServerClient({
        transport,
        rootUri,
        workspaceFolders: rootUri ? [{ name: 'root', uri: rootUri }] : [],
        documentUri: '', // Dynamic
        languageId: cfg.lang,
        autoClose: false
      });
      lspClients.set(cfg.id, client);

      // Clean up dead clients if the backend connection drops
      if (transport.connection) {
        transport.connection.addEventListener('close', () => {
          lspClients.delete(cfg.id);
        });
      }
    }

    // Convert file path to URI
    let fPath = filePath.replace(/\\/g, '/');
    while (fPath.startsWith('/')) fPath = fPath.slice(1);
    const fileUri = 'file:///' + encodeURI(fPath);

    const { ViewPlugin } = await import('@codemirror/view');

    // Return extension that shares this client but targets this specific file
    const extObj = [
      languageServerWithTransport({
        client,
        documentUri: fileUri,
        languageId: cfg.lang,
        allowHTMLContent: true
      }),
      ViewPlugin.define(() => ({
        destroy() {
          // Explicitly tell the shared server this file is closed to free memory
          // and allow clean re-opens.
          client.notify('textDocument/didClose', {
            textDocument: { uri: fileUri }
          }).catch(err => console.error('LSP didClose error:', err));
        }
      }))
    ];

    updateStatus();
    return extObj;
  } catch (e) {
    console.error(`LSP Init failed for ${cfg.id}:`, e);
    state.lspError = `LSP server (${cfg.id}) could not be initialized.`;
    updateStatus();
    return [];
  }
}
