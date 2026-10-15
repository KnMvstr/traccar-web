Tu agis comme un binôme composé de deux rôles complémentaires :

1. Un AI Product Manager, responsable de la cohérence de l'expérience.
2. Un Staff Frontend Engineer, responsable de l'architecture de l'état et du
   rayon d'impact des modifications.

Tu dois produire une seule analyse consolidée.

# Contexte produit

Les préférences (unités, fuseau, carte, notifications) influencent ce que
voit le responsable de flotte. Une préférence qui s'applique à certains
écrans mais pas à d'autres produit des chiffres contradictoires.

# Mission

Audite la lecture, la modification et la persistance des préférences, ainsi
que les états partagés à fort rayon d'impact (stores, reducers, contextes).

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
- Ne modifie pas les changements locaux éventuellement déjà présents.
- Lorsque Git est disponible, vérifie l'état du working tree au début et à la
  fin de l'audit.
- Si une commande ne peut pas être exécutée sans modifier le dépôt, indique-la
  comme disponible mais ne l'exécute pas.

Le backend n'étant pas inclus dans le périmètre :

- tu peux analyser les appels API, les modèles de données et les hypothèses
  faites par le frontend ;
- tu ne peux pas confirmer le comportement réel du backend ;
- toute dépendance au backend doit être explicitement signalée ;
- un sujet dépendant du backend ne peut pas être sélectionné comme amélioration
  prioritaire.

Ne propose pas comme priorité principale :

- une refonte globale ;
- une migration technologique ;
- une mise à jour de dépendances ;
- un changement purement cosmétique ;
- une préférence de style sans conséquence démontrable ;
- une optimisation théorique sans chemin utilisateur ou risque identifiable.

Ne pose pas de question de clarification lorsque l'information est absente.
Indique la limite ou l'hypothèse, puis poursuis l'audit avec les éléments
disponibles.

# Règles d'exécution des commandes

Avant d'exécuter des validations :

1. Identifie le gestionnaire de paquets réellement utilisé.
2. Inspecte les scripts déclarés dans le dépôt.
3. Vérifie que les dépendances nécessaires sont déjà présentes.
4. Écarte toute commande susceptible d'installer, de corriger ou de générer des
   fichiers.
5. N'exécute que les commandes pertinentes pour vérifier un constat.

Pour chaque commande exécutée, indique :

- la commande exacte ;
- pourquoi elle est considérée comme sûre ;
- son résultat ;
- son code de sortie lorsque celui-ci est accessible ;
- ce que ce résultat permet ou ne permet pas de conclure.

Si une commande ne peut pas être exécutée, explique précisément pourquoi.
N'invente jamais de résultat de test.

# Étape 1 - Compréhension du produit et du dépôt

## 1.1 Cartographie produit

Cartographie brièvement les parcours majeurs du dashboard, notamment :

- consultation de la carte ;
- recherche, liste et sélection des dispositifs ;
- consultation de l'état d'un véhicule ou équipement ;
- historique et relecture des positions ;
- événements, alertes ou notifications ;
- rapports ;
- préférences ;
- navigation entre les principales sections.

Pour chaque parcours identifié, indique si possible :

- le point d'entrée ou la route ;
- les principaux composants ;
- la gestion d'état associée ;
- les services ou appels API utilisés ;
- les fichiers servant de preuve.

Ne décris pas un parcours qui ne peut pas être relié au dépôt.

## 1.2 Zones critiques du code

Identifie les zones qui portent les principaux flux utilisateur :

- routes ;
- composants ;
- hooks ;
- stores ou reducers ;
- services ;
- sélecteurs ;
- utilitaires ;
- modèles ;
- gestion des erreurs, chargements et états vides.

Signale également les composants ou états partagés dont une modification
pourrait avoir un fort rayon d'impact.

## 1.3 Capacités de validation

Présente un tableau contenant :

- commande disponible ;
- origine de la commande, par exemple `package.json` ou configuration CI ;
- type de validation : test, lint, type-check, build ou autre ;
- commande exécutée ou non ;
- résultat ;
- limitation éventuelle.

Distingue clairement :

- les commandes déclarées dans le dépôt ;
- les commandes réellement exécutables dans l'environnement ;
- les commandes effectivement exécutées.

# Étape 2 - Backlog d'opportunités

Cible 10 opportunités distinctes et suffisamment étayées.

Ne complète jamais artificiellement la liste pour atteindre ce nombre. Si moins
de 10 opportunités répondent au niveau de preuve attendu, présente uniquement
les opportunités défendables et explique l'écart.

Une opportunité peut être :

- un bug confirmé ;
- un bug probable ;
- un risque de fiabilité ;
- un risque de maintenance ;
- une friction produit avec un impact opérationnel plausible.

Évite les doublons : deux symptômes provenant de la même cause racine doivent
être regroupés dans une seule opportunité, sauf si leurs corrections et leurs
impacts sont réellement indépendants.

Pour chaque opportunité, fournis exactement les informations suivantes :

1. Rang de priorité.
2. Titre précis et orienté problème.
3. Catégorie :
   - bug ;
   - fiabilité ;
   - maintenance ;
   - expérience produit.
4. Statut de validation :
   - confirmé ;
   - probable ;
   - risque ;
   - friction plausible.
5. Parcours utilisateur concerné.
6. Preuve dans le dépôt :
   - chemin du fichier ;
   - composant, fonction, hook ou symbole concerné ;
   - lignes lorsque celles-ci peuvent être indiquées de manière fiable ;
   - comportement observé dans le code ;
   - chaîne causale expliquant le problème.
7. Validation effectuée :
   - commande ou test ;
   - résultat ;
   - ou raison précise pour laquelle la validation n'a pas été possible.
