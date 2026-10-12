import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const BREW_SQLITE = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
export const DIM = 768;

// bun:sqlite allows setCustomSQLite exactly once per process, before the
// first Database is opened. Guard so repeated openDb() calls (e.g. one per
// test) don't throw "SQLite already loaded".
let customSqliteSet = false;

export function openDb(path = ":memory:"): Database {
  if (!customSqliteSet) {
    Database.setCustomSQLite(BREW_SQLITE);
    customSqliteSet = true;
  }
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS snippets (
      id INTEGER PRIMARY KEY,
      captured_at INTEGER NOT NULL,
      app TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts
      USING fts5(text, content='snippets', content_rowid='id');
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_snippets
      USING vec0(embedding float[${DIM}]);
    CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
      INSERT INTO snippets_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `);
  return db;
}

export function insertSnippet(
  db: Database,
  s: { capturedAt: number; app: string; text: string; embedding: Float32Array },
): number {
  const row = db
    .prepare("INSERT INTO snippets (captured_at, app, text) VALUES (?, ?, ?) RETURNING id")
    .get(s.capturedAt, s.app, s.text) as { id: number };
  db.prepare("INSERT INTO vec_snippets (rowid, embedding) VALUES (?, ?)")
    .run(row.id, s.embedding);
  return row.id;
}
