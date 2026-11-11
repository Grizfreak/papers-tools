"""Chargement du fichier .env local, sans dépendance externe."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env():
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        # Une variable déjà définie (CI) garde la priorité sur le fichier
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def require(name):
    load_env()
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Variable {name} absente : renseigne-la dans .env (voir .env.example).")
    return value
