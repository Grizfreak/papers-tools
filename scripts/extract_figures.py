"""Extrait les figures et tableaux d'un PDF en PNG, avec leurs légendes.

Usage :
  python scripts/extract_figures.py article.pdf [--out dossier]   un PDF quelconque
  python scripts/extract_figures.py --key 764PHHFY                un papier de la Bibliothèque
  python scripts/extract_figures.py --all [--force]               tous les PDF de la Bibliothèque

Sortie : figures/<clé>/fig-01.png, table-01.png, ... et figures/<clé>/captions.json.
La zone de la page est rendue telle quelle : les schémas vectoriels sont donc inclus.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path, PureWindowsPath

import pymupdf

from env import ROOT, load_env

FIGURES = ROOT / "figures"

CAPTION = re.compile(r"^\s*(fig(?:ure)?s?\.?|table|tab\.)\s*(\d+|[ivxl]+)\b\s*([.:|—–-])?", re.IGNORECASE)
ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50}
PAD = 4
BRIDGE = 28


def roman(text):
    total = 0
    values = [ROMAN[c] for c in text.lower()]
    for value, following in zip(values, values[1:] + [0]):
        total += -value if value < following else value
    return total


def text_blocks(page):
    """Blocs de texte de la page : rectangle, texte, taille de police dominante, gras."""
    blocks = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        spans = [span for line in block["lines"] for span in line["spans"] if span["text"].strip()]
        if not spans:
            continue
        lines = ["".join(span["text"] for span in line["spans"]).strip() for line in block["lines"]]
        sizes = Counter()
        for span in spans:
            sizes[round(span["size"], 1)] += len(span["text"])
        blocks.append({
            "rect": pymupdf.Rect(block["bbox"]),
            "lines": [line for line in lines if line],
            "size": sizes.most_common(1)[0][0],
            "bold": bool(spans[0]["flags"] & 16) or "bold" in spans[0]["font"].lower(),
        })
    return blocks


def body_size(doc):
    """Taille de police la plus fréquente du document : celle du texte courant."""
    sizes = Counter()
    for page in doc:
        for block in text_blocks(page):
            sizes[block["size"]] += sum(len(line) for line in block["lines"])
    return sizes.most_common(1)[0][0] if sizes else 10


def join_lines(lines):
    text = ""
    for line in lines:
        # Un mot coupé en fin de ligne est recollé
        text = text[:-1] + line if text.endswith("-") and line[:1].islower() else f"{text} {line}"
    return re.sub(r"\s+", " ", text).strip()


def find_captions(blocks):
    """Blocs qui commencent par « Fig. 3. » ou « Table 2 : », pas les renvois dans le texte."""
    captions = []
    for block in blocks:
        first = block["lines"][0]
        match = CAPTION.match(first)
        if not match:
            continue
        alone = match.end() >= len(first.rstrip())
        if not (match.group(3) or alone or block["bold"]):
            continue
        number = match.group(2)
        captions.append({
            "kind": "table" if match.group(1).lower().startswith("tab") else "figure",
            "number": int(number) if number.isdigit() else roman(number),
            "rect": block["rect"],
            "text": join_lines(block["lines"]),
        })
    return captions


def graphics(page):
    """Rectangles des images et des groupes de tracés vectoriels de la page."""
    area = abs(page.rect)
    rects = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
    try:
        rects += page.cluster_drawings(x_tolerance=4, y_tolerance=4)
    except Exception:
        rects += [pymupdf.Rect(drawing["rect"]) for drawing in page.get_drawings()]
    kept = []
    for rect in rects:
        rect = rect & page.rect
        # Ni les poussières, ni les fonds qui couvrent toute la page
        if rect.width < 6 and rect.height < 6:
            continue
        if abs(rect) > 0.85 * area:
            continue
        # Un trait isolé est un filet de mise en page (en-tête, séparateur), pas une figure
        if min(rect.width, rect.height) < 3:
            continue
        kept.append(rect)
    return kept


def column(caption, page):
    """Bande verticale où chercher : la colonne de la légende, ou toute la largeur."""
    rect = caption["rect"]
    width = page.rect.width
    middle = page.rect.x0 + width / 2
    centered = abs((rect.x0 + rect.x1) / 2 - middle) < 0.08 * width
    if rect.width > 0.55 * width or centered:
        return page.rect.x0, page.rect.x1
    return (page.rect.x0, middle) if rect.x1 <= middle + 0.05 * width else (middle, page.rect.x1)


def overlap_x(rect, x0, x1):
    return min(rect.x1, x1) - max(rect.x0, x0)


def in_column(rect, x0, x1):
    return overlap_x(rect, x0, x1) > 0.5 * min(rect.width, x1 - x0)


def inside_column(rect, x0, x1):
    """Plus strict que in_column : l'élément ne déborde presque pas sur la colonne voisine."""
    return overlap_x(rect, x0, x1) > 0.8 * rect.width


