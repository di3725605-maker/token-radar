// Independent verification for the radar's board and its written output.
//
// boardIssue in lib/model.ts answers the gate's shape; this module answers
// the questions it does not ask. Before anything is written, verifyBoard
// checks that every slug is real and used once, that the board is the right
// size, that the trimmed farm steps fit the gate, that every row's age
// matches the snapshot, and that no row claims more than the gate's value
// cap. After writing, verifyWritten reads the files back and checks they
// landed, parse, and match the board that was written. main.ts refuses to
// hand in a board that fails either pass, so a bad board fails here with a
// plain message instead of failing the gate on the server.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ageDays, isPreToken, type BoardRow, type Snapshot } from './model.ts';

/** Gate bounds for board.json, from the competition's rules. */
const MIN_ROWS = 100;
const MAX_ROWS = 4_000;
const MAX_IMPLIED_VALUE_USD = 100_000_000_000_000;
const MAX_DOSSIER_BYTES = 1_572_864;

/** The board's own checks, beyond the gate-shape check in boardIssue. */
export function verifyBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < MIN_ROWS) return `the board holds ${board.length} rows, under the ${MIN_ROWS} minimum`;
  if (board.length > MAX_ROWS) return `the board holds ${board.length} rows, over the ${MAX_ROWS} maximum`;

  const known = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `${row.slug} appears twice on the board`;
    seen.add(row.slug);
    const protocol = known.get(row.slug);
    if (protocol === undefined) return `${row.slug} is not one of the snapshot's protocols`;
    if (row.name.trim().length === 0) return `${row.slug} has an empty name`;
    if (row.token_status !== 'pre-token') return `${row.slug} is marked ${row.token_status}, not pre-token`;
    if (!isPreToken(protocol)) return `${row.slug} records a token in the snapshot, so it cannot sit on the pre-token board`;
    const age = ageDays(snapshot.as_of, protocol.listed_at);
    if (row.age_days !== age) return `${row.slug} claims ${row.age_days} days old, the snapshot says ${age}`;
    if (row.implied_value_usd > MAX_IMPLIED_VALUE_USD) {
      return `${row.slug} claims $${row.implied_value_usd}, over the $${MAX_IMPLIED_VALUE_USD} cap`;
    }
    if (row.odds < 0.05 || row.odds > 0.95) return `${row.slug} has odds ${row.odds}, outside [0.05, 0.95]`;
    if (row.value_if_launches_usd <= 0) return `${row.slug} has a non-positive value if it launches`;
    if (!(row.band_p10_usd <= row.band_p25_usd && row.band_p25_usd <= row.implied_value_usd && row.implied_value_usd <= row.band_p75_usd && row.band_p75_usd <= row.band_p90_usd)) {
      return `${row.slug} has bands out of order around $${row.implied_value_usd}`;
    }
    if (row.rank_range_lo < 1 || row.rank_range_hi > board.length || row.rank_range_lo > row.rank_range_hi) {
      return `${row.slug} has rank range ${row.rank_range_lo}-${row.rank_range_hi}, outside the board`;
    }
    if (!Number.isFinite(row.farm.netUsd) || !Number.isFinite(row.farm.breakEvenOdds)) {
      return `${row.slug} has non-finite farm economics`;
    }
    if (!['FARM', 'THIN', 'SKIP'].includes(row.farm.verdict)) return `${row.slug} has verdict ${row.farm.verdict}`;
    if (row.nearest_comps.length === 0) return `${row.slug} has no nearest comps`;
    for (const step of row.farm_steps) {
      const trimmed = step.trim().length;
      if (trimmed < 20 || trimmed > 600) return `${row.slug} has a farm step of ${trimmed} trimmed characters`;
    }
  }
  return null;
}

/** The written output's checks: the files landed, parse, and match the board. */
export function verifyWritten(out: string, board: BoardRow[]): string | null {
  try {
    const boardPath = join(out, 'board.json');
    if (!existsSync(boardPath)) return `board.json was not written to ${out}`;
    const written = JSON.parse(readFileSync(boardPath, 'utf8')) as { rows?: BoardRow[] };
    const rows = written.rows;
    if (!Array.isArray(rows)) return `board.json holds no rows array`;
    if (rows.length !== board.length) return `board.json holds ${rows.length} rows, the board has ${board.length}`;
    if (rows.length > 0) {
      if (rows[0]!.slug !== board[0]!.slug || rows[rows.length - 1]!.slug !== board[board.length - 1]!.slug) {
        return `board.json does not match the board's first and last rows`;
      }
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.rank !== board[i]!.rank) return `board.json row ${i + 1} has rank ${rows[i]!.rank}, the board says ${board[i]!.rank}`;
      }
    }
    const dataPath = join(out, 'data.js');
    if (!existsSync(dataPath)) return `data.js was not written to ${out}`;
    const data = readFileSync(dataPath, 'utf8');
    if (!data.startsWith('window.RADAR=')) return `data.js does not start with the radar payload`;
    if (!data.includes('"model_version":"radar-4"')) return `data.js does not carry the radar-4 model`;
    if (!data.includes('"validation":')) return `data.js does not carry the validation summary`;
    if (data.length < 100) return `data.js is only ${data.length} characters: the dashboard would render empty`;
    const dossierPath = join(out, 'dossier.json');
    if (!existsSync(dossierPath)) return `dossier.json was not written to ${out}`;
    const dossierBytes = statSync(dossierPath).size;
    if (dossierBytes > MAX_DOSSIER_BYTES) return `dossier.json is ${dossierBytes} bytes, over the ${MAX_DOSSIER_BYTES} cap`;
    JSON.parse(readFileSync(dossierPath, 'utf8'));
    return null;
  } catch (error) {
    return `the written output could not be read back: ${error instanceof Error ? error.message : String(error)}`;
  }
}
