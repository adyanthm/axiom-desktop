import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { state } from './state.js';
import { openFile } from './files.js';
import { getFileIcon } from './icons.js';

const overlay = document.getElementById('global-search-overlay');
const input = document.getElementById('global-search-input');
const resultsContainer = document.getElementById('global-search-results');
const closeBtn = document.getElementById('global-search-close-btn');

let currentQuery = '';
let searchListenUnsub = null;
let finishedListenUnsub = null;

export async function openGlobalSearch() {
  if (!state.rootDirPath) {
    alert('Please open a folder first to use global search.');
    return;
  }
  overlay.classList.remove('hidden');
  input.focus();
  input.select();

  // Setup listeners if not already done
  if (!searchListenUnsub) {
    searchListenUnsub = await listen('search_result', (event) => {
      addSearchResult(event.payload);
    });
  }
  if (!finishedListenUnsub) {
    finishedListenUnsub = await listen('search_finished', () => {
      const loading = resultsContainer.querySelector('.search-loading');
      if (loading) loading.remove();
      if (resultsContainer.children.length === 0) {
        resultsContainer.innerHTML = '<div style="padding: 16px; color: var(--text-muted); text-align: center;">No results found.</div>';
      }
    });
  }
}

export function closeGlobalSearch() {
  overlay.classList.add('hidden');
  import('./editor.js').then(m => m.view.focus());
}

closeBtn?.addEventListener('click', closeGlobalSearch);

overlay?.addEventListener('click', e => {
  if (e.target === overlay) closeGlobalSearch();
});

input?.addEventListener('keydown', async e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeGlobalSearch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    
    currentQuery = query;
    resultsContainer.innerHTML = '<div class="search-loading" style="padding: 16px; color: var(--text-muted); text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    
    try {
      await invoke('global_search', {
        dir: state.rootDirPath,
        query: query
      });
    } catch (err) {
      console.error(err);
      resultsContainer.innerHTML = `<div style="padding: 16px; color: #E06C75; text-align: center;">Search failed: ${escapeHtml(err.toString())}</div>`;
    }
  }
});

function addSearchResult(res) {
  // Clear "Searching..." if it's the first result
  const loading = resultsContainer.querySelector('.search-loading');
  if (loading && resultsContainer.children.length === 1) {
    resultsContainer.innerHTML = '';
  }

  const div = document.createElement('div');
  div.className = 'global-search-result-item';
  
  const fullPath = res.path;
  const fileName = fullPath.split(/[\\\/]/).pop();
  const dirPath = fullPath.substring(0, fullPath.length - fileName.length).replace(/[\\\/]$/, '');
  
  const relativeDir = dirPath.startsWith(state.rootDirPath) ? 
    dirPath.substring(state.rootDirPath.length).replace(/^[\\\/]/, '') : dirPath;
    
  // VS Code style UI with syntax highlighting and file icons
  div.innerHTML = `
    <div class="search-result-info">
      <div class="search-result-file">
        ${getFileIcon(fileName)}
        <span class="search-result-name">${escapeHtml(fileName)}</span>
        <span class="search-result-path">${escapeHtml(relativeDir)}</span>
      </div>
      <div class="search-result-line-num">${res.line_number}</div>
    </div>
    <div class="search-result-content hljs">${highlightMatches(res.line_text, currentQuery, fileName)}</div>
  `;
  
  div.addEventListener('click', () => {
    closeGlobalSearch();
    import('./explorer.js').then(m => m.revealInExplorer(res.path));
    openFile(res.path).then(() => {
      setTimeout(() => {
          import('./editor.js').then(m => {
          const view = m.view;
          if (!view) return;
          try {
              const docText = view.state.doc.toString();
              const lineInfo = view.state.doc.line(res.line_number);
              const colMatch = lineInfo.text.toLowerCase().indexOf(currentQuery.toLowerCase());
              if (colMatch !== -1) {
                  view.dispatch({
                  selection: { anchor: lineInfo.from + colMatch, head: lineInfo.from + colMatch + currentQuery.length },
                  scrollIntoView: true
                  });
              } else {
                  view.dispatch({ 
                  selection: { anchor: lineInfo.from },
                  scrollIntoView: true 
                  });
              }
          } catch (e) { console.error('Error navigating:', e); }
          });
      }, 100);
    });
  });
  
  resultsContainer.appendChild(div);
}

function highlightMatches(text, query, fileName) {
  if (!query) return escapeHtml(text);
  
  let highlighted = text;
  // Apply basic syntax highlighting if hljs is available
  if (window.hljs) {
    const ext = fileName.split('.').pop();
    try {
        const lang = window.hljs.getLanguage(ext) ? ext : 'plaintext';
        highlighted = window.hljs.highlight(text, { language: lang }).value;
    } catch (e) {
        highlighted = escapeHtml(text);
    }
  } else {
    highlighted = escapeHtml(text);
  }

  try {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    
    // If we used hljs, we need to be careful not to break tags.
    // However, hljs returns HTML strings. We'll do a simple replacement on the final string
    // avoiding replacing inside tags if possible. 
    // A safer way for this demo is to just highlight the raw text matches.
    
    // For now, let's do a simple replace on the HTML-safe version if we didn't use hljs,
    // or a slightly more complex one if we did.
    
    // Simple approach: re-apply match highlighting to the already-highlighted HTML
    return highlighted.replace(regex, '<span class="search-match-highlight">$1</span>');
  } catch (e) {
    return highlighted;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag])
  );
}

window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openGlobalSearch();
  }
});
