"""Échoue si data/public.json contient autre chose que la liste blanche.

Usage : python scripts/check_public.py [chemin du JSON]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Liste volontairement indépendante de sync_notion.py : c'est un second verrou
ALLOWED_TOP = {"version", "families", "keywords", "papers"}
ALLOWED_PAPER = {
    "id", "label", "title", "authors", "year", "type", "publication",
    "doi", "keywords", "en_bref", "citations",
}
ALLOWED_FAMILY = {"color", "label"}
ALLOWED_KEYWORD = {"name", "color"}
FORBIDDEN_PARTS = ("note", "pertinence", "path", "zotero", "lu_le", "statut", "abstract")


def _forbidden_keys(node, trail="racine"):
    """Cherche un nom de champ interdit à n'importe quelle profondeur."""
    if isinstance(node, dict):
        for key, value in node.items():
            if any(part in key.lower() for part in FORBIDDEN_PARTS):
                yield f"champ interdit « {key} » dans {trail}"
            yield from _forbidden_keys(value, f"{trail}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _forbidden_keys(value, f"{trail}[{index}]")


def _extra_keys(items, allowed, name):
    for index, item in enumerate(items):
        extra = set(item) - allowed
        if extra:
            yield f"{name}[{index}] : champs hors liste blanche {sorted(extra)}"


def check(data):
    """Renvoie la liste des erreurs ; vide si le JSON est publiable."""
    errors = list(_forbidden_keys(data))
    if data.get("version") != "public":
        errors.append("le champ « version » doit valoir « public »")
    extra = set(data) - ALLOWED_TOP
    if extra:
        errors.append(f"racine : champs hors liste blanche {sorted(extra)}")
    errors += _extra_keys(data.get("papers", []), ALLOWED_PAPER, "papers")
    errors += _extra_keys(data.get("families", []), ALLOWED_FAMILY, "families")
    errors += _extra_keys(data.get("keywords", []), ALLOWED_KEYWORD, "keywords")
    return errors


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "public.json"
    sys.stdout.reconfigure(encoding="utf-8")
    problems = check(json.loads(path.read_text(encoding="utf-8")))
    for problem in problems:
        print(f"ERREUR  {problem}")
    if problems:
        raise SystemExit(1)
    print(f"OK  {path.name} ne contient que la liste blanche.")
