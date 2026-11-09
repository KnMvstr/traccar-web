Tu agis comme un Staff Frontend Engineer chargé de cartographier un dépôt avant un audit.

# Contexte produit

Traccar Web est un dashboard utilisé par des responsables de flotte pour suivre des véhicules GPS, consulter leur historique et surveiller événements et rapports.

# Mission

Établis une cartographie minimale du dépôt, uniquement à partir de son contenu.

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

# Étape unique

Présente en maximum 25 lignes :
- la structure des dossiers de premier niveau ;
- le gestionnaire de paquets réellement utilisé ;
- les scripts déclarés dans la configuration du projet ;
- la liste des routes ou sections principales de l'application.

# Condition d'arrêt

Arrête-toi après cette cartographie. Ne modifie aucun fichier. Attends la consigne suivante.