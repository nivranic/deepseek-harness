/**
 * Schema and open sequence for the Device Trust SQLite store: the on-disk
 * layout version, the owner-only file creation, and the device, pairing, and
 * host-identity tables.
 * @module @deepseek-ai/dsh-device-trust/schema
 */

import { mkdir, open } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'

/**
 * The on-disk layout version, stored in `PRAGMA user_version`. Bumped only on
 * a breaking change to the table layout; any other stamped version rejects —
 * this unreleased format has no migrations.
 */
export const DEVICE_TRUST_SCHEMA_VERSION = 1

/* jscpd:ignore-start -- deliberately mirrors the storage-sqlite /
   session-persistence-sqlite open sequence; the shared medium helper is
   deferred so the existing packages stay untouched by this addition. */
/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes; errors other than `EEXIST` propagate.
 * `DatabaseSync` reopens by path, so this does not protect confidentiality or
 * integrity when another principal can replace the database entry in its
 * parent directory.
 * @param path - database file about to open.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    /* v8 ignore next 2 -- only a non-EEXIST obstruction rejects, for example a directory at the path. */
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the database and apply its schema and pragmas. Missing directories and
 * database files are created owner-only (`:memory:` skips filesystem setup).
 * A zero `user_version` is stamped with {@link DEVICE_TRUST_SCHEMA_VERSION};
 * every other non-current version rejects rather than being migrated in place.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @returns the open handle with pragmas applied and the trust tables ensured.
 */
export async function openDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configureDatabase(db, actual)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  // `PRAGMA user_version` always returns exactly one row { user_version }.
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== DEVICE_TRUST_SCHEMA_VERSION) {
    throw new Error(
      `device trust database at "${path}" has schema version ${onDisk}, incompatible with this build (${DEVICE_TRUST_SCHEMA_VERSION})`,
    )
  }
  /* jscpd:ignore-end */
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id        TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      public_key_spki  TEXT NOT NULL,
      role             TEXT NOT NULL,
      created_at       INTEGER NOT NULL,
      last_seen_at     INTEGER,
      revoked_at       INTEGER
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_pairings (
      code_hash  TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    ) STRICT
  `)
  if (onDisk === 0) {
    // Stamp fresh databases LAST: the stamp asserts the layout is complete,
    // so a failure above must leave the medium unstamped.
    db.exec(`PRAGMA user_version = ${DEVICE_TRUST_SCHEMA_VERSION}`)
  }
}
