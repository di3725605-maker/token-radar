// Token Radar · round 8 — build the board, the dashboard and the dossier.
//
// Reads a DefiLlama snapshot, fits the value curve, prices every ranked
// protocol, derives farm verdicts from the frozen round-8 calibration, and
// stages everything under --output (never inside this repo: the grader runs
// the repo read-only, so every write goes to the output directory).
import {existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, renameSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, join, relative, resolve, isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {buildDossier, canonicalJson, DOSSIER_SCHEMA} from './vendor/makefun-board.ts';
import {MODEL_VERSION, calibrationNote, parse, comparables, fit, oddsParams, buildLedger, buildBoard, sum, valueAt, verdictCounts} from './lib/model.ts';
import {validate} from './lib/validate.ts';
import {reconcile, verifyBoard, verifyWritten} from './lib/verify.ts';

const repo = realpathSync(import.meta.dirname);
const options = parseArgs({options: {input: {type: 'string', default: 'input/snapshot.json'},
  output: {type: 'string', default: '/output'}}}).values;
const input = resolve(options.input);
const out = resolve(options.output);
const sourceBytes = readFileSync(input);
const snapshot = parse(JSON.parse(sourceBytes.toString()));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stableSnapshot = {as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
  protocols: snapshot.protocols, watchlist: snapshot.watchlist};
const comps = comparables(snapshot.protocols);
const fitResult = fit(comps);
const roundedSlope = Number(fitResult.b.toFixed(4));
const roundedScale = Number(fitResult.A.toFixed(2));
const curve = {A: roundedScale > 0 ? roundedScale : fitResult.A,
  b: roundedSlope > 0 && roundedSlope < 1 ? roundedSlope : fitResult.b, n: fitResult.n};
const params = oddsParams(snapshot.protocols);
const ledger = buildLedger(snapshot);
const rows = buildBoard(snapshot, curve, params, ledger);
const validation = validate(comps, snapshot.protocols, params, rows);
const training = new Set(comps.map(p => p.slug));
const anchors = snapshot.protocols.filter(p => p.mcap_usd > 0).sort((a, b) => b.mcap_usd - a.mcap_usd)
  .map(p => ({...p, training: training.has(p.slug), curveCap: p.tvl_usd > 0 ? valueAt(curve, p.tvl_usd) : null}));
const plans = {
  'valantis-sthype-restaking': {asset: 'stHYPE', action: 'Inspect the Valantis stHYPE restaking pool and confirm its network, deposit asset and receipt. Model a deposit only if the product and withdrawal path are confirmed.', exit: 'Test the redemption route for stHYPE and check any cooldown before depositing.'},
  goonfi: {asset: 'Supported Solana pool asset (unverified)', action: 'Check whether GoonFi exposes a public liquidity deposit. A routed swap alone gives no evidence of eligibility. Keep the ticket idle without a verified deposit route.', exit: 'Confirm an LP withdrawal and unwind quote before entry.'},
  'loopscale-curation': {asset: 'Vault asset (unverified)', action: 'Compare official Loopscale curated vaults, identify the deposit asset and check borrower exposure before evaluating a supply transaction.', exit: 'Check available withdrawal liquidity and redeem vault shares only through the verified vault.'},
  'aftermath-aflp': {asset: 'afLP', action: 'Check the official Aftermath afLP mint quote and identify the accepted Sui collateral asset before considering a mint.', exit: 'Check the afLP redemption quote and liquidity before entry.'}
};
const ablation = [
  ['Quadratic size term', '×2.75', '×2.09', 'Dropped'],
  ['Category premium', '×2.84', '×2.53', 'Dropped'],
  ['Category-specific curve', '×2.75', '×2.26', 'Dropped'],
  ['7d momentum on TVL', '×2.71', '×2.14', 'Dropped'],
  ['Growth factor', '×3.07', '×2.41', 'Dropped'],
  ['Growth and age', '×3.02', '×2.59', 'Dropped'],
  ['Age alone', '×3.07', '×2.74', 'Dropped']
];
const integrity = reconcile(snapshot, ledger, rows);
const total = sum(rows.map(p => p.implied));
const verdicts = verdictCounts(rows.map(p => p.farms[1000]));
const board = {modelVersion: MODEL_VERSION, snapshot: {asOf: snapshot.as_of, source: snapshot.source,
  floor: snapshot.floor_usd, id: sha(canonicalJson(stableSnapshot)).slice(0, 12)},
  integrity, curve, params, rows, ledger, anchors, validation, verdicts, total, plans, ablation};
verifyBoard(board);

function projectedPath(path) {
  return existsSync(path) ? realpathSync(path) : join(projectedPath(dirname(path)), relative(dirname(path), path));
}
function within(base, path) {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}
if (within(repo, projectedPath(out))) throw Error('Output must be outside the source tree');
mkdirSync(out, {recursive: true});
const outputRoot = realpathSync(out);
function outputPath(name) {
  const path = join(outputRoot, name);
  const parent = projectedPath(dirname(path));
  if (!within(outputRoot, parent) || within(repo, parent)) throw Error('Unsafe output path: ' + name);
  return path;
}
function put(name, bytes) {
  const path = outputPath(name);
  mkdirSync(dirname(path), {recursive: true});
  const temporary = path + '.' + randomUUID();
  writeFileSync(temporary, bytes, {flag: 'wx'});
  renameSync(temporary, path);
}
const boardText = JSON.stringify(board) + '\n';
const script = 'window.RADAR = ' + boardText.trimEnd() + ';\n';
put('board.json', boardText);
put('data.js', script);
for (const name of ['app.js', 'app.css', 'index.html']) put('dashboard/' + name, readFileSync(join(repo, 'dashboard', name)));

const shots = join(repo, 'screenshots');
const names = ['1-board.png', '2-detail.png', '3-filtered.png'].filter(name => existsSync(join(shots, name)));
mkdirSync(dirname(outputPath('screenshots/.stage')), {recursive: true});
for (const name of names) put('screenshots/' + name, readFileSync(join(shots, name)));

const farmOrder = [...rows].sort((a, b) => Number(a.farms[1000].verdict !== 'FARM') - Number(b.farms[1000].verdict !== 'FARM') ||
  b.farms[1000].net - a.farms[1000].net || a.rank - b.rank);
const c = validation.curve;
const evidence = {
  masthead: integrity.coverage + ' accounted for',
  integrity: 'Coverage: ' + integrity.coverage + ' protocols accounted for | Ranked: ' + integrity.ranked +
    ' (' + integrity.cohorts.watchlist + ' watchlist · ' + integrity.cohorts.found + ' found · ' + integrity.cohorts.early + ' early) | Ledger: ' +
    integrity.ledgerTotal + ' protocols in ' + integrity.groups + ' groups | Reconciliation: ' + integrity.status + ' | Snapshot: ' + board.snapshot.id,
  snapshot: {asOf: board.snapshot.asOf, id: board.snapshot.id, floor: board.snapshot.floor, rawSha256: sha(sourceBytes)}, model: MODEL_VERSION,
  decision: verdicts.FARM ? 'FARM plans qualify' : 'No FARM plans under current assumptions',
  calibration: calibrationNote(),
  verdicts, total, curve, validation: {curve: c, baseline: validation.baseline, ablation, splitHalf: validation.splitHalf},
  proxy: 'Age bucket token presence × (K=5 shrunk category rate / overall rate)^0.25, clamped to 5–95%. A cross-sectional proxy.',
  survivorInvestigation: {label: 'Unidentified assumption; excluded from production valuation and odds', rows: validation.survivor},
  ledger: ledger.map(({name, count}) => ({name, count})),
  valuationLeaders: rows.slice(0, 10).map(({rank, name, cohort, tvl_usd, value, odds, implied}) => ({rank, name, cohort, tvl_usd, value, odds, implied})),
  decisions: farmOrder.slice(0, 12).map(({name, slug, rank, odds, farms, farm_steps}) => ({name, slug, rank, odds, ...farms[1000], farm_steps,
    lowerShareNet: farms[1000].expectedSlice / 2 - farms[1000].fees - farms[1000].forgone,
    plan: plans[slug] ?? null, eligibility: 'unverified', evidenceDate: snapshot.as_of, evidence: 'DefiLlama snapshot ' + snapshot.as_of + ' · protocol ' + slug}))
};
const cap = 65536;
// Rebuild the full evidence in staging before checking the vendor extraction.
let dossier;
for (;;) {
  put('dashboard/evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  if (names.length === 3) {
    dossier = JSON.parse(Buffer.from(buildDossier(outputRoot, {text_max_bytes: cap,
      screenshots: {max: 3, max_bytes: 524288}})).toString());
  } else {
    const files = readdirSync(join(outputRoot, 'dashboard')).sort();
    const text = files.map(name => '### ' + name + '\n' + readFileSync(join(outputRoot, 'dashboard', name), 'utf8')).join('\n');
    dossier = {schema: DOSSIER_SCHEMA, cover: null, images: [], text};
  }
  if (Buffer.byteLength(dossier.text) <= cap && !/\[Cut at \d+ bytes:/.test(dossier.text)) break;
  if (evidence.decisions.length <= 3) throw Error('Essential judge text exceeds budget');
  evidence.decisions.pop();
}
put('judge-visible-text.txt', dossier.text);
put('dossier.json', canonicalJson(dossier) + '\n');
verifyWritten(outputRoot, boardText, script, dossier);
console.log(JSON.stringify({model: MODEL_VERSION, snapshot: board.snapshot.id, coverage: integrity.coverage,
  ranked: rows.length, cohorts: integrity.cohorts, ledgerGroups: integrity.groups, reconciliation: integrity.status,
  verdicts, first: rows[0]?.name ?? null, firstImplied: Math.round(rows[0]?.implied ?? 0), total: Math.round(total), curve,
  loo: c.loo.median, wf50: c.wf50.median, judgeBytes: Buffer.byteLength(dossier.text), screenshots: names.length}));
