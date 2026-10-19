# Traccar Web Benchmark Runner

Cette branche sert de **runner de benchmark OpenCode** pour mesurer l'impact
de `context-mode` sur une séquence de prompts d'audit Traccar Web.

## Objectif

Le benchmark compare trois branches du dépôt principal :

- **OFF** : sans `context-mode` ;
- **ON avec routing** : avec `context-mode` et ses instructions de routage ;
- **ON sans routing** : avec `context-mode`, sans référence à ces instructions.

Chaque variante ON est comparée au même groupe OFF. Le runner ne génère pas
de comparaison directe entre les deux variantes ON.

L'objectif est de mesurer :

- la consommation de tokens par tour ;
- la croissance du contexte au fil de la session ;
- le coût du premier tour ;
- le coût marginal des tours suivants ;
- le point d'équilibre entre ON et OFF ;
- la réutilisation du contexte entre plusieurs prompts ;
- l'effet des outils `ctx_*` sur la trajectoire de session.

## Campagnes à trois configurations

Lancer le runner depuis `benchmark/opencode-runner`. Chaque répétition teste
une fois chacune des trois branches :

| Branche | Configuration | Résultats |
|---|---|---|
| `benchmark/opencode-off` | Sans Context Mode | `results/off/` |
| `benchmark/opencode-on-plus-routing` | Context Mode avec routing | `results/on/` |
| `benchmark/opencode-on-no-routing` | Context Mode sans routing | `results/on-no-routing/` |

`--runs=5` exécute donc quinze sessions mesurées. L'ordre des trois
configurations tourne à chaque répétition pour équilibrer leur position.
Chaque variante ON possède son diagnostic indépendant : `results/diagnostic/`
pour le routing et `results/on-no-routing/diagnostic/` sans routing.
Les deux variantes exigent le plugin ; seule la variante avec routing doit
référencer `.opencode/context-mode-routing.md`.

Le même groupe OFF sert de référence aux deux comparaisons. `compare.json`
et `validity.json` concernent ON avec routing ; `compare-no-routing.json`
et `validity-no-routing.json` concernent ON sans routing. Les pilotes restent
exclus des deux comparaisons. Archiver aussi `results/on-no-routing/`.
Dans chaque rapport, ON désigne la variante sélectionnée et OFF la référence commune.
Les options `--runner`, `--off`, `--on` et `--on-no-routing` permettent de
remplacer les noms de branches par défaut.

```powershell
# Recalcul de la comparaison sans routing
node compare.mjs --results=results --on=on-no-routing --runs=1,2,3,4,5
```

## Nombre de runs et options du runner

Une **campagne** est un lancement de `bench.mjs`. Une **répétition** regroupe
un run sur chacune des trois branches. Un **run** est une session OpenCode neuve
qui enchaîne les huit prompts P0–P7 ; le contexte est conservé entre les prompts
du run, puis une nouvelle session est créée pour le run suivant.

`--runs=N` accepte un entier supérieur ou égal à 1, sans plafond métier imposé
par le runner. Il n'existe pas de mode infini : fournir un nombre fini.
La valeur par défaut est **5**. Les runs sont numérotés de 1 à N sur chaque
branche et exécutés séquentiellement, sans parallélisme.

| Option | Sessions mesurées au total | Prompts mesurés si la campagne termine |
|---|---:|---:|
| `--runs=1` | 3 | 24 |
| `--runs=5` ou option omise | 15 | 120 |
| `--runs=60` | 180 | 1 440 |
| `--pilot` | 3, toutes numérotées 0 | 24, exclus des statistiques |

Les deux diagnostics ON s'ajoutent à ces sessions et peuvent consommer des
crédits. Le temps, le stockage, les crédits et les limites du fournisseur restent
les contraintes pratiques ; aucune durée totale ni dépense maximale n'est fixée
par `--runs`. Zéro, les nombres négatifs et les nombres fractionnaires sont refusés.

