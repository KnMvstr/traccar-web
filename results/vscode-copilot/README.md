# Résultats VS Code Copilot

Les campagnes archivées sont conservées dans `campaigns/<horodatage>/<off|on>/`.

Campagne publiée : `2026-11-12T21-38-12-025Z/off`, cinq runs OFF terminés
(P0 à P7), modèle GPT-5.6 Luna, VS Code 1.146.0. L'horodatage du dossier est UTC.
Les campagnes locales interrompues ne sont pas incluses.

- `manifest.json` : configuration, commit mesuré et empreintes des prompts.
- `campaign.json` : statut de la campagne.
- `run-N.json` : résumé de chaque run.
- `run-N.PX.export.json.gz` : export brut natif, compressé en gzip sans perte.
- `archive-index.json` : tailles et SHA-256 des fichiers avant compression.

Exemple de lecture d'un export depuis la racine du dépôt :

```powershell
node -e "const fs=require('fs'),z=require('zlib');const f=process.argv[1];console.log(z.gunzipSync(fs.readFileSync(f)).toString())" results/vscode-copilot/campaigns/2026-11-12T21-38-12-025Z/off/run-1.P0.export.json.gz
```

Les originaux restent dans `.bench-work/vscode-copilot/`, ignoré par Git.
`executionValid: true` indique la réussite de l'exécution ; la comparabilité des
tokens reste non validée (`metricsComparable: false`). Ces archives ne sont pas
encore un jeu de données normalisé pour le dashboard : aucun marqueur
`completed.json` ne leur attribue une validation supplémentaire.
