# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/competitions/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/rank.svg)](https://make.fun/competitions/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/reward.svg)](https://make.fun/competitions/token-radar-01)

A token launch radar for the [token-radar-01](https://make.fun/competitions/token-radar-01) bounty on make.fun: it reads a frozen DefiLlama protocol snapshot, ranks every pre-token protocol by implied value, and writes a dashboard with a concrete farm plan for each one.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it. The board is not a TVL table: a protocol's implied value is its TVL times a category multiple calibrated from the snapshot's own tokenized comparators, times a growth multiplier from its seven-day TVL change, times a maturity multiplier from how long it has run with no token recorded.

## The model (radar-2)

`implied = max(1, round(TVL x M x G x A))`

- **M, the category multiple**: the median market-cap-to-TVL ratio of the snapshot's tokenized protocols in that category, shrunk toward the snapshot-wide median (0.1689, n=144) with a pseudo-count of 6, clamped to 0.05 .. 0.60. A category with fewer than 3 comparators uses the global median instead, so one outlier can never set a multiple.
- **G, growth**: `clamp(1 + 0.30 x clamp(change_7d, -60, 120) / 100, 0.70, 1.30)`.
- **A, maturity**: `0.60 + 0.40 x min(age_days, 1095) / 1095`; a protocol with no listing date scores 0.60.

The watchlist is the floor: every protocol with at least $50M of TVL and no token on record (40 this snapshot). The early radar adds 138 pre-token protocols below that floor, by TVL, excluding exchanges, bridges, liquid staking and restaking, versioned names, and wrapped or staked tokens. Live-token protocols are set aside with their market caps shown. No protocol name is special-cased anywhere: the multiples, the board and every farm plan are derived from the snapshot's own figures.

## Farm plans

Each board row carries six steps with a cost and a time: a fresh wallet, the category's qualifying action (supply, provide liquidity, deposit into a vault, mint, hedge, stake), a weekly action that keeps the position active, an age-tiered hold (60 / 45 / 30 days), a points check that never pays to claim, and a log plus the exit. Capital follows TVL ($250 / $150 / $100 / $50); gas is chain-aware (about $8 on Ethereum, about $2-4 elsewhere).

## Run it

Node 22, standard library only, no install:

```sh
node main.ts --input input/snapshot.json
```

It writes `/output/board.json` (the ranked board), `/output/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` to `/output`, and writes `/output/dossier.json` with the vendored make.fun library. Set `MAKEFUN_OUTPUT_DIR` to choose the output directory.

## Files

- `main.ts` — the entrypoint: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the model: multiples, scoring, farm plans, the board, the dossier data.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`. It recomputes every row from the snapshot figures and checks the number the board carries.
- `screenshots/` — the board, a detail view and a filtered view of the dashboard.
- `vendor/makefun-board.ts` — make.fun's dashboard-dossier library, byte for byte the kit's copy.
- `input/snapshot.json` — the sealed DefiLlama snapshot (758 protocols, as of 2026-11-14), read-only.
