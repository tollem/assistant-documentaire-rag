// Vérifie la logique de sélection du script livré, sans navigateur ni dépendance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; this.className = ''; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  setAttribute() {}
  focus() {}
}
const documents = [
  { id: 'a'.repeat(24), name: 'premier.md', pages: 1, chunks: 2 },
  { id: 'b'.repeat(24), name: 'second.md', pages: 1, chunks: 3 },
];

async function screen(saved = null) {
  const ids = new Map();
  const storage = new Map(saved === null ? [] : [['source-document-selection', JSON.stringify(saved)]]);
  const requests = [];
  const uploads = [];
  let corpus = structuredClone(documents);
  const document = {
    getElementById(id) { if (!ids.has(id)) ids.set(id, new Element(id === 'question' ? 'textarea' : 'div')); return ids.get(id); },
    createElement(tag) { return new Element(tag); },
    createTextNode(text) { return new Element('text'); },
    querySelectorAll(selector) {
      const nodes = new Set();
      const visit = element => { if (nodes.has(element)) return; nodes.add(element); for (const child of element.children) visit(child); };
      for (const element of ids.values()) visit(element);
      if (selector === '.doc-check') return [...nodes].filter(el => el.className === 'doc-check');
      if (selector === '[data-question]') return [];
      return [...nodes].filter(el => ['button', 'select', 'input', 'textarea'].includes(el.tagName));
    },
  };
  document.getElementById('mode').value = 'extraits';
  const context = vm.createContext({
    document,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (path, options) => {
      if (path === '/api/status') return { ok: true, json: async () => ({ documents: corpus, ai_configured: true, storage: 'local', model: 'test' }) };
      if (path === '/api/documents' && options.headers['Content-Type'] === 'application/octet-stream') {
        uploads.push(options);
        return { ok: true, json: async () => ({ duplicate: false }) };
      }
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ answer: 'Résultat.', sources: [], trace: [], verified: false, mode: 'extraits', elapsed: 0.1 }) };
    },
  });
  vm.runInContext(readFileSync(new URL('../static/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    context, document, storage, requests, uploads,
    state: vm.runInContext('state', context),
    refresh: async docs => { corpus = docs; await context.refresh(); },
    element: id => document.getElementById(id),
    boxes: () => document.querySelectorAll('.doc-check'),
  };
}

test('choisit tous les documents au premier chargement et envoie seulement les cochés', async () => {
  const ui = await screen();
  assert.equal(ui.state.selectedIds.size, 2);
  const first = ui.boxes()[0]; first.checked = false; first.listeners.change();
  assert.equal(ui.state.selectedIds.size, 1);
  ui.element('question').value = 'Quel budget ?';
  ui.element('question-form').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ui.requests[0].document_ids, [documents[1].id]);
  assert.equal(ui.element('asked-scope').textContent, 'Documents interrogés : second.md');
  assert.equal(ui.element('result').hidden, false);
  ui.boxes()[0].checked = true; ui.boxes()[0].listeners.change();
  assert.equal(ui.element('result').hidden, true);
});

test('tout désélectionner bloque la recherche, même via soumission clavier', async () => {
  const ui = await screen();
  ui.element('select-all').listeners.click();
  assert.equal(ui.state.selectedIds.size, 0);
  assert.equal(ui.element('ask').disabled, true);
  ui.element('question').value = 'Quel budget ?';
  ui.element('question-form').listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.element('ask').disabled, true);
  ui.element('select-all').listeners.click();
  assert.equal(ui.state.selectedIds.size, 2);
  assert.equal(ui.element('ask').disabled, false);
});

test('restaure une sélection vide sans sélectionner silencieusement tous les fichiers', async () => {
  const ui = await screen([]);
  assert.equal(ui.state.selectedIds.size, 0);
  assert.equal(ui.element('ask').disabled, true);
  await ui.refresh(documents);
  assert.equal(ui.state.selectedIds.size, 0);
});

test('conserve le choix lors du rafraîchissement, coche les ajouts et retire les disparus', async () => {
  const ui = await screen([documents[1].id]);
  assert.equal(ui.state.selectedIds.size, 1);
  await ui.refresh(documents);
  assert.equal(ui.state.selectedIds.has(documents[0].id), false);
  const added = { ...documents[0], id: 'c'.repeat(24), name: 'nouveau.md' };
  await ui.refresh([...documents, added]);
  assert.equal(ui.state.selectedIds.has(added.id), true);
  assert.equal(ui.state.selectedIds.has(documents[0].id), false);
  await ui.refresh([documents[0]]);
  assert.equal(ui.state.selectedIds.size, 0);
  assert.deepEqual(JSON.parse(ui.storage.get('source-document-selection')), []);
});

test('envoie un fichier de 30 Mio en binaire et refuse 30 Mio + 1 octet', async () => {
  const ui = await screen();
  const accepted = { name: 'école + 30%.pdf', size: 30 * 1024 * 1024 };
  const rejected = { name: 'trop-grand.pdf', size: accepted.size + 1 };
  ui.element('files').listeners.change({ target: { files: [accepted, rejected] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.uploads[0].body, accepted);
  assert.equal(ui.uploads[0].headers['X-File-Name'], encodeURIComponent(accepted.name));
  assert.equal(ui.uploads[0].headers['X-Upload-Mode'], 'extraits');
  assert.match(ui.element('message').textContent, /trop-grand.pdf : dépasse 30 Mo/);
});