Avec `--pilot`, une seule répétition numérotée **0** est exécutée, même si
`--runs=60` est aussi fourni. La valeur de `--runs`, si fournie, doit toutefois
rester valide. Le pilote appelle réellement le modèle et les diagnostics,
mais ne calcule aucune comparaison statistique.

Les arguments avec valeur doivent utiliser la syntaxe **`--option=valeur`**.
Pour un chemin avec espaces, entourer l'argument complet de guillemets.

| Option de `bench.mjs` | Défaut | Effet |
|---|---|---|
| `--model=provider/model` | Obligatoire | Modèle demandé pour les diagnostics et tous les runs. |
| `--variant=nom` | Omise | Variante transmise à OpenCode ; utiliser une variante prise en charge par le modèle. |
| `--runs=N` | `5` | Nombre de runs par branche hors pilote. |
| `--pilot` | Absent | Exécute uniquement le run 0 par branche. Pour le désactiver, omettre l'option ; `--pilot=false` active aussi le pilote car sa présence est détectée. |
| `--timeout-ms=N` | Runs : `900000` ; diagnostics : `180000` | Délai par processus OpenCode, en millisecondes ; fournir un nombre fini strictement positif. Une valeur explicite s'applique aux deux. Ce n'est pas un délai total de campagne. |
| `--repo=chemin` | Dossier de `bench.mjs` | Dépôt cible contenant les branches, scripts et prompts ; les résultats sont écrits dans son dossier `results/`. |
| `--runner=branche` | `benchmark/opencode-runner` | Branche courante exigée dans le dépôt cible. |
| `--off=branche` | `benchmark/opencode-off` | Branche sans plugin et sans référence au routing. |
| `--on=branche` | `benchmark/opencode-on-plus-routing` | Branche avec plugin et référence au routing. |
| `--on-no-routing=branche` | `benchmark/opencode-on-no-routing` | Branche avec plugin, sans référence au routing. |

Les noms de branches sont configurés explicitement : le runner ne découvre pas
automatiquement les nouvelles branches `benchmark/opencode-*`. Les trois refs
doivent être disponibles dans le dépôt cible ; le runner ne fait ni fetch ni pull.
Les options de branche changent les refs testées, pas les noms des dossiers résultats.
`bench.mjs` écrit toujours dans `<repo>/results/` ; `--results` est une option
pour les scripts d'analyse et `run.mjs`, pas pour le runner de campagne.

## Principe

Le runner exécute une même séquence de prompts dans une même session OpenCode.
Les prompts sont définis dans `prompts.json` et stockés dans des fichiers `.md`
individuels.

Chaque run :

1. vérifie que le dépôt cible est propre ;
2. vérifie que le bloc commun OpenCode est identique et présent ;
3. exécute les prompts dans l'ordre ;
4. exporte la session ;
5. extrait les métriques par tour ;
6. enregistre un export brut et un résumé ;
7. en fin de campagne hors pilote, compare chaque variante ON à OFF et écrit
   `results/compare.json` et `results/compare-no-routing.json`.

## Structure attendue

```text
traccar-web/
├─ .opencode/
│  └─ instructions.md
├─ prompts.json
├─ prompts/
│  ├─ P0_Inventory.md
│  ├─ P1_FullAudit.md
│  ├─ P2_LivePositionReliability.md
│  ├─ P3_LoadingErrorEmptyStates.md
│  ├─ P4_TestCoverageValidation.md
│  ├─ P5_HistoryAndTripReplay.md
│  ├─ P6_PreferencesAndSharedState.md
│  └─ P7_ChainSummary.md
├─ run.mjs
├─ compare.mjs
├─ results/
│  ├─ off/
│  ├─ on/
│  ├─ on-no-routing/
│  └─ diagnostic/
└─ README.md
```

## Protocole de mesure

