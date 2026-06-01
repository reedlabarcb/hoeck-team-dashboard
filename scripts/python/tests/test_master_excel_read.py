"""
pytest suite for scripts/python/master_excel_read.py.

Covers all three actions (lookup, all, smoke) plus edge cases:
- standard sheet shape
- title rows before header
- shuffled column order
- empty sheet
- missing header row
- multi-market client (multiple matches)
- market filter
- fuzzy contains match
- missing columns warning
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Make the script directory importable so we can also call the python module functions
# directly without going through subprocess. Tests use BOTH paths so we catch issues
# in either the lib logic or the CLI shim.
SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import master_excel_read as mxr  # noqa: E402


# ----------------- CLI helper -----------------

def run_cli(*args: str) -> tuple[int, dict]:
    """Run the CLI script as a subprocess. Returns (exit_code, parsed_json)."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "master_excel_read.py"), *args],
        capture_output=True, text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw_stdout": result.stdout, "raw_stderr": result.stderr}
    return result.returncode, data


# ----------------- action=smoke -----------------

def test_smoke_returns_sheet_metadata(fixture_standard):
    result = mxr.action_smoke(str(fixture_standard))
    assert result["status"] == "ok"
    assert result["action"] == "smoke"
    assert result["sheet_count"] == 1
    assert "Master List" in result["sheet_names"]
    assert result["primary_sheet"] == "Master List"
    assert result["primary_row_count"] >= 6  # header + ≥5 data rows


def test_smoke_cli(fixture_standard):
    code, data = run_cli("--file-path", str(fixture_standard), "--action", "smoke")
    assert code == 0
    assert data["status"] == "ok"
    assert data["sheet_count"] == 1


def test_smoke_missing_file_returns_error_json():
    code, data = run_cli("--file-path", "/nonexistent/path.xlsx", "--action", "smoke")
    assert code == 1
    assert data["status"] == "error"
    assert "not found" in data["error"].lower()


# ----------------- action=all -----------------

def test_all_returns_every_row(fixture_standard):
    result = mxr.action_all(str(fixture_standard), None)
    assert result["status"] == "ok"
    # Standard fixture has 5 real data rows (Procopio×2, Northwestern, ACME, Care Solace);
    # the blank row should be skipped (no client column).
    assert result["row_count"] == 5
    clients = {r["client"] for r in result["rows"]}
    assert "Procopio" in clients
    assert "Northwestern Mutual - MT" in clients
    assert "ACME" in clients
    assert "Care Solace" in clients


def test_all_extracts_market_from_parens(fixture_standard):
    result = mxr.action_all(str(fixture_standard), None)
    procopio_rows = [r for r in result["rows"] if r["client"] == "Procopio"]
    assert len(procopio_rows) == 2
    markets = {r["market"] for r in procopio_rows}
    # DC came from parens; Scottsdale came from explicit Market column
    assert markets == {"DC", "Scottsdale"}


def test_all_extracts_dates_as_iso_strings(fixture_standard):
    result = mxr.action_all(str(fixture_standard), None)
    procopio_dc = next(r for r in result["rows"] if r["client"] == "Procopio" and r["market"] == "DC")
    assert procopio_dc["lease_expiration"].startswith("2028-07-31")
    assert procopio_dc["renewal_window_start"].startswith("2027-01-01")
    assert procopio_dc["renewal_window_end"].startswith("2027-07-28")
    assert procopio_dc["renewal_deadline"].startswith("2027-07-28")


def test_all_handles_empty_cells(fixture_standard):
    result = mxr.action_all(str(fixture_standard), None)
    nw = next(r for r in result["rows"] if r["client"].startswith("Northwestern"))
    assert nw["lease_expiration"] is None
    assert nw["renewal_deadline"] is None
    assert nw["space_sf"] is None


def test_all_handles_title_rows_before_header(fixture_with_title_rows):
    result = mxr.action_all(str(fixture_with_title_rows), None)
    assert result["status"] == "ok"
    assert result["row_count"] == 1
    assert result["rows"][0]["client"] == "Procopio"


