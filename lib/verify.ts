import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {cohort, sum, valueAt, launchOdds, farmEconomics, verdictCounts} from './model.ts';

export function reconcile(snapshot,ledger,rows) {
  const expected = new Set(snapshot.protocols.map(p => p.slug));
  const ranked = new Set(ledger.find(g => g.name === 'Ranked')?.members.map(p => p.slug));
  const seen = new Set(), boardSlugs = new Set(), issues = [];
  const counts = {watchlist:0,found:0,early:0};
  for (const group of ledger) {
    if (group.count !== group.members.length) issues.push('Incorrect group total for '+group.name);
    for (const {slug} of group.members) {
      if (!expected.has(slug) || seen.has(slug)) issues.push('Unexpected or repeated ledger slug '+slug);
      seen.add(slug);
    }
  }
  for (const slug of expected) if (!seen.has(slug)) issues.push('Missing ledger slug '+slug);
  for (const row of rows) {
    if (!ranked.has(row.slug) || boardSlugs.has(row.slug)) issues.push('Unexpected or repeated ranked slug '+row.slug);
    boardSlugs.add(row.slug);
    const segment = cohort(row,snapshot);
    if (row.cohort !== segment) issues.push('Incorrect cohort for '+row.slug);
    counts[segment]++;
  }
  for (const slug of ranked) if (!boardSlugs.has(slug)) issues.push('Missing ranked slug '+slug);
  return {status:issues.length ? 'FAIL':'PASS',issues,coverage:seen.size,ranked:rows.length,
    ledgerTotal:sum(ledger.map(g => g.count)),groups:ledger.length,cohorts:counts};
}

export function verifyBoard(board) {
  const {curve,params,rows,integrity,total,verdicts} = board;
  if (integrity.status !== 'PASS') throw Error(integrity.issues.join(' / '));
  if (!(Number.isFinite(curve.A) && curve.A>0 && curve.b>0 && curve.b<1)) throw Error('Invalid curve');
  if (sum(rows.map(row => row.implied)) !== total) throw Error('Implied total mismatch');
  if (JSON.stringify(verdictCounts(rows.map(row => row.farms[1000]))) !== JSON.stringify(verdicts))
    throw Error('Verdict total mismatch');
  rows.forEach((row,i) => {
    const value = valueAt(curve,row.tvl_usd), odds = launchOdds(params,row);
    if (row.rank !== i+1 || (i && row.implied>rows[i-1].implied) ||
        !Number.isFinite(row.implied) || row.value !== value || row.odds !== odds || row.implied !== value*odds)
      throw Error('Invalid valuation for '+row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 ||
        row.implied_value_usd > 100000000000000 || row.implied_value_usd !== Math.round(row.implied))
      throw Error('Invalid implied_value_usd for '+row.slug);
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12 ||
        row.farm_steps.some(step => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600))
      throw Error('Invalid farm_steps for '+row.slug);
    for (const [ticket,farm] of Object.entries(row.farms)) {
      if (JSON.stringify(farmEconomics(row,value,odds,Number(ticket))) !== JSON.stringify(farm))
        throw Error('Invalid farm economics for '+row.slug);
    }
  });
}

export function verifyWritten(out, expected, script, dossier) {
  const read = name => readFileSync(join(out,name));
  if (read('board.json').toString() !== expected || read('data.js').toString() !== script) throw Error('Board staging mismatch');
  const text = read('judge-visible-text.txt');
  if (text.length > 65536 || text.toString() !== dossier.text) throw Error('Judge text mismatch or over cap');
  for (const image of dossier.images) {
    if (!read('screenshots/'+image.name).equals(Buffer.from(image.base64,'base64')))
      throw Error('Unmatched screenshot '+image.name);
  }
}
