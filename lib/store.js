'use strict';

/**
 * Persistence layer.
 *
 * Prefers SQLite via the built-in `node:sqlite` module (Node 22.5+ / 24+).
 * Falls back to an atomic JSON file when SQLite is unavailable, so the
 * prototype runs anywhere with zero install steps.
 *
 * Stored:
 *   - latest dashboard snapshot (single-row key/value state blob)
 *   - latest state for each constituent (inside that blob, keyed by ticker)
 *   - append-only event history
 *   - last successful update time
 */

const fs = require('fs');
const path = require('path');
const { emptyState } = require('./normalize');

const MAX_EVENTS = 5000;

/* ------------------------------------------------------------------ SQLite */

function openSqlite(file) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT NOT NULL,
        received_at TEXT NOT NULL,
        event TEXT NOT NULL,
        ticker TEXT,
        state TEXT,
        score REAL,
        transmission TEXT,
        index_risk REAL,
        index_risk_state TEXT,
        raw TEXT
      );
      CREATE INDEX IF NOT EXISTS events_id_desc ON events (id DESC);
    `);
  } catch {
    return null;
  }

  return {
    kind: 'sqlite',
    readState() {
      const row = db.prepare('SELECT json FROM state WHERE id = 1').get();
      return row ? JSON.parse(row.json) : emptyState();
    },
    writeState(state) {
      db.prepare(
        `INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      ).run(JSON.stringify(state), state.updated_at || null);
    },
    appendEvent(evt, receivedAt, raw) {
      db.prepare(
        `INSERT INTO events (time, received_at, event, ticker, state, score, transmission, index_risk, index_risk_state, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        evt.time,
        receivedAt,
        evt.event,
        evt.ticker ?? null,
        evt.state ?? null,
        evt.score ?? null,
        evt.transmission ?? null,
        evt.index_risk ?? null,
        evt.index_risk_state ?? null,
        JSON.stringify(raw)
      );
      db.prepare(
        `DELETE FROM events WHERE id <= (SELECT MAX(id) - ${MAX_EVENTS} FROM events)`
      ).run();
    },
    readEvents(limit) {
      return db
        .prepare(
          `SELECT time, received_at, event, ticker, state, score, transmission, index_risk, index_risk_state
           FROM events ORDER BY id DESC LIMIT ?`
        )
        .all(limit)
        .map((r) => ({
          time: r.time,
          received_at: r.received_at,
          event: r.event,
          ticker: r.ticker,
          state: r.state,
          score: r.score,
          transmission: r.transmission,
          index_risk: r.index_risk,
          index_risk_state: r.index_risk_state,
        }));
    },
    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/* -------------------------------------------------------------- JSON store */

function openJson(file) {
  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        state: parsed.state || emptyState(),
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return { state: emptyState(), events: [] };
    }
  };

  let data = load();

  const flush = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic replace
  };

  return {
    kind: 'json',
    readState: () => data.state,
    writeState(state) {
      data.state = state;
      flush();
    },
    appendEvent(evt, receivedAt) {
      // Newest first; history is preserved independently of the latest snapshot.
      data.events.unshift({ ...evt, received_at: receivedAt });
      if (data.events.length > MAX_EVENTS) data.events.length = MAX_EVENTS;
      flush();
    },
    readEvents: (limit) => data.events.slice(0, limit),
    close() {},
  };
}

/* ------------------------------------------------------------------ facade */

function createStore(dataDir, { forceJson = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const backend =
    (!forceJson && openSqlite(path.join(dataDir, 'mags-lre.sqlite'))) ||
    openJson(path.join(dataDir, 'mags-lre.json'));
  return backend;
}

module.exports = { createStore, MAX_EVENTS };
