"""Utility functions for working with files and directories."""

from __future__ import annotations

import locale
import platform
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

try:
    locale.setlocale(locale.LC_ALL, "")
except locale.Error:
    locale.setlocale(locale.LC_ALL, "C")

_CHUNK_SIZE = 1024  # bytes


def _get_preferred_encodings() -> list[str]:
    """Get list of encodings to try, prioritized for the current platform.

    Returns
    -------
    list[str]
        List of encoding names to try in priority order, starting with the
        platform's default encoding followed by common fallback encodings.

    """
    encodings = [locale.getpreferredencoding(), "utf-8", "utf-16", "utf-16le", "utf-8-sig", "latin"]
    if platform.system() == "Windows":
        encodings += ["cp1252", "iso-8859-1"]
    return list(dict.fromkeys(encodings))


def _read_chunk(path: Path) -> bytes | None:
    """Attempt to read the first *size* bytes of *path* in binary mode.

    Parameters
    ----------
    path : Path
        The path to the file to read.

    Returns
    -------
    bytes | None
        The first ``_CHUNK_SIZE`` bytes of ``path``, or ``None`` on any ``OSError``.

    """
    try:
        with path.open("rb") as fp:
            return fp.read(_CHUNK_SIZE)
    except OSError:
        return None


def _decodes(chunk: bytes, encoding: str) -> bool:
    """Return ``True`` if ``chunk`` decodes cleanly with ``encoding``.

    Parameters
    ----------
    chunk : bytes
        The chunk of bytes to decode.
    encoding : str
        The encoding to use to decode the chunk.

    Returns
    -------
    bool
        ``True`` if the chunk decodes cleanly with the encoding, ``False`` otherwise.

    """
    try:
        chunk.decode(encoding)
    except UnicodeDecodeError:
        return False
    return True


def format_binary_content(path: Path, max_bytes: int = 16384) -> str:
    """Format binary file contents cleanly for LLM consumption.

    Prevents raw corrupted unicode output (e.g. /clF) and instead provides
    clean file metadata, file size, and a formatted hex dump.

    Parameters
    ----------
    path : Path
        The path to the binary file.
    max_bytes : int
        Maximum number of bytes to include in the hex dump preview (default: 16 KB).

    Returns
    -------
    str
        Human and LLM readable representation of the binary file.

    """
    try:
        size = path.stat().st_size
    except OSError:
        size = 0

    try:
        with path.open("rb") as fp:
            data = fp.read(max_bytes + 1)
    except OSError as exc:
        return f"[Binary file | Size: {size} bytes | Error reading file: {exc}]"

    truncated = len(data) > max_bytes
    if truncated:
        data = data[:max_bytes]

    lines = [f"[Binary file | Size: {size} bytes | Format: Hex Dump]"]
    if truncated:
        lines.append(f"[Showing first {len(data)} of {size} bytes]")

    # Generate standard 16-byte hex dump
    for offset in range(0, len(data), 16):
        chunk = data[offset : offset + 16]
        hex_bytes = " ".join(f"{b:02x}" for b in chunk)
        # Pad hex bytes if less than 16
        hex_bytes = f"{hex_bytes:<48}"
        ascii_text = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append(f"{offset:08x}  {hex_bytes}  |{ascii_text}|")

    return "\n".join(lines)

