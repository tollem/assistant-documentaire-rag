# Déployer sur Google Cloud Run

Configuration cible : projet **ZENAI** (`zenai-07071978`), région Zurich **europe-west6**, service **assistant-documentaire-rag**.

## Architecture

- Cloud Run exécute le Dockerfile, sans volume local persistant.
- Cloud Storage conserve `corpus/index.json` dans le bucket privé `zenai-07071978-source-rag`. Une précondition de génération évite l’écrasement des écritures concurrentes.
- Le compte dédié `source-rag-runtime@zenai-07071978.iam.gserviceaccount.com` reçoit seulement l’accès aux objets de ce bucket et, si configuré, l’accès au secret OpenAI dédié.
- La clé est injectée par Secret Manager ; elle ne figure ni dans l’image ni dans Git.
- Cloud Run exige une identité Google autorisée. Le dépôt GitHub public ne rend pas l’application ou les documents publics.

La localisation du bucket ne signifie pas que le traitement OpenAI a lieu en Suisse.

## Préparer les ressources

Les commandes suivantes sont à exécuter une seule fois dans le projet cible. Ne pas recréer des ressources déjà existantes.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com --project=zenai-07071978
gcloud iam service-accounts create source-rag-runtime --project=zenai-07071978 --display-name='Source RAG Cloud Run'
gcloud storage buckets create gs://zenai-07071978-source-rag --project=zenai-07071978 --location=europe-west6 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://zenai-07071978-source-rag --member=serviceAccount:source-rag-runtime@zenai-07071978.iam.gserviceaccount.com --role=roles/storage.objectUser
```

## Déployer sans clé (mode extraits)

Depuis la racine du dépôt :

```bash
gcloud run deploy assistant-documentaire-rag \
  --project=zenai-07071978 --region=europe-west6 \
  --source=. --service-account=source-rag-runtime@zenai-07071978.iam.gserviceaccount.com \
  --set-env-vars=GCS_BUCKET=zenai-07071978-source-rag \
  --port=8080 --memory=512Mi --cpu=1 \
  --min-instances=0 --max-instances=1 --concurrency=1 --timeout=300 \
  --no-allow-unauthenticated --quiet
```

Le build peut nécessiter `roles/run.builder` pour le compte Cloud Build utilisé par le projet. Accorder ce rôle seulement à l’identité réellement indiquée par le build, pas au compte d’exécution de l’application. Cloud Build et Artifact Registry peuvent être facturés indépendamment du nombre d’instances.

## Brancher OpenAI

Créer le secret **`source-rag-openai-api-key`** à partir de la clé autorisée par le propriétaire. Transférer la valeur via l’entrée standard ou un outil sécurisé ; ne pas mettre la valeur dans une commande, un argument, un log ou un fichier suivi par Git.

```bash
gcloud secrets add-iam-policy-binding source-rag-openai-api-key \
  --project=zenai-07071978 \
  --member=serviceAccount:source-rag-runtime@zenai-07071978.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
gcloud run services update assistant-documentaire-rag \
  --project=zenai-07071978 --region=europe-west6 \
  --set-secrets=OPENAI_API_KEY=source-rag-openai-api-key:1
```

Épingler une version numérique du secret ; après rotation, mettre à jour ce numéro et redéployer. Au premier usage RAG, les fragments chargés en mode extraits sont vectorisés automatiquement.

## Ouvrir l’application privée

```bash
gcloud run services proxy assistant-documentaire-rag \
  --project=zenai-07071978 --region=europe-west6 --port=8080
```

Puis ouvrir <http://127.0.0.1:8080>. Pour d’autres utilisateurs, attribuer explicitement `roles/run.invoker` aux personnes autorisées. Le corpus est commun à tous les utilisateurs de cette démo.

## Vérifier après déploiement

1. `/api/status` indique `storage: cloud` et l’état de la configuration IA.
2. Charger le corpus fictif ; vérifier que les trois fiches apparaissent.
3. Poser la question du budget et du pilotage, vérifier les extraits et les citations.
4. Poser une question hors corpus ; vérifier le refus d’inventer.
5. Après une nouvelle révision, vérifier que les fiches sont toujours présentes.

Ne pas exposer anonymement cette démo avec une clé facturable sans ajouter un contrôle d’accès applicatif, des quotas et une séparation des corpus.

Documentation : [déploiement depuis les sources](https://docs.cloud.google.com/run/docs/deploying-source-code), [secrets Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/secrets), [préconditions Cloud Storage](https://docs.cloud.google.com/storage/docs/request-preconditions).
