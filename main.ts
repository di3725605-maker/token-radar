import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildBoard, buildLedger, compSet, fitSurvivor, huberCurve, MODEL_VERSION, parseSnapshot, prevalence, reconcile, trades, type RadarData} from './lib/model.ts';
import {verifyBoard, verifyWritten} from './lib/verify.ts';
import {validate} from './lib/validate.ts';
import {buildDossier} from './vendor/makefun-board.ts';

const repo=fileURLToPath(new URL('.',import.meta.url));
function arg(key:string, fallback:string) {
  const i=process.argv.indexOf('--'+key);
  return i<0 ? process.argv.find(x=>x.startsWith('--'+key+'='))?.split('=').slice(1).join('=') ?? fallback : process.argv[i+1];
}
const input=arg('input','/input');
const bytes=readFileSync(input.endsWith('.json')?input:join(input,'snapshot.json'));
const s=parseSnapshot(bytes.toString()), comps=compSet(s), curve=huberCurve(comps), stats=prevalence(s), fit=fitSurvivor(stats.points);
if(comps.length<10 || !Number.isFinite(curve.a) || !Number.isFinite(curve.b) || curve.a<=0 || curve.b<=0 || curve.b>=1) throw Error('Invalid curve: '+JSON.stringify(curve));
if(!Number.isFinite(fit.tau) || !Number.isFinite(fit.k) || fit.tau<=0 || fit.k<=0 || fit.k>=5) throw Error('Invalid survivor fit: '+JSON.stringify(fit));
const initial=buildBoard(s,curve,stats,fit);
const validation=validate(s,initial,curve,stats,fit);
const rows=buildBoard(s,curve,stats,fit,validation.bands,validation.ranges);
const ledger=buildLedger(s,rows), reconciliation=reconcile(s,rows,ledger);
if(reconciliation.status!=='PASS') throw Error('Reconciliation failed: '+JSON.stringify(reconciliation));
verifyBoard(s,rows,ledger,reconciliation);
const data:RadarData={
  as_of:s.as_of,source:s.source,floor_usd:s.floor_usd,model_version:MODEL_VERSION,
  snapshot_id:'sha256:'+createHash('sha256').update(bytes).digest('hex').slice(0,12),
  universe_size:s.protocols.length,reconciliation,rows,ledger,curve,fit,
  overall:stats.overall,buckets:stats.points.map(p=>p.rate),
  anchors:s.protocols.filter(trades).sort((a,b)=>b.mcap_usd!-a.mcap_usd!).map(p=>({...p,fit_comp:comps.includes(p)})),
  validation:{...validation.summary,bands:validation.bands}
};
const out=arg('output',process.env.MAKEFUN_OUTPUT_DIR??'/output');
const dashboardDir=join(out,'dashboard');
mkdirSync(dashboardDir,{recursive:true});
if(existsSync(join(repo,'dashboard'))) {
  for(const file of readdirSync(join(repo,'dashboard'))) {
    writeFileSync(join(dashboardDir,file),readFileSync(join(repo,'dashboard',file)));
  }
}
const shots=readdirSync(join(repo,'screenshots'));
if(shots.length) {
  if(shots.length<3 || shots.some(x=>!/^[\w][\w.-]{0,127}$/.test(x))) throw Error('Expected at least three valid screenshot names');
  mkdirSync(join(out,'screenshots'),{recursive:true});
  for(const shot of shots) writeFileSync(join(out,'screenshots',shot),readFileSync(join(repo,'screenshots',shot)));
}
// Only dashboard text is extracted by the kit. Include compact computed evidence there.
const round=(n:number,d=2)=>+n.toFixed(d);
const proof={
  snapshot:data.snapshot_id,as_of:data.as_of,source:data.source,reconciliation,
  units:'TVL and implied USD; age days; odds fraction; expected net USD at $1000/10%; values rounded only in this evidence table.',
  row_columns:['slug','TVL','age','bucket odds','survivor odds','implied USD','base net','assumed net'],
  rows:rows.map(r=>[r.slug,r.tvl_usd,r.age_days,round(r.odds,6),round(r.odds_survivor,6),r.implied_value_usd,
    round(r.farm.netUsd),round(r.farm.sliceIfLaunchesUsd*r.odds_survivor-r.farm.feesUsd-r.farm.forgoneUsd)]),
  ledger:ledger.map(g=>({label:g.label,count:g.count,slugs:g.members.map(m=>m.slug)})),
  curve,fit,buckets:data.buckets,overall:data.overall,
  validation:{loo:validation.summary.loo,walk:validation.summary.walk,split:validation.summary.split,bands:validation.bands,
    bandHold:validation.summary.bandHold,top20:validation.summary.top20,rank1:validation.summary.rank1,
    ablation:validation.summary.ablation.map(x=>[x.label,x.loo.miss,...x.walk.map(w=>w.miss)]),
    survivor:validation.summary.survivorProbes,farmSensitivity:validation.summary.farmSensitivity},
  promoted_plans:rows.filter(r=>r.farm.verdict==='FARM').slice().sort((a,b)=>b.farm.netUsd-a.farm.netUsd).slice(0,2)
    .map(r=>({slug:r.slug,fees:r.farm.feesUsd,reserve:r.farm.reserveUsd,steps:r.farm_steps}))
};
writeFileSync(join(dashboardDir,'evidence.json'),JSON.stringify(proof)+'\n');
function dashboardText() {
const files=readdirSync(dashboardDir).sort().map(path=>({path,size:Buffer.byteLength(readFileSync(join(dashboardDir,path)))}));
let judgeText=['## Dashboard','',`Files: ${files.length} (${files.reduce((n,f)=>n+f.size,0)} bytes)`,
  ...files.map(f=>`- ${f.path} (${f.size} bytes)`),'','## Source','',''].join('\n');
for(const file of files){
  const text=readFileSync(join(dashboardDir,file.path),'utf8');
  const fence='`'.repeat(Math.max(3,...[...text.matchAll(/`+/g)].map(m=>m[0].length+1)));
  const lines=(text.match(/\n/g)??[]).length+(text.length&&!text.endsWith('\n')?1:0);
  judgeText+=`### ${file.path}\n\n${file.size} bytes, ${lines} line${lines===1?'':'s'}\n\n${fence}${file.path.split('.').pop()}\n${text}${text.endsWith('\n')?'':'\n'}${fence}\n\n`;
}
return judgeText.replace(/\n+$/,'\n');
}
let judgeText=dashboardText();
let judgeBytes=Buffer.byteLength(judgeText);
const evidenceRows=proof.rows.length;
// Re-render sizes and file contents together, exactly as the dossier extractor does.
while(judgeBytes>65536 && proof.rows.length) {
  proof.rows.pop();
  writeFileSync(join(dashboardDir,'evidence.json'),JSON.stringify(proof)+'\n');
  judgeText=dashboardText();
  judgeBytes=Buffer.byteLength(judgeText);
}
if(proof.rows.length<evidenceRows) console.warn(`Dashboard text cap: trimmed ${evidenceRows-proof.rows.length} evidence rows.`);
if(judgeBytes>65536) {
  console.warn('Dashboard text cap: evidence rows exhausted; using dossier text truncation.');
  judgeText=JSON.parse(Buffer.from(buildDossier(out,{text_max_bytes:65536})).toString()).text;
  judgeBytes=Buffer.byteLength(judgeText);
}
writeFileSync(join(out,'judge-visible-text.txt'),judgeText);
writeFileSync(join(out,'board.json'),JSON.stringify({rows})+'\n');
writeFileSync(join(out,'data.js'),'window.RADAR='+JSON.stringify(data)+';\n');
if(shots.length) {
  writeFileSync(join(out,'dossier.json'),buildDossier(out,{text_max_bytes:65536,screenshots:{max:4,max_bytes:524288},dashboard:{max_files:400,max_bytes:4194304}}));
  const actual=JSON.parse(readFileSync(join(out,'dossier.json'),'utf8'));
  if(actual.text!==judgeText) throw Error('Independent text extraction differs from vendor dossier');
} else {
  console.warn('SCREENSHOTS NOT VERIFIED: no dossier created; local model output only.');
}
verifyWritten(out,rows,shots.length>0);
console.log(JSON.stringify({reconciliation,curve,fit,top:rows[0].name,total:rows.reduce((a,r)=>a+r.implied_value_usd,0),farm:rows.filter(r=>r.farm.verdict==='FARM').length,judgeBytes}));
