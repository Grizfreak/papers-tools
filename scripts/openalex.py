"""Accès à OpenAlex : 3 DOI au plus par requête, une requête à la fois, cache local.

Usage : python scripts/openalex.py 10.1109/TVCG.2010.223 [autre DOI ...] [--refresh]
"""
import json
import sys
import time
import urllib.parse
import urllib.request

from env import ROOT, require

API = "https://api.openalex.org/works"
CACHE = ROOT / ".cache" / "openalex.json"
BATCH = 3
PAUSE = 1.0
SELECT = "id,doi,cited_by_count,open_access,best_oa_location"


def bare_doi(doi):
    """Ramène un DOI ou une URL doi.org à la forme nue en minuscules."""
    doi = (doi or "").strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi


def _summary(work):
    location = work.get("best_oa_location") or {}
    access = work.get("open_access") or {}
    return {
        "openalex_id": work.get("id"),
        "cited_by_count": work.get("cited_by_count"),
        "is_oa": bool(access.get("is_oa")),
        "oa_status": access.get("oa_status"),
        "license": location.get("license"),
        "oa_url": location.get("landing_page_url") or access.get("oa_url"),
    }


def _request(dois, mailto):
    query = urllib.parse.urlencode({
        "filter": "doi:" + "|".join(dois),
        "select": SELECT,
        "per-page": BATCH,
        "mailto": mailto,
    })
    with urllib.request.urlopen(f"{API}?{query}", timeout=30) as response:
        return json.load(response)["results"]


def fetch_works(dois, refresh=False):
    """Renvoie {doi nu: résumé ou None si OpenAlex ne connaît pas le DOI}."""
    wanted = sorted({bare_doi(d) for d in dois if bare_doi(d)})
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    missing = [d for d in wanted if refresh or d not in cache]
    if missing:
        mailto = require("OPENALEX_MAILTO")
        for start in range(0, len(missing), BATCH):
            batch = missing[start:start + BATCH]
            if start:
                time.sleep(PAUSE)
            found = {bare_doi(w.get("doi")): _summary(w) for w in _request(batch, mailto)}
            for doi in batch:
                cache[doi] = found.get(doi)
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    return {d: cache[d] for d in wanted}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--refresh"]
    if not args:
        raise SystemExit(__doc__)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fetch_works(args, refresh="--refresh" in sys.argv), ensure_ascii=False, indent=2))
