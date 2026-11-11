"""Notion (lecture seule) -> data/full.json (local) et data/public.json (liste blanche).

Usage : python scripts/sync_notion.py [--public-only]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

from check_public import check
from env import ROOT, require

API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
DATA_SOURCE_ID = os.environ.get("NOTION_DATA_SOURCE_ID", "feb7e690-40d4-82c8-b9ab-07670ec9a671")

# Seul le nom de la famille est fixé ici ; la couleur de chaque mot-clé vient de Notion
FAMILIES = {
    "blue": "Objet",
    "green": "Domaine",
    "purple": "Support",
    "orange": "Question traitée",
    "gray": "Type de papier",
    "brown": "Contribution",
}

PUBLIC_FIELDS = (
    "id", "label", "title", "authors", "year", "type", "publication",
    "doi", "keywords", "en_bref", "citations",
)


def notion(token, method, path, body=None):
    """Appelle l'API Notion ; seuls deux points d'accès de lecture sont utilisés."""
    request = urllib.request.Request(
        f"{API}/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 4:
                time.sleep(float(error.headers.get("Retry-After", 2)))
                continue
            hints = {
                401: "token refusé : vérifie NOTION_TOKEN.",
                404: "base introuvable : partage la Bibliothèque avec l'intégration.",
            }
            detail = hints.get(error.code, error.read().decode(errors="replace")[:300])
            raise SystemExit(f"Notion a répondu {error.code} : {detail}")


def value(prop):
    """Aplati une propriété Notion en valeur simple."""
    kind = prop["type"]
    content = prop[kind]
    if kind in ("title", "rich_text"):
        return "".join(part["plain_text"] for part in content).strip() or None
    if kind in ("select", "status"):
        return content["name"] if content else None
    if kind == "multi_select":
        return [option["name"] for option in content]
    if kind == "date":
        return content["start"] if content else None
    if kind in ("number", "url"):
        return content
    return None


def authors(raw):
    """Notero écrit « Nom, Prénom » ligne par ligne ; on rend « Prénom Nom »."""
    names = []
    for line in (raw or "").splitlines():
        last, _, first = line.partition(",")
        names.append(f"{first.strip()} {last.strip()}".strip())
    return [name for name in names if name]


def label(raw_authors, year):
    """Libellé court du nœud : nom du premier auteur + année."""
    lines = (raw_authors or "").splitlines()
    first = lines[0].partition(",")[0].strip() if lines else "?"
    suffix = " et al." if len(lines) > 1 else ""
    return f"{first}{suffix} {int(year)}" if year else f"{first}{suffix}"


def paper(page):
    get = lambda name: value(page["properties"][name]) if name in page["properties"] else None
    year = get("Year")
    uri = get("Zotero URI") or ""
    return {
        # La clé Zotero sert aussi de nom au dossier de figures du papier
        "id": uri.rstrip("/").rsplit("/", 1)[-1] or page["id"],
        "label": label(get("Authors"), year),
        "title": get("Name"),
        "authors": authors(get("Authors")),
        "year": int(year) if year else None,
        "type": get("Item Type"),
        "publication": get("Publication"),
        "doi": get("DOI"),
        "keywords": get("Mots-clés") or [],
        "en_bref": get("En bref"),
        "citations": get("Citations"),
        "statut": get("Statut"),
        "pertinence": get("Pertinence"),
        "lu_le": get("Lu le"),
        "mes_notes": get("Mes notes"),
        "file_path": get("File Path"),
        "zotero_uri": uri or None,
    }


def read_library(token):
    schema = notion(token, "GET", f"data_sources/{DATA_SOURCE_ID}")["properties"]
    options = schema["Mots-clés"]["multi_select"]["options"]
    keywords = [{"name": o["name"], "color": o["color"]} for o in options]
    colors = list(dict.fromkeys(k["color"] for k in keywords))
    families = [{"color": c, "label": FAMILIES.get(c, c)} for c in colors]

    # Tous les statuts sont lus ; le tri entre public et local se fait dans main()
    body = {"page_size": 100}
    pages = []
    while True:
        result = notion(token, "POST", f"data_sources/{DATA_SOURCE_ID}/query", body)
        pages += result["results"]
        if not result.get("has_more"):
            break
        body["start_cursor"] = result["next_cursor"]

    # Tri stable et pas de date de génération : le JSON ne change que si Notion change
    papers = sorted(map(paper, pages), key=lambda p: (p["year"] or 0, p["title"] or "", p["id"]))
    return families, keywords, papers


def write(name, data):
    path = ROOT / "data" / name
    path.parent.mkdir(exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"{path.relative_to(ROOT)} : {len(data['papers'])} papiers")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    families, keywords, papers = read_library(require("NOTION_TOKEN"))
    base = {"families": families, "keywords": keywords}

    # Le site public ne montre que les papiers lus, réduits à la liste blanche
    read = [p for p in papers if p["statut"] == "Lu"]
    public = {"version": "public", **base,
              "papers": [{field: p[field] for field in PUBLIC_FIELDS} for p in read]}
    errors = check(public)
    if errors:
        raise SystemExit("public.json refusé :\n" + "\n".join(errors))
    write("public.json", public)

    # La CI n'a aucune raison de produire le JSON privé
    if "--public-only" not in sys.argv:
        write("full.json", {"version": "full", **base, "papers": papers})


if __name__ == "__main__":
    main()