def trim_text(region, blocks, body, x0, x1):
    """Retire les lignes de texte courant mordues par une image à marges blanches."""
    for block in blocks:
        rect = block["rect"]
        wide = rect.width > 0.5 * (x1 - x0) and sum(len(line) for line in block["lines"]) >= 40
        if not (wide and block["size"] >= body - 0.3 and rect.intersects(region)):
            continue
        # Seul le texte qui dépasse du bord est retiré ; celui d'un schéma reste en place
        if rect.y0 <= region.y0 + 3 and rect.y1 - region.y0 < 0.35 * region.height:
            region.y0 = max(region.y0, rect.y1)
        elif rect.y1 >= region.y1 - 3 and region.y1 - rect.y0 < 0.35 * region.height:
            region.y1 = min(region.y1, rect.y0)
    return region


def running_title(block, page):
    """En-tête ou pied de page : une ligne isolée dans la marge haute ou basse."""
    rect = block["rect"]
    margin = rect.y1 < page.rect.y0 + 0.08 * page.rect.height or rect.y0 > page.rect.y1 - 0.06 * page.rect.height
    return margin and len(block["lines"]) == 1


def is_body(block, body, x0, x1):
    """Vrai paragraphe de texte courant : il borne une figure, il n'en fait pas partie."""
    long = sum(len(line) for line in block["lines"]) >= 150
    return long and block["size"] >= body - 0.3 and block["rect"].width > 0.6 * (x1 - x0)


def grow(seed, pool, limit_top, limit_bottom):
    """Agrège au départ `seed` les éléments graphiques voisins, sans franchir les limites."""
    region = pymupdf.Rect(seed)
    rest = [r for r in pool if r is not seed and r.y0 >= limit_top - 2 and r.y1 <= limit_bottom + 2]
    changed = True
    while changed:
        changed = False
        reach = region + (-BRIDGE / 2, -BRIDGE, BRIDGE / 2, BRIDGE)
        for rect in rest[:]:
            if rect.intersects(reach):
                region |= rect
                rest.remove(rect)
                changed = True
    return region


def add_labels(region, blocks, body, limit_top, limit_bottom):
    """Rattache les petits textes collés à la figure : graduations, titres d'axes, (a), (b)."""
    changed = True
    while changed:
        changed = False
        reach = region + (-12, -12, 12, 12)
        for block in blocks:
            rect = block["rect"]
            if rect.y0 < limit_top - 2 or rect.y1 > limit_bottom + 2 or region.contains(rect):
                continue
            small = block["size"] < body - 0.4 or sum(len(line) for line in block["lines"]) <= 12
            if small and rect.intersects(reach):
                region |= rect
                changed = True
    return region


