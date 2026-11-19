// Token Radar's entry program (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), fits
// the radar-4 model on the snapshot's own traded tokens (lib/model.ts), validates it by
// leave-one-out, walk-forward and bootstrap (lib/validate.ts), scores every pre-token protocol
// into the ranked board, writes the board to /output/board.json, and copies this repository's
// dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildLedger, categoryRatesTable, compSet, dataScript, fitModel, parseSnapshot, MODEL_VERSION, type RadarData } from './lib/model.ts';
import { validateModel } from './lib/validate.ts';
import { verifyBoard, verifyWritten } from './lib/verify.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Fit the model on the snapshot's own traded tokens, then validate it before anything is
// scored: the band factors and the rank ranges come from the validation, not from a constant.
const fitted0 = fitModel(snapshot);
const validation = validateModel(snapshot, fitted0);
const fitted = { ...fitted0, band25: validation.band25, band90: validation.band90 };

// The fitted curve must reproduce the independent fit in the fit report (value = 6220.36 *
// TVL^0.4453 on the sealed snapshot, radar-4). A large drift means the fit or the comp set changed.
if (Math.abs(fitted.curve.a - 6220.36) / 6220.36 > 0.02 || Math.abs(fitted.curve.b - 0.4453) > 0.01) {
  process.stderr.write(
    `token radar: the fitted curve drifted from the fit report: A=${fitted.curve.a.toFixed(2)}, b=${fitted.curve.b.toFixed(4)} (expected A=6220.36, b=0.4453)\n`,
  );
  process.exit(1);
}

const { board, live } = buildBoard(snapshot, fitted, validation.ranges);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// The board's own verification: slug reality and uniqueness, size, trimmed
// steps, ages and the value cap. A board that fails here never reaches disk.
const verifyIssue = verifyBoard(board, snapshot);
if (verifyIssue !== null) {
  process.stderr.write(`token radar: the board failed its own verification: ${verifyIssue}\n`);
  process.exit(1);
}

const radar: RadarData = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: MODEL_VERSION,
  watchlist_size: snapshot.watchlist.length,
  board_size: board.length,
  found_size: board.filter((r) => r.list === 'found').length,
  early_size: board.filter((r) => r.list === 'early').length,
  live_size: live.length,
  total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
  curve_a: fitted.curve.a,
  curve_b: fitted.curve.b,
  odds_overall: fitted.odds.overall,
  odds_bucket_rates: fitted.odds.bucketRates,
  odds_exponent: fitted.odds.exponent,
  band25: fitted.band25,
  band90: fitted.band90,
  validation: validation.summary,
  ablation: validation.ablation,
  odds_bakeoff: validation.oddsBakeoff,
  comp_probes: validation.compProbes,
  survivor_probes: validation.survivorProbes,
  small_n_rules: validation.smallNRules,
  farm_sensitivity: validation.farmSensitivity,
  ledger: buildLedger(snapshot, board),
  comps: compSet(snapshot).map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! })),
  odds_categories: categoryRatesTable(snapshot),
  rows: board,
  live,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// The written output is verified after writing: the files landed, parse, and
// match the board. A partial or mismatched write fails here, not on the server.
const writtenIssue = verifyWritten(out, board);
if (writtenIssue !== null) {
  process.stderr.write(`token radar: the written output failed verification: ${writtenIssue}\n`);
  process.exit(1);
}

const top = board[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.found_size} found, ${radar.live_size} live set aside)\n` +
    `token radar: model ${MODEL_VERSION}: value = ${fitted.curve.a.toFixed(2)} * TVL^${fitted.curve.b.toFixed(4)} on ${validation.summary.comps} comps (R2 ${validation.summary.rSquared.toFixed(3)}), LOO x${validation.summary.looMedianMiss.toFixed(2)}, walk-forward x${validation.summary.walkForward50.toFixed(2)}, bands x${fitted.band25.toFixed(2)}/x${fitted.band90.toFixed(2)}\n` +
    `token radar: top ${top.name} $${top.implied_value_usd.toLocaleString('en-US')}, board total $${radar.total_implied_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
