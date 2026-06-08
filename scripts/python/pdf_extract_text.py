#!/usr/bin/env python3
"""
PDF text extractor for the Hoeck Team Dashboard (Phase 2.5a).

Invoked as a subprocess by lib/external/box/text-extractor.ts. Reads a single
PDF (downloaded locally by the TS worker from Box) and emits JSON to stdout.

Phase 2.5a — TEXT-NATIVE PDFs ONLY.
  Scanned PDFs (image-only) are detected and reported as status="scanned" so
  the caller can record extraction_status='skipped_scanned'. OCR is Phase 2.5b.

Usage:
    python pdf_extract_text.py --file-path /tmp/in.pdf

Returns (stdout, always JSON):
    {
      "status":           "ok" | "scanned" | "too_large" | "error",
      "text":             str | null,
      "page_count":       int,
      "character_count":  int,
      "extraction_method": "pdfplumber",
      "warnings":         [str, ...],
      "error":            str       # status="error" only
    }

Status meanings:
    "ok"         — text-native PDF, text extracted successfully (caller writes
                   extracted_text + extraction_status='extracted')
    "scanned"    — PDF opened successfully but yielded almost no text
                   (< MIN_CHARS_FOR_TEXT_NATIVE across > 1 page).
                   Caller writes extraction_status='skipped_scanned'.
    "too_large"  — file size > MAX_FILE_BYTES; skipped without opening.
                   Caller writes extraction_status='skipped_too_large'.
    "error"      — extraction threw. Caller writes extraction_status='failed'
                   and stores `error` in extraction_error.

Exit codes:
    0 = success (status in {"ok", "scanned", "too_large"})
    1 = extraction error (status == "error")
    2 = argument error
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

# ----- Tunables (mirror these in MEMORY.md if changed) -----

# A text-native PDF should yield at least this many extracted characters across
# its pages combined. Below threshold + multi-page = likely scanned/image-only.
# Single-page PDFs are NOT classified as scanned even when below threshold —
# a one-page cover sheet with just a logo is too ambiguous to flag.
MIN_CHARS_FOR_TEXT_NATIVE: int = 100

# Hard ceiling on file size we'll attempt to read. 50 MB covers >99% of leases.
# Deferring big-file handling avoids OOM on Railway's small worker dynos.
MAX_FILE_BYTES: int = 50 * 1024 * 1024  # 50 MB

EXTRACTION_METHOD = "pdfplumber"


def _emit(payload: dict[str, Any], exit_code: int) -> None:
    """Write JSON to stdout and exit."""
    json.dump(payload, sys.stdout, default=str, indent=None)
    sys.stdout.write("\n")
    sys.exit(exit_code)


def _import_pdfplumber():
    """Lazy import so a missing pdfplumber turns into a clean JSON error
    instead of a Python stack trace. Same pattern as master_excel_read.py."""
    try:
        import pdfplumber  # noqa: PLC0415
        return pdfplumber
    except ImportError as e:
        _emit(
            {
                "status": "error",
                "text": None,
                "page_count": 0,
                "character_count": 0,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": [],
                "error": (
                    f"pdfplumber not installed ({e}). On Railway it ships via nixpacks "
                    "python311.withPackages; locally use a venv and `pip install pdfplumber`."
                ),
            },
            1,
        )


def extract(file_path: str) -> tuple[dict[str, Any], int]:
    """Inspect + extract. Returns (payload, exit_code).

    Split out as a pure function so pytest can call it directly without going
    through argparse + sys.exit.
    """
    warnings: list[str] = []

    # File existence check (FileNotFoundError → clean JSON error)
    if not os.path.isfile(file_path):
        return (
            {
                "status": "error",
                "text": None,
                "page_count": 0,
                "character_count": 0,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": warnings,
                "error": f"File not found: {file_path}",
            },
            1,
        )

    # Size guard FIRST. Avoids opening a 1 GB PDF only to OOM.
    try:
        size = os.path.getsize(file_path)
    except OSError as e:
        return (
            {
                "status": "error",
                "text": None,
                "page_count": 0,
                "character_count": 0,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": warnings,
                "error": f"Could not stat file: {type(e).__name__}: {e}",
            },
            1,
        )

    if size > MAX_FILE_BYTES:
        return (
            {
                "status": "too_large",
                "text": None,
                "page_count": 0,
                "character_count": 0,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": [
                    f"File size {size:,} bytes exceeds MAX_FILE_BYTES "
                    f"({MAX_FILE_BYTES:,} bytes). Skipped without attempting extraction."
                ],
            },
            0,
        )

    pdfplumber = _import_pdfplumber()

    # Open + iterate pages. Wrap in try/except so corrupt PDFs surface as
    # status="error" not a Python crash.
    try:
        text_parts: list[str] = []
        page_count = 0
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                # extract_text() returns None for image-only pages; treat as empty.
                page_text = page.extract_text() or ""
                if page_text:
                    text_parts.append(page_text)
    except Exception as e:  # noqa: BLE001
        return (
            {
                "status": "error",
                "text": None,
                "page_count": 0,
                "character_count": 0,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": warnings,
                "error": f"pdfplumber raised {type(e).__name__}: {e}",
            },
            1,
        )

    full_text = "\n".join(text_parts)
    character_count = len(full_text)

    # Scanned/image-only detection. Two-condition guard so a one-page cover
    # sheet with just a logo doesn't get misflagged.
    if character_count < MIN_CHARS_FOR_TEXT_NATIVE and page_count > 1:
        return (
            {
                "status": "scanned",
                "text": None,
                "page_count": page_count,
                "character_count": character_count,
                "extraction_method": EXTRACTION_METHOD,
                "warnings": [
                    f"Extracted only {character_count} chars across {page_count} pages "
                    f"(threshold: {MIN_CHARS_FOR_TEXT_NATIVE}). Likely image-based / scanned. "
                    f"Phase 2.5b will add OCR."
                ],
            },
            0,
        )

    # Single-page-with-little-text edge case: still ok, just note it.
    if character_count < MIN_CHARS_FOR_TEXT_NATIVE and page_count == 1:
        warnings.append(
            f"Single-page PDF yielded only {character_count} chars. Not flagged as "
            f"scanned (one-page minimum-text PDFs are too ambiguous), but search "
            f"relevance for this file will be near-zero."
        )

    return (
        {
            "status": "ok",
            "text": full_text,
            "page_count": page_count,
            "character_count": character_count,
            "extraction_method": EXTRACTION_METHOD,
            "warnings": warnings,
        },
        0,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract text from a single PDF.")
    parser.add_argument("--file-path", required=True, help="Local path to the .pdf file.")
    args = parser.parse_args(argv)

    payload, exit_code = extract(args.file_path)
    _emit(payload, exit_code)
    return exit_code  # unreachable — _emit calls sys.exit, but satisfies type checker


if __name__ == "__main__":
    sys.exit(main())
