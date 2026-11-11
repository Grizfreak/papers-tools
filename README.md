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

- `data/public.json` : papiers lus, champs de la liste blanche uniquement. Commité.
- `data/full.json` : tous les champs, notes personnelles comprises. Jamais commité.

Le script ne fait que lire Notion, avec une intégration limitée à « Read content ».

## OpenAlex

```powershell
python scripts/openalex.py 10.1109/TVCG.2010.223
```

Renvoie citations, accès ouvert et licence. Trois DOI au plus par requête, résultats gardés
dans `.cache/`.

## Réseau des lectures

À venir.

## Extracteur de figures

À venir.
