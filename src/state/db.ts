// SQLite access via Node's built-in node:sqlite (DatabaseSync). Numbered .sql migrations
// in ./migrations are applied in order and recorded in schema_migrations.
// VERIFY node:sqlite's stability status for your Node version in the official Node docs.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { InstantClock } from '../domain/dates.js';

export type Db = DatabaseSync;
export type Row = Record<string, unknown>;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Open (and create) a writable database. Parent folders are created. */
export function openDatabase(dbPath: string): Db {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  // Rollback journal, NOT WAL (D-066): in WAL mode even a read-only connection creates -wal/-shm
  // files, which would break the dry run's zero-writes guarantee. Also converts an older WAL database.
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Open read-only for dry runs. Returns null when no database exists yet (and creates nothing). */
export function openDatabaseReadOnly(dbPath: string): Db | null {
  if (!existsSync(dbPath)) return null;
  return new DatabaseSync(dbPath, { readOnly: true });
}

export function listMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

/** Apply pending migrations in order; returns the ids applied now. */
export function migrate(db: Db, clock: InstantClock, dir = MIGRATIONS_DIR): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(all(db, 'SELECT id FROM schema_migrations').map((row) => String(row.id)));
  const appliedNow: string[] = [];
  for (const file of listMigrationFiles(dir)) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    transaction(db, () => {
      db.exec(readFileSync(path.join(dir, file), 'utf8'));
      run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', id, clock.now().toISOString());
    });
    appliedNow.push(id);
  }
  return appliedNow;
}

/** Run fn inside BEGIN IMMEDIATE ... COMMIT; any throw rolls everything back. fn must be synchronous. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
  const result = db.prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export function get(db: Db, sql: string, ...params: SQLInputValue[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export function all(db: Db, sql: string, ...params: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