Le code de sortie 0 du CLI ne prouve pas la fin d'un prompt. Après chaque tour,
le runner exporte la session et exige une dernière réponse assistant avec
`finish: "stop"`, un horodatage de fin et du texte, sans outil en attente ni
erreur assistant. Un refus d'outil suivi d'une correction et d'une réponse finale
reste acceptable. Une interruption bloque immédiatement le prompt suivant.
Un timeout tue aussi les processus enfants sous Windows. Les traces stdout,
stderr et exports restent disponibles, même pour une branche invalide.

Les chemins de prompts sont normalisés et vérifiés, y compris les liens
symboliques. L'agent reçoit la racine exacte et la consigne de travailler avec
des chemins relatifs. Un overlay OpenCode identique OFF/ON refuse les accès
extérieurs, les modifications et les boucles de répétition ; il n'élargit aucune
permission. Les sous-agents et les outils de mise à jour/purge sont désactivés
pour éviter des traitements non mesurés ou une modification de l'environnement.
Après une erreur de chemin ou permission, l'agent a au plus deux
corrections consécutives par outil/type d'erreur. Le runner coupe après le
troisième échec consécutif observé dans le flux JSON. Un appel réussi remet
le compteur de l'outil à zéro. Les événements dupliqués sont ignorés. Ce contrôle
dépend des événements émis par OpenCode ; le timeout reste le dernier garde-fou.

Chaque campagne crée un worktree détaché, utilisé au même emplacement pour les
trois branches. Le dépôt de travail de l'utilisateur reste disponible avec ses
modifications. Le worktree temporaire est supprimé uniquement si Git l'accepte
sans `--force` ; s'il est modifié, il est conservé pour inspection.
Les refs Git sont figées au démarrage. Les fichiers suivis doivent être
identiques hors `opencode.json` et `.opencode/context-mode-routing.md`. La
configuration peut différer par le plugin Context Mode et la référence exacte
à ce fichier dans `instructions`, obligatoire uniquement dans ON avec routing
et interdite dans les deux autres configurations. Le fichier référencé doit
exister ; les instructions communes restent identiques. Le benchmark mesure
ainsi le plugin avec et sans ses règles de routage. L'empreinte
`contextModeRoutingSha` conserve le contenu du fichier utilisé dans chaque run.
Le runner enregistre les empreintes du code, des
prompts, de la configuration, de l'overlay et de la configuration effective de
l'agent, ainsi que les versions, le modèle et la variante. La version résolue,
l'entrée du plugin et son lockfile sont enregistrés ; une variation entre runs
ON bloque la comparaison. L'agent `build` est explicitement choisi. Les outils `ctx_*`
peuvent être natifs au plugin : une liste MCP vide ne prouve pas leur absence.

Chaque variante ON reçoit un diagnostic préalable dans une session indépendante : configuration
résolue, agent et outils disponibles, état MCP, `ctx_doctor` si exposé, puis
calcul de `2+2` par un outil ctx d'exécution. Le diagnostic doit terminer et
retourner `4`. Il ne modifie pas les prompts de la séquence autonome.
Les prompts P0–P7 sont identiques pour OFF et ON, et les nouveaux runs n'imposent
pas ctx. Les rapports distinguent outils indisponibles, disponibles mais non
choisis, appels échoués et appels réussis. Sans usage réussi dans chaque run ON,
aucun gain n'est attribué au traitement ctx. Des appels `ctx_doctor` ou
`ctx_stats` seuls ne démontrent pas un traitement de données et ne suffisent
pas pour cette attribution.

Les caches fournisseur ne sont pas réinitialisés et leur état n'est pas
contrôlé ; les diagnostics ont déjà utilisé le plugin avant les mesures.
Lors d'une première campagne, l'ordre des répétitions est :

1. OFF → ON avec routing → ON sans routing ;
2. ON avec routing → ON sans routing → OFF ;
3. ON sans routing → OFF → ON avec routing ;
4. reprise du premier ordre, puis poursuite de la rotation.

