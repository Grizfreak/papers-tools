# papers-tools

Outils autour de ma bibliographie de thèse : un réseau interactif des papiers lus, alimenté
par une base Notion, et un extracteur de figures.

Version publique : <https://grizfreak.github.io/papers-tools/>

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
  (liste blanche). Commité.
- `data/full.json` : tous les papiers (lus ou non) et tous les champs, notes personnelles
  et textes personnels compris (En bref, Mes notes, Pertinence). Jamais commité.

Le script ne fait que lire Notion, avec une intégration limitée à « Read content ».

## Mise en ligne

Le workflow `.github/workflows/sync.yml` tourne chaque jour à 5 h UTC, à chaque push et à la
demande (`gh workflow run sync.yml`). Il régénère `public.json` avec le secret `NOTION_TOKEN`,
vérifie la liste blanche, commite le fichier s'il a changé, puis déploie sur GitHub Pages les
seuls fichiers du site.

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

## Extracteur de figures

```powershell
python -m pip install -r requirements.txt                 # PyMuPDF, une seule fois
python scripts/extract_figures.py article.pdf --out dossier   # un PDF quelconque (slides)
python scripts/extract_figures.py --key 764PHHFY          # un papier de la Bibliothèque
python scripts/extract_figures.py --all                   # tous les PDF, sans refaire l'existant
```

Chaque légende « Fig. X » ou « Table X » donne une image `fig-0X.png` ou `table-0X.png` et une
entrée dans `captions.json`. La zone de la page est rendue telle quelle, schémas vectoriels
compris. `figures/` reste local : le site local affiche ces images dans le panneau d'un papier.

```powershell
python scripts/publish_figures.py            # liste les papiers en accès ouvert sous licence CC
python scripts/publish_figures.py --apply    # copie leurs figures dans figures-public/
```

Seul `figures-public/` peut être commité ; chaque figure y porte sa source et sa licence.
