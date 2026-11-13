# Benchmark Copilot dans VS Code

Le lanceur automatise le **chat Agent natif de VS Code**, sur la branche active.
Il ne lance ni OpenCode ni Copilot CLI. Tu actives ou désactives Context Mode
toi-même avant chaque campagne. Le lanceur ne modifie ni le MCP, ni les hooks,
ni les extensions. Il active les approbations automatiques **dans chaque
conversation de benchmark** avec la commande native `/autoApprove`, sans
modifier les paramètres globaux. Cette commande silencieuse ne constitue pas
un prompt de mesure. Le niveau `autoApprove` est vérifié dans chaque export ;
la campagne s'arrête s'il n'est pas appliqué. Les consignes d'audit en lecture
seule restent identiques pour OFF et ON.

## Lancer une campagne

Prérequis : Node.js, Git, VS Code **1.146 ou ultérieur**, Copilot disponible et
connecté dans VS Code, commande `code` dans le PATH. Les commandes internes
utilisées ont été examinées dans la version locale 1.146.0 ; une future version
peut nécessiter une adaptation. L'exécution réelle doit être validée par un pilote.

Depuis la racine du dépôt, sur `vscode-gthb-copilot-off`, avec Context Mode
désactivé (serveur et éventuels hooks/routage) :

```powershell
node tools/vscode-benchmark/launch.mjs --arm=off --runs=1
```

Une fenêtre **Extension Development Host** s'ouvre avec le dossier courant et
la petite extension de benchmark. Aucun modèle n'est appelé par le lanceur.
Dans cette nouvelle fenêtre :

1. Vérifie Copilot et la configuration effective de Context Mode.
2. Ouvre `Ctrl+Shift+P` → **Traccar Benchmark: Start Campaign**.
3. Confirme le nombre de runs et sélectionne un modèle explicite.
4. Laisse le chat disponible pendant toute la campagne : ne change pas de
   conversation, de modèle, de branche ou de fichiers.

Si la fenêtre affiche uniquement Welcome sans dépôt ouvert, utilise
**File > Open Folder…** et sélectionne `traccar-web`, puis relance la commande
de benchmark. Le lanceur transmet explicitement le dossier avec `--folder-uri`
pour préserver les chemins Windows contenant des espaces.

Le nombre indiqué au démarrage est le nombre de runs **pour cette configuration**.
Un run ouvre une conversation locale neuve et enchaîne P0–P7 en conservant son
historique. La suite est copiée depuis le runner OpenCode ; son commit source et
les empreintes de chaque prompt sont enregistrés. Un même préambule de lecture
seule est ajouté dans les deux configurations, sans imposer les outils ctx.

Après le pilote, pour cinq runs OFF :

```powershell
node tools/vscode-benchmark/launch.mjs --arm=off --runs=5
```

Ferme la fenêtre de benchmark avant de changer de branche. Sur
`vscode-gthb-copilot-on`, active Context Mode, puis utilise les **mêmes fichiers
de lanceur**, le même modèle et le même nombre de runs :

```powershell
node tools/vscode-benchmark/launch.mjs --arm=on --runs=5
```

Le lanceur refuse une incohérence entre `--arm` et la branche. Dans les deux
fenêtres, conserve les mêmes réglages de modèle, de raisonnement, d'outils et
d'approbations hors changements nécessaires à Context Mode. La présence du
serveur MCP seul ne prouve pas que les hooks/règles ont été activés ou désactivés.
L'état ON/OFF est une déclaration de l'utilisateur, pas une détection automatique.

Option : `--timeout-ms=900000` fixe le délai maximal **par prompt**, par défaut
quinze minutes, attente humaine comprise. Une approbation d'outil met la campagne
en pause : examine la demande dans le chat, valide-la si elle convient, puis
attends la réponse finale de Copilot. Clique alors **Réponse terminée** dans la
notification du benchmark. Le lanceur réexporte et vérifie le même tour avant
de poursuivre ; il ne renvoie pas le prompt et n'accorde aucune permission.
Si d'autres demandes apparaissent dans ce tour, traite-les dans le chat avant
de cliquer. Cliquer trop tôt provoque un arrêt, car le tour n'est pas terminé.
Fermer la notification ou choisir **Arrêter la campagne** arrête la campagne.
Une copie `run-N.PX.approval.export.json` conserve l'état avant validation.
`manualApprovalWaitMs` enregistre la durée de pause ; `durationMs` l'inclut.
Conserve le même réglage d'approbations pour OFF et ON et tiens compte de
l'attente humaine dans toute comparaison de durée.

Pour arrêter : bouton Annuler de la notification, ou commande
**Traccar Benchmark: Stop Campaign**. Une interruption arrête les prompts
suivants ; une nouvelle campagne repart du premier run.

## Résultats et limites de mesure

Chaque campagne est conservée sous :

```text
.bench-work/vscode-copilot/<horodatage>/<off|on>/
  manifest.json
  campaign.json
  run-1.json
  run-1.P0.export.json
  ...
  run-1.P7.export.json
```

Les dossiers sont ignorés par Git et ne remplacent aucune ancienne campagne.
`manifest.json` contient branche, commit, modèle choisi, version VS Code,
empreintes des prompts et déclaration ON/OFF. Chaque tour sauvegarde l'export
natif avec les réponses, appels d'outils et champs d'usage disponibles.

`campaign.json` passe à `complete: true` et `executionValid: true` uniquement
après la réussite de tous les runs. Le lanceur vérifie l'ordre des prompts,
la continuité des identifiants, la stabilité du modèle exporté, la fin des
réponses et l'absence de modification des fichiers suivis. Il **détecte** les
modifications après un tour, sans constituer un bac à sable ni les annuler.

**`metricsComparable` reste à `false`.** Les champs `promptTokens` et
`completionTokens` du chat ne prouvent pas à eux seuls la consommation complète
de tous les appels internes. Les champs `modelTotals`, crédits et autres mesures
sont conservés bruts lorsqu'ils existent. Aucun coût ni total manquant n'est
inventé. La validation des tokens et l'adaptateur vers `results/vscode-copilot/`
du dashboard restent à réaliser après inspection d'un pilote réel OFF/ON.
Ce lanceur n'écrit donc pas de faux `completed.json` accepté par le dashboard.

Pour un premier essai, prévoir une campagne d'un run par configuration et
examiner la sortie **Traccar Benchmark**. Un échec conserve les exports déjà
produits et le motif de l'arrêt.

## Vérifications sans appel au modèle

```powershell
node --test tools/vscode-benchmark/core.test.cjs tools/vscode-benchmark/campaign.test.cjs
```

Références des commandes et du format, détails internes susceptibles d'évoluer :

- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/actions/chatActions.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatModel.ts
- https://code.visualstudio.com/docs/agents/run/sessions/session-history
