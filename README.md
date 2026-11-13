# papers-tools

Outils autour de ma bibliographie de thèse : un réseau interactif des papiers lus, alimenté
par une base Notion, et un extracteur de figures.

## Installation

Python 3.13 suffit pour la synchro (aucune dépendance externe).

```powershell
Copy-Item .env.example .env   # puis remplir NOTION_TOKEN et OPENALEX_MAILTO
```

## Synchro Notion

```powershell
python scripts/sync_notion.py      # écrit data/public.json et data/full.json
python scripts/check_public.py     # échoue si public.json sort de la liste blanche
```

- `data/public.json` : papiers lus, métadonnées bibliographiques et mots-clés uniquement
  (liste blanche). Jamais commité : seul le workflow le publie, sur Cloudflare.
- `data/full.json` : tous les papiers (lus ou non) et tous les champs, notes personnelles
  et textes personnels compris (En bref, Mes notes, Pertinence). Jamais commité.

Le script ne fait que lire Notion, avec une intégration limitée à « Read content ».

## Mise en ligne

Le workflow `.github/workflows/sync.yml` tourne chaque jour à 5 h UTC, à chaque push sur `main`
et à la demande (`gh workflow run sync.yml`). Il régénère `public.json` avec le secret
`NOTION_TOKEN`, vérifie la liste blanche, puis déploie les seuls fichiers du site sur Cloudflare
Workers (`wrangler.jsonc`), sous un dossier secret donné par le secret `SITE_PATH`. Le JSON n'est
ni commité ni gardé comme artifact, et la sortie de `wrangler` n'apparaît pas dans les logs.

Secrets GitHub : `NOTION_TOKEN`, `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers »),
`CLOUDFLARE_ACCOUNT_ID` et `SITE_PATH` (16 caractères au moins parmi `A-Z a-z 0-9 _ -`).

Le site répond à `https://carte-these.<sous-domaine>.workers.dev/<SITE_PATH>/` ; la racine du
domaine renvoie un 404. `deploy/_headers` interdit l'indexation, n'envoie aucun référent et
n'autorise l'intégration en iframe que depuis Notion.

Changer le lien (l'ancien cesse de marcher dès la fin du redéploiement) :

```powershell
scripts
ew_link.ps1 -Subdomain <sous-domaine>   # puis mettre à jour le bloc /embed de Notion
```

## OpenAlex

```powershell
python scripts/openalex.py 10.1109/TVCG.2010.223
```

Renvoie citations, accès ouvert et licence. Trois DOI au plus par requête, résultats gardés
dans `.cache/`.

## Réseau des lectures

Site statique à la racine (`index.html`, `app.js`, `style.css`), sans étape de build, avec
Cytoscape.js 3.33.1 copié dans `vendor/`.

```powershell
scripts\serve.ps1                 # synchro Notion, puis http://127.0.0.1:8137/
scripts\serve.ps1 -NoSync         # sans synchro
scripts\install_shortcut.ps1      # raccourci sur le bureau et dans le menu Démarrer
```

Le site charge `data/full.json` s'il existe (version locale, avec les notes), sinon
`data/public.json`. Ajouter `?data=public` à l'adresse force la version publique.

- Trois vues : Graphe, Chronologie (une colonne par année) et Liste (tableau triable).
- Double-clic sur un mot-clé ou un papier pour l'isoler ; clic pour ouvrir ses détails.
- Filtres : années, citations, type, mots-clés, recherche ; en local, pertinence et statut.
- Exporter : la vue en PNG, ou le tableau en CSV depuis la vue Liste.
- L'adresse retient la vue, la couleur, le nœud isolé et le nœud ouvert.
- Embarqué dans une autre page (bloc `/embed` de Notion), le site passe en mode compact :
  en-tête sur une ligne, légende repliée, lien « Plein écran ». `?embed=1` ou `?embed=0` le
  force ou l'empêche.

## Extracteur de figures

```powershell
python -m pip install -r requirements.txt                 # PyMuPDF, une seule fois
python scripts/extract_figures.py article.pdf --out dossier   # un PDF quelconque (slides)
python scripts/extract_figures.py --key 764PHHFY          # un papier de la Bibliothèque
python scripts/extract_figures.py --all                   # tous les PDF, sans refaire l'existant
```

Chaque légende « Fig. X » ou « Table X » donne une image `fig-0X.png` ou `table-0X.png` et une
entrée dans `captions.json`. La zone de la page est rendue telle quelle, schémas vectoriels
compris. Les PDF sont cherchés au chemin noté dans Notion, sinon par leur clé dans le stockage
Zotero de la machine (`~/Zotero/storage`, ou le dossier donné par `ZOTERO_STORAGE` dans `.env`).
`figures/` reste local et n'est jamais commité : seul le site local affiche ces images,
dans le panneau d'un papier. Le site public n'en montre aucune.