def figure_region(caption, page, blocks, captions, pool, body):
    x0, x1 = column(caption, page)
    rect = caption["rect"]
    others = [c["rect"] for c in captions if c is not caption and in_column(c["rect"], x0, x1)]
    texts = [b for b in blocks if b["rect"] != rect and in_column(b["rect"], x0, x1)
             and not running_title(b, page)]
    strict = [g for g in pool if inside_column(g, x0, x1)]
    # Plus souple : tout élément au-dessus ou au-dessous de la légende, même plus large qu'elle
    loose = [g for g in pool if in_column(g, x0, x1) or overlap_x(g, rect.x0, rect.x1) > 0]
    middle = lambda g: (g.y0 + g.y1) / 2

    def finish(region, top, bottom):
        # Une image à marges blanches peut mordre sur la légende : on la coupe aux limites
        region.y0, region.y1 = max(region.y0, top), min(region.y1, bottom)
        region = add_labels(region, texts, body, top, bottom)
        return trim_text(region, texts, body, x0, x1)

    def search(above, candidates):
        # Limites : la légende elle-même, puis la légende ou le paragraphe voisin le plus proche
        free = lambda b: not any(g.intersects(b["rect"]) for g in candidates)
        if above:
            walls = [r.y1 for r in others if r.y1 <= rect.y0]
            walls += [b["rect"].y1 for b in texts
                      if b["rect"].y1 <= rect.y0 and is_body(b, body, x0, x1) and free(b)]
            top, bottom = max(walls, default=page.rect.y0), rect.y0
            near = [g for g in candidates if g.y0 >= top - 2 and middle(g) < bottom]
            near.sort(key=lambda g: bottom - g.y1)
            gap = bottom - near[0].y1 if near else 0
        else:
            walls = [r.y0 for r in others if r.y0 >= rect.y1]
            walls += [b["rect"].y0 for b in texts
                      if b["rect"].y0 >= rect.y1 and is_body(b, body, x0, x1) and free(b)]
            top, bottom = rect.y1, min(walls, default=page.rect.y1)
            near = [g for g in candidates if g.y1 <= bottom + 2 and middle(g) > top]
            near.sort(key=lambda g: g.y0 - top)
            gap = near[0].y0 - top if near else 0
        if not near or gap > 60:
            return None
        return finish(grow(near[0], near[1:], top, bottom + 400), top, bottom)

    def beside():
        # Légende posée à côté de la figure, à la même hauteur (mise en page Springer)
        near = [g for g in pool if min(g.y1, rect.y1) - max(g.y0, rect.y0) > 0.5 * rect.height
                and (0 <= g.x0 - rect.x1 <= 50 or 0 <= rect.x0 - g.x1 <= 50)]
        if not near:
            return None
        near.sort(key=lambda g: -abs(g))
        region = grow(near[0], [g for g in pool if g is not near[0]], page.rect.y0, page.rect.y1)
        return region if not region.intersects(rect) else None

    return (search(True, strict) or search(True, loose) or beside()
            or search(False, strict) or search(False, loose))


def table_region(caption, page, blocks, captions, body):
    x0, x1 = column(caption, page)
    rect = caption["rect"]
    try:
        found = [pymupdf.Rect(t.bbox) for t in page.find_tables().tables]
    except Exception:
        found = []
    found = [t for t in found if in_column(t, x0, x1) and t.height > 15]
    below = sorted((t for t in found if 0 <= t.y0 - rect.y1 + 6 <= 50), key=lambda t: t.y0)
    above = sorted((t for t in found if 0 <= rect.y0 - t.y1 + 6 <= 50), key=lambda t: -t.y1)
    if below or above:
        return (below or above)[0]

    # Tableau sans grille détectable : on s'appuie sur ses filets horizontaux sous la légende
    rules = sorted(
        (pymupdf.Rect(d["rect"]) for d in page.get_drawings()
         if pymupdf.Rect(d["rect"]).height < 3 and pymupdf.Rect(d["rect"]).width > 40),
        key=lambda r: r.y0,
    )
    rules = [r for r in rules if in_column(r, x0, x1) and r.y0 >= rect.y1 - 4]
    if not rules or rules[0].y0 - rect.y1 > 30:
        return None
    walls = [c["rect"].y0 for c in captions if c is not caption and c["rect"].y0 > rect.y1
             and in_column(c["rect"], x0, x1)]
    limit = min(walls, default=page.rect.y1)
    region = pymupdf.Rect(rules[0])
    for rule in rules[1:]:
        between = [b for b in blocks if region.y1 < b["rect"].y0 and b["rect"].y1 < rule.y0
                   and in_column(b["rect"], x0, x1) and is_body(b, body, x0, x1)]
        if rule.y1 > limit or between:
            break
        region |= rule
    return region if region.height > 15 else None


