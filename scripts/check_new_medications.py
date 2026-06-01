#!/usr/bin/env python3
"""
Controleert maandelijks of er nieuwe EU-geautoriseerde diergeneesmiddelen zijn
die nog niet in medications.json staan. Draait via GitHub Actions en maakt
automatisch een GitHub Issue aan als er nieuwe middelen gevonden worden.

Data-bron: EMA (European Medicines Agency) — EPAR data voor diergeneesmiddelen
Als de download-URL niet meer werkt, controleer dan:
https://www.ema.europa.eu/en/medicines/download-medicine-data
"""

import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from urllib.error import URLError
from urllib.request import Request, urlopen

# EMA download-URL voor diergeneesmiddelen (EPAR-spreadsheet)
# Controleer en update dit adres als de download mislukt:
# https://www.ema.europa.eu/en/medicines/download-medicine-data#veterinary-medicines-section
EMA_VET_URL = (
    "https://www.ema.europa.eu/sites/default/files/"
    "Medicines_output_veterinary_medicines_en.xlsx"
)

GITHUB_API = "https://api.github.com"
MEDICATIONS_PATH = "data/medications.json"
LOOKBACK_DAYS = 40  # iets meer dan een maand zodat we geen autorisaties missen


def load_current_medications():
    """Laad alle bekende namen/stoffen uit medications.json in een set."""
    with open(MEDICATIONS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    known = set()
    for med in data["medicaties"]:
        for field in ("werkzameStof", "naam"):
            val = med.get(field, "").strip().lower()
            if val:
                known.add(val)
        for merk in med.get("merknamen", []):
            known.add(merk.strip().lower())

    return known


def fetch_ema_excel():
    """Download de EMA veterinaire EPAR-spreadsheet en geef de rijen terug."""
    try:
        import openpyxl
    except ImportError:
        print("openpyxl niet gevonden. Installeer met: pip install openpyxl")
        sys.exit(1)

    print(f"EMA data downloaden van:\n  {EMA_VET_URL}")
    req = Request(
        EMA_VET_URL,
        headers={"User-Agent": "vet-medicatie-checker/1.0 (github-actions)"},
    )

    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except URLError as e:
        print(f"\nFout bij downloaden EMA data: {e}")
        print("Controleer de URL bovenaan dit script.")
        print("Zie: https://www.ema.europa.eu/en/medicines/download-medicine-data")
        sys.exit(1)

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    if not rows:
        print("Spreadsheet is leeg — controleer de URL.")
        sys.exit(1)

    headers = [str(h).strip().lower() if h else "" for h in rows[0]]
    records = [dict(zip(headers, row)) for row in rows[1:] if any(row)]

    print(f"  {len(records)} rijen ingeladen, kolommen: {[h for h in headers if h][:8]}...")
    return records, headers


def _find_col(headers, *keywords):
    """Zoek de eerste kolomnaam die een van de keywords bevat."""
    for kw in keywords:
        for h in headers:
            if kw in h:
                return h
    return None


def find_new_medicines(records, headers, known):
    """Filter op recent geautoriseerde middelen die niet in onze database staan."""
    cutoff = datetime.now() - timedelta(days=LOOKBACK_DAYS)

    name_col   = _find_col(headers, "medicine name", "product name")
    inn_col    = _find_col(headers, "inn", "common name", "active substance", "substance")
    date_col   = _find_col(headers, "date of authorisation", "authorisation date", "decision date")
    status_col = _find_col(headers, "authorisation status", "status")

    print(f"  Kolomkoppelingen: naam={name_col!r}, INN={inn_col!r}, datum={date_col!r}, status={status_col!r}")

    new_meds = []

    for rec in records:
        # Sla ingetrokken of geweigerde autorisaties over
        if status_col:
            status = str(rec.get(status_col) or "").lower()
            if any(w in status for w in ("withdrawn", "refused", "expired")):
                continue

        # Filter op autorisatiedatum
        if date_col:
            raw_date = rec.get(date_col)
            auth_date = None
            if isinstance(raw_date, datetime):
                auth_date = raw_date
            elif raw_date:
                for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
                    try:
                        auth_date = datetime.strptime(str(raw_date)[:10], fmt)
                        break
                    except ValueError:
                        continue
            if auth_date is None or auth_date < cutoff:
                continue

        med_name = str(rec.get(name_col) or "").strip()
        inn      = str(rec.get(inn_col)  or "").strip()

        if not med_name and not inn:
            continue

        # Check of het al in onze database staat (op naam of werkzame stof)
        candidates = {med_name.lower(), inn.lower()}
        candidates.discard("")

        already_known = any(
            cand in known or any(cand in k or k in cand for k in known if len(k) > 4)
            for cand in candidates
        )

        if not already_known:
            new_meds.append({
                "naam":  med_name,
                "inn":   inn,
                "datum": str(rec.get(date_col, "")) if date_col else "onbekend",
            })

    return new_meds


def create_github_issue(new_meds):
    """Maak een GitHub Issue aan met de gevonden nieuwe medicaties."""
    token = os.environ.get("GH_TOKEN")
    repo  = os.environ.get("REPO")

    if not token or not repo:
        print("\nGH_TOKEN of REPO niet ingesteld — issue overgeslagen.")
        print("Nieuw gevonden middelen:")
        for m in new_meds:
            print(f"  - {m['naam']} ({m['inn']}) — {m['datum']}")
        return

    today = datetime.now().strftime("%Y-%m-%d")
    count = len(new_meds)

    tabel_rijen = "\n".join(
        f"| {m['naam']} | {m['inn']} | {m['datum']} |"
        for m in new_meds[:50]
    )
    extra = f"\n| _(en nog {count - 50} andere...)_ | | |" if count > 50 else ""

    body = f"""## Maandelijkse Medicatie Check — {today}

Er zijn **{count} mogelijk nieuwe** EU-geregistreerde diergeneesmiddelen gevonden die nog niet in `medications.json` staan.

### Actie vereist
Controleer onderstaande middelen en voeg ze toe als ze relevant zijn voor de app:

| Merknaam | Werkzame stof (INN) | Autorisatiedatum |
|----------|---------------------|-----------------|
{tabel_rijen}{extra}

### Bronnen om te checken
- [EudraPharm](https://medicines.eudrapharm.eu/) — EU database diergeneesmiddelen
- [EMA Veterinary Medicines](https://www.ema.europa.eu/en/veterinary-regulatory/overview) — dosering via SmPC's

---
_Automatisch gegenereerd door de maandelijkse check workflow._"""

    payload = json.dumps({
        "title":  f"[Maandelijkse Check] {count} mogelijk nieuwe diergeneesmiddelen — {today}",
        "body":   body,
        "labels": ["medicatie-update", "automatisch"],
    }).encode()

    req = Request(
        f"{GITHUB_API}/repos/{repo}/issues",
        data=payload,
        headers={
            "Authorization":        f"Bearer {token}",
            "Accept":               "application/vnd.github+json",
            "Content-Type":         "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST",
    )

    try:
        with urlopen(req) as resp:
            result = json.load(resp)
        print(f"\nIssue aangemaakt: {result['html_url']}")
    except Exception as e:
        print(f"\nFout bij aanmaken issue: {e}")
        sys.exit(1)


def main():
    print("=== Maandelijkse Medicatie Check ===\n")

    known = load_current_medications()
    print(f"Huidige database: {len(known)} bekende stoffen/namen\n")

    records, headers = fetch_ema_excel()

    new_meds = find_new_medicines(records, headers, known)
    print(f"\nMogelijk nieuwe middelen: {len(new_meds)}")

    if not new_meds:
        print("Geen nieuwe middelen gevonden — database lijkt up-to-date!")
        return

    create_github_issue(new_meds)


if __name__ == "__main__":
    main()
