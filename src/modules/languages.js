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
  py:   () => import('@codemirror/lang-python').then(m => m.python()),
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