def test_all_handles_column_reorder(fixture_column_reorder):
    result = mxr.action_all(str(fixture_column_reorder), None)
    assert result["status"] == "ok"
    assert result["row_count"] == 1
    row = result["rows"][0]
    assert row["client"] == "Procopio"
    assert row["market"] == "DC"
    assert row["address"] == "525 B Street, San Diego, CA"
    assert row["space_sf"] == 8000.0
    assert row["lease_expiration"].startswith("2028-07-31")


def test_all_empty_sheet_returns_zero_rows_with_warning(fixture_empty_sheet):
    result = mxr.action_all(str(fixture_empty_sheet), None)
    assert result["status"] == "ok"
    assert result["row_count"] == 0
    assert len(result["warnings"]) >= 1


def test_all_no_header_returns_zero_rows_with_warning(fixture_no_header):
    result = mxr.action_all(str(fixture_no_header), None)
    assert result["status"] == "ok"
    assert result["row_count"] == 0
    assert any("Client column" in w for w in result["warnings"])


# ----------------- action=lookup -----------------

def test_lookup_exact_client_single_match(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "ACME", None)
    assert result["status"] == "ok"
    assert result["match_count"] == 1
    assert result["multiple_matches"] is False
    assert result["rows"][0]["client"] == "ACME"


def test_lookup_multiple_matches_flag(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "Procopio", None)
    assert result["status"] == "ok"
    assert result["match_count"] == 2
    assert result["multiple_matches"] is True
    assert {r["market"] for r in result["rows"]} == {"DC", "Scottsdale"}


def test_lookup_with_market_filter_narrows_to_one(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "Procopio", "DC")
    assert result["status"] == "ok"
    assert result["match_count"] == 1
    assert result["multiple_matches"] is False
    assert result["rows"][0]["market"] == "DC"


def test_lookup_fuzzy_contains_match(fixture_standard):
    """Searching 'proc' should still find Procopio."""
    result = mxr.action_lookup(str(fixture_standard), None, "proc", None)
    assert result["status"] == "ok"
    assert result["match_count"] == 2


def test_lookup_case_insensitive(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "PROCOPIO", None)
    assert result["match_count"] == 2


def test_lookup_no_match_returns_empty(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "NoSuchClient", None)
    assert result["status"] == "ok"
    assert result["match_count"] == 0
    assert result["rows"] == []
    assert result["multiple_matches"] is False


def test_lookup_market_case_insensitive(fixture_standard):
    result = mxr.action_lookup(str(fixture_standard), None, "Procopio", "dc")
    assert result["match_count"] == 1


def test_lookup_missing_client_arg_returns_error():
    result = mxr.action_lookup("/dev/null", None, "", None)
    assert result["status"] == "error"
    assert "--client" in result["error"]


def test_lookup_cli_roundtrip(fixture_standard):
    code, data = run_cli(
        "--file-path", str(fixture_standard),
        "--action", "lookup",
        "--client", "Procopio",
        "--market", "DC",
    )
    assert code == 0
    assert data["status"] == "ok"
    assert data["match_count"] == 1
    assert data["rows"][0]["client"] == "Procopio"
    assert data["rows"][0]["market"] == "DC"


# ----------------- helpers -----------------

def test_extract_market_from_parens():
    assert mxr._extract_market_from_client("Procopio (DC)") == ("Procopio", "DC")
    assert mxr._extract_market_from_client("Procopio (Lake Oswego, OR)") == ("Procopio", "Lake Oswego, OR")
    assert mxr._extract_market_from_client("ACME") == ("ACME", None)
    assert mxr._extract_market_from_client(None) == (None, None)
    assert mxr._extract_market_from_client("Northwestern Mutual - MT") == ("Northwestern Mutual - MT", None)


def test_matches_case_insensitive_contains():
    assert mxr._matches("Procopio Inc.", "PROC")
    assert mxr._matches("Procopio Inc.", "inc")
    assert not mxr._matches("Procopio Inc.", "Acme")
    assert not mxr._matches(None, "anything")
    assert not mxr._matches("anything", "")


def test_cli_with_no_args_returns_argparse_error():
    code, data = run_cli()
    assert code == 2  # argparse error