8. Impact métier pour un responsable de flotte.
9. Impact :
   - élevé ;
   - moyen ;
   - faible.
10. Confiance :
    - élevée ;
    - moyenne ;
    - faible.
11. Effort :
    - XS ;
    - S ;
    - M ;
    - L.
12. Risque de régression :
    - faible ;
    - moyen ;
    - élevé.
13. Dépendance au backend :
    - aucune ;
    - possible ;
    - certaine.
14. Recommandation concise.
15. Limite de validation restante.

Utilise les tailles d'effort de manière relative :

- XS :
  modification très localisée, généralement un composant ou une fonction,
  avec une validation simple.

- S :
  quelques fichiers liés, sans changement transversal important.

- M :
  plusieurs composants, états ou tests doivent être coordonnés.

- L :
  changement transversal, architecture partagée, comportement complexe ou
  dépendance significative au backend.

# Méthode de priorisation

Classe les opportunités par priorité globale, et non uniquement par simplicité.

Utilise les critères suivants, dans cet ordre :

1. Gravité de l'impact utilisateur ou opérationnel.
2. Solidité de la preuve.
3. Fréquence ou importance probable du parcours concerné.
4. Possibilité de valider la correction dans ce frontend.
5. Effort de mise en œuvre.
6. Risque de régression.
7. Dépendance au backend.

A impact et confiance équivalents, privilégie :

- l'effort le plus faible ;
- le risque de régression le plus faible ;
- la meilleure capacité de validation locale.

Explique brièvement la raison du classement des trois premières opportunités.

# Étape 3 - Proposition de roadmap

Construis une roadmap concise :

## Now

Place une ou deux améliorations qui sont :

- XS ou S ;
- à impact élevé ou moyen ;
- à confiance élevée ;
- validables dans ce dépôt ;
- sans dépendance au backend ;
- avec un risque de régression maîtrisable.

## Next

Place les améliorations principalement de taille M ou nécessitant une validation
plus large.

## Later

Place :

- les sujets L ;
- les sujets à confiance faible ;
- les changements transversaux ;
- les sujets dépendant du backend ;
- les opportunités nécessitant des données utilisateur ou de production.

Pour chaque élément de la roadmap, indique :

- le rang correspondant dans le backlog ;
- la raison de son placement ;
- la principale condition nécessaire à sa réalisation.

# Sélection de l'amélioration prioritaire

Sélectionne une seule amélioration.

Elle doit :

- offrir le meilleur compromis entre impact, confiance, effort et risque ;
- être validable dans le dépôt frontend ;
- ne pas nécessiter de changement backend ;
- pouvoir être corrigée sans refonte globale ;
- disposer de critères d'acceptation vérifiables ;
- être couverte par une stratégie de test réaliste.

Explique en quelques phrases pourquoi elle est retenue et pourquoi les autres
candidates du groupe Now ne le sont pas.

# Étape 4 - Plan de correction

Pour cette seule amélioration, rédige un plan exécutable sans produire de code.

Le plan doit contenir :

## 4.1 Problème

- comportement actuel ;
- preuve du comportement actuel ;
- comportement attendu ;
- utilisateurs et parcours concernés ;
- limites éventuelles de la conclusion.

## 4.2 Périmètre technique

- fichiers à modifier ;
- composants, fonctions, hooks, états ou services concernés ;
- fichiers de test à modifier ou créer ;
- éléments explicitement hors périmètre.

## 4.3 Changements prévus

Décris les changements dans leur ordre d'implémentation.

Pour chaque changement, indique :

- l'emplacement concerné ;
- la logique à modifier ;
- le résultat attendu ;
- les interactions possibles avec les autres parties du frontend.

Ne fournis ni patch, ni diff, ni implémentation complète.

## 4.4 Stratégie de validation

Indique :

- tests unitaires ;
- tests de composants ;
- tests d'intégration ;
- validations manuelles ;
- commandes à exécuter ;
- cas nominal ;
- cas limites ;
- cas de non-régression.

Ne mentionne que les types de tests compatibles avec l'outillage réellement
présent dans le dépôt.

## 4.5 Critères d'acceptation

Rédige des critères observables et testables.

Utilise de préférence le format :

- Étant donné...
- Lorsque...
- Alors...

## 4.6 Risques

Indique :

- risque de régression ;
- composants ou parcours voisins à surveiller ;
- hypothèses restantes ;
- éléments non validables sans backend ou données réelles ;
- stratégie de retour arrière si elle est pertinente.

## 4.7 Commit proposé

Propose un message de commit concis.

Respecte la convention du dépôt lorsqu'elle peut être déduite localement.
Sinon, utilise un format Conventional Commits approprié.

# Format final obligatoire

Présente le résultat dans cet ordre :

1. Résumé exécutif - maximum 10 lignes.
2. Hypothèses et limites.
3. Cartographie des parcours.
4. Zones critiques du frontend.
5. Commandes et capacités de validation.
6. Backlog classé.
7. Justification du top 3.
8. Roadmap Now / Next / Later.
9. Amélioration prioritaire sélectionnée.
10. Plan de correction.
11. Vérification finale du respect du mode lecture seule.

Dans la vérification finale, indique explicitement :

- si un fichier a été modifié ;
- si un fichier a été créé ;
- si une dépendance a été installée ;
- si le working tree a changé pendant l'audit ;
- les commandes qui n'ont pas été exécutées par précaution.

# Condition d'arrêt

Arrête-toi immédiatement après le plan de correction et la vérification finale.

Ne modifie aucun fichier.
Ne génère aucun code.
Ne prépare aucun patch.
Ne crée aucun commit.
Ne commence pas l'implémentation.

Attends une validation explicite avant toute modification.