const $ = (id) => document.getElementById(id);
function savedSelection() { try { const ids = JSON.parse(sessionStorage.getItem('source-document-selection')); return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? new Set(ids) : null; } catch { return null; } }
const state = { busy: false, documents: [], selectedIds: savedSelection(), loaded: false };
function syncSelection() {
  const selected = state.selectedIds?.size || 0;
  $('selection-count').textContent = `${selected} document${selected > 1 ? 's' : ''} sélectionné${selected > 1 ? 's' : ''} sur ${state.documents.length}`;
  $('scope-summary').textContent = selected ? `Recherche limitée à ${selected} document${selected > 1 ? 's' : ''} sélectionné${selected > 1 ? 's' : ''}.` : 'Sélectionnez au moins un document dans la bibliothèque.';
  $('ask').disabled = state.busy || selected === 0;
  $('select-all').disabled = state.busy || state.documents.length === 0;
  $('select-all').textContent = selected && selected === state.documents.length ? 'Tout désélectionner' : 'Tout sélectionner';
  document.querySelectorAll('.doc-check').forEach(box => { box.checked = state.selectedIds.has(box.value); box.disabled = state.busy; });
  try { if (state.selectedIds !== null) sessionStorage.setItem('source-document-selection', JSON.stringify([...state.selectedIds])); } catch { /* La sélection reste utilisable sans stockage navigateur. */ }
}
function selectionChanged() { clearResult(); $('message').hidden = true; syncSelection(); }
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').hidden = false; }
function busy(on) { state.busy = on; document.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = on; }); $('ask').textContent = on ? 'Traitement…' : 'Rechercher'; if (!on) $('clear').disabled = $('result').hidden; syncSelection(); }
async function api(path, body) { const response = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Une erreur est survenue.'); return value; }
async function uploadDocument(file, mode) {
  const response = await fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Upload-Mode': mode }, body: file });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Import impossible.');
  return value;
}
function clearResult() { $('result').hidden = true; $('welcome').hidden = false; $('clear').disabled = true; $('source-count').textContent = '0'; $('sources').replaceChildren(node('p', 'Les passages de votre prochaine recherche apparaîtront ici.', 'source-empty muted')); $('trace').replaceChildren(...['Recherche', 'Synthèse', 'Vérification'].map(name => { const li = node('li'); li.append(node('span', name), node('p', 'En attente de votre question.')); return li; })); }
async function refresh() {
  const data = await api('status');
  const previousIds = new Set(state.documents.map(doc => doc.id));
  const nextSelection = new Set(data.documents.filter(doc => state.selectedIds === null || state.selectedIds.has(doc.id) || (state.loaded && !previousIds.has(doc.id))).map(doc => doc.id));
  if (state.loaded && (nextSelection.size !== state.selectedIds.size || [...nextSelection].some(id => !state.selectedIds.has(id)))) clearResult();
  state.selectedIds = nextSelection;
  state.documents = data.documents; state.loaded = true;
  $('storage').textContent = data.storage === 'cloud' ? 'Stockage persistant · Google Cloud' : 'Stockage local · SQLite';
  $('session').textContent = data.storage === 'cloud' ? 'Espace de démonstration partagé' : 'Session locale';
  if (!data.ai_configured && $('mode').value === 'rag') $('mode').value = 'extraits';
  $('connection').textContent = data.ai_configured ? 'OpenAI configuré · ' + data.model : 'Sans clé · mode extraits disponible';
  $('doc-count').textContent = String(data.documents.length);
  const total = data.documents.reduce((sum, d) => sum + d.chunks, 0);
  $('chunk-count').textContent = total + ' fragment' + (total > 1 ? 's indexés' : ' indexé');
  $('documents').replaceChildren();
  if (!data.documents.length) $('documents').append(node('p', 'Aucun document pour le moment.', 'document-empty'));
  for (const doc of data.documents) {
    const row = node('div', undefined, 'document'); const info = node('div'); info.append(node('span', doc.name, 'document-name'), node('span', `${doc.pages} page${doc.pages > 1 ? 's' : ''} · ${doc.chunks} fragment${doc.chunks > 1 ? 's' : ''}`, 'document-meta'));
    const choice = node('label', undefined, 'document-choice'); const checkbox = node('input', undefined, 'doc-check'); checkbox.type = 'checkbox'; checkbox.value = doc.id; checkbox.checked = state.selectedIds.has(doc.id); checkbox.disabled = state.busy; checkbox.setAttribute('aria-label', 'Interroger ' + doc.name);
    checkbox.addEventListener('change', () => { if (checkbox.checked) state.selectedIds.add(doc.id); else state.selectedIds.delete(doc.id); selectionChanged(); }); choice.append(checkbox, info);
    const remove = node('button', '×', 'delete'); remove.title = 'Supprimer ' + doc.name; remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => run(async () => { await api('delete', { id: doc.id }); clearResult(); await refresh(); message('Document retiré de la bibliothèque.'); })); row.append(choice, remove); $('documents').append(row);
  }
  syncSelection();
}
async function run(action) { if (state.busy) return; busy(true); $('message').hidden = true; try { await action(); } catch (error) { message(error.message, true); } finally { busy(false); } }
function renderResult(data, question, documentNames) {
  $('welcome').hidden = true; $('result').hidden = false; $('asked').textContent = question;
  $('asked-scope').textContent = 'Documents interrogés : ' + documentNames.join(', ');
  $('verification').textContent = data.verified ? 'Relue par l’IA · citations valides' : data.mode === 'extraits' ? 'Texte original · sans IA' : 'Réponse non vérifiée';
  $('verification').className = data.verified ? 'verified' : '';
  $('answer').replaceChildren(); const pattern = /\[(\d+)\]/g; let start = 0;
  for (const match of data.answer.matchAll(pattern)) {
    $('answer').append(document.createTextNode(data.answer.slice(start, match.index)));
    if (data.sources.some(s => s.citation === Number(match[1]))) {
      const link = node('a', match[0], 'citation'); link.href = '#source-' + match[1]; link.setAttribute('aria-label', 'Consulter la source ' + match[1]);
      link.addEventListener('click', () => { document.querySelectorAll('.source').forEach(s => s.classList.remove('selected')); $('source-' + match[1]).classList.add('selected'); }); $('answer').append(link);
    } else $('answer').append(document.createTextNode(match[0])); start = match.index + match[0].length;
  }
  $('answer').append(document.createTextNode(data.answer.slice(start))); $('duration').textContent = `${data.elapsed} s · ${data.sources.length} passage${data.sources.length > 1 ? 's' : ''} retenu${data.sources.length > 1 ? 's' : ''}`;
  $('source-count').textContent = String(data.sources.length); $('sources').replaceChildren();
  if (!data.sources.length) $('sources').append(node('p', 'Aucun passage suffisamment pertinent trouvé.', 'source-empty muted'));
  for (const source of data.sources) {
    const article = node('article', undefined, 'source'); article.id = 'source-' + source.citation; article.tabIndex = -1;
    const title = node('h3', undefined, 'source-title'); title.append(node('span', '[' + source.citation + ']', 'ref-number'), node('span', source.name));
    article.append(title, node('p', `Page ${source.page} · score de classement ${source.score.toFixed(3)}`, 'source-meta'), node('blockquote', source.text)); $('sources').append(article);
  }
  $('trace').replaceChildren(...data.trace.map(step => { const li = node('li', undefined, 'done'); li.append(node('span', step.agent), node('p', step.detail)); return li; }));
}
$('question-form').addEventListener('submit', event => { event.preventDefault(); const question = $('question').value.trim(); if (question.length < 3) { message('Écrivez une question d’au moins trois caractères.', true); return; } run(async () => { if (!state.documents.length) throw new Error('Ajoutez un document ou chargez le corpus de démo.'); const selected = state.documents.filter(doc => state.selectedIds.has(doc.id)); if (!selected.length) throw new Error('Sélectionnez au moins un document dans la bibliothèque.'); $('loading').hidden = false; try { const data = await api('ask', { question, mode: $('mode').value, document_ids: selected.map(doc => doc.id) }); renderResult(data, question, selected.map(doc => doc.name)); } finally { $('loading').hidden = true; } }); });
$('question').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('question-form').requestSubmit(); } });
$('demo').addEventListener('click', () => run(async () => { const data = await api('demo', { mode: $('mode').value }); await refresh(); const added = data.documents.filter(d => !d.duplicate).length; message(added ? `${added} fiches de démonstration ajoutées. Posez votre première question.` : 'Le corpus de démonstration est déjà chargé.'); }));
$('files').addEventListener('change', event => { const files = Array.from(event.target.files); run(async () => { const outcomes = []; for (const file of files) { if (file.size > 30 * 1024 * 1024) { outcomes.push(file.name + ' : dépasse 30 Mo'); continue; } try { const result = await uploadDocument(file, $('mode').value); outcomes.push(file.name + (result.duplicate ? ' : déjà présent' : ' : ajouté')); } catch (error) { outcomes.push(file.name + ' : ' + error.message); } } await refresh(); message(outcomes.join(' · ')); $('files').value = ''; }); });
$('clear').addEventListener('click', () => { clearResult(); $('question').value = ''; $('question').focus(); });
$('mode').addEventListener('change', clearResult);
$('select-all').addEventListener('click', () => { state.selectedIds = state.selectedIds.size === state.documents.length ? new Set() : new Set(state.documents.map(doc => doc.id)); selectionChanged(); });
$('help-toggle').addEventListener('click', () => { $('help').hidden = !$('help').hidden; $('help-toggle').setAttribute('aria-expanded', String(!$('help').hidden)); });
refresh().catch(error => message('Connexion au serveur impossible : ' + error.message, true));
