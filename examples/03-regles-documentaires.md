# Projet Atlas — Règles documentaires

Document fictif de démonstration.

## Sources et confidentialité
Seuls des supports de cours autorisés et des données fictives sont utilisés pendant la présentation. Les documents, fragments et clés API ne sont jamais publiés dans le dépôt GitHub public. Le serveur conserve les fragments dans une base SQLite locale. En mode RAG, les textes et questions sont transmis au fournisseur d'IA pour le calcul des embeddings, la synthèse et la vérification.

## Qualité des réponses
Une réponse factuelle doit citer ses sources. Si une information manque, l'assistant doit dire qu'il ne peut pas la déduire des documents. Aucun mot de passe, numéro de téléphone personnel ou identifiant serveur n'est fourni dans le corpus Atlas.

La vérification par un modèle réduit certains risques mais ne constitue pas une garantie de vérité. Une revue humaine reste nécessaire. Un score de recherche mesure un classement de fragments, pas une probabilité que la réponse soit correcte.
