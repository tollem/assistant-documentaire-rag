# Démonstration de classe — cinq minutes

## 1. Le besoin (30 secondes)

« Je souhaite retrouver une information dans mes supports de cours sans perdre sa provenance. L’assistant répond à partir d’un corpus choisi et montre les preuves. »

## 2. L’indexation (1 minute)

Charger les trois fiches Atlas. Expliquer : extraction du texte, découpage avec recouvrement, création des embeddings et stockage. Préciser que les fiches et leur budget sont fictifs.

## 3. Une réponse qui croise des sources (1 minute)

Question : **Quel est le budget et qui pilote le projet Atlas ?**

Résultat attendu : budget maximal de **500 CHF**, pilotage par **Léa Martin**, avec références à la fiche budget et à la note de cadrage. Cliquer sur une citation ; montrer le passage original et la page.

## 4. Le parcours des agents (1 minute)

- Recherche : sélection des fragments par proximité sémantique et mots communs.
- Synthèse : premier appel IA, rédaction sourcée.
- Vérification : second appel IA, relecture contre les preuves, puis contrôle des numéros de référence par le serveur.

Cette application est un RAG orchestré avec deux rôles IA spécialisés ; il ne s’agit pas de trois agents autonomes. Le RAG apporte des connaissances au moment de la question ; il n’entraîne pas le modèle.

## 5. L’information absente (1 minute)

Question : **Quel est le mot de passe du serveur Atlas ?**

Résultat attendu : refus de déduire un mot de passe absent. Les sources peuvent mentionner explicitement qu’aucun mot de passe n’est fourni ; retrouver un passage ne suffit pas à répondre.

## 6. Les limites (30 secondes)

Montrer le mode extraits, qui reste local et ne génère pas de réponse. En mode RAG, les contenus sont transmis à OpenAI. Les citations et le second agent réduisent certains risques sans garantir la vérité. PDF scannés non pris en charge, questions indépendantes, corpus partagé dans le service Cloud Run.
