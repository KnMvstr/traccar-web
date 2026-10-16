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
7. compare ensuite les branches ON et OFF.

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
identiques hors `opencode.json`, et la configuration doit différer uniquement
par le plugin Context Mode. Le runner enregistre les empreintes du code, des
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
entre paires. Cette limite reste explicite dans les résultats et interdit de
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

# Recalcul des rapports v2
node compare.mjs --results=C:\chemin\campagne\results
```

Les résultats sont écrits dans le dépôt d'origine : `results/on` et
`results/off` pour les exports, résumés et traces par prompt ;
`results/diagnostic` pour le diagnostic ; `results/manifest.json`,
`results/audit.*` et `results/summary.*` pour le manifeste et les rapports.
Les commandes `node audit.mjs` et `node compare.mjs` utilisent ce dossier
`results` par défaut lorsqu'elles sont lancées depuis le dépôt.

`BENCH_WORK` choisit uniquement le dossier temporaire des outils et du worktree
(par défaut `C:\work\traccar-bench-run`). Aucun ancien run n'est écrasé : si les
numéros demandés existent déjà dans `results/on` ou `results/off`, archivez-les
avant de relancer une campagne. `--timeout-ms` limite chaque processus OpenCode, export et
pré-vol compris. Un échec arrête la campagne et produit tout de même l'audit.

Les exports historiques peuvent être requalifiés par prompt, avec propagation
du contexte divergent après la première interruption. Sans métadonnées v2, ils
ne sont pas admissibles aux gains officiels. Si les anciens exports P2 ON/P6 OFF
ne sont pas présents, aucune conclusion historique n'est fabriquée : il faut
pointer leur dossier avec `audit.mjs`.

Référence de configuration : [permissions OpenCode](https://opencode.ai/docs/permissions/).
