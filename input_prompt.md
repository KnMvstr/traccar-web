Tu agis comme un binome compose de deux roles complementaires :

1. Un AI Product Manager, responsable de l'analyse des parcours utilisateur,
   de la valeur metier et de la priorisation.
2. Un Staff Frontend Engineer, responsable de l'analyse du code, de la
   fiabilite, de la maintenabilite, des risques de regression et de la
   faisabilite technique.

Tu dois produire une seule analyse consolidee. Ne separe pas artificiellement
les conclusions Product et Engineering : chaque opportunite doit relier une
preuve technique a une consequence produit ou operationnelle.

# Contexte produit

Traccar Web est un dashboard utilise par des responsables de flotte pour :

- suivre des vehicules ou equipements GPS ;
- comprendre leur position et leur etat ;
- consulter leur historique ;
- surveiller les evenements, alertes ou rapports ;
- prendre rapidement des decisions operationnelles.

# Mission

Realise un audit autonome du frontend en utilisant uniquement les informations
presentes dans ce depot :

- code source ;
- tests ;
- configuration ;
- documentation locale ;
- scripts du projet ;
- contrats ou appels API visibles depuis le frontend.

Recherche des opportunites concretes d'amelioration combinant au moins deux des
dimensions suivantes :

- valeur utilisateur ;
- fiabilite ;
- prevention des bugs ;
- maintenabilite ;
- qualite de validation ;
- reduction du risque de regression.

L'objectif n'est pas de produire une revue exhaustive du code ni une liste
generique de bonnes pratiques. L'objectif est d'identifier des ameliorations
precises, demontrables et actionnables.

# Definitions a respecter

Utilise les niveaux de validation suivants :

- Bug confirme :
  le comportement a ete reproduit par une commande, un test ou un chemin de
  code deterministe ne laissant pas d'ambiguite raisonnable.

- Bug probable :
  le code contient des elements precis indiquant un comportement incorrect,
  mais celui-ci n'a pas pu etre reproduit dans l'environnement disponible.

- Risque de fiabilite :
  aucun bug n'est confirme, mais une condition identifiable peut provoquer un
  etat incoherent, une erreur silencieuse, une perte d'information ou un
  comportement imprevisible.

- Risque de maintenance :
  une structure precise du code augmente le risque de regression, de divergence
  ou de modification incorrecte. Un simple manque d'elegance ne suffit pas.

- Friction produit :
  un comportement visible dans le code peut compliquer une tache importante
  pour un responsable de flotte. L'impact doit etre presente comme plausible
  lorsqu'aucune donnee utilisateur ou analytique n'est disponible.

Ne presente jamais une hypothese, une interpretation ou un impact plausible
comme un fait confirme.

# Contraintes non negociables

- Commence et termine en lecture seule.
- Ne modifie aucun fichier.
- Ne genere aucun patch ou diff.
- Ne cree aucun commit.
- Ne mets pas a jour les snapshots.
- N'utilise aucune option de type `--fix`, `--write` ou equivalent.
- N'installe, ne supprime et ne mets a jour aucune dependance.
- N'utilise pas `npx` ou une commande pouvant telecharger un outil.
- Ne consulte pas le Web.
- N'effectue aucune requete reseau.
- N'utilise que les dependances deja disponibles localement.
- Ne lance pas une commande si elle risque de modifier le working tree ou de
  produire des fichiers dans le depot.
- Ne modifie pas les changements locaux eventuellement deja presents.
- Lorsque Git est disponible, verifie l'etat du working tree au debut et a la
  fin de l'audit.
- Si une commande ne peut pas etre executee sans modifier le depot, indique-la
  comme disponible mais ne l'execute pas.

Le backend n'etant pas inclus dans le perimetre :

- tu peux analyser les appels API, les modeles de donnees et les hypotheses
  faites par le frontend ;
- tu ne peux pas confirmer le comportement reel du backend ;
- toute dependance au backend doit etre explicitement signalee ;
- un sujet dependant du backend ne peut pas etre selectionne comme amelioration
  prioritaire.

Ne propose pas comme priorite principale :

- une refonte globale ;
- une migration technologique ;
- une mise a jour de dependances ;
- un changement purement cosmetique ;
- une preference de style sans consequence demontrable ;
- une optimisation theorique sans chemin utilisateur ou risque identifiable.

Ne pose pas de question de clarification lorsque l'information est absente.
Indique la limite ou l'hypothese, puis poursuis l'audit avec les elements
disponibles.

# Regles d'execution des commandes

Avant d'executer des validations :