Le premier côté alterne entre OFF et ON avec routing d'une campagne à l'autre,
y compris pour les pilotes, indépendamment du nombre de répétitions. Le champ
`firstArm` de `results/manifest.json` mémorise ce choix ; supprimer ce manifeste
remet le départ à OFF. Une campagne enregistrée compte même
si elle échoue ensuite. Les anciens manifestes sans `firstArm` sont reconnus
à partir du premier numéro de run (0 : ON, sinon impair : OFF, pair : ON).
Cette limite sur les caches reste explicite dans les résultats et interdit de
présenter l'essai comme un protocole à cache froid. Le stockage local Context
Mode est distinct du cache de tokens du fournisseur.

Les catégories de tokens et les coûts bruts restent disponibles pour chaque
appel. Le total comparé est le champ `tokens.total` exporté par OpenCode,
rapproché pour chaque appel de `input + output + cacheRead + cacheWrite`, avec
ou sans `reasoning` selon la convention observée. Les exports locaux 1.18.35
comptent le raisonnement séparément de la sortie. Un total absent ou incohérent
bloque la comparaison. Les coûts sont ceux des exports, jamais recalculés depuis
un tarif présumé ; un coût absent est inconnu, tandis qu'un coût exporté nul
reste nul. Les statistiques donnent médiane, minimum et maximum sur les paires
complètes, et conservent les résultats individuels. Une comparaison invalide
remplace aussi les anciens rapports pour éviter d'afficher un gain périmé.

## Commandes

Node.js, Git et un exécutable OpenCode fonctionnel sont requis. Sous Windows,
le runner résout le véritable `opencode.exe` derrière le shim npm. Pour une autre
installation, définir `OPENCODE_BIN` vers l'exécutable réel. Le fournisseur
du modèle doit être configuré et authentifié dans OpenCode avant le lancement.

```powershell
# Tests locaux, sans appel au modèle ni consommation de crédits
node --test bench.test.mjs

# Pilote, run 0 exclu des statistiques
node bench.mjs --model=github-copilot/gpt-5.6-luna --variant=medium --pilot --timeout-ms=900000

# Cinq runs par branche : quinze sessions mesurées
node bench.mjs --model=github-copilot/gpt-5.6-luna --variant=medium --runs=5 --timeout-ms=900000

# Soixante runs par branche : 180 sessions mesurées, plus les diagnostics
node bench.mjs --model=github-copilot/gpt-5.6-luna --variant=medium --runs=60 --timeout-ms=900000

# Réaudit d'exports historiques (.export ou .export.json), sans relancer le modèle
node audit.mjs --results=C:\chemin\anciens-resultats

# Recalcul des métriques dérivées depuis les exports v2, sans modifier les exports
node audit.mjs --results=C:\chemin\campagne\results --refresh-metrics

# Recalcul manuel de compare.json depuis les données v2 (hors pilote)
node compare.mjs --results=C:\chemin\campagne\results
```

Les résultats sont écrits dans le dépôt cible : `results/on`, `results/off`
et `results/on-no-routing` pour les exports, résumés et traces par prompt.
Les diagnostics sont dans `results/diagnostic` et
`results/on-no-routing/diagnostic`. `results/manifest.json` décrit la campagne
et `results/audit.*` contient l'audit des exports présents.
Le runner lance automatiquement les deux comparaisons après toutes les
répétitions d'une campagne normale. Il produit `compare.json` et `validity.json`
pour le routing, `compare-no-routing.json` et `validity-no-routing.json` sans
routing. Aucun `summary.md` ni `summary.json` n'est généré.
Les rapports d'une analyse précédente sont supprimés au début d'une nouvelle
campagne pour éviter de les associer aux nouvelles données.
Les commandes `node audit.mjs` et `node compare.mjs` utilisent ce dossier
`results` par défaut lorsqu'elles sont lancées depuis le dépôt.

