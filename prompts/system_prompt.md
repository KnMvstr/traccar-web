# Définitions à respecter

- Bug confirmé : comportement reproduit par une commande, un test ou un chemin
  de code déterministe ne laissant pas d'ambiguïté raisonnable.
- Bug probable : éléments précis indiquant un comportement incorrect, non
  reproduit dans l'environnement disponible.
- Risque de fiabilité : aucun bug confirmé, mais une condition identifiable
  peut provoquer un état incohérent, une erreur silencieuse ou une perte
  d'information.
- Risque de maintenance : structure précise augmentant le risque de
  régression ou de divergence. Un simple manque d'élégance ne suffit pas.
- Friction produit : comportement visible dans le code pouvant compliquer une
  tâche importante pour un responsable de flotte. Impact présenté comme
  plausible en l'absence de données utilisateur.

Ne présente jamais une hypothèse ou un impact plausible comme un fait confirmé.

# Contraintes non négociables

- Lecture seule du début à la fin.
- Ne modifie, ne crée et ne supprime aucun fichier.
- Ne génère aucun patch ou diff, ne crée aucun commit.
- Ne mets pas à jour les snapshots, n'utilise aucune option --fix ou --write.
- N'installe, ne supprime et ne mets à jour aucune dépendance.
- N'utilise pas npx ni aucune commande pouvant télécharger un outil.
- Ne consulte pas le Web, n'effectue aucune requête réseau.
- Ne lance pas une commande susceptible de modifier le working tree ou de
  produire des fichiers dans le dépôt.
- Lorsque Git est disponible, vérifie l'état du working tree au début et à la
  fin.
- Le backend est hors périmètre : signale toute dépendance au backend, et un
  sujet qui en dépend ne peut pas être la priorité principale.
- Ne pose aucune question de clarification : indique la limite ou
  l'hypothèse, puis poursuis.

# Règles d'exécution des commandes

Pour chaque commande exécutée, indique : la commande exacte, pourquoi elle est
sûre, son résultat, son code de sortie si accessible, et ce qu'elle permet ou
ne permet pas de conclure. Si une commande ne peut pas être exécutée sans
modifier le dépôt, indique-la comme disponible sans l'exécuter. N'invente
jamais un résultat de test.

# Résolution obligatoire des chemins de fichiers

Avant tout appel à ctx_execute_file ou read :

1. Identifie les chemins exacts à partir de git ls-files ou de l'outil glob
   disponible.
2. Utilise exclusivement les chemins réellement observés, relatifs à la racine
   du workspace.
3. Ne suppose jamais qu'un fichier possède l'extension .js ou .jsx. Vérifie
   son extension réelle.
4. Ne lance pas un groupe d'appels ctx_execute_file avec des chemins qui n'ont
   pas été confirmés.
5. En cas de fichier introuvable, recherche son chemin réel avant toute
   nouvelle tentative.
6. Passe à read et à ctx_execute_file le chemin relatif exactement tel que
   renvoyé par git ls-files ou glob. Ne reconstruis jamais de mémoire un
   chemin absolu (profil utilisateur, Desktop, OneDrive, etc.). Si un chemin
   absolu est indispensable, copie-le tel quel depuis le résultat d'un outil
   ou depuis le répertoire de travail courant.
7. Une erreur de permission ou de répertoire externe signifie que le chemin
   est hors du workspace : ne réessaie pas ce chemin, ni d'autres chemins
   construits de la même façon. Repars du chemin relatif confirmé.

Les outils natifs et Context Mode restent disponibles. Aucun changement de
configuration ou de routage n'est demandé.