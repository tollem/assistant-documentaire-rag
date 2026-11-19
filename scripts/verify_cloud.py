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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--impersonate-service-account')
    args = parser.parse_args()
    context = ssl.create_default_context(cafile=certifi.where())
    if args.impersonate_service_account:
        access = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
        req = urllib.request.Request('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + args.impersonate_service_account + ':generateIdToken',
            data=json.dumps({'audience': args.url, 'includeEmail': True}).encode(),
            headers={'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, context=context, timeout=30) as response:
            token = json.load(response)['token']
    else:
        token = subprocess.check_output(['gcloud', 'auth', 'print-identity-token'], text=True).strip()

    def request(path, body=None):
        headers = {'Authorization': 'Bearer ' + token}
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
    result = request('ask', {'mode': 'extraits', 'question': 'Quel est le budget du projet Atlas ?'})
    assert '500 CHF' in result['answer'] and result['sources'], 'Budget ou sources manquants'
    print('Import et recherche avec sources : OK')
    result = request('ask', {'mode': 'extraits', 'question': 'recette lasagne vegetarienne'})
    assert not result['sources'], 'La question hors corpus devrait être refusée'
    print('Refus hors corpus : OK')
    print('Documents persistants :', len(request('status')['documents']))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Échec HTTP {error.code} du service Cloud Run.') from None
