#!/usr/bin/env python3
"""
Controleert maandelijks of er nieuwe diergeneesmiddelen zijn die nog niet
in medications.json staan en maakt een GitHub Issue aan als dat zo is.

Primaire bron : Diergeneesmiddeleninformatiebank (DIB) — publieke CSV van CBG-MEB
                Geen authenticatie nodig.
                https://www.diergeneesmiddeleninformatiebank.nl

Optionele bron: EMA Union Product Database (UPD) — REST API, OAuth2 vereist.
                Activeer door EMA_CLIENT_ID en EMA_CLIENT_SECRET in te stellen
                als GitHub Actions secrets.
                Registratie: https://upd-portal-prod.azurewebsites.net/updwebui/home
"""

import csv
import io
import json
import os
import sys
from datetime import datetime, timedelta
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ── Configuratie ───────────────────────────────────────────────────────────────

# DIB CSV — publiek, geen auth
DIB_CSV_URL = "https://www.diergeneesmiddeleninformatiebank.nl/metadatadib.csv"

# EMA UPD — vul in na registratie (zie onderin dit bestand)
EMA_UPD_TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
EMA_UPD_API_URL   = "https://prod-upd-openapi-app.azurewebsites.net/api/v1/MedicinalProduct"
EMA_UPD_SCOPE     = "api://upd-public-api/.default"

GITHUB_API      = "https://api.github.com"
MEDICATIONS_PATH = "data/medications.json"
LOOKBACK_DAYS   = 40   # iets meer dan een maand zodat we niets missen


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_current_medications():
    """Geeft een set van alle bekende namen/werkzame stoffen/merknamen."""
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


def _find_col(headers, *keywords):
    """Zoek de eerste kolomnaam (case-insensitief) die een keyword bevat."""
    hl = [h.lower() for h in headers]
    for kw in keywords:
        for i, h in enumerate(hl):
            if kw in h:
                return headers[i]
    return None


def _is_new(name, inn, known):
    """True als naam of INN niet in de bekende set voorkomt."""
    for cand in {name.lower(), inn.lower()} - {""}:
        if cand in known:
            return False
        if any(cand in k or k in cand for k in known if len(k) > 4):
            return False
    return True


def _parse_date(raw):
    """Parseer een datumstring naar datetime; geeft None bij mislukking."""
    if isinstance(raw, datetime):
        return raw
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(str(raw).strip()[:10], fmt)
        except ValueError:
            continue
    return None


# ── Bron 1: DIB CSV ────────────────────────────────────────────────────────────

def fetch_dib_csv():
    """
    Download de publieke metadata-CSV van de Diergeneesmiddeleninformatiebank.
    Geeft (records: list[dict], headers: list[str]) terug.
    """
    print(f"DIB CSV downloaden van:\n  {DIB_CSV_URL}")
    req = Request(
        DIB_CSV_URL,
        headers={"User-Agent": "vet-medicatie-checker/2.0 (github-actions)"},
    )
    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except URLError as e:
        print(f"Fout bij downloaden DIB CSV: {e}")
        print("Controleer: https://www.diergeneesmiddeleninformatiebank.nl")
        return None, None

    # Probeer UTF-8, val terug op latin-1 (veelgebruikt door NL overheidsbestanden)
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        print("Kon CSV niet decoderen.")
        return None, None

    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    records = list(reader)
    headers = reader.fieldnames or []

    print(f"  {len(records)} rijen geladen | kolommen: {list(headers)[:6]}...")
    return records, list(headers)


def find_new_dib(records, headers, known):
    """Filter DIB-records op recent geregistreerde middelen die ontbreken."""
    if not records:
        return []

    cutoff = datetime.now() - timedelta(days=LOOKBACK_DAYS)

    name_col   = _find_col(headers, "naam", "productnaam", "name")
    inn_col    = _find_col(headers, "werkzame stof", "werkzamestof", "substance", "inn")
    date_col   = _find_col(headers, "datum", "registratiedatum", "date")
    status_col = _find_col(headers, "status")

    print(f"  Kolommen → naam:{name_col!r}  INN:{inn_col!r}  "
          f"datum:{date_col!r}  status:{status_col!r}")

    new_meds = []
    for rec in records:
        if status_col:
            st = str(rec.get(status_col) or "").lower()
            if any(w in st for w in ("ingetrokken", "vervallen", "withdrawn", "refused")):
                continue

        if date_col:
            d = _parse_date(rec.get(date_col))
            if d is None or d < cutoff:
                continue

        naam = str(rec.get(name_col) or "").strip() if name_col else ""
        inn  = str(rec.get(inn_col)  or "").strip() if inn_col  else ""

        if not naam and not inn:
            continue
        if not _is_new(naam, inn, known):
            continue

        new_meds.append({
            "naam":  naam,
            "inn":   inn,
            "datum": str(rec.get(date_col, "—")) if date_col else "—",
            "bron":  "DIB (CBG-MEB)",
        })

    return new_meds


# ── Bron 2: EMA UPD (optioneel — vereist registratie) ──────────────────────────

def get_ema_token(client_id, client_secret, tenant_id):
    """
    Haal een OAuth2 Bearer Token op via Client Credentials flow.
    Vereist registratie op: https://upd-portal-prod.azurewebsites.net/updwebui/home
    """
    token_url = EMA_UPD_TOKEN_URL.format(tenant=tenant_id)
    payload = urlencode({
        "grant_type":    "client_credentials",
        "client_id":     client_id,
        "client_secret": client_secret,
        "scope":         EMA_UPD_SCOPE,
    }).encode()

    req = Request(token_url, data=payload, method="POST")
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        return data.get("access_token")
    except Exception as e:
        print(f"EMA token ophalen mislukt: {e}")
        return None


