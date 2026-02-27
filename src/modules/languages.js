// ── Lazy Language Loader ─────────────────────────────────────────────────────
// Languages are only downloaded when a file with that extension is first opened.

const languageRegistry = {
  js:   () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  ts:   () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  jsx:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
  tsx:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  css:  () => import('@codemirror/lang-css').then(m => m.css()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  md:   () => import('@codemirror/lang-markdown').then(m => m.markdown()),
  py:   () => Promise.all([import('@codemirror/lang-python'), import('@codemirror/language')]).then(([m, l]) => new l.LanguageSupport(m.pythonLanguage, [])),
  rs:   () => import('@codemirror/lang-rust').then(m => m.rust()),
  cpp:  () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  c:    () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  java: () => import('@codemirror/lang-java').then(m => m.java()),
  php:  () => import('@codemirror/lang-php').then(m => m.php()),
};

// Cache already-loaded extensions so we never fetch the same language twice
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

export async function getLspExtension(filePath) {
  if (!filePath) return [];
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  if (ext === 'py') {
    const { getStore } = await import('./store.js');
    const store = await getStore();
    const lspState = store ? await store.get('lspState') : null;
    let isPyrightEnabled = true;

    if (lspState) {
        const pyright = lspState.find(l => l.id === 'pyright');
        if (pyright && (!pyright.installed || !pyright.enabled)) {
            isPyrightEnabled = false;
        }
    }

    if (isPyrightEnabled) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const port = await invoke('get_lsp_port');
        
        // Dynamic import to keep init lightweight
        const { languageServer } = await import('codemirror-languageserver');
        
        const { state } = await import('./state.js');
        let rUri = null;
        if (state.rootDirPath) {
          let rPath = state.rootDirPath.replace(/\\/g, '/');
          if (!rPath.startsWith('/')) rPath = '/' + rPath;
          rUri = 'file://' + encodeURI(rPath);
        }

        let fileUri = filePath.replace(/\\/g, '/');
        if (!fileUri.startsWith('/')) fileUri = '/' + fileUri;
        fileUri = 'file://' + encodeURI(fileUri);

        const lspClientExt = languageServer({
          serverUri: `ws://127.0.0.1:${port}/pyright`, // connected to rust backend
          rootUri: rUri,
          documentUri: fileUri,
          languageId: 'python',
          allowHTMLContent: true
        });
        return lspClientExt;
      } catch (e) {
        console.error('Failed to init pyright lsp', e);
        return [];
      }
    }
  }
  
  return [];
}

