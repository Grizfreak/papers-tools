[mise-en-place.md](https://github.com/user-attachments/files/34850556/mise-en-place.md)
# Mise en place de zéro

Ce guide part de rien : pas de bibliographie, pas de base Notion, pas de compte Cloudflare.
À la fin, on a un réseau interactif de ses lectures, mis à jour chaque jour, visible à une
adresse secrète et intégrable dans une page Notion. Le [README](../README.md) détaille chaque
outil ; ce guide donne l'ordre des étapes.

Compter une à deux heures la première fois. Tout est gratuit.

```
Zotero ──Notero──▶ Notion (base Bibliothèque) ──API, lecture seule──▶ GitHub Actions
                                                                       │ chaque jour
                                        page Notion ◀──/embed── Cloudflare (adresse secrète)
```

## 0. Ce qu'il faut

- Des comptes gratuits : [Zotero](https://www.zotero.org/), [Notion](https://www.notion.so/),
  [GitHub](https://github.com/), [Cloudflare](https://dash.cloudflare.com/sign-up).
- Sur la machine : Zotero 7, [Python 3.13](https://www.python.org/downloads/),
  [Git](https://git-scm.com/) et la [CLI GitHub `gh`](https://cli.github.com/)
  (`gh auth login` une fois installée).
- Les scripts `.ps1` sont écrits pour Windows (PowerShell). Sur macOS ou Linux, les équivalents
  sont donnés plus bas.

## 1. Zotero : la bibliographie

1. Installer Zotero 7 et le connecteur de navigateur, se connecter à son compte.
2. Facultatif mais pratique : créer une **bibliothèque de groupe privée** (zotero.org →
   Groups → Create a New Group → *Private Membership*) pour partager les références avec ses
   encadrants. Les fichiers d'un groupe comptent dans le quota de stockage de son propriétaire
   (300 Mo en gratuit).
3. Créer une **collection** dans la bibliothèque utilisée : c'est elle que Notero
   synchronisera. Y ranger les papiers.

## 2. Notion : la base « Bibliothèque »

1. Créer une page (par exemple « Ma thèse »), puis une base de données pleine page
   « Bibliothèque ».
2. Installer le plugin [Notero](https://github.com/dvanoni/notero) dans Zotero, le connecter
   à Notion en suivant sa documentation, choisir la base « Bibliothèque » et activer la
   collection de l'étape 1. Notero crée et remplit les colonnes `Name`, `Authors`, `Year`,
   `Item Type`, `Publication`, `DOI`, `Zotero URI`, `File Path`… : ne pas les renommer.
3. Ajouter à la main les colonnes personnelles (noms exacts, accents compris) :

   | Colonne | Type | Remarque |
   |---|---|---|
   | `Statut` | sélection ou statut | seuls les papiers à **`Lu`** apparaissent sur le site |
   | `Mots-clés` | sélection multiple | voir ci-dessous |
   | `Citations` | nombre | facultatif ; taille des nœuds (voir `scripts/openalex.py`) |
   | `En bref`, `Mes notes` | texte | facultatifs, **jamais publiés** |
   | `Pertinence` | sélection | facultatif, local uniquement |
   | `Lu le` | date | facultatif, local uniquement |

4. **Mots-clés** : la *couleur* de chaque option donne sa famille. Par défaut : bleu = Objet,
   vert = Domaine, violet = Support, orange = Question traitée, gris = Type de papier,
   marron = Contribution. Pour d'autres familles, changer le dictionnaire `FAMILIES` en tête
   de `scripts/sync_notion.py`. Garder une liste courte : un mot-clé porté par un seul papier
   n'apporte rien au réseau.
5. Passer quelques papiers à `Lu` et leur mettre des mots-clés, pour avoir de quoi tester.

## 3. Notion : l'intégration en lecture seule

1. Sur <https://www.notion.so/profile/integrations>, créer une intégration **interne**, avec
   la seule capacité **Read content**. Copier son jeton (« Internal Integration Secret »).
2. Ouvrir la base « Bibliothèque » → menu `⋯` → **Connexions** → ajouter l'intégration. Sans
   cette étape, la synchro répond « base introuvable ».
3. Récupérer l'**identifiant de la data source** de la base : menu `⋯` de la base → gestion
   des sources de données → copier l'identifiant (l'emplacement exact peut varier selon la
   version de Notion). Le script utilise l'API Notion `2025-09-03`, qui parle de *data
   sources* et non plus de *databases*.

## 4. Le dépôt

1. **Forker** ce dépôt sur GitHub (bouton *Fork*), puis le cloner :

   ```powershell
   gh repo clone <ton-compte>/papers-tools
   cd papers-tools
   ```

2. Désactiver GitHub Pages s'il s'est activé (Settings → Pages) : le site est servi par
   Cloudflare.
3. Pour une copie privée plutôt qu'un fork public : créer un dépôt vide et y pousser le code.
   Tout fonctionne de la même façon.

## 5. Premier essai en local

```powershell
Copy-Item .env.example .env
# Dans .env : NOTION_TOKEN=<jeton de l'étape 3>
#             NOTION_DATA_SOURCE_ID=<identifiant de l'étape 3>
#             OPENALEX_MAILTO=<ton adresse>   (seulement pour scripts/openalex.py)
python scripts/sync_notion.py     # écrit data/full.json et data/public.json
python scripts/check_public.py    # vérifie la liste blanche
scripts\serve.ps1                 # ouvre http://127.0.0.1:8137/
```

Sur macOS ou Linux : `cp .env.example .env`, puis `python3 scripts/sync_notion.py` et
`python3 scripts/serve.py`, et ouvrir <http://127.0.0.1:8137/>.

**Toujours renseigner `NOTION_DATA_SOURCE_ID`** : sans lui, le script retombe sur la base du
dépôt d'origine, à laquelle ton jeton n'a pas accès.

En local, le site affiche `full.json` (tous les papiers, notes comprises). Ce fichier ne
quitte jamais la machine ; `.gitignore` empêche de le commiter.

## 6. Cloudflare et GitHub : la mise en ligne

1. **Cloudflare** : créer un compte (plan Free), aller dans *Workers & Pages* et choisir un
   sous-domaine `workers.dev`. Il fera partie de l'adresse publique : le choisir neutre.
2. Noter l'**Account ID** (affiché dans le tableau de bord du compte ; l'emplacement change
   selon les versions de l'interface).
3. Créer un **jeton d'API de compte** (dans la gestion du compte, rubrique des jetons d'API) avec deux
   permissions seulement : *Workers Scripts : Edit* et *Account Settings : Read*, limité à son
   compte, avec une date d'expiration (la noter pour le renouveler).
4. Dans `wrangler.jsonc`, changer `name` si l'on veut un autre nom que `carte-these` : il
   apparaît aussi dans l'adresse.
5. Dans le dépôt GitHub, *Settings → Secrets and variables → Actions* :
   - **Secrets** : `NOTION_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` ;
   - **Variables** : `NOTION_DATA_SOURCE_ID`.

   Ou en ligne de commande : `gh secret set NOTION_TOKEN` (il demande la valeur), etc., et
   `gh variable set NOTION_DATA_SOURCE_ID`.
6. Créer le lien secret et déployer :

   ```powershell
   scripts\new_link.ps1 -Subdomain <sous-domaine>
   gh run watch                      # suivre le déploiement
   ```

   Sur macOS ou Linux :

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(18))" | gh secret set SITE_PATH
   gh workflow run sync.yml && gh run watch
   # adresse : https://<name>.<sous-domaine>.workers.dev/<SITE_PATH>/
   ```

   Le chemin secret n'est affiché qu'une fois, dans ton terminal : le noter dans un endroit
   privé (gestionnaire de mots de passe, page Notion privée). GitHub ne permet pas de relire
   un secret.
7. Ouvrir l'adresse affichée : le réseau doit apparaître. La racine du domaine, elle, renvoie
   un 404, c'est voulu.

## 7. Intégrer le réseau dans une page Notion

1. Dans la page voulue, taper `/embed`, coller l'adresse secrète, valider.
2. Agrandir le bloc à la souris. Le site passe tout seul en mode compact ; le lien « Plein
   écran » l'ouvre dans un onglet.
3. Les personnes qui voient la page voient le réseau, sans compte ni connexion. Attention :
   quiconque a le lien voit le site. S'il circule trop, relancer `scripts\new_link.ps1` et
   remplacer l'adresse du bloc `/embed`.

## 8. Au quotidien

- Ajouter un papier dans la collection Zotero → Notero le pousse dans Notion → le passer à
  `Lu` et lui mettre ses mots-clés → il apparaît en ligne après la synchro du lendemain (5 h
  UTC), ou tout de suite avec `gh workflow run sync.yml`.
- En local, `scripts\serve.ps1` resynchronise avant d'ouvrir le site ;
  `scripts\install_shortcut.ps1` crée un raccourci sur le bureau.
- Figures des PDF (local uniquement) : `python -m pip install -r requirements.txt` une fois,
  puis `python scripts/extract_figures.py --all` (voir le README).

## 9. En cas de problème

| Symptôme | Cause probable |
|---|---|
| `401` à la synchro | jeton Notion faux ou expiré |
| `404` / « base introuvable » | base non partagée avec l'intégration, ou mauvais `NOTION_DATA_SOURCE_ID` |
| Le workflow s'arrête à « Vérifier les secrets » | un secret manque, ou `SITE_PATH` fait moins de 16 caractères |
| « Échec du déploiement » | jeton Cloudflare expiré ou permissions insuffisantes, mauvais Account ID |
| Le site s'affiche seul mais pas dans Notion | domaine de la page hôte absent de `frame-ancestors` dans `deploy/_headers` |
| Un papier manque en ligne | statut différent de `Lu`, ou la synchro du jour n'a pas encore tourné |
| Couleurs ou familles bizarres | couleur d'option Notion absente de `FAMILIES` |

## Ce qui est public, ce qui ne l'est pas

- **Public** : le code (ce dépôt) et les logs d'Actions, qui ne contiennent ni données ni
  chemin secret.
- **Accessible avec le lien seulement** : le site et `public.json` (titre, auteurs, année,
  type, revue, DOI, mots-clés, citations).
- **Jamais publié** : `full.json`, `En bref`, `Mes notes`, `Pertinence`, `Lu le`, les figures,
  les jetons.
