# Traccar Web Benchmark Runner

Cette branche sert de **runner de benchmark OpenCode** pour mesurer l'impact
de `context-mode` sur une séquence de prompts d'audit Traccar Web.

## Objectif

Le benchmark compare deux branches du dépôt principal :

- **OFF** : sans `context-mode`
- **ON** : avec `context-mode`

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
Les descriptions ON/OFF ci-dessous s'appliquent à chaque comparaison ;
les anciens décomptes de fichiers pour deux côtés ne couvrent pas le troisième.
Les options `--runner`, `--off`, `--on` et `--on-no-routing` permettent de
remplacer les noms de branches par défaut.

```powershell
# Recalcul de la comparaison sans routing
node compare.mjs --results=results --on=on-no-routing --runs=1,2,3,4,5
```

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
7. compare automatiquement les paires ON/OFF en fin de campagne et écrit `results/compare.json`.

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
│  └─ on/
└─ README.md
```

## Protocole corrigé

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
deux branches. Le dépôt de travail de l'utilisateur reste disponible avec ses
modifications. Le worktree temporaire est supprimé uniquement si Git l'accepte
sans `--force` ; s'il est modifié, il est conservé pour inspection.
Les refs Git sont figées au démarrage. Les fichiers suivis doivent être
identiques hors `opencode.json` et `.opencode/context-mode-routing.md`. La
configuration peut différer par le plugin Context Mode et la référence exacte
à ce fichier dans `instructions`, autorisée uniquement dans ON. Le fichier
référencé doit exister dans ON ; les instructions communes restent identiques.
Le benchmark mesure donc le plugin avec ses règles de routage. L'empreinte
`contextModeRoutingSha` conserve le contenu du fichier utilisé dans chaque run.
Le runner enregistre les empreintes du code, des
prompts, de la configuration, de l'overlay et de la configuration effective de
l'agent, ainsi que les versions, le modèle et la variante. La version résolue,
l'entrée du plugin et son lockfile sont enregistrés ; une variation entre runs
ON bloque la comparaison. L'agent `build` est explicitement choisi. Les outils `ctx_*`
peuvent être natifs au plugin : une liste MCP vide ne prouve pas leur absence.

Le diagnostic préalable utilise une session indépendante : configuration
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
contrôlé ; le cache local est chaud après le diagnostic. L'ordre OFF/ON alterne
entre paires, et le premier côté alterne aussi entre campagnes successives :
OFF → ON au premier lancement, ON → OFF au suivant, puis OFF → ON, etc.
Cela vaut aussi pour les pilotes et ne dépend pas du nombre de paires.
Le champ `firstArm` de `results/manifest.json` mémorise ce choix ; supprimer ce
manifeste remet l'alternance à OFF → ON. Une campagne enregistrée compte même
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
installation, définir `OPENCODE_BIN` vers l'exécutable réel.

```powershell
# Tests locaux, sans appel au modèle ni consommation de crédits
node --test bench.test.mjs

# Pilote, run 0 exclu des statistiques
node bench.mjs --model=github-copilot/gpt-5.6-luna --variant=medium --pilot --timeout-ms=900000

# Campagne de cinq paires, chacune avec une session neuve par branche
node bench.mjs --model=github-copilot/gpt-5.6-luna --variant=medium --runs=5 --timeout-ms=900000

# Réaudit d'exports historiques (.export ou .export.json), sans relancer le modèle
node audit.mjs --results=C:\chemin\anciens-resultats

# Recalcul des métriques dérivées depuis les exports v2, sans modifier les exports
node audit.mjs --results=C:\chemin\campagne\results --refresh-metrics