def fetch_ema_upd(token, known):
    """
    Bevraag de EMA UPD REST API voor recent geregistreerde veterinaire middelen.
    Vereist een geldig Bearer Token (zie get_ema_token).
    """
    cutoff = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    # Filter op veterinaire middelen geregistreerd na cutoff-datum
    params = urlencode({
        "productType":        "veterinary",
        "authorisationDateGt": cutoff,
        "pageSize":           200,
    })
    url = f"{EMA_UPD_API_URL}?{params}"

    req = Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept":        "application/json",
    })

    try:
        with urlopen(req, timeout=60) as resp:
            data = json.load(resp)
    except HTTPError as e:
        print(f"EMA UPD API fout {e.code}: {e.reason}")
        return []
    except URLError as e:
        print(f"EMA UPD verbindingsfout: {e}")
        return []

    items = data.get("items") or data.get("results") or (data if isinstance(data, list) else [])
    print(f"  EMA UPD: {len(items)} middelen ontvangen")

    new_meds = []
    for item in items:
        naam = str(item.get("name") or item.get("productName") or "").strip()
        inn  = str(item.get("activeSubstance") or item.get("inn") or "").strip()
        datum = str(item.get("authorisationDate") or "—")

        if not naam and not inn:
            continue
        if not _is_new(naam, inn, known):
            continue

        new_meds.append({
            "naam":  naam,
            "inn":   inn,
            "datum": datum,
            "bron":  "EMA UPD",
        })

    return new_meds


# ── GitHub Issue aanmaken ──────────────────────────────────────────────────────

def create_github_issue(new_meds):
    token = os.environ.get("GH_TOKEN")
    repo  = os.environ.get("REPO")

    if not token or not repo:
        print("\nGH_TOKEN of REPO niet ingesteld — issue overgeslagen.")
        for m in new_meds:
            print(f"  - [{m['bron']}] {m['naam']} ({m['inn']}) — {m['datum']}")
        return

    today = datetime.now().strftime("%Y-%m-%d")
    count = len(new_meds)

    # Splits per bron voor overzicht in het issue
    dib_meds = [m for m in new_meds if m["bron"] == "DIB (CBG-MEB)"]
    ema_meds = [m for m in new_meds if m["bron"] == "EMA UPD"]

    def tabel(meds):
        rijen = "\n".join(f"| {m['naam']} | {m['inn']} | {m['datum']} |" for m in meds[:50])
        extra = f"\n| _(+{len(meds)-50} meer)_ | | |" if len(meds) > 50 else ""
        return rijen + extra

    secties = ""
    if dib_meds:
        secties += f"""
### 🇳🇱 Diergeneesmiddeleninformatiebank (CBG-MEB) — {len(dib_meds)} nieuw

| Productnaam | Werkzame stof | Registratiedatum |
|-------------|---------------|-----------------|
{tabel(dib_meds)}
"""
    if ema_meds:
        secties += f"""
### 🇪🇺 EMA Union Product Database — {len(ema_meds)} nieuw

| Productnaam | Werkzame stof | Autorisatiedatum |
|-------------|---------------|-----------------|
{tabel(ema_meds)}
"""

    body = f"""## Maandelijkse Medicatie Check — {today}

Er zijn **{count} mogelijk nieuwe** geregistreerde diergeneesmiddelen gevonden die nog niet in `medications.json` staan.
{secties}
### Actie vereist
Controleer de bovenstaande middelen en voeg ze toe indien relevant.

### Bronnen voor dosering
- [Diergeneesmiddeleninformatiebank](https://www.diergeneesmiddeleninformatiebank.nl/) — NL database met SmPC's
- [EMA Veterinary Medicines](https://medicines.health.europa.eu/veterinary/en) — EU zoekinterface

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


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=== Maandelijkse Medicatie Check ===\n")

    known = load_current_medications()
    print(f"Huidige database: {len(known)} bekende stoffen/namen\n")

    all_new = []

    # ── Bron 1: DIB CSV (altijd) ──
    records, headers = fetch_dib_csv()
    if records:
        dib_new = find_new_dib(records, headers, known)
        print(f"  Nieuw via DIB: {len(dib_new)}")
        all_new.extend(dib_new)
    else:
        print("  DIB download mislukt — bron overgeslagen.")

    # ── Bron 2: EMA UPD (alleen als credentials beschikbaar zijn) ──
    ema_client_id     = os.environ.get("EMA_CLIENT_ID")
    ema_client_secret = os.environ.get("EMA_CLIENT_SECRET")
    ema_tenant_id     = os.environ.get("EMA_TENANT_ID")

    if ema_client_id and ema_client_secret and ema_tenant_id:
        print("\nEMA UPD credentials gevonden — API bevragen...")
        token = get_ema_token(ema_client_id, ema_client_secret, ema_tenant_id)
        if token:
            ema_new = fetch_ema_upd(token, known)
            # Dedupliceer t.o.v. al gevonden DIB-middelen
            dib_names = {m["naam"].lower() for m in all_new}
            ema_new = [m for m in ema_new if m["naam"].lower() not in dib_names]
            print(f"  Nieuw via EMA UPD (na dedup): {len(ema_new)}")
            all_new.extend(ema_new)
    else:
        print("\nEMA_CLIENT_ID/SECRET/TENANT_ID niet ingesteld → EMA UPD overgeslagen.")
        print("Zie registratie-instructies in README of vraag je beheerder.")

    # ── Resultaat ──
    print(f"\nTotaal mogelijk nieuw: {len(all_new)}")

    if not all_new:
        print("Geen nieuwe middelen gevonden — database lijkt up-to-date!")
        return

    create_github_issue(all_new)


if __name__ == "__main__":
    main()
