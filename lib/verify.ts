import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {ageDays, disposition, hasToken, rankedLabel, type BoardRow, type Ledger, type RadarData, type Snapshot} from './model.ts';

function requireThat(ok: unknown, problem: string): asserts ok {
  if(!ok) throw Error(problem);
}
export function verifyBoard(s:Snapshot, rows:BoardRow[], ledger:Ledger, check:RadarData['reconciliation']) {
  const source = new Map(s.protocols.map(p=>[p.slug,p]));
  const seen = new Set<string>();
  requireThat(rows.length>=100&&rows.length<=4000,'Board size outside 100–4000');
  requireThat(check.status==='PASS'&&check.discrepancy===0&&source.size===s.protocols.length,'Reconciliation metadata or input identity failed');
  const memberships=ledger.flatMap(g=>g.members.map(m=>[m.slug,g.label] as const));
  const bySlug=new Map(memberships), ranked=new Set(memberships.filter(([,label])=>label===rankedLabel).map(([slug])=>slug));
  requireThat(bySlug.size===source.size&&memberships.length===source.size&&
    [...source.keys()].every(slug=>bySlug.has(slug))&&ledger.every(g=>g.count===g.members.length)&&
    ranked.size===rows.length&&rows.every(r=>ranked.has(r.slug)), 'Ledger does not partition all snapshot identities');
  requireThat(memberships.every(([slug,label])=>disposition(source.get(slug)!,ranked)===label),'Incorrect ledger disposition');
  requireThat(check.universe===source.size&&check.ledger_total===memberships.length&&check.ledger_groups===ledger.length&&
    check.ranked===rows.length&&check.exclusions_total===source.size-rows.length&&rows.length===198&&
    (['watchlist','found','early'] as const).every((list,i)=>rows.filter(r=>r.list===list).length===[40,20,138][i]),'Coverage counters do not match the board and ledger');
  requireThat(rows.some(r=>r.tvl_usd<s.floor_usd),'Missing early coverage');
  rows.forEach((r,i)=>{
    const p=source.get(r.slug);
    requireThat(p&&!seen.has(r.slug)&&r.name.trim(), 'Invalid or repeated board identity: '+r.slug);
    seen.add(r.slug);
    requireThat(!hasToken(p)&&r.token_status==='pre-token'&&r.age_days===ageDays(s.as_of,p.listed_at), 'Bad status or age: '+r.slug);
    requireThat(r.rank===i+1&&(!i||rows[i-1].implied_value_usd>=r.implied_value_usd),'Unexpected rank order');
    const v=r.implied_value_usd, f=r.farm;
    requireThat(Number.isInteger(v)&&v>0&&v<=1e14&&r.tvl_usd>=0&&r.value_if_launches_usd>0,'Invalid value: '+r.slug);
    requireThat([r.odds,r.odds_survivor,r.bucket_odds].every(x=>x>=.05&&x<=.95),'Invalid odds: '+r.slug);
    requireThat(r.band_p10_usd<=r.band_p25_usd&&r.band_p25_usd<=v&&v<=r.band_p75_usd&&r.band_p75_usd<=r.band_p90_usd,'Invalid value bands');
    requireThat(r.rank_range_lo>=1&&r.rank_range_hi<=rows.length&&r.rank_range_lo<=r.rank_range_hi,'Invalid rank range');
    requireThat(Number.isFinite(f.netUsd)&&Number.isFinite(f.breakEvenOdds)&&f.verdict===(f.netUsd>0?'FARM':f.breakEvenOdds<=.33?'THIN':'SKIP'),'Invalid farm decision');
    requireThat(r.odds===r.bucket_odds&&r.odds===f.odds&&f.reserveUsd===10&&
      Math.abs(f.feesUsd-f.nTx*f.gasUsd-f.allowanceUsd)<1e-10&&
      Math.abs(f.sliceIfLaunchesUsd*r.odds-f.feesUsd-f.forgoneUsd-f.netUsd)<1e-10,'Headline odds or fee arithmetic differs: '+r.slug);
    requireThat(r.nearest_comps.length&&r.farm_steps.length===8&&r.farm_steps.every(x=>x.trim().length>=20&&x.trim().length<=600),'Invalid plan or anchors: '+r.slug);
    requireThat(r.farm_steps[0].includes('wallet buffer')&&r.farm_steps[0].includes('not deducted')&&
      r.farm_steps[7].includes('IF a real announcement exists AND eligibility is confirmed'),'Reserve or conditional-claim disclosure missing');
  });
  requireThat(s.watchlist.every(slug=>seen.has(slug)), 'Missing watchlist protocol');
}
export function verifyWritten(out:string,rows:BoardRow[],dossier:boolean) {
  const doc=JSON.parse(readFileSync(join(out,'board.json'),'utf8'));
  requireThat(JSON.stringify(doc.rows)===JSON.stringify(rows),'Written board differs');
  const data=readFileSync(join(out,'data.js'),'utf8'), prefix='window.RADAR=';
  requireThat(data.startsWith(prefix)&&data.length>=100,'Dashboard payload missing');
  const radar:RadarData=JSON.parse(data.slice(prefix.length).trim().slice(0,-1));
  requireThat(radar.model_version==='radar-6'&&radar.validation&&radar.reconciliation.status==='PASS','Invalid dashboard metadata');
  if(dossier) {
    const path=join(out,'dossier.json');
    requireThat(statSync(path).size<=1572864,'Dossier image envelope exceeds byte cap');
    const {text}=JSON.parse(readFileSync(path,'utf8'));
    requireThat(Buffer.byteLength(text)<=65536,'Dossier text exceeds cap');
  }
}
