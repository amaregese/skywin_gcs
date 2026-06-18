import sqlite3
import os
import threading
import time

_db_path = None
local = threading.local()
_local = local


def _get_connection():
    path = _db_path
    if path is None:
        path = os.path.join(os.path.dirname(__file__), "..", "..", "firmware_data.db")
    conn = getattr(_local, "_fw_conn", None)
    if conn is not None:
        return conn
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _local._fw_conn = conn
    return conn


def init_db(path=None):
    conn = _get_connection()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS firmware_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            version TEXT,
            frame TEXT,
            category TEXT DEFAULT 'stable',
            url TEXT UNIQUE,
            checksum_sha256 TEXT,
            file_size INTEGER DEFAULT 0,
            local_path TEXT,
            cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS installation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            board_name TEXT,
            firmware_name TEXT,
            version TEXT,
            status TEXT DEFAULT 'success',
            method TEXT DEFAULT 'uploader',
            details TEXT,
            installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS known_boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            port TEXT,
            board_name TEXT,
            board_type TEXT,
            bootloader TEXT,
            firmware_version TEXT,
            firmware_type TEXT,
            first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()


def cache_firmware(name, version, frame, category, url, checksum, file_size, cached_path):
    conn = _get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO firmware_cache (name, version, frame, category, url, checksum_sha256, file_size, local_path, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (name, version, frame, category, url, checksum, file_size, cached_path, time.strftime('%Y-%m-%d %H:%M:%S'))
    )
    conn.commit()


def get_cached_firmware(category):
    conn = _get_connection()
    rows = conn.execute("SELECT * FROM firmware_cache WHERE category = ? ORDER BY cached_at DESC", (category,)).fetchall()
    return [dict(r) for r in rows]


def record_installation(board_name, firmware_name, version, status='success', method='uploader', details=''):
    conn = _get_connection()
    conn.execute(
        "INSERT INTO installation_history (board_name, firmware_name, version, status, method, details) VALUES (?, ?, ?, ?, ?, ?)",
        (board_name, firmware_name, version, status, method, details)
    )
    conn.commit()


def record_board(port, board_name, board_type, bootloader, firmware_version, firmware_type):
    conn = _get_connection()
    now = time.strftime('%Y-%m-%d %H:%M:%S')
    conn.execute(
        "INSERT OR REPLACE INTO known_boards (port, board_name, board_type, bootloader, firmware_version, firmware_type, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (port, board_name, board_type, bootloader, firmware_version, firmware_type, now)
    )
    conn.commit()


def get_known_boards():
    conn = _get_connection()
    rows = conn.execute("SELECT DISTINCT * FROM known_boards ORDER BY first_seen DESC").fetchall()
    return [dict(r) for r in rows]


def get_installation_history(limit=100):
    conn = _get_connection()
    rows = conn.execute("SELECT * FROM installation_history ORDER BY installed_at DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]