# Recalcul manuel de compare.json depuis les données v2 (hors pilote)
node compare.mjs --results=C:\chemin\campagne\results
```

Les résultats sont écrits dans le dépôt d'origine : `results/on` et
`results/off` pour les exports, résumés et traces par prompt ;
`results/diagnostic` pour le diagnostic ; `results/manifest.json`,
`results/audit.*` pour le manifeste et l'audit de validité.
Le runner lance automatiquement `compare.mjs` après toutes les paires d'une
campagne normale : il produit `results/compare.json` et les contrôles détaillés
dans `results/validity.json`. Aucun `summary.md` ni `summary.json` n'est généré.
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
`results/on` et `results/off`. Leurs anciens exports, résumés et traces sont
supprimés avant la relance pour éviter de mélanger les exécutions. Les autres
numéros sont conservés ; la comparaison automatique utilise uniquement les runs
du manifeste courant. Pour une analyse manuelle, sélectionner avec `--runs`
les numéros du manifeste afin de ne pas mélanger les campagnes.
`--timeout-ms` limite chaque processus OpenCode, export et
pré-vol compris. Un échec arrête la campagne et produit tout de même l'audit.

Les exports historiques peuvent être requalifiés par prompt, avec propagation
du contexte divergent après la première interruption. Sans métadonnées v2, ils
ne sont pas admissibles aux gains officiels. Si les anciens exports P2 ON/P6 OFF
ne sont pas présents, aucune conclusion historique n'est fabriquée : il faut
pointer leur dossier avec `audit.mjs`.

Référence de configuration : [permissions OpenCode](https://opencode.ai/docs/permissions/).

## À quoi servent les fichiers générés ?

### Fichiers à conserver pour une analyse a posteriori

Les données nécessaires à l'analyse sont les suivantes, pour **chaque paire
ON/OFF de la campagne** :

| Fichier à archiver | Ce qu'il permet d'analyser |
|---|---|
| `results/manifest.json` | Conditions de la campagne : modèle, variante, commits ON/OFF, numéros de runs, ordre initial et empreintes des outils. |
| `results/on/run-N.json` et `results/off/run-N.json` | Métriques par prompt, durées, validité, contexte, tokens, coûts, versions et empreintes. Nécessaires au comparateur. |
| `results/on/run-N.export.json` et `results/off/run-N.export.json` | Sessions brutes : messages, réponses, appels d'outils et consommation par appel. Nécessaires pour vérifier les métriques et réauditer les tours. |
| `results/diagnostic/diagnostic.json` et `session.export.json` | Preuves du fonctionnement de ctx avant les mesures, dans une session indépendante. |
| `.bench-work/<campagne>/tools/` | Scripts et prompts exacts de la campagne, pour réutiliser le même protocole d'analyse. |

Les chemins `run-N.*` existent pour chaque numéro `N` listé dans le manifeste.
Le pilote utilise `N = 0` et reste exclu de la comparaison statistique.
Pour cinq paires, cela représente **23 fichiers de données**, plus la copie des
scripts et prompts dans `tools/`. Conserver aussi l'accès aux commits Git indiqués
par le manifeste si l'on veut inspecter le code et les configurations mesurés.

Les fichiers `compare.json`, `audit.*` et `validity.json` sont des **rapports dérivés** :
ils ne sont pas nécessaires à l'archive et peuvent être recréés depuis les données.
Les fichiers `config`, `agent` et les traces par prompt décrits ci-dessous sont
des compléments de diagnostic, utiles notamment pour comprendre un échec.
L'audit et la comparaison sont automatiques ; les données brutes restent
disponibles pour effectuer sa propre analyse.

### Contenu et génération de `compare.json`

Ce fichier est calculé par le script `compare.mjs`, sans appel au modèle, à partir
des `on/run-N.json` et `off/run-N.json`. Il ne remplace pas les exports bruts.
Il est généré automatiquement après la dernière paire d'une campagne normale,
et peut être recalculé manuellement avec les commandes indiquées ci-dessus.

Avant le calcul, le script exige des paires complètes et comparables : sessions
distinctes, tours valides, mêmes prompts dans le même ordre, même modèle,
variante, version OpenCode et empreintes communes, plugin ON figé et dépôt
non modifié. Un échec bloque la comparaison ; aucun gain validé n'est publié.

| Champ | Signification |
|---|---|
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

Au démarrage, `compare.json` contient `valid: false` et
`reason: "campaign-in-progress"`. En cas d'échec pendant l'exécution, il contient
`reason: "campaign-failed"` et le message d'erreur. Un pilote ne calcule aucune
comparaison : son fichier reste à `valid: false`, `reason: "pilot-excluded"`.
Lors d'un recalcul manuel invalide, il reste à `valid: false` avec
`reason: "comparison-not-validated"` ; consulter la sortie du script et,
s'il a été produit, `validity.json`.

Avant une nouvelle campagne, copier les données dans un dossier d'archive en
préservant `on/`, `off/` et `diagnostic/`, puis y copier le dossier `tools/`.
Le manifeste contient des chemins d'origine : après déplacement, utiliser les
chemins de l'archive dans les commandes. Par exemple, depuis le dépôt :

```powershell
# Vérifier les tours depuis les exports bruts avec les scripts archivés
node C:\archives\campagne\tools\audit.mjs --results=C:\archives\campagne

