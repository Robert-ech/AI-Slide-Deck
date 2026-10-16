import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Memo } from "./types";

const dataDir = path.join(process.cwd(), "data");
let db: Database.Database | undefined;

function database(): Database.Database {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, "memos.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memos (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      created_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memos_ticker_created_idx ON memos(ticker, created_at DESC);
  `);
  return db;
}

export function saveMemo(memo: Memo): void {
  database()
    .prepare("INSERT OR REPLACE INTO memos(id, ticker, created_at, json) VALUES (?, ?, ?, ?)")
    .run(memo.id, memo.company.ticker, memo.generatedAt, JSON.stringify(memo));
}

export function getMemo(id: string): Memo | null {
  const row = database().prepare("SELECT json FROM memos WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Memo) : null;
}

export function listMemos(): Pick<Memo, "id" | "generatedAt" | "company" | "reviewStatus">[] {
  const rows = database().prepare("SELECT json FROM memos ORDER BY created_at DESC LIMIT 30").all() as { json: string }[];
  return rows.map((row) => {
    const memo = JSON.parse(row.json) as Memo;
    return { id: memo.id, generatedAt: memo.generatedAt, company: memo.company, reviewStatus: memo.reviewStatus };
  });
}
