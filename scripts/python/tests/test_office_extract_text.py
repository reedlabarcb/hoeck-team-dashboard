"""
pytest suite for scripts/python/office_extract_text.py (.docx + .xlsx).

The contract with lib/external/box/text-extractor.ts is the point of these tests: the
office extractor MUST emit the same JSON keys, the same status enum, and the same exit
codes as pdf_extract_text.py, because the TS worker maps status -> extraction_status
with one shared code path. A contract drift here writes wrong rows to the DB.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import office_extract_text as oxt  # noqa: E402
import pdf_extract_text as pxt  # noqa: E402


def run_cli(*args: str) -> tuple[int, dict]:
    """Run the CLI as a subprocess — the same way text-extractor.ts spawns it."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "office_extract_text.py"), *args],
        capture_output=True, text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw_stdout": result.stdout, "raw_stderr": result.stderr}
    return result.returncode, data


# ----------------- contract parity with the PDF extractor -----------------

REQUIRED_KEYS = {"status", "text", "page_count", "character_count", "extraction_method", "warnings"}


def test_contract_keys_match_pdf_extractor(fixture_docx, tmp_path):
    """Both extractors emit the same key set — the TS worker reads ONE shape for both."""
    office_payload, office_code = oxt.extract(str(fixture_docx))
    pdf_payload, pdf_code = pxt.extract(str(tmp_path / "nope.pdf"))  # error path
    assert REQUIRED_KEYS.issubset(office_payload.keys())
    assert REQUIRED_KEYS.issubset(pdf_payload.keys())
    assert office_code == 0
    assert pdf_code == 1  # missing file -> error, exit 1 (same convention both sides)


def test_status_enum_is_a_subset_of_the_pdf_statuses(fixture_docx, fixture_docx_empty, tmp_path):
    """No new status values — extraction_status mapping in TS covers exactly these."""
    allowed = {"ok", "scanned", "too_large", "error"}
    for path in (str(fixture_docx), str(fixture_docx_empty), str(tmp_path / "missing.docx")):
        payload, _ = oxt.extract(path)
        assert payload["status"] in allowed


def test_error_payload_carries_an_error_key_and_exit_1(tmp_path):
    payload, code = oxt.extract(str(tmp_path / "does-not-exist.docx"))
    assert payload["status"] == "error"
    assert "not found" in payload["error"].lower()
    assert payload["text"] is None
    assert code == 1


def test_unsupported_extension_is_a_clean_error_not_a_crash(tmp_path):
    """A .pdf routed here by mistake must fail as data, not blow up the worker."""
    stray = tmp_path / "lease.pdf"
    stray.write_bytes(b"%PDF-1.4 stub")
    payload, code = oxt.extract(str(stray))
    assert payload["status"] == "error"
    assert "unsupported extension" in payload["error"].lower()
    assert code == 1


# ----------------- .docx -----------------

def test_docx_extracts_paragraphs_AND_table_cells(fixture_docx):
    payload, code = oxt.extract(str(fixture_docx))
    assert code == 0
    assert payload["status"] == "ok"
    assert payload["extraction_method"] == "python-docx"
    text = payload["text"]
    # Paragraph content
    assert "LEASE AGREEMENT" in text
    assert "base rent monthly" in text
    # TABLE content — the bit a paragraphs-only extractor would drop
    assert "Option Dates Open" in text
    assert "2027-01-01" in text
    assert "Rentable SF" in text
    assert "21347" in text
    assert payload["character_count"] == len(text)
    # .docx has no page count without rendering → 0, which the caller stores as NULL
    assert payload["page_count"] == 0


def test_docx_with_no_text_is_scanned_not_ok(fixture_docx_empty):
    payload, code = oxt.extract(str(fixture_docx_empty))
    assert payload["status"] == "scanned"  # → extraction_status='skipped_scanned'
    assert payload["text"] is None
    assert code == 0  # a skip is not a failure
    assert payload["warnings"]


def test_docx_cli_roundtrip(fixture_docx):
    code, data = run_cli("--file-path", str(fixture_docx))
    assert code == 0
    assert data["status"] == "ok"
    assert "Option Dates Open" in data["text"]


# ----------------- .xlsx -----------------

def test_xlsx_reads_every_sheet_including_sheet_names(fixture_xlsx_multisheet):
    payload, code = oxt.extract(str(fixture_xlsx_multisheet))
    assert code == 0
    assert payload["status"] == "ok"
    assert payload["extraction_method"] == "openpyxl"
    text = payload["text"]
    # Sheet 1 cells
    assert "Procopio" in text
    assert "Suite 400" in text
    assert "8000" in text
    # Sheet 2 reached too (multi-sheet walk), and sheet NAMES are indexed
    assert "Renewals 2027" in text
    assert "Totals" in text
    assert "Total SF" in text
    assert payload["page_count"] == 2  # sheet count


def test_xlsx_uses_data_only_so_formula_STRINGS_never_leak(fixture_xlsx_multisheet):
    """data_only=True means we index cached VALUES. openpyxl writes no cache for a
    formula, so the cell is None here — the thing that must never happen is emitting
    the formula source ("=SUM(...)"), which would index gibberish."""
    payload, _ = oxt.extract(str(fixture_xlsx_multisheet))
    assert "=SUM" not in payload["text"]
    assert "SUM('Renewals 2027'" not in payload["text"]


def test_xlsx_sheet_name_alone_counts_as_content(fixture_xlsx_empty):
    """A cell-less workbook still has a sheet name, which is real content."""
    payload, code = oxt.extract(str(fixture_xlsx_empty))
    assert code == 0
    assert payload["status"] == "ok"
    assert "Blank Tab" in payload["text"]


def test_xlsx_cli_roundtrip(fixture_xlsx_multisheet):
    code, data = run_cli("--file-path", str(fixture_xlsx_multisheet))
    assert code == 0
    assert data["status"] == "ok"
    assert "Procopio" in data["text"]


# ----------------- guards -----------------

def test_size_guard_applies_to_office_files(fixture_docx, monkeypatch):
    """The 50 MB ceiling is enforced for .docx/.xlsx exactly as for PDFs, and BEFORE
    the file is opened (a 1 GB workbook must never be loaded just to be rejected)."""
    assert oxt.MAX_FILE_BYTES == pxt.MAX_FILE_BYTES  # same ceiling as the PDF path

    import os as _os
    real_getsize = _os.path.getsize

    def fake_getsize(p):
        if str(p) == str(fixture_docx):
            return oxt.MAX_FILE_BYTES + 1
        return real_getsize(p)

    monkeypatch.setattr(_os.path, "getsize", fake_getsize)
    payload, code = oxt.extract(str(fixture_docx))
    assert payload["status"] == "too_large"  # → extraction_status='skipped_too_large'
    assert payload["text"] is None
    assert code == 0
    assert "exceeds MAX_FILE_BYTES" in payload["warnings"][0]


def test_workbook_cell_cap_bails_to_too_large(fixture_xlsx_multisheet, monkeypatch):
    """A file can pass the byte guard and still expand to too many cells."""
    monkeypatch.setattr(oxt, "MAX_CELLS", 1)
    payload, code = oxt.extract(str(fixture_xlsx_multisheet))
    assert payload["status"] == "too_large"
    assert code == 0
    assert "MAX_CELLS" in payload["warnings"][0]


def test_nul_bytes_are_stripped(fixture_docx):
    """Postgres text columns reject 0x00. Same source-side strip as the PDF extractor."""
    assert "\x00" not in (oxt.extract(str(fixture_docx))[0]["text"] or "")
    assert oxt._clean("a\x00b") == "ab"
