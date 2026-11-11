"""Prépare figures-public/ : figures des papiers lus, en accès ouvert sous licence CC.

Usage :
  python scripts/publish_figures.py            liste les papiers éligibles, sans rien écrire
  python scripts/publish_figures.py --apply    copie leurs figures dans figures-public/
"""
import json
import shutil
import sys

from env import ROOT
from extract_figures import FIGURES, write_index
from openalex import bare_doi, fetch_works

PUBLIC = ROOT / "figures-public"


def license_name(code):
    """« cc-by-nc-sa » -> « CC BY-NC-SA » ; rien si la licence n'est pas une Creative Commons."""
    code = (code or "").lower()
    if code in ("cc0", "public-domain"):
        return "CC0"
    if not code.startswith("cc-by"):
        return None
    return "CC " + code[3:].upper()


def eligible():
    papers = json.loads((ROOT / "data" / "full.json").read_text(encoding="utf-8"))["papers"]
    read = [p for p in papers if p["statut"] == "Lu" and p["doi"]]
    works = fetch_works(p["doi"] for p in read)
    rows = []
    for paper in read:
        work = works.get(bare_doi(paper["doi"])) or {}
        name = license_name(work.get("license")) if work.get("is_oa") else None
        has_figures = (FIGURES / paper["id"] / "captions.json").exists()
        rows.append((paper, work, name, has_figures))
    return rows


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    apply = "--apply" in sys.argv
    rows = eligible()
    kept = [row for row in rows if row[2] and row[3]]
    for paper, work, name, has_figures in rows:
        status = name or f"non ({work.get('oa_status') or 'inconnu'}, {work.get('license') or 'sans licence'})"
        note = "" if has_figures or not name else "  (pas de figures extraites)"
        print(f"{'OUI' if name and has_figures else '   '} {paper['label']:26} {status}{note}")
    print(f"\n{len(kept)} papiers éligibles sur {len(rows)} papiers lus avec DOI.")
    if not apply:
        print("Rien n'a été écrit. Relance avec --apply pour remplir figures-public/.")
        return

    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    for paper, work, name, _ in kept:
        target = PUBLIC / paper["id"]
        shutil.copytree(FIGURES / paper["id"], target)
        record = json.loads((target / "captions.json").read_text(encoding="utf-8"))
        # La source accompagne chaque figure : auteurs, année, licence, lien
        record["credit"] = f"Source : {paper['label']}, {paper['doi']}. Licence {name}."
        record.pop("source", None)
        (target / "captions.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    PUBLIC.mkdir(exist_ok=True)
    write_index(PUBLIC)
    print(f"figures-public/ : {len(kept)} papiers.")


if __name__ == "__main__":
    main()
