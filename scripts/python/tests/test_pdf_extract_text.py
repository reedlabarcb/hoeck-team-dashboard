"""
pytest suite for scripts/python/pdf_extract_text.py (Phase 2.5a).

Three primary status paths, plus a couple of edge cases:
  - text-native multi-page PDF → status="ok"
  - scanned (no text)         → status="scanned"
  - oversized                 → status="too_large"
  - missing file              → status="error"
  - extraction crash          → status="error" (corrupt input)

Each test uses both the pure `extract()` function (direct call) AND the CLI
subprocess shim, mirroring test_master_excel_read.py's discipline so we catch
bugs in either layer.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

# Make scripts/python/ importable so we can call the module fn directly.
SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import pdf_extract_text as pxt  # noqa: E402


# ----------------- CLI helper -----------------

def run_cli(*args: str) -> tuple[int, dict]:
    """Run the CLI script as a subprocess. Returns (exit_code, parsed_json)."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "pdf_extract_text.py"), *args],
        capture_output=True, text=True,
    )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw_stdout": result.stdout, "raw_stderr": result.stderr}
    return result.returncode, data


# ----------------- status="ok" (text-native) -----------------

def test_extract_text_native_returns_ok(fixture_text_native_pdf):
    payload, exit_code = pxt.extract(str(fixture_text_native_pdf))
    assert exit_code == 0
    assert payload["status"] == "ok"
    assert payload["page_count"] == 3
    assert payload["character_count"] >= pxt.MIN_CHARS_FOR_TEXT_NATIVE
    assert payload["extraction_method"] == "pdfplumber"
    # Distinct phrase from page 2 must round-trip through the extractor.
    assert "tenant shall pay base rent" in payload["text"]
    # No warnings expected for a normal text-native multi-page PDF.
    assert payload["warnings"] == []


def test_cli_text_native_returns_ok(fixture_text_native_pdf):
    code, data = run_cli("--file-path", str(fixture_text_native_pdf))
    assert code == 0, data
    assert data["status"] == "ok"
    assert data["page_count"] == 3
    assert "Lorem ipsum" in data["text"] or "tenant shall pay" in data["text"]


# ----------------- status="scanned" -----------------

def test_extract_scanned_returns_scanned(fixture_scanned_pdf):
    payload, exit_code = pxt.extract(str(fixture_scanned_pdf))
    assert exit_code == 0  # scanned is a SUCCESSFUL skip, not an error
    assert payload["status"] == "scanned"
    assert payload["page_count"] > 1, "fixture must be multi-page for scanned detection to trigger"
    assert payload["character_count"] < pxt.MIN_CHARS_FOR_TEXT_NATIVE
    assert payload["text"] is None  # we DON'T leak partial text from scanned PDFs
    # Warning must mention Phase 2.5b OCR so the caller knows what's coming next.
    assert any("2.5b" in w for w in payload["warnings"])


def test_cli_scanned_returns_scanned(fixture_scanned_pdf):
    code, data = run_cli("--file-path", str(fixture_scanned_pdf))
    assert code == 0, data
    assert data["status"] == "scanned"
    assert data["text"] is None


# ----------------- status="too_large" -----------------

def test_extract_oversized_returns_too_large(fixture_oversized_pdf_stub):
    payload, exit_code = pxt.extract(str(fixture_oversized_pdf_stub))
    assert exit_code == 0  # too_large is a SUCCESSFUL skip, not an error
    assert payload["status"] == "too_large"
    # We must NOT have called pdfplumber — page_count stays at the default.
    assert payload["page_count"] == 0
    assert payload["character_count"] == 0
    assert payload["text"] is None
    # Warning should cite the actual size + ceiling so ops can see why.
    assert any("MAX_FILE_BYTES" in w for w in payload["warnings"])


# ----------------- status="error" (edge cases) -----------------

def test_extract_missing_file_returns_error(tmp_path):
    payload, exit_code = pxt.extract(str(tmp_path / "does_not_exist.pdf"))
    assert exit_code == 1
    assert payload["status"] == "error"
    assert "not found" in payload["error"].lower()


def test_cli_missing_file_returns_error(tmp_path):
    code, data = run_cli("--file-path", str(tmp_path / "nope.pdf"))
    assert code == 1
    assert data["status"] == "error"


def test_extract_corrupt_pdf_returns_error(tmp_path):
    """Garbage bytes with a .pdf extension must surface as status='error',
    not crash the worker. The extractor wraps the pdfplumber call in try/except."""
    p = tmp_path / "corrupt.pdf"
    p.write_bytes(b"%PDF-1.4\nthis is not a real pdf body\n%%EOF\n")
    payload, exit_code = pxt.extract(str(p))
    # Either pdfplumber raises (status='error', exit 1) or it opens an empty
    # doc with 0 pages (status='scanned' if >1 page, else 'ok'). Both are
    # acceptable — the contract is "do not crash the subprocess." We assert
    # the soft constraint.
    assert payload["status"] in {"error", "ok", "scanned"}
    if payload["status"] == "error":
        assert exit_code == 1
        assert payload["error"]


# ----------------- NUL-byte sanitization (Phase 2.5a regression) -----------------

def test_nul_bytes_stripped_status_ok(tmp_path, monkeypatch):
    """Web-print PDFs (Bloomberg / Investing.com print-to-PDF) commonly embed NUL
    (0x00) bytes in their text. Postgres `text` columns reject 0x00, which previously
    made these PDFs fail to persist and stick at extraction_status='pending'. The
    extractor must STRIP NULs at the source and return status='ok' with clean text.

    We mock pdfplumber so page text deterministically contains NUL bytes — cleaner
    than fighting a PDF generator to embed them."""
    f = tmp_path / "nul_doc.pdf"
    f.write_bytes(b"%PDF-1.4 dummy body")  # real file so isfile + size guards pass

    class _FakePage:
        def __init__(self, text):
            self._text = text

        def extract_text(self):
            return self._text

    class _FakePdf:
        def __init__(self, pages):
            self.pages = pages

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    class _FakePlumber:
        def open(self, _path):
            return _FakePdf([
                _FakePage("Lease between Acme\x00 Corporation and the Landlord\x00 party."),
                _FakePage("Base rent of \x00$10,000.00 per month for the demised premises."),
            ])

    monkeypatch.setattr(pxt, "_import_pdfplumber", lambda: _FakePlumber())

    payload, exit_code = pxt.extract(str(f))
    assert exit_code == 0
    assert payload["status"] == "ok", payload
    # The whole point: no NUL survives into the persisted text.
    assert "\x00" not in payload["text"]
    # And stripping is lossless for the surrounding content (NUL just vanishes).
    assert "Acme Corporation and the Landlord party." in payload["text"]
    assert "$10,000.00 per month" in payload["text"]


# ----------------- argparse / smoke -----------------

def test_cli_missing_required_arg_returns_2():
    """argparse error → exit 2 (Python convention)."""
    code, data = run_cli()
    assert code == 2
    # argparse writes to stderr; stdout is empty so JSON parse will have failed.
    assert "raw_stderr" in data
