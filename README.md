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