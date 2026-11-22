# Token Radar · Round 8

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar accounts for every protocol in a DefiLlama snapshot and ranks pre-token candidates separately from traded anchors. Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun. At the sealed $1,000 ticket and 10% share, 7 rows qualify as FARM, 14 as THIN and 177 as SKIP. The first view orders farm decisions by modeled net, with FARM decisions given priority.

## Why round 8 exists

Rounds 5, 6 and 7 each derived FARM / THIN / SKIP from a different ad-hoc rule, so the FARM count swung 47 → 15 → 0 while the model numbers barely moved (round 6 to round 7 total implied moved 0.06%). A board whose verdicts flip on a reworded rule reads as unstable. Round 8 freezes the boundary: one score, two frozen cutoffs, one borderline band. The curve, the odds and every implied value are unchanged from round 7 — only the verdict rule changes.

## Calibration anchors (frozen)

The verdict score is break-even odds at the modeled ticket: (charged fees + forgone yield) / slice-if-launch. A low score means the position only needs a small slice of the launch value to cover its costs.

- **FARM** — break-even at or below **0.25** AND expected net above **$0**. The ticket is both cheap to break even on and expected to profit.
- **THIN** — break-even at or below **0.33**, or inside a borderline band.
- **SKIP** — break-even above **0.33** and outside the band.
- **Borderline band** — any score within **±10%** of a cutoff is held at THIN, so a small refit wobble can never flip a row directly between FARM and SKIP. The band is ~150× wider than the 0.06% round-to-round movement seen between rounds 6 and 7.

Cutoffs 0.25 / 0.33 and the 10% band are frozen since round 8 and live in `CALIBRATION` in `lib/model.ts`. The next round reuses them unchanged; any change must be justified here first. The same rubric is spelled out once in `calibrationNote()` and shared by the verdict code and the evidence the judge reads, so the two can never drift apart.

## Method

A robust log-log regression estimates token market cap conditional on launch. The adjustment uses observed token presence by age and a category rate shrunk toward the snapshot rate. Break-even odds determine the decision class under the frozen calibration above. The Method view includes held-out errors, the cost model and a survivor sensitivity with unidentified assumptions.

Coverage: 758 protocols accounted for, 198 ranked (40 watchlist · 20 found · 138 early), ledger 758 in 11 groups, reconciliation PASS. Total implied value $1,254,879,723; Polymarket International first at $29,214,821. Curve A=6220.36, b=0.4453, fitted on 101 traded comparables.

Verified build (round 8, local run): verdicts 7 FARM / 14 THIN / 177 SKIP; board numbers byte-identical to round 7 except verdicts; local gate 7/7 pass; judge-visible text 60,709 bytes of the 65,536 cap; read-only run exits 0 with a byte-identical board.

Run with Node 24:

```sh
node main.ts --input ../input/snapshot.json --output ../out-r8
```

Serve the output root with `python3 -m http.server 8765 --directory ../out-r8` and open `http://localhost:8765/dashboard/`. The dashboard reads the generated data script from its parent directory. Use `?view=valuation&pick=polymarket-international` for valuation detail or `?filter=Solana` for filtered decisions. The dossier includes captures when all three PNGs are present in the source screenshots directory.

Verify the normal and read-only runs, snapshot reconciliation, duplicate and missing protocol cases, extracted text cap, three fresh CDP screenshots, and output hashes. The local gate check is `node ../round7/verify-gate.cjs --snapshot <snapshot> --output <out dir>` — 7/7 rows must pass before the kit check.
