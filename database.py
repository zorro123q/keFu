"""SQLite database helper for the marketing platform.

This module wraps the built‑in ``sqlite3`` library with a few
convenience functions for executing queries and returning results
as dictionaries.  It also exposes a function to initialise the
schema on startup.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get(
    "DATABASE_PATH", os.path.join(BASE_DIR, "database.db")
)


def init_db() -> None:
    """Create the database and tables if they do not already exist."""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                phone TEXT,
                wechat TEXT,
                qq TEXT,
                company TEXT,
                position TEXT,
                industry TEXT,
                region TEXT,
                channel TEXT,
                collected_time TEXT,
                add_status TEXT,
                group_name TEXT,
                intention TEXT,
                remarks TEXT,
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT,
                scene TEXT,
                is_active INTEGER,
                created_at TEXT,
                updated_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS message_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER,
                send_time TEXT,
                send_type TEXT,
                message_content TEXT,
                status TEXT,
                error TEXT,
                created_at TEXT,
                FOREIGN KEY(customer_id) REFERENCES customers(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS command_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command_content TEXT,
                standardized_command TEXT,
                account TEXT,
                time TEXT,
                status TEXT,
                result TEXT,
                error TEXT,
                duration INTEGER,
                created_at TEXT
            )
            """
        )
        conn.commit()


@contextmanager
def get_conn() -> Iterable[sqlite3.Connection]:
    """Context manager yielding a SQLite connection with row dicts.

    The connection is configured so that ``cursor.fetchall()`` returns
    rows as dictionaries rather than tuples.  The connection is
    automatically closed when the context exits.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def execute(query: str, params: Iterable[Any] = ()) -> int:
    """Execute a write operation and return the last row id."""
    with get_conn() as conn:
        cur = conn.execute(query, params)
        conn.commit()
        return cur.lastrowid


def fetchall(query: str, params: Iterable[Any] = ()) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        cur = conn.execute(query, params)
        rows = [dict(row) for row in cur.fetchall()]
    return rows


def fetchone(query: str, params: Iterable[Any] = ()) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        cur = conn.execute(query, params)
        row = cur.fetchone()
        return dict(row) if row else None