def extract(pdf, out, dpi=200):
    """Écrit les PNG et captions.json dans `out` ; renvoie les éléments extraits."""
    doc = pymupdf.open(pdf)
    body = body_size(doc)
    items = []
    seen = Counter()
    missed = []
    for page in doc:
        blocks = text_blocks(page)
        captions = find_captions(blocks)
        if not captions:
            continue
        pool = graphics(page)
        for caption in captions:
            if caption["kind"] == "figure":
                region = figure_region(caption, page, blocks, captions, pool, body)
            else:
                region = table_region(caption, page, blocks, captions, body)
            label = ("Fig." if caption["kind"] == "figure" else "Table") + f" {caption['number']}"
            if region is None or region.width < 40 or region.height < 20:
                missed.append(f"{label} (p. {page.number + 1})")
                continue
            clip = (region + (-PAD, -PAD, PAD, PAD)) & page.rect
            items.append({"kind": caption["kind"], "number": caption["number"], "label": label,
                          "page": page.number + 1, "caption": caption["text"], "clip": clip})

    # Un même numéro trouvé deux fois : on garde la zone la plus grande (l'autre est un renvoi)
    best = {}
    for item in items:
        key = (item["kind"], item["number"])
        if key not in best or abs(item["clip"]) > abs(best[key]["clip"]):
            best[key] = item
    items = sorted(best.values(), key=lambda i: (i["kind"] != "figure", i["number"]))

    out.mkdir(parents=True, exist_ok=True)
    for old in list(out.glob("fig-*.png")) + list(out.glob("table-*.png")):
        old.unlink()
    for item in items:
        prefix = "fig" if item["kind"] == "figure" else "table"
        seen[prefix] += 1
        item["file"] = f"{prefix}-{item['number']:02d}.png"
        clip = item.pop("clip")
        doc[item["page"] - 1].get_pixmap(clip=clip, dpi=dpi).save(out / item["file"])
    record = {"source": Path(pdf).name, "items": items}
    (out / "captions.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return items, missed


def local_pdf(file_path):
    """Chemin du PDF sur cette machine : celui noté dans Notion, sinon le stockage Zotero local."""
    if Path(file_path).exists():
        return Path(file_path)
    # Notion garde le chemin de l'ordi d'origine ; seuls <clé>/<fichier> valent partout
    parts = PureWindowsPath(file_path).parts
    load_env()
    storage = Path(os.environ.get("ZOTERO_STORAGE") or Path.home() / "Zotero" / "storage")
    candidate = storage / parts[-2] / parts[-1] if len(parts) >= 2 else None
    return candidate if candidate and candidate.exists() else None


def library():
    """Papiers de la Bibliothèque qui ont un PDF local, d'après data/full.json."""
    path = ROOT / "data" / "full.json"
    if not path.exists():
        raise SystemExit("data/full.json absent : lance d'abord python scripts/sync_notion.py")
    found = []
    for paper in json.loads(path.read_text(encoding="utf-8"))["papers"]:
        if not (paper["file_path"] or "").lower().endswith(".pdf"):
            continue
        pdf = local_pdf(paper["file_path"])
        if pdf:
            found.append({**paper, "file_path": str(pdf)})
    return found


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Extrait figures et tableaux d'un PDF en PNG.")
    parser.add_argument("pdf", nargs="?", help="chemin d'un PDF")
    parser.add_argument("--key", help="clé Zotero d'un papier de la Bibliothèque")
    parser.add_argument("--all", action="store_true", help="tous les PDF de la Bibliothèque")
    parser.add_argument("--out", help="dossier de sortie (défaut : figures/<clé ou nom du PDF>)")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--force", action="store_true", help="refaire les papiers déjà extraits")
    args = parser.parse_args()

    if args.pdf:
        jobs = [(Path(args.pdf), Path(args.out) if args.out else FIGURES / Path(args.pdf).stem, args.pdf)]
    elif args.key or args.all:
        papers = [p for p in library() if args.all or p["id"] == args.key]
        if not papers:
            raise SystemExit(f"Aucun PDF local pour la clé {args.key}.")
        jobs = [(Path(p["file_path"]), FIGURES / p["id"], p["label"]) for p in papers]
    else:
        parser.error("donne un PDF, --key ou --all")

    for pdf, out, name in jobs:
        if args.all and not args.force and (out / "captions.json").exists():
            continue
        try:
            items, missed = extract(pdf, out, args.dpi)
        except Exception as error:
            print(f"ÉCHEC  {name} : {error}")
            continue
        figures = sum(1 for item in items if item["kind"] == "figure")
        note = f"  non délimités : {', '.join(missed)}" if missed else ""
        print(f"{name} : {figures} figures, {len(items) - figures} tableaux -> {out}{note}")
    if args.key or args.all:
        write_index(FIGURES)


def write_index(folder):
    """Liste des papiers qui ont des figures : le site la lit pour ne rien demander en vain."""
    index = {}
    for captions in sorted(folder.glob("*/captions.json")):
        count = len(json.loads(captions.read_text(encoding="utf-8"))["items"])
        if count:
            index[captions.parent.name] = count
    (folder / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