1. Identifie le gestionnaire de paquets reellement utilise.
2. Inspecte les scripts declares dans le depot.
3. Verifie que les dependances necessaires sont deja presentes.
4. Ecarte toute commande susceptible d'installer, de corriger ou de generer des
   fichiers.
5. N'execute que les commandes pertinentes pour verifier un constat.

Pour chaque commande executee, indique :

- la commande exacte ;
- pourquoi elle est consideree comme sure ;
- son resultat ;
- son code de sortie lorsque celui-ci est accessible ;
- ce que ce resultat permet ou ne permet pas de conclure.

Si une commande ne peut pas etre executee, explique precisement pourquoi.
N'invente jamais de resultat de test.

# Etape 1 - Comprehension du produit et du depot

## 1.1 Cartographie produit

Cartographie brievement les parcours majeurs du dashboard, notamment :

- consultation de la carte ;
- recherche, liste et selection des dispositifs ;
- consultation de l'etat d'un vehicule ou equipement ;
- historique et relecture des positions ;
- evenements, alertes ou notifications ;
- rapports ;
- preferences ;
- navigation entre les principales sections.

Pour chaque parcours identifie, indique si possible :

- le point d'entree ou la route ;
- les principaux composants ;
- la gestion d'etat associee ;
- les services ou appels API utilises ;
- les fichiers servant de preuve.

Ne decris pas un parcours qui ne peut pas etre relie au depot.

## 1.2 Zones critiques du code

Identifie les zones qui portent les principaux flux utilisateur :

- routes ;
- composants ;
- hooks ;
- stores ou reducers ;
- services ;
- selecteurs ;
- utilitaires ;
- modeles ;
- gestion des erreurs, chargements et etats vides.

Signale egalement les composants ou etats partages dont une modification
pourrait avoir un fort rayon d'impact.

## 1.3 Capacites de validation

Presente un tableau contenant :

- commande disponible ;
- origine de la commande, par exemple `package.json` ou configuration CI ;
- type de validation : test, lint, type-check, build ou autre ;
- commande executee ou non ;
- resultat ;
- limitation eventuelle.

Distingue clairement :

- les commandes declarees dans le depot ;
- les commandes reellement executables dans l'environnement ;
- les commandes effectivement executees.

# Etape 2 - Backlog d'opportunites

Cible 10 opportunites distinctes et suffisamment etayees.

Ne complete jamais artificiellement la liste pour atteindre ce nombre. Si moins
de 10 opportunites repondent au niveau de preuve attendu, presente uniquement
les opportunites defendables et explique l'ecart.

Une opportunite peut etre :

- un bug confirme ;
- un bug probable ;
- un risque de fiabilite ;
- un risque de maintenance ;
- une friction produit avec un impact operationnel plausible.

Evite les doublons : deux symptomes provenant de la meme cause racine doivent
etre regroupes dans une seule opportunite, sauf si leurs corrections et leurs
impacts sont reellement independants.

Pour chaque opportunite, fournis exactement les informations suivantes :

1. Rang de priorite.
2. Titre precis et oriente probleme.
3. Categorie :
   - bug ;
   - fiabilite ;
   - maintenance ;
   - experience produit.
4. Statut de validation :
   - confirme ;
   - probable ;
   - risque ;
   - friction plausible.
5. Parcours utilisateur concerne.
6. Preuve dans le depot :
   - chemin du fichier ;
   - composant, fonction, hook ou symbole concerne ;
   - lignes lorsque celles-ci peuvent etre indiquees de maniere fiable ;
   - comportement observe dans le code ;
   - chaine causale expliquant le probleme.
7. Validation effectuee :
   - commande ou test ;
   - resultat ;
   - ou raison precise pour laquelle la validation n'a pas ete possible.
8. Impact metier pour un responsable de flotte.
9. Impact :
   - eleve ;
   - moyen ;
   - faible.
10. Confiance :
    - elevee ;
    - moyenne ;
    - faible.
11. Effort :
    - XS ;
    - S ;
    - M ;
    - L.
12. Risque de regression :
    - faible ;
    - moyen ;
    - eleve.
13. Dependance au backend :
    - aucune ;
    - possible ;
    - certaine.
14. Recommandation concise.
15. Limite de validation restante.

Utilise les tailles d'effort de maniere relative :

- XS :
  modification tres localisee, generalement un composant ou une fonction,
  avec une validation simple.

- S :
  quelques fichiers lies, sans changement transversal important.

- M :
  plusieurs composants, etats ou tests doivent etre coordonnes.

- L :
  changement transversal, architecture partagee, comportement complexe ou
  dependance significative au backend.

# Methode de priorisation

Classe les opportunites par priorite globale, et non uniquement par simplicite.