# Comparer uniquement les paires de cette campagne (numéros du manifeste)
node C:\archives\campagne\tools\compare.mjs --results=C:\archives\campagne --runs=1,2,3,4,5
```

### Détail de tous les fichiers produits

`N` désigne le numéro du run et `PX` un prompt de P0 à P7.

| Fichier | Utilité |
|---|---|
| `results/compare.json` | Comparaison ON/OFF automatique en fin de campagne : statistiques, écarts et données individuelles. Voir les champs et statuts ci-dessus. |
| `results/validity.json` | Contrôles de validité des runs examinés par le comparateur automatique ou manuel. |
| `results/audit.md` et `audit.json` | État de chaque prompt trouvé dans les exports, motifs d'invalidité et divergence du contexte. L'audit peut inclure des runs anciens conservés. |
| `results/manifest.json` | Références Git figées, modèle, variante, numéros de runs, premier côté (`firstArm`), empreintes des outils et chemin de campagne. |
| `results/{on,off}/run-N.json` | Résumé d'une session : métriques par tour, validité, versions, empreintes et outils ctx utilisés. Lu par le comparateur. |
| `results/{on,off}/run-N.export.json` | Export brut complet de la session OpenCode, actualisé après chaque prompt. Source pour réauditer et recalculer les métriques sans appeler le modèle. |
| `results/{on,off}/run-N.config.json` | Résultat du pré-vol de configuration effective OpenCode, avec stdout, stderr et statut du processus. |
| `results/{on,off}/run-N.agent.json` | Résultat du pré-vol de l'agent `build`, dont ses outils disponibles. |
| `results/{on,off}/run-N.PX.process.json` | Trace d'exécution du prompt : stdout (événements JSON), stderr, code de sortie, timeout et éventuel motif d'arrêt. |
| `results/{on,off}/run-N.PX.export-process.json` | Trace du processus d'export après ce prompt, contenant aussi l'export dans stdout. Utile si l'export échoue ou pour retrouver l'état intermédiaire. |
| `results/diagnostic/diagnostic.json` | Résultats du diagnostic préalable ctx : versions, chemins, configuration, agent, MCP, traces et conclusion. Session distincte des mesures. |
| `results/diagnostic/session.export.json` | Export brut de la session de diagnostic. |
| `results/diagnostic/last-event.json` | Dernier événement reçu pendant le diagnostic, utile pour localiser un blocage. |
| `.bench-work/<campagne>/manifest.json` | Copie du manifeste de cette campagne. |
| `.bench-work/<campagne>/tools/` | Copie figée des scripts et prompts utilisés, pour que les modifications du dépôt ne changent pas la campagne en cours. |
| `.bench-work/<campagne>/project/` | Worktree temporaire des branches mesurées. Normalement supprimé à la fin ; conservé si Git refuse sa suppression. |

Avec huit prompts, un run complet produit **20 fichiers par côté** : un résumé,
un export, deux pré-vols et seize traces. Cinq paires produisent donc 200 fichiers
dans `on/` et `off/`, en plus des rapports et du diagnostic. Cette duplication
conserve les preuves nécessaires pour expliquer les erreurs et les mesures.

Avant de relancer, copier tout `results/` ailleurs pour archiver une campagne :
`.bench-work/` ne contient pas de copie des résultats. Pour conserver la possibilité
de réauditer et comparer, garder les `run-N.export.json`, les `run-N.json` et le
manifeste. Les traces par prompt et les pré-vols peuvent être supprimés après
analyse si leur diagnostic détaillé n'est plus nécessaire. Les rapports d'audit
et de comparaison peuvent être régénérés avec les commandes ci-dessus.
Les dossiers `tools/` restent après exécution ; un dossier `project/` conservé
doit être inspecté avant tout nettoyage de son worktree Git.
