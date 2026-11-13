# papers-tools

Outils autour d'une bibliographie de thèse tenue dans Notion :

- **un réseau interactif des lectures** : graphe papiers / mots-clés, chronologie et tableau,
  dans un site statique sans étape de build ;
- **une synchro Notion** en lecture seule, qui produit les données du site ;
- **un extracteur de figures** qui découpe les figures et tableaux des PDF.

Le code est public ; les données ne le sont pas. Le site est déployé sur Cloudflare Workers à
une adresse secrète, et les fichiers JSON ne passent jamais par git.

## Ce qui est publié, ce qui reste local

`scripts/sync_notion.py` écrit deux fichiers, tous deux ignorés par git :

- `data/public.json` : papiers au statut « Lu », réduits à une liste blanche de champs (id,
  label, title, authors, year, type, publication, doi, keywords, citations). C'est le seul
  fichier mis en ligne, par le workflow. `scripts/check_public.py` refuse tout autre champ.
- `data/full.json` : tous les papiers et tous les champs, notes personnelles comprises. Il ne
  quitte jamais la machine.

## Brancher sa propre base Notion

1. Créer une intégration interne sur <https://www.notion.so/profile/integrations> avec la seule
   capacité « Read content », puis partager la base avec elle (menu `⋯` → Connexions).