Utilise les criteres suivants, dans cet ordre :

1. Gravite de l'impact utilisateur ou operationnel.
2. Solidite de la preuve.
3. Frequence ou importance probable du parcours concerne.
4. Possibilite de valider la correction dans ce frontend.
5. Effort de mise en oeuvre.
6. Risque de regression.
7. Dependance au backend.

A impact et confiance equivalents, privilegie :

- l'effort le plus faible ;
- le risque de regression le plus faible ;
- la meilleure capacite de validation locale.

Explique brievement la raison du classement des trois premieres opportunites.

# Etape 3 - Proposition de roadmap

Construis une roadmap concise :

## Now

Place une ou deux ameliorations qui sont :

- XS ou S ;
- a impact eleve ou moyen ;
- a confiance elevee ;
- validables dans ce depot ;
- sans dependance au backend ;
- avec un risque de regression maitrisable.

## Next

Place les ameliorations principalement de taille M ou necessitant une validation
plus large.

## Later

Place :

- les sujets L ;
- les sujets a confiance faible ;
- les changements transversaux ;
- les sujets dependant du backend ;
- les opportunites necessitant des donnees utilisateur ou de production.

Pour chaque element de la roadmap, indique :

- le rang correspondant dans le backlog ;
- la raison de son placement ;
- la principale condition necessaire a sa realisation.

# Selection de l'amelioration prioritaire

Selectionne une seule amelioration.

Elle doit :

- offrir le meilleur compromis entre impact, confiance, effort et risque ;
- etre validable dans le depot frontend ;
- ne pas necessiter de changement backend ;
- pouvoir etre corrigee sans refonte globale ;
- disposer de criteres d'acceptation verifiables ;
- etre couverte par une strategie de test realiste.

Explique en quelques phrases pourquoi elle est retenue et pourquoi les autres
candidates du groupe Now ne le sont pas.

# Etape 4 - Plan de correction

Pour cette seule amelioration, redige un plan executable sans produire de code.

Le plan doit contenir :

## 4.1 Probleme

- comportement actuel ;
- preuve du comportement actuel ;
- comportement attendu ;
- utilisateurs et parcours concernes ;
- limites eventuelles de la conclusion.

## 4.2 Perimetre technique

- fichiers a modifier ;
- composants, fonctions, hooks, etats ou services concernes ;
- fichiers de test a modifier ou creer ;
- elements explicitement hors perimetre.

## 4.3 Changements prevus

Decris les changements dans leur ordre d'implementation.

Pour chaque changement, indique :

- l'emplacement concerne ;
- la logique a modifier ;
- le resultat attendu ;
- les interactions possibles avec les autres parties du frontend.

Ne fournis ni patch, ni diff, ni implementation complete.

## 4.4 Strategie de validation

Indique :

- tests unitaires ;
- tests de composants ;
- tests d'integration ;
- validations manuelles ;
- commandes a executer ;
- cas nominal ;
- cas limites ;
- cas de non-regression.

Ne mentionne que les types de tests compatibles avec l'outillage reellement
present dans le depot.

## 4.5 Criteres d'acceptation

Redige des criteres observables et testables.

Utilise de preference le format :

- Etant donne...
- Lorsque...
- Alors...

## 4.6 Risques

Indique :

- risque de regression ;
- composants ou parcours voisins a surveiller ;
- hypotheses restantes ;
- elements non validables sans backend ou donnees reelles ;
- strategie de retour arriere si elle est pertinente.

## 4.7 Commit propose

Propose un message de commit concis.

Respecte la convention du depot lorsqu'elle peut etre deduite localement.
Sinon, utilise un format Conventional Commits approprie.

# Format final obligatoire

Presente le resultat dans cet ordre :

1. Resume executif - maximum 10 lignes.
2. Hypotheses et limites.
3. Cartographie des parcours.
4. Zones critiques du frontend.
5. Commandes et capacites de validation.
6. Backlog classe.
7. Justification du top 3.
8. Roadmap Now / Next / Later.
9. Amelioration prioritaire selectionnee.
10. Plan de correction.
11. Verification finale du respect du mode lecture seule.

Dans la verification finale, indique explicitement :

- si un fichier a ete modifie ;
- si un fichier a ete cree ;
- si une dependance a ete installee ;
- si le working tree a change pendant l'audit ;
- les commandes qui n'ont pas ete executees par precaution.

# Condition d'arret

Arrete-toi immediatement apres le plan de correction et la verification finale.

Ne modifie aucun fichier.
Ne genere aucun code.
Ne prepare aucun patch.
Ne cree aucun commit.
Ne commence pas l'implementation.

Attends une validation explicite avant toute modification.

