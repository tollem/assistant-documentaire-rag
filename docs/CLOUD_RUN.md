# Déployer sur Google Cloud Run

Configuration cible : projet **ZENAI** (`zenai-07071978`), région Zurich **europe-west6**, service **assistant-documentaire-rag**.

## Architecture

- Cloud Run exécute le Dockerfile, sans volume local persistant.
- Cloud Storage conserve `corpus/index.json` dans le bucket privé `zenai-07071978-source-rag`. Une précondition de génération évite l’écrasement des écritures concurrentes.
- Le compte dédié `source-rag-runtime@zenai-07071978.iam.gserviceaccount.com` reçoit seulement l’accès aux objets de ce bucket et, si configuré, l’accès au secret OpenAI dédié.
- La clé est injectée par Secret Manager ; elle ne figure ni dans l’image ni dans Git.
- Le service ZENAI a été rendu public à la demande du propriétaire : son corpus est accessible aux visiteurs. L’accès du service se règle indépendamment de la visibilité du dépôt GitHub.

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
  --allow-unauthenticated --quiet
```

Le build peut nécessiter `roles/run.builder` pour le compte Cloud Build utilisé par le projet. Accorder ce rôle seulement à l’identité réellement indiquée par le build, pas au compte d’exécution de l’application. Cloud Build et Artifact Registry peuvent être facturés indépendamment du nombre d’instances.

Pour un nouveau déploiement privé, utiliser `--no-allow-unauthenticated` à la place. Pour retirer l’accès public d’un service déjà public, retirer aussi le membre `allUsers` du rôle `roles/run.invoker` : le changement du drapeau de déploiement seul ne doit pas être considéré comme une preuve de retrait d’un droit existant.

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

Si le jeton utilisateur gcloud est refusé (cas constaté dans cet environnement), le proxy du projet utilise un jeton destiné explicitement à l’URL Cloud Run, sans secret dans les arguments ou les fichiers :

```bash
python scripts/open_cloud.py
```

Ce chemin nécessite `roles/iam.serviceAccountOpenIdTokenCreator` sur le compte dédié pour l’utilisateur appelant, ainsi que `roles/run.invoker` sur le service pour ce compte. Ces droits ont été configurés dans ZENAI pour le compte Google du propriétaire. Ils ne permettent pas de générer une clé de compte de service. Le jeton expire au bout d’environ une heure ; relancer le proxy pour le renouveler.

## Vérifier après déploiement

1. `/api/status` indique `storage: cloud` et l’état de la configuration IA.
2. Charger le corpus fictif ; vérifier que les trois fiches apparaissent.
3. Poser la question du budget et du pilotage, vérifier les extraits et les citations.
4. Poser une question hors corpus ; vérifier le refus d’inventer.
5. Après une nouvelle révision, vérifier que les fiches sont toujours présentes.

Le script de contrôle automatise ces vérifications sur le corpus fictif. L’option `--rag` effectue de vrais appels OpenAI facturables pour tester les embeddings, les deux agents, les sources croisées et l’information absente :

```bash
python scripts/verify_cloud.py \
  --url https://assistant-documentaire-rag-460305442272.europe-west6.run.app \
  --public \
  --rag
```

Sans `--rag`, seuls le stockage, l’import, la sélection et la recherche en mode extraits sont testés. Le contrôle vérifie qu’un document décoché n’alimente pas la réponse et qu’une sélection vide est refusée. Pour un service privé, remplacer `--public` par `--impersonate-service-account` suivi du compte dédié. Les jetons Google sont gardés en mémoire ; le script ne lit jamais la valeur du secret OpenAI.

Ne pas exposer anonymement cette démo avec une clé facturable sans ajouter un contrôle d’accès applicatif, des quotas et une séparation des corpus.

Documentation : [déploiement depuis les sources](https://docs.cloud.google.com/run/docs/deploying-source-code), [secrets Cloud Run](https://docs.cloud.google.com/run/docs/configuring/services/secrets), [préconditions Cloud Storage](https://docs.cloud.google.com/storage/docs/request-preconditions).
