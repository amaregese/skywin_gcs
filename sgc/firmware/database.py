import sqlite3
import os
import threading
import time

_db_path = None
_local = threading.local()


def _get_connection():
    path = _db_path or os.path.join(os.path.dirname(__file__), "..", "..", "firmware.db")
    path = os.path.abspath(path)
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(path)
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db(path=None):
    global _db_path
    if path:
        _db_path = os.path.abspath(path)
    conn = _get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS firmware_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            frame TEXT,
            category TEXT NOT NULL DEFAULT 'stable',
            url TEXT NOT NULL,
            checksum_sha256 TEXT,
            file_size INTEGER DEFAULT 0,
            cached_path TEXT,
            cached_at REAL,
            UNIQUE(name, version, category, frame)
        );
        CREATE TABLE IF NOT EXISTS installed_firmware_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_name TEXT NOT NULL,
            firmware_name TEXT NOT NULL,
            version TEXT NOT NULL,
            installed_at REAL NOT NULL,
            status TEXT DEFAULT 'success',
            method TEXT DEFAULT 'flash',
            details TEXT
        );
        CREATE TABLE IF NOT EXISTS downloaded_firmware (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            frame TEXT,
            category TEXT,
            url TEXT,
            local_path TEXT NOT NULL,
            checksum_sha256 TEXT,
            downloaded_at REAL NOT NULL,
            file_size INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS connected_boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            port TEXT NOT NULL,
            board_name TEXT NOT NULL,
            board_type TEXT,
            bootloader INTEGER DEFAULT 0,
            first_seen REAL NOT NULL,
            last_seen REAL NOT NULL,
            firmware_version TEXT,
            firmware_type TEXT,
            UNIQUE(port)
        );
    """)
    conn.commit()


def cache_firmware(name, version, frame, category, url, checksum=None, file_size=0, cached_path=None):
    conn = _get_connection()
    conn.execute("""
        INSERT OR REPLACE INTO firmware_cache
            (name, version, frame, category, url, checksum_sha256, file_size, cached_path, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (name, version, frame, category, url, checksum, file_size, cached_path, time.time()))
    conn.commit()


def get_cached_firmware(category="stable"):
    conn = _get_connection()
    rows = conn.execute(
        "SELECT * FROM firmware_cache WHERE category = ? ORDER BY name, version DESC",
        (category,)
    ).fetchall()
    return [dict(r) for r in rows]


def record_installation(board_name, firmware_name, version, status="success", method="flash", details=None):
    conn = _get_connection()
    conn.execute("""
        INSERT INTO installed_firmware_history
            (board_name, firmware_name, version, installed_at, status, method, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (board_name, firmware_name, version, time.time(), status, method, details))
    conn.commit()


def record_board(port, board_name, board_type=None, bootloader=False, firmware_version=None, firmware_type=None):
    conn = _get_connection()
    now = time.time()
    conn.execute("""
        INSERT OR REPLACE INTO connected_boards
            (port, board_name, board_type, bootloader, first_seen, last_seen,
             firmware_version, firmware_type)
        VALUES (?, ?, ?, ?, COALESCE((SELECT first_seen FROM connected_boards WHERE port = ?), ?), ?, ?, ?)
    """, (port, board_name, board_type, 1 if bootloader else 0,
          port, now, now, firmware_version, firmware_type))
    conn.commit()


def get_known_boards():
    conn = _get_connection()
    rows = conn.execute(
        "SELECT * FROM connected_boards ORDER BY last_seen DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def get_installation_history(limit=50):
    conn = _get_connection()
    rows = conn.execute(
        "SELECT * FROM installed_firmware_history ORDER BY installed_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]
