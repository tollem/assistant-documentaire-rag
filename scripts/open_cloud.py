"""Ouvre un proxy Cloud Run privé, jeton limité au service et gardé en mémoire."""
import json
import subprocess

from verify_cloud import cloud_token


def main():
    url = 'https://assistant-documentaire-rag-y65u67ao2a-oa.a.run.app'
    account = 'source-rag-runtime@zenai-07071978.iam.gserviceaccount.com'
    token = cloud_token(url, account)
    # Le jeton ne passe ni par les arguments du processus ni par un fichier.
    process = subprocess.Popen(['gcloud', 'run', 'services', 'proxy', 'assistant-documentaire-rag',
        '--project=zenai-07071978', '--region=europe-west6', '--port=8080',
        '--flags-file=/dev/stdin'], stdin=subprocess.PIPE, text=True)
    try:
        process.stdin.write(json.dumps({'--token': token}))
        process.stdin.close()
        print('Proxy privé : jeton valable environ une heure. Relancer ce script à expiration.', flush=True)
        process.wait()
    except KeyboardInterrupt:
        process.terminate()
        process.wait()


if __name__ == '__main__':
    main()