2. Récupérer l'identifiant de la *data source* de la base (API Notion `2025-09-03`).
3. Donner à la base les colonnes ci-dessous. Celles du haut correspondent à ce qu'écrit le
   plugin Zotero [Notero](https://github.com/dvanoni/notero).

| Colonne | Type | Rôle |
|---|---|---|
| `Name` | titre | titre du papier |
| `Authors` | texte | un auteur par ligne, « Nom, Prénom » |
| `Year` | nombre | année |
| `Item Type` | texte ou sélection | type de document |
| `Publication` | texte | revue ou conférence |
| `DOI` | URL | lien doi.org |
| `Zotero URI` | URL | son dernier segment sert d'identifiant |
| `File Path` | texte | chemin du PDF, pour l'extracteur (local) |
| `Statut` | sélection ou statut | seuls les papiers « Lu » sont publiés |
| `Mots-clés` | sélection multiple | la couleur de l'option donne la famille |
| `Citations` | nombre | taille des nœuds |
| `En bref`, `Mes notes`, `Pertinence`, `Lu le` | divers | facultatifs, locaux uniquement |

Les familles de mots-clés sont lues dans la couleur des options de `Mots-clés`. Leurs noms
sont dans `FAMILIES`, en tête de `scripts/sync_notion.py` (bleu = Objet, vert = Domaine, etc.).

## Utilisation locale

Python 3.13 suffit pour la synchro et le site : aucune dépendance externe.

```powershell
Copy-Item .env.example .env      # puis remplir NOTION_TOKEN (et NOTION_DATA_SOURCE_ID)
python scripts/sync_notion.py    # écrit data/public.json et data/full.json
python scripts/check_public.py   # échoue si public.json sort de la liste blanche
scripts\serve.ps1                # synchro, puis http://127.0.0.1:8137/
scripts\serve.ps1 -NoSync        # sans synchro
scripts\install_shortcut.ps1     # raccourci sur le bureau et dans le menu Démarrer
```

En local, le site charge `data/full.json` s'il existe, sinon `data/public.json` ; `?data=public`
force la version publique.

## Déploiement sur Cloudflare

Le workflow `.github/workflows/sync.yml` tourne chaque jour à 5 h UTC, à chaque push sur `main`
et à la demande (`gh workflow run sync.yml`). Il régénère `public.json`, vérifie la liste
blanche et déploie le site avec `wrangler`, sans rien commiter ni garder comme artifact.

1. Créer un compte Cloudflare (plan Free) et choisir un sous-domaine `workers.dev` dans
   Workers & Pages. Il apparaît dans l'adresse du site : le choisir neutre.
2. Créer un jeton d'API de compte avec deux permissions seulement : **Workers Scripts : Edit**
   et **Account Settings : Read**, limité à son compte, avec une date d'expiration.
3. Dans le dépôt GitHub, créer les secrets (Settings → Secrets and variables → Actions) :

   | Secret | Contenu |
   |---|---|
   | `NOTION_TOKEN` | jeton de l'intégration Notion |
   | `CLOUDFLARE_API_TOKEN` | jeton de l'étape 2 |
   | `CLOUDFLARE_ACCOUNT_ID` | identifiant du compte Cloudflare |
   | `SITE_PATH` | chemin secret, créé par `scripts\new_link.ps1` |

   et la variable `NOTION_DATA_SOURCE_ID` (onglet Variables) avec l'identifiant de sa base.
4. Changer le `name` du Worker dans `wrangler.jsonc` si besoin, puis pousser sur `main`.
5. Lancer `scripts\new_link.ps1 -Subdomain <sous-domaine>` : il tire un chemin aléatoire de
   24 caractères, l'enregistre dans `SITE_PATH`, redéploie et affiche l'adresse.

Le site répond alors à `https://<name>.<sous-domaine>.workers.dev/<SITE_PATH>/` ; toute autre
adresse, racine comprise, renvoie un 404. `deploy/_headers` interdit l'indexation, n'envoie
aucun référent et n'autorise l'intégration en iframe que depuis Notion (et son relais
Iframely) : adapter `frame-ancestors` pour l'intégrer ailleurs.

**Changer le lien** : relancer `scripts\new_link.ps1`. L'ancien lien cesse de marcher dès la
fin du redéploiement ; penser à mettre à jour les pages qui l'intègrent.

**Logs publics** : sur un dépôt public, les logs d'Actions sont visibles de tous. La sortie de
`wrangler`, qui liste les fichiers envoyés et donc le chemin secret, n'y est pas affichée. Un
fork sans secrets s'arrête dès la première étape avec la liste des secrets manquants.

## Le réseau des lectures

- Trois vues : Graphe, Chronologie (une colonne par année) et Liste (tableau triable).
- Double-clic sur un mot-clé ou un papier pour l'isoler ; clic pour ouvrir ses détails.
- Filtres : années, citations, type, mots-clés, recherche ; en local, pertinence et statut.
- Exporter : la vue en PNG, ou le tableau en CSV depuis la vue Liste.
- L'adresse retient la vue, la couleur, le nœud isolé et le nœud ouvert.
- Embarqué dans une autre page (bloc `/embed` de Notion), le site passe en mode compact :
  en-tête sur une ligne, légende repliée, lien « Plein écran », nœuds figés, molette laissée à
  la page hôte, famille « Question traitée » masquée au départ. `?embed=1` ou `?embed=0` le
  force ou l'empêche.

Cytoscape.js 3.33.1 est copié dans `vendor/`.

## Extracteur de figures

```powershell
python -m pip install -r requirements.txt                     # PyMuPDF, une seule fois
python scripts/extract_figures.py article.pdf --out dossier   # un PDF quelconque (slides)
python scripts/extract_figures.py --key 764PHHFY              # un papier de la base
python scripts/extract_figures.py --all                       # tous les PDF, sans refaire l'existant
```

Chaque légende « Fig. X » ou « Table X » donne une image `fig-0X.png` ou `table-0X.png` et une
entrée dans `captions.json`. La zone de la page est rendue telle quelle, schémas vectoriels
compris. Les PDF sont cherchés au chemin noté dans Notion, sinon par leur clé dans le stockage
Zotero de la machine (`~/Zotero/storage`, ou le dossier donné par `ZOTERO_STORAGE` dans `.env`).
`figures/` reste local : seul le site local affiche ces images, jamais le site en ligne.

## OpenAlex

```powershell
python scripts/openalex.py 10.1109/TVCG.2010.223
```

Renvoie citations, accès ouvert et licence. Trois DOI au plus par requête, résultats gardés
dans `.cache/`. Demande `OPENALEX_MAILTO` dans `.env`.

## Licence

[MIT](LICENSE).
