"""Smoke test Cloud Run privé. Identité gcloud conservée en mémoire uniquement.

Utiliser seulement sur un service de démonstration : charge les fiches fictives.
"""
import argparse
import json
import ssl
import subprocess
import urllib.error
import urllib.request

import certifi


def cloud_token(url, service_account=None):
    context = ssl.create_default_context(cafile=certifi.where())
    if service_account:
        access = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
        req = urllib.request.Request('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + service_account + ':generateIdToken',
            data=json.dumps({'audience': url, 'includeEmail': True}).encode(),
            headers={'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, context=context, timeout=30) as response:
            token = json.load(response)['token']
    else:
        token = subprocess.check_output(['gcloud', 'auth', 'print-identity-token'], text=True).strip()
    return token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--impersonate-service-account')
    parser.add_argument('--rag', action='store_true', help='Teste aussi les embeddings et les deux appels IA réels (facturables).')
    parser.add_argument('--public', action='store_true', help='Teste un service public sans jeton Google.')
    args = parser.parse_args()
    token = None if args.public else cloud_token(args.url, args.impersonate_service_account)
    context = ssl.create_default_context(cafile=certifi.where())

    def request(path, body=None):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(args.url.rstrip('/') + '/api/' + path,
            data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with urllib.request.urlopen(req, context=context, timeout=300) as response:
            return json.load(response)

    status = request('status')
    assert status['storage'] == 'cloud', 'Stockage cloud attendu'
    print('Cloud Storage : OK ; IA configurée :', status['ai_configured'])
    request('demo', {'mode': 'extraits'})
    corpus = request('status')['documents']
    fixtures = {doc['name']: doc['id'] for doc in corpus if doc['name'] in {'01-projet-atlas.md', '02-planning-budget.md', '03-regles-documentaires.md'}}
    demo_ids = list(fixtures.values())
    assert len(demo_ids) == 3, 'Trois fiches de démonstration attendues'
    result = request('ask', {'mode': 'extraits', 'question': 'Quel est le budget du projet Atlas ?', 'document_ids': demo_ids})
    assert '500 CHF' in result['answer'] and result['sources'], 'Budget ou sources manquants'
    print('Import et recherche avec sources : OK')
    result = request('ask', {'mode': 'extraits', 'question': 'recette lasagne vegetarienne', 'document_ids': demo_ids})
    assert not result['sources'], 'La question hors corpus devrait être refusée'
    print('Refus hors corpus : OK')
    print('Documents persistants :', len(request('status')['documents']))
    note_id = fixtures['01-projet-atlas.md']
    budget_id = fixtures['02-planning-budget.md']
    result = request('ask', {'mode': 'extraits', 'question': 'Quel est le budget du projet Atlas ?', 'document_ids': [note_id]})
    assert all(source['document_id'] == note_id for source in result['sources']), 'Un document décoché a été utilisé'
    assert '500' not in result['answer'], 'Le budget exclu ne doit pas apparaître'
    result = request('ask', {'mode': 'extraits', 'question': 'Quel est le budget du projet Atlas ?', 'document_ids': [budget_id]})
    assert '500 CHF' in result['answer'] and all(source['document_id'] == budget_id for source in result['sources'])
    try:
        request('ask', {'mode': 'extraits', 'question': 'budget Atlas', 'document_ids': []})
        raise AssertionError('Une sélection vide doit être refusée')
    except urllib.error.HTTPError as error:
        assert error.code == 400, 'Une sélection vide doit produire HTTP 400'
    print('Sélection de documents et refus d’une sélection vide : OK')
    if args.rag:
        assert status['ai_configured'], 'Secret OpenAI non configuré'
        result = request('ask', {'mode': 'rag', 'question': 'Quel est le budget et qui pilote le projet Atlas ?', 'document_ids': [note_id, budget_id]})
        assert result['verified'], 'Réponse non validée par le parcours de vérification'
        assert '500' in result['answer'] and 'Martin' in result['answer'], 'Réponse incomplète'
        assert {source['document_id'] for source in result['sources']} == {note_id, budget_id}, 'Sources croisées ou filtre manquants'
        assert len(result['trace']) == 3, 'Étapes du parcours manquantes'
        print('RAG réel : embeddings, synthèse, vérification et sources croisées OK')
        print('Réponse de démonstration :', result['answer'])
        result = request('ask', {'mode': 'rag', 'question': 'Quel est le budget du projet Atlas ?', 'document_ids': [note_id]})
        assert '500' not in result['answer'], 'Le RAG ne doit pas utiliser le budget du document exclu'
        assert all(source['document_id'] == note_id for source in result['sources'])
        print('RAG limité à une seule source sans fuite du document exclu : OK')
        result = request('ask', {'mode': 'rag', 'question': 'Quel est le mot de passe du serveur Atlas ?', 'document_ids': demo_ids})
        assert any(word in result['answer'].lower() for word in ['aucun', 'pas', 'insuffisant', 'absence']), 'Refus attendu pour le mot de passe absent'
        print('Information absente :', result['answer'])


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors='replace')
        try:
            detail = json.loads(detail).get('error', {}).get('message', '')
        except (ValueError, AttributeError):
            detail = 'Accès HTTP refusé.'
        raise SystemExit(f'Échec HTTP {error.code} : {detail[:500]}') from None
