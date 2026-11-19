# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun: it reads a frozen DefiLlama protocol snapshot, ranks every pre-token protocol by implied value, and writes a dashboard with a concrete, costed farm plan for each one.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it. The board is not a TVL table: a protocol's implied value is a size curve fitted on the snapshot's own traded tokens, times the launch odds for its age and category. The top of the board is a statistical tie, so ranks are shown with bootstrap ranges, not false precision.

## The model (radar-3)

`implied = max(1, round(value_if_launches x odds))`

- **value_if_launches, the size curve**: a Huber log-log fit of log(market cap) on log(TVL) over the snapshot's own standalone traded tokens (market cap at least $1M, no other protocol sharing the symbol or CoinGecko id; 101 comps on the sealed snapshot): `value = 6,220.36 x TVL^0.4453`. Ten times the TVL buys about 2.8 times the value, not ten. Log-scale R² is 0.20: TVL alone explains about a fifth of log-cap variance, which is why the bands are wide.
- **odds, the launch odds**: the share of protocols of the row's age bucket that record a token, times the row's category ever-rate relative to the snapshot-wide rate (0.5488), raised to 0.25, clamped to [0.05, 0.95]. Age buckets: under 6 months (26.4%), 6–12 months (39.7%), 1–2 years (38.3%), 2–4 years (64.0%), over 4 years (79.7%). A category with no token yet (ever-rate zero) carries no signal, so the odds use the bucket rate alone; a protocol with no listing date uses the snapshot-wide rate as its bucket rate.
- **bands**: the P25–P75 band is implied / 2.71 … implied × 2.71 and the P10–P90 band is implied / 6.40 … implied × 6.40, from the leave-one-out misses.

Validation, all computed from the snapshot at build time: leave-one-out median miss ×2.71 (51.5% within 3×) against a flat-multiple baseline of ×3.51; walk-forward (fit on older comps, price the newer) ×2.26 on the 50/50 split, ×2.83 on 70/30, ×2.34 on a fixed 2024-07-15 cutoff; bands hold for 50.5% / 80.2% of held-out caps; 19 of the top 20 stay top 20 in at least 80% of 200 bootstrap refits. The dashboard's Method tab shows the full ablation ladder (flat → curve → category premium → growth → age) and the odds-exponent bake-off: the premium, growth and age terms are dropped because they fail leave-one-out, with the numbers.

The watchlist is the floor: every protocol with at least $50M of TVL and no token on record (40 this snapshot). The found set adds 20 pre-token protocols above that floor the watchlist misses, by TVL, and the early radar adds 138 below it, by TVL, excluding exchanges, bridges, liquid staking and restaking, versioned names, and wrapped or staked tokens. Live-token protocols are set aside with their market caps shown. The 758-protocol ledger on the dashboard accounts for every protocol exactly once. No protocol name is special-cased anywhere: the curve, the odds, the board and every farm plan are derived from the snapshot's own figures.

## Farm plans

Each board row carries eight steps with a cost and a time, and a costed netting block: the expected airdrop slice (10% of implied value at the row's odds, on the ticket, time-shared by the hold) minus fees (one transaction per weekly check plus fund, approve, deposit, claim and exit, at the chain's gas, plus a $1.50 allowance) minus forgone yield (a 4% T-bill over the hold), giving net, net per hour, the ticket it pays from, break-even odds and a FARM / THIN / SKIP verdict (FARM when break-even odds ≤ 0.10, THIN when ≤ 0.33). At a $1,000 ticket the board has 0 FARM, 20 THIN and 178 SKIP; at $10,000 it has 4 FARM. The dashboard recomputes the netting live for tickets of $500 / $1,000 / $5,000 / $10,000 and shares of 3.5% / 7% / 10% / 14%. Gas is a stated estimate per chain, not a measured quote.

## Run it

Node 22, standard library only, no install:

```sh
node main.ts --input /path/to/snapshot.json
```

The grader mounts the sealed snapshot at `/input/snapshot.json`, so no `--input` is needed there: locally, point `--input` at the kit's copy of the snapshot.

It writes `/output/board.json` (the ranked board), `/output/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json` with the vendored make.fun library. Set `MAKEFUN_OUTPUT_DIR` to choose the output directory.

## Files

- `main.ts` — the entrypoint: fits the model, validates it, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the model: the fitted curve, launch odds, farm economics, the board, the ledger, the dossier data.
- `lib/validate.ts` — the validation: leave-one-out, walk-forward, the ablation ladder, the odds bake-off, band calibration and bootstrap rank ranges, all computed from the snapshot.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. It recomputes every row from the stamped constants and every farm plan from the same formulas, and checks the number the board carries.
- `screenshots/` — the board, a detail view and a filtered view of the dashboard.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, byte for byte the kit's copy.
- `lib/verify.ts` — independent verification: the board's slugs, size, steps, ages and value cap before writing, and the written files read back after writing.

The sealed DefiLlama snapshot (758 protocols, as of 2026-11-14) is NOT in this repository: the grader mounts it at `/input/snapshot.json`, and local runs point `--input` at the kit's copy.