Les outils temporaires et le worktree sont créés automatiquement dans
`.bench-work/<campagne>/`, à la racine du dépôt. Ce dossier est ignoré par Git ;
aucun dossier externe ni chemin Windows prédéfini n'est nécessaire.
La variable facultative `BENCH_WORK` permet de choisir un autre emplacement
(les chemins relatifs sont résolus depuis la racine du dépôt).
Les runs portant les mêmes numéros sont écrasés automatiquement dans
`results/on`, `results/off` et `results/on-no-routing`. Leurs anciens exports, résumés et traces sont
supprimés avant la relance pour éviter de mélanger les exécutions. Les autres
numéros sont conservés ; la comparaison automatique utilise uniquement les runs
du manifeste courant. Pour une analyse manuelle, sélectionner avec `--runs`
les numéros du manifeste afin de ne pas mélanger les campagnes.
`--timeout-ms` limite chaque processus OpenCode, export et
pré-vol compris. Un échec de diagnostic ou de run arrête la campagne, invalide
les deux rapports de comparaison et déclenche l'audit des exports disponibles.
Il n'y a ni reprise automatique ni nouvelle tentative automatique d'un run en
échec : relancer la commande recommence aux numéros prévus et écrase leurs traces.
Les diagnostics et le manifeste sont également remplacés. Archiver `results/`
avant chaque nouvelle campagne si les anciennes données doivent être conservées.

Les exports historiques peuvent être requalifiés par prompt, avec propagation
du contexte divergent après la première interruption. Sans métadonnées v2, ils
ne sont pas admissibles aux gains officiels. Si les anciens exports P2 ON/P6 OFF
ne sont pas présents, aucune conclusion historique n'est fabriquée : il faut
pointer leur dossier avec `audit.mjs`.

