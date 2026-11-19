const $ = (id) => document.getElementById(id);
const state = { busy: false, documents: [] };
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').hidden = false; }
function busy(on) { state.busy = on; document.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = on; }); $('ask').textContent = on ? 'Traitement…' : 'Rechercher'; if (!on) $('clear').disabled = $('result').hidden; }
async function api(path, body) { const response = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Une erreur est survenue.'); return value; }
function clearResult() { $('result').hidden = true; $('welcome').hidden = false; $('clear').disabled = true; $('source-count').textContent = '0'; $('sources').replaceChildren(node('p', 'Les passages de votre prochaine recherche apparaîtront ici.', 'source-empty muted')); $('trace').replaceChildren(...['Recherche', 'Synthèse', 'Vérification'].map(name => { const li = node('li'); li.append(node('span', name), node('p', 'En attente de votre question.')); return li; })); }
async function refresh() {
  const data = await api('status'); state.documents = data.documents;
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
    const row = node('div', undefined, 'document'); const info = node('div'); info.append(node('p', doc.name, 'document-name'), node('p', `${doc.pages} page${doc.pages > 1 ? 's' : ''} · ${doc.chunks} fragment${doc.chunks > 1 ? 's' : ''}`, 'document-meta'));
    const remove = node('button', '×', 'delete'); remove.title = 'Supprimer ' + doc.name; remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => run(async () => { await api('delete', { id: doc.id }); clearResult(); await refresh(); message('Document retiré de la base locale.'); })); row.append(info, remove); $('documents').append(row);
  }
}
async function run(action) { if (state.busy) return; busy(true); $('message').hidden = true; try { await action(); } catch (error) { message(error.message, true); } finally { busy(false); } }
function renderResult(data, question) {
  $('welcome').hidden = true; $('result').hidden = false; $('asked').textContent = question;
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
$('question-form').addEventListener('submit', event => { event.preventDefault(); const question = $('question').value.trim(); if (question.length < 3) { message('Écrivez une question d’au moins trois caractères.', true); return; } run(async () => { if (!state.documents.length) throw new Error('Ajoutez un document ou chargez le corpus de démo.'); $('loading').hidden = false; try { const data = await api('ask', { question, mode: $('mode').value }); renderResult(data, question); } finally { $('loading').hidden = true; } }); });
$('question').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('question-form').requestSubmit(); } });
$('demo').addEventListener('click', () => run(async () => { const data = await api('demo', { mode: $('mode').value }); await refresh(); const added = data.documents.filter(d => !d.duplicate).length; message(added ? `${added} fiches de démonstration ajoutées. Posez votre première question.` : 'Le corpus de démonstration est déjà chargé.'); }));
$('files').addEventListener('change', event => { const files = Array.from(event.target.files); run(async () => { const outcomes = []; for (const file of files) { if (file.size > 8 * 1024 * 1024) { outcomes.push(file.name + ' : dépasse 8 Mo'); continue; } try { const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Lecture impossible.')); reader.readAsDataURL(file); }); const result = await api('documents', { name: file.name, data: base64, mode: $('mode').value }); outcomes.push(file.name + (result.duplicate ? ' : déjà présent' : ' : ajouté')); } catch (error) { outcomes.push(file.name + ' : ' + error.message); } } await refresh(); message(outcomes.join(' · ')); $('files').value = ''; }); });
$('clear').addEventListener('click', () => { clearResult(); $('question').value = ''; $('question').focus(); });
$('mode').addEventListener('change', clearResult);
$('help-toggle').addEventListener('click', () => { $('help').hidden = !$('help').hidden; $('help-toggle').setAttribute('aria-expanded', String(!$('help').hidden)); });
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => { $('question').value = button.dataset.question; $('question').focus(); }));
refresh().catch(error => message('Connexion au serveur impossible : ' + error.message, true));
