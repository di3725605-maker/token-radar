# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun: it reads a frozen DefiLlama protocol snapshot, ranks every pre-token protocol by implied value, and writes a dashboard with a concrete, costed farm plan for each one.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it. The board is not a TVL table: a protocol's implied value is a size curve fitted on the snapshot's own traded tokens, times the launch odds for its age and category. The top of the board is a statistical tie, so ranks are shown with bootstrap ranges, not false precision.

## The model (radar-4)

`implied = max(1, round(value_if_launches x odds))`

- **value_if_launches, the size curve**: a Huber log-log fit of log(market cap) on log(TVL) over the snapshot's own standalone traded tokens (market cap at least $1M, no other protocol sharing the symbol or CoinGecko id; 101 comps on the sealed snapshot): `value = 6,220.36 x TVL^0.4453`. Ten times the TVL buys about 2.8 times the value, not ten. Log-scale R² is 0.2075 (OLS; 0.20 for the Huber fit): TVL alone explains about a fifth of log-cap variance, which is why the bands are wide. The curve is unchanged from radar-3 — every attempt to improve it failed validation.
- **odds, the launch odds**: the share of protocols of the row's age bucket that record a token, times the row's category ever-rate relative to the snapshot-wide rate (0.5488), raised to 0.25, clamped to [0.05, 0.95]. Age buckets: under 6 months (26.4%), 6–12 months (39.7%), 1–2 years (38.3%), 2–4 years (64.0%), over 4 years (79.7%). **Radar-4 change: every category rate is shrunk toward the snapshot-wide rate with pseudo-count K = 5** — shrunk = (n·raw + 5·0.5488) / (n+5) — so a thin category can no longer swing the odds on one member, and there is no fallback cliff at n = 5. Prediction Market (n = 3) goes from a raw 0.333 to a shrunk 0.468; Risk Curators (n = 39) from 0.128 to 0.176. A protocol with no listing date uses the snapshot-wide rate as its bucket rate.
- **bands**: the P25–P75 band is implied / 2.71 … implied × 2.71 and the P10–P90 band is implied / 6.40 … implied × 6.40, from the leave-one-out misses.

Validation, all computed from the snapshot at build time: leave-one-out median miss ×2.71 (51.5% within 3×) against a flat-multiple baseline of ×3.51; walk-forward (fit on older comps, price the newer) ×2.26 on the 50/50 split, ×2.40 on 60/40, ×2.83 on 70/30, ×3.75 on 80/20, ×2.34 on a fixed 2024-07-15 cutoff and ×2.69 on a 2025-01-01 cutoff; bands hold for 50.5% / 80.2% of held-out caps; 19 of the top 20 stay top 20 in at least 80% of 200 bootstrap refits; odds LOO accuracy 0.6605, Brier 0.2167 (proper LOO — radar-3's 0.2101 was computed in-sample). The dashboard's Method tab shows the full 10-rung ablation ladder (flat → curve → quadratic → category premium → per-category fits → momentum → growth → age), the odds-exponent bake-off (e = 0.25 at the knee), the small-n rule test, the survivor-form investigation (dropped: its asymptote is unidentifiable), the fair comp-set probes, and a decomposition of why the top entries' implied values run up to 6× ours (the gap is in the odds, not the curve — and no part of it survives our validation).

The board: 198 rows, total implied value $1,254,164,087 as built. Rank 1 is a tie — Polymarket International $29,196,824 (rank 1 in 116/200 refits) vs Sentora Curator $28,612,513 (84/200), then Steakhouse Financial $28,595,856. Bittensor dTAO is rank 21 at $11,615,067. The watchlist is the floor: every protocol with at least $50M of TVL and no token on record (40 this snapshot). The found set adds 20 pre-token protocols above that floor the watchlist misses, by TVL, and the early radar adds 138 below it, by TVL, excluding exchanges, bridges, liquid staking and restaking, versioned names, and wrapped or staked tokens. Live-token protocols are set aside with their market caps shown. The 758-protocol ledger on the dashboard accounts for every protocol exactly once. No protocol name is special-cased anywhere: the curve, the odds, the board and every farm plan are derived from the snapshot's own figures.

## Farm plans

Each board row carries eight steps with a cost and a time, and a costed netting block: the expected airdrop slice (10% of implied value at the row's odds, on the ticket, time-shared by the hold) minus fees (one transaction per weekly check plus fund, approve, deposit, claim and exit, at the chain's gas, plus a $1.50 allowance) minus forgone yield (a 4% T-bill over the hold), giving net, net per hour, the ticket it pays from, break-even odds and a FARM / THIN / SKIP verdict (FARM when break-even odds ≤ 0.10, THIN when ≤ 0.33). Verdicts by ticket: **$500: 0 FARM / 12 THIN / 186 SKIP; $1,000: 0 / 20 / 178; $5,000: 3 / 26 / 169; $10,000: 4 / 29 / 165.** The FARM rows at $5,000 are Valantis stHYPE Restaking (+$74.81 net), GoonFi (+$66.84) and Loopscale Curation (+$40.59); Monarq joins them at $10,000. Best net/hour at $1,000 is +$6.11/h (Valantis, THIN). The 0 FARM at $1,000 is structural, not a parameter accident: the dashboard's sensitivity grid shows halving gas or dropping the weekly tx moves nothing at $1,000, while zeroing forgone yield — dishonest, since the $6.58 on a $1,000/60-day ticket is a real opportunity cost every top entry also charges — would move 16 rows. The dashboard recomputes the netting live for tickets of $500 / $1,000 / $5,000 / $10,000 and shares of 3.5% / 7% / 10% / 14%. Gas is a stated estimate per chain, not a measured quote. Rank by implied value is not rank by farmability: rank-1 Polymarket is SKIP at every ticket (break-even odds 11.54 — its 1,845-day age gives a time-share of 0.089, so almost no slice accrues).

## Run it

Node 22, standard library only, no install:

```sh
node main.ts --input /path/to/snapshot.json
```

The grader mounts the sealed snapshot at `/input/snapshot.json`, so no `--input` is needed there: locally, point `--input` at the kit's copy of the snapshot.

It writes `/output/board.json` (the ranked board), `/output/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json` with the vendored make.fun library. Set `MAKEFUN_OUTPUT_DIR` to choose the output directory.

## Files

- `main.ts` — the entrypoint: fits the model, validates it, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the model: the fitted curve, shrunk launch odds, farm economics, the board, the ledger, the dossier data.
- `lib/validate.ts` — the validation: leave-one-out, walk-forward, the ablation ladder, the odds bake-off, the comp-set probes, the survivor-form and small-n investigations, the farm sensitivity grid, band calibration and bootstrap rank ranges, all computed from the snapshot.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. It recomputes every row from the stamped constants and every farm plan from the same formulas, and checks the number the board carries.
- `screenshots/` — the board, a detail view and a filtered view of the dashboard.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, byte for byte the kit's copy.
- `lib/verify.ts` — independent verification: the board's slugs, size, steps, ages and value cap before writing, and the written files read back after writing.

The sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) is NOT in this repository: the grader mounts it at `/input/snapshot.json`, and local runs point `--input` at the kit's copy.