Référence de configuration : [permissions OpenCode](https://opencode.ai/docs/permissions/).

## À quoi servent les fichiers générés ?

### Fichiers à conserver pour une analyse a posteriori

Les données nécessaires à l'analyse sont les suivantes, pour **les trois configurations
de chaque répétition de la campagne** :

| Fichier à archiver | Ce qu'il permet d'analyser |
|---|---|
| `results/manifest.json` | Conditions de la campagne : modèle, variante, branches et commits des trois configurations, numéros de runs, ordre initial et empreintes des outils. |
| `results/{off,on,on-no-routing}/run-N.json` | Métriques par prompt, durées, validité, contexte, tokens, coûts, versions et empreintes. Nécessaires au comparateur. |
| `results/{off,on,on-no-routing}/run-N.export.json` | Sessions brutes : messages, réponses, appels d'outils et consommation par appel. Nécessaires pour vérifier les métriques et réauditer les tours. |
| `diagnostic.json` et `session.export.json` dans les deux dossiers de diagnostic | Preuves du fonctionnement de ctx avant les mesures, dans une session indépendante. |
| `.bench-work/<campagne>/tools/` | Scripts et prompts exacts de la campagne, pour réutiliser le même protocole d'analyse. |

Les chemins `run-N.*` existent pour chaque numéro `N` listé dans le manifeste.
Le pilote utilise `N = 0` et reste exclu de la comparaison statistique.
Pour cinq répétitions, cela représente **35 fichiers de données** :
30 résumés/exports, quatre fichiers de diagnostic et un manifeste, plus la copie des
scripts et prompts dans `tools/`. Conserver aussi l'accès aux commits Git indiqués
par le manifeste si l'on veut inspecter le code et les configurations mesurés.

Les fichiers `compare*.json`, `audit.*` et `validity*.json` sont des **rapports dérivés** :
ils ne sont pas nécessaires à l'archive et peuvent être recréés depuis les données.
Les fichiers `config`, `agent` et les traces par prompt décrits ci-dessous sont
des compléments de diagnostic, utiles notamment pour comprendre un échec.
L'audit et la comparaison sont automatiques ; les données brutes restent
disponibles pour effectuer sa propre analyse.

### Contenu et génération de `compare.json`

Ce fichier est calculé par le script `compare.mjs`, sans appel au modèle, à partir
des `on/run-N.json` et `off/run-N.json`. Avec `--on=on-no-routing`, il lit
`on-no-routing/run-N.json` et `off/run-N.json`, puis écrit `compare-no-routing.json`.
Chaque rapport utilise les clés `S.on` et `S.off` ; `onArm` identifie la variante ON.
Ces rapports ne remplacent pas les exports bruts.
Ils sont générés automatiquement après la dernière répétition d'une campagne normale,
et peuvent être recalculés manuellement avec les commandes indiquées ci-dessus.

Avant le calcul, le script exige des paires complètes et comparables : sessions
distinctes, tours valides, mêmes prompts dans le même ordre, même modèle,
variante, version OpenCode et empreintes communes, plugin ON figé et dépôt
non modifié. Un échec bloque la comparaison ; aucun gain validé n'est publié.

| Champ | Signification |
|---|---|
| `onArm` | `on` pour le routing, `on-no-routing` sans routing. |
| `valid` | `true` uniquement lorsque les contrôles et calculs ont abouti. Ne prouve pas à lui seul un bénéfice de ctx. |
| `S.off`, `S.on` | Nombre de runs ; minimum, médiane et maximum par prompt pour tokens, coûts, durées, contexte et outils ; cumuls et totaux marginaux. |
| `savingPct` | Économie de tokens marginaux : `100 × (1 − médiane ON / médiane OFF)`. Positive si ON consomme moins ; vaut 0 si le dénominateur est nul. |
| `costSavingPct` | Même formule pour les coûts marginaux exportés ; `null` si les coûts sont incomplets ou si le dénominateur est nul. |
| `paired` | Tokens marginaux ON/OFF et écart pour chaque paire de runs. |
| `breakEven` | Premier prompt où le cumul médian ON est inférieur à OFF, ou `null`. |
| `disjoint` | Indique si le maximum marginal ON est inférieur au minimum marginal OFF ; ce n'est pas un test de significativité statistique. |
| `ctxUsed` | Traitement ctx réussi observé dans chaque run ON ; les seuls appels de diagnostic ne suffisent pas. |
| `costComplete` | Tous les coûts nécessaires sont connus. |
| `metricsSha` | Empreinte du fichier `bench-lib.mjs` utilisé pour les métriques. |
| `individualRuns` | Copie des données individuelles utilisées pour la comparaison. |

Les cumuls sont calculés par run avant de prendre leur médiane. Les tokens
proviennent des totaux par appel exportés par OpenCode ; les coûts ne sont pas
estimés depuis un tarif. Les tours marginaux sont ceux marqués `marginal` dans
la suite de prompts.

Les statuts suivants concernent les deux fichiers de comparaison.
Au démarrage, chaque rapport contient `valid: false` et
`reason: "campaign-in-progress"`. En cas d'échec pendant l'exécution, il contient
`reason: "campaign-failed"` et le message d'erreur. Un pilote ne calcule aucune
comparaison : son fichier reste à `valid: false`, `reason: "pilot-excluded"`.
Lors d'un recalcul manuel invalide, il reste à `valid: false` avec
`reason: "comparison-not-validated"` ; consulter la sortie du script et,
s'il a été produit, `validity.json`.

Avant une nouvelle campagne, copier les données dans un dossier d'archive en
préservant `on/`, `off/`, `on-no-routing/` (avec son diagnostic) et `diagnostic/`, puis y copier le dossier `tools/`.
Le manifeste contient des chemins d'origine : après déplacement, utiliser les
chemins de l'archive dans les commandes. Par exemple, depuis le dépôt :

```powershell
# Vérifier les tours depuis les exports bruts avec les scripts archivés
node C:\archives\campagne\tools\audit.mjs --results=C:\archives\campagne

# Comparer uniquement les paires de cette campagne (numéros du manifeste)
node C:\archives\campagne\tools\compare.mjs --results=C:\archives\campagne --runs=1,2,3,4,5
node C:\archives\campagne\tools\compare.mjs --results=C:\archives\campagne --on=on-no-routing --runs=1,2,3,4,5
```

### Détail de tous les fichiers produits

`N` désigne le numéro du run et `PX` un prompt de P0 à P7. Les trois fichiers
de diagnostic décrits ci-dessous existent aussi sous `results/on-no-routing/diagnostic/`.

| Fichier | Utilité |
|---|---|
| `results/compare.json` | Comparaison ON/OFF automatique en fin de campagne : statistiques, écarts et données individuelles. Voir les champs et statuts ci-dessus. |
| `results/compare-no-routing.json` | Comparaison de ON sans routing à OFF. |
| `results/validity-no-routing.json` | Contrôles de validité de cette comparaison. |
| `results/validity.json` | Contrôles de validité des runs examinés par le comparateur automatique ou manuel. |
| `results/audit.md` et `audit.json` | État de chaque prompt trouvé dans les exports, motifs d'invalidité et divergence du contexte. L'audit peut inclure des runs anciens conservés. |
| `results/manifest.json` | Références Git figées, modèle, variante, numéros de runs, premier côté (`firstArm`), empreintes des outils et chemin de campagne. |
| `results/{on,off,on-no-routing}/run-N.json` | Résumé d'une session : métriques par tour, validité, versions, empreintes et outils ctx utilisés. Lu par le comparateur. |
| `results/{on,off,on-no-routing}/run-N.export.json` | Export brut complet de la session OpenCode, actualisé après chaque prompt. Source pour réauditer et recalculer les métriques sans appeler le modèle. |
| `results/{on,off,on-no-routing}/run-N.config.json` | Résultat du pré-vol de configuration effective OpenCode, avec stdout, stderr et statut du processus. |
| `results/{on,off,on-no-routing}/run-N.agent.json` | Résultat du pré-vol de l'agent `build`, dont ses outils disponibles. |
| `results/{on,off,on-no-routing}/run-N.PX.process.json` | Trace d'exécution du prompt : stdout (événements JSON), stderr, code de sortie, timeout et éventuel motif d'arrêt. |
| `results/{on,off,on-no-routing}/run-N.PX.export-process.json` | Trace du processus d'export après ce prompt, contenant aussi l'export dans stdout. Utile si l'export échoue ou pour retrouver l'état intermédiaire. |
| `results/diagnostic/diagnostic.json` | Résultats du diagnostic préalable ctx : versions, chemins, configuration, agent, MCP, traces et conclusion. Session distincte des mesures. |
| `results/diagnostic/session.export.json` | Export brut de la session de diagnostic. |
| `results/diagnostic/last-event.json` | Dernier événement reçu pendant le diagnostic, utile pour localiser un blocage. |
| `.bench-work/<campagne>/manifest.json` | Copie du manifeste de cette campagne. |
| `.bench-work/<campagne>/tools/` | Copie figée des scripts et prompts utilisés, pour que les modifications du dépôt ne changent pas la campagne en cours. |
| `.bench-work/<campagne>/project/` | Worktree temporaire des branches mesurées. Normalement supprimé à la fin ; conservé si Git refuse sa suppression. |

Avec huit prompts, un run complet produit **20 fichiers par côté** : un résumé,
un export, deux pré-vols et seize traces. Chaque répétition produit donc
60 fichiers mesurés : cinq répétitions en produisent **300**, soixante en
produisent **3 600**, répartis entre `on/`, `off/` et `on-no-routing/`,
en plus des rapports, du manifeste et des deux diagnostics. Cette duplication
conserve les preuves nécessaires pour expliquer les erreurs et les mesures.

Avant de relancer, copier tout `results/` ailleurs pour archiver une campagne :
`.bench-work/` ne contient pas de copie des résultats. Pour conserver la possibilité
de réauditer et comparer, garder les `run-N.export.json`, les `run-N.json` et le
manifeste. Les traces par prompt et les pré-vols peuvent être supprimés après
analyse si leur diagnostic détaillé n'est plus nécessaire. Les rapports d'audit
et de comparaison peuvent être régénérés avec les commandes ci-dessus.
Les dossiers `tools/` restent après exécution ; un dossier `project/` conservé
doit être inspecté avant tout nettoyage de son worktree Git.
