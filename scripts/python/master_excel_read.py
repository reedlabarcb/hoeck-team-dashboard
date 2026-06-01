#!/usr/bin/env python3
"""
Master Excel reader for the Hoeck Team Dashboard.

Invoked as a subprocess by lib/external/master-excel/safe.ts. Reads the
TT Rep Master Client List xlsx (downloaded locally by the TS wrapper from Box)
and emits JSON to stdout.

Usage:
    python master_excel_read.py --file-path /tmp/master.xlsx --action lookup --client "Procopio" --market "DC"
    python master_excel_read.py --file-path /tmp/master.xlsx --action all
    python master_excel_read.py --file-path /tmp/master.xlsx --action smoke

Returns (stdout, always JSON):
    {
      "status": "ok" | "error",
      "action": "lookup" | "all" | "smoke",
      "rows":              [...],            # action=lookup or all
      "multiple_matches":  bool,             # action=lookup, true if >1 match
      "row_count":         int,              # action=all/smoke
      "sheet_count":       int,              # action=smoke
      "sheet_name":        str,              # which sheet was read
      "headers":           {field: col_idx}, # debugging — detected header map
      "warnings":          [str, ...],
      "error":             str               # action=error only
    }

Exit codes:
    0 = success (status=="ok")
    1 = file/sheet/parse error (status=="error")
    2 = argument error
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import date, datetime
from typing import Any

try:
    from openpyxl import load_workbook
except ImportError:
    print(json.dumps({
        "status": "error",
        "error": "openpyxl not installed. On Railway it ships via nixpacks "
                 "python311.withPackages; locally use a venv and `pip install openpyxl`.",
    }))
    sys.exit(1)


# Header-detection patterns. We match the FIRST row whose cells contain text that
# looks like headers; for each column, we check the patterns in order and assign
# the first matching field. Case-insensitive substring matches.
# Tuple = (field_name, [pattern_groups]) — all groups in a single pattern must match.
HEADER_PATTERNS: list[tuple[str, list[re.Pattern[str]]]] = [
    ("client",                  [re.compile(r"client", re.I)]),
    ("address",                 [re.compile(r"address|premise|location", re.I)]),
    ("market",                  [re.compile(r"\bmarket\b|\boffice\b|\bcity\b", re.I)]),
    ("space_sf",                [re.compile(r"\bsf\b|square ?f(ee)?t|space size", re.I)]),
    ("lease_expiration",        [re.compile(r"(lease|expir).*expir|expir.*(lease|date)|expir", re.I)]),
    ("renewal_window_start",    [
        re.compile(r"renew", re.I),
        re.compile(r"(window|option).*(start|begin|open)", re.I),
    ]),
    ("renewal_window_end",      [
        re.compile(r"renew", re.I),
        re.compile(r"(window|option).*(end|close|stop)", re.I),
    ]),
    ("renewal_deadline",        [
        re.compile(r"renew", re.I),
        re.compile(r"deadline|notice", re.I),
    ]),
    ("termination_deadline",    [
        re.compile(r"termin", re.I),
        re.compile(r"deadline|option|notice|close", re.I),
    ]),
    ("notes",                   [re.compile(r"\bnotes?\b|comment", re.I)]),
]


@dataclass
class RowDict:
    """Normalized representation of one Master Excel row."""
    client: str | None = None
    market: str | None = None
    address: str | None = None
    space_sf: float | None = None
    lease_expiration: str | None = None
    renewal_window_start: str | None = None
    renewal_window_end: str | None = None
    renewal_deadline: str | None = None
    termination_deadline: str | None = None
    notes: str | None = None
    # The original 1-indexed row number in the sheet (useful for cross-checking + debugging).
    source_row: int | None = None


def _cell_to_str(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        # ISO-8601 date for downstream parsing in TS.
        return v.isoformat()
    s = str(v).strip()
    return s if s else None


def _cell_to_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _detect_headers(rows: list[list[Any]]) -> tuple[int, dict[str, int]]:
    """
    Find the header row (first row with >= 3 non-empty cells) and return its
    1-indexed row number + a {field_name: column_index} map.

    Raises ValueError if no header row is found within the first 10 rows.
    """
    for row_idx, row in enumerate(rows[:10], start=1):
        non_empty = [c for c in row if c is not None and str(c).strip()]
        if len(non_empty) < 3:
            continue
        # This looks like a header row. Try to map each cell to a known field.
        headers: dict[str, int] = {}
        for col_idx, cell in enumerate(row):
            if cell is None:
                continue
            cell_str = str(cell).strip()
            if not cell_str:
                continue
            for field_name, patterns in HEADER_PATTERNS:
                if field_name in headers:
                    continue  # first match wins per field
                if all(p.search(cell_str) for p in patterns):
                    headers[field_name] = col_idx
                    break
        # We need at least a `client` column to call this a real header row.
        if "client" in headers:
            return row_idx, headers
    raise ValueError("Could not find a header row with a Client column in the first 10 rows.")


def _extract_market_from_client(client_str: str | None) -> tuple[str | None, str | None]:
    """
    "Procopio (DC)"            -> ("Procopio", "DC")
    "Northwestern Mutual - MT" -> ("Northwestern Mutual - MT", None)
    "Foo"                      -> ("Foo", None)
    """
    if not client_str:
        return None, None
    m = re.match(r"^(.+?)\s*\(([^)]+)\)\s*$", client_str)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return client_str.strip(), None


def _matches(haystack: str | None, needle: str) -> bool:
    """Case-insensitive contains. Empty needle -> False."""
    if not needle or not haystack:
        return False
    return needle.strip().lower() in haystack.lower()


def _parse_row(raw: list[Any], header_map: dict[str, int], source_row: int) -> RowDict | None:
    """Map a sheet row to a RowDict using the detected header map. None if no client."""
    def cell(field_name: str) -> Any:
        idx = header_map.get(field_name)
        if idx is None or idx >= len(raw):
            return None
        return raw[idx]

    raw_client = _cell_to_str(cell("client"))
    if not raw_client:
        return None

    explicit_market = _cell_to_str(cell("market"))
    parsed_client, parens_market = _extract_market_from_client(raw_client)
    market = explicit_market or parens_market

    return RowDict(
        client=parsed_client,
        market=market,
        address=_cell_to_str(cell("address")),
        space_sf=_cell_to_float(cell("space_sf")),
        lease_expiration=_cell_to_str(cell("lease_expiration")),
        renewal_window_start=_cell_to_str(cell("renewal_window_start")),
        renewal_window_end=_cell_to_str(cell("renewal_window_end")),
        renewal_deadline=_cell_to_str(cell("renewal_deadline")),
        termination_deadline=_cell_to_str(cell("termination_deadline")),
        notes=_cell_to_str(cell("notes")),
        source_row=source_row,
    )


def _load_rows(file_path: str, sheet_name: str | None) -> tuple[str, list[RowDict], dict[str, int], list[str]]:
    """Load + parse all data rows. Returns (sheet_name, rows, header_map, warnings)."""
    warnings: list[str] = []
    wb = load_workbook(file_path, data_only=True, read_only=True)
    sheet = wb[sheet_name] if sheet_name else wb[wb.sheetnames[0]]
    all_rows = [list(r) for r in sheet.iter_rows(values_only=True)]
    if not all_rows:
        return sheet.title, [], {}, ["Sheet is empty"]

    try:
        header_row_idx, header_map = _detect_headers(all_rows)
    except ValueError as e:
        warnings.append(str(e))
        return sheet.title, [], {}, warnings

    # Flag missing optional columns so the UI can surface a "this column wasn't found" hint.
    expected = {"client", "address", "market", "lease_expiration",
                "renewal_window_start", "renewal_window_end",
                "renewal_deadline", "termination_deadline"}
    missing = expected - set(header_map.keys())
    if missing:
        warnings.append(f"Headers not found for: {sorted(missing)}. Lookup may return null for those fields.")

    rows: list[RowDict] = []
    for raw_row_idx, raw in enumerate(all_rows[header_row_idx:], start=header_row_idx + 1):
        parsed = _parse_row(raw, header_map, source_row=raw_row_idx)
        if parsed is not None:
            rows.append(parsed)

    return sheet.title, rows, header_map, warnings


# ----------------- Actions -----------------

def action_smoke(file_path: str) -> dict[str, Any]:
    """Open the file, count sheets + rows. No full parse. Used by /api/health."""
    wb = load_workbook(file_path, data_only=True, read_only=True)
    sheet_names = wb.sheetnames
    primary = wb[sheet_names[0]]
    return {
        "status": "ok",
        "action": "smoke",
        "sheet_count": len(sheet_names),
        "sheet_names": sheet_names,
        "primary_sheet": primary.title,
        "primary_row_count": primary.max_row,
        "warnings": [],
    }


def action_all(file_path: str, sheet_name: str | None) -> dict[str, Any]:
    sheet_title, rows, header_map, warnings = _load_rows(file_path, sheet_name)
    return {
        "status": "ok",
        "action": "all",
        "sheet_name": sheet_title,
        "row_count": len(rows),
        "rows": [asdict(r) for r in rows],
        "headers": header_map,
        "warnings": warnings,
    }


def action_lookup(file_path: str, sheet_name: str | None, client: str, market: str | None) -> dict[str, Any]:
    if not client:
        return {"status": "error", "action": "lookup",
                "error": "--client is required for action=lookup"}

    sheet_title, rows, header_map, warnings = _load_rows(file_path, sheet_name)

    matches: list[RowDict] = []
    for row in rows:
        if not _matches(row.client, client):
            continue
        if market and not _matches(row.market, market):
            continue
        matches.append(row)

    return {
        "status": "ok",
        "action": "lookup",
        "sheet_name": sheet_title,
        "query": {"client": client, "market": market},
        "match_count": len(matches),
        "multiple_matches": len(matches) > 1,
        "rows": [asdict(r) for r in matches],
        "headers": header_map,
        "warnings": warnings,
    }


# ----------------- CLI -----------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read TT Rep Master Client List xlsx.")
    parser.add_argument("--file-path", required=True, help="Local path to the .xlsx file.")
    parser.add_argument("--action", required=True, choices=["lookup", "all", "smoke"])
    parser.add_argument("--client", default=None, help="Client name (case-insensitive contains).")
    parser.add_argument("--market", default=None, help="Optional market filter (case-insensitive contains).")
    parser.add_argument("--sheet", default=None, help="Optional sheet name. Default: first sheet.")
    args = parser.parse_args(argv)

    try:
        if args.action == "smoke":
            result = action_smoke(args.file_path)
        elif args.action == "all":
            result = action_all(args.file_path, args.sheet)
        elif args.action == "lookup":
            result = action_lookup(args.file_path, args.sheet, args.client or "", args.market)
        else:
            result = {"status": "error", "error": f"Unknown action: {args.action}"}
    except FileNotFoundError:
        result = {"status": "error", "action": args.action,
                  "error": f"File not found: {args.file_path}"}
    except Exception as e:  # noqa: BLE001 — surface unexpected errors to the caller as JSON
        result = {"status": "error", "action": args.action,
                  "error": f"{type(e).__name__}: {e}"}

    json.dump(result, sys.stdout, default=str, indent=None)
    sys.stdout.write("\n")
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
