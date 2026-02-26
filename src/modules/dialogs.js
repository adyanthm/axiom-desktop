import { pathBasename } from './utils.js';

// ── Save Dialog ───────────────────────────────────────────────────────────────
// Returns a Promise that resolves to 'save' | 'discard' | 'cancel'.
export function showSaveDialog(filePath) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('save-dialog-overlay');
    const saveBtn   = document.getElementById('save-dialog-save');
    const skipBtn   = document.getElementById('save-dialog-dont-save');
    const cancelBtn = document.getElementById('save-dialog-cancel');

    document.getElementById('save-dialog-message').textContent =
      `Do you want to save changes to "${pathBasename(filePath)}"?`;
    overlay.classList.remove('hidden');

    const done = (result) => {
      overlay.classList.add('hidden');
      saveBtn.removeEventListener('click', onSave);
      skipBtn.removeEventListener('click', onSkip);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };

    const onSave   = () => done('save');
    const onSkip   = () => done('discard');
    const onCancel = () => done('cancel');

    saveBtn.addEventListener('click', onSave);
    skipBtn.addEventListener('click', onSkip);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Generic Prompt Dialog ─────────────────────────────────────────────────────
// Returns the entered string, or null if the user cancels.
export function showPrompt(title, message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay   = document.getElementById('prompt-dialog-overlay');
    const titleEl   = document.getElementById('prompt-dialog-title');
    const msgEl     = document.getElementById('prompt-dialog-message');
    const input     = document.getElementById('prompt-dialog-input');
    const okBtn     = document.getElementById('prompt-dialog-ok');
    const cancelBtn = document.getElementById('prompt-dialog-cancel');

    titleEl.textContent = title;
    msgEl.textContent   = message;
    input.value         = defaultValue;

    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    const done = (result) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onOk     = () => done(input.value.trim());
    const onCancel = () => done(null);
    const onKey    = (e) => {
      if (e.key === 'Enter')  onOk();
      if (e.key === 'Escape') onCancel();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}
