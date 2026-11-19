"""Writes the CSV fixtures the tests build."""

import csv
import io
from pathlib import Path


def csv_text(rows: list[dict], fields=None) -> str:
    """Rows as CSV, with a header from `fields` (default: the first row's keys)."""
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=fields or list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


def write_csv(path: Path, rows: list[dict], fields=None) -> None:
    path.write_text(csv_text(rows, fields), encoding="utf-8", newline="")
