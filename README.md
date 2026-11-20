# Token Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/di3725605-maker/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun: it reads a frozen DefiLlama protocol snapshot, ranks every pre-token protocol by implied value, and writes a dashboard with a concrete, costed farm plan for each one.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it. The board is not a TVL table: a protocol's implied value is a size curve fitted on the snapshot's own traded tokens, times the launch odds for its age and category. The top of the board is a statistical tie, so ranks are shown with bootstrap ranges, not false precision.

## The model (radar-5)

`implied = max(1, round(value_if_launches x odds))`

- **value_if_launches, the size curve**: a Huber log-log fit of log(market cap) on log(TVL) over the snapshot's own standalone traded tokens (market cap at least $1M, no other protocol sharing the symbol or CoinGecko id; 101 comps on the sealed snapshot): `value = 6,220.36 x TVL^0.4453`. Ten times the TVL buys about 2.8 times the value, not ten. Log-scale R² is 0.2075 (OLS; 0.20 for the Huber fit): TVL alone explains about a fifth of log-cap variance, which is why the bands are wide. The curve is unchanged from radar-3 — every attempt to improve it failed validation.
- **odds, the launch odds — radar-5 change: a survivor form.** Radar-4 used the age-bucket rate, P(has token | age) in a cross-section — the wrong estimand for the farm decision. The question is P(will launch | no token yet), which falls as a protocol ages without launching. The survivor form fits a Weibull CDF through the five bucket rates (0.264 at <6m, 0.397 at 6–12m, 0.383 at 1–2y, 0.640 at 2–4y, 0.797 at >4y): `P(launch) = (L − F(t)) / (1 − F(t)) × (shrunk category rate / overall rate)^0.25`, where `F(t) = L × (1 − exp(−(t/τ)^k))` is the Weibull CDF fitted to the bucket rates, clamped to [0.05, 0.95], t = age in days, **L = 0.85, τ = 693d, k = 0.678** (SSE 3.61, grid-searched at build time over L = 0.80/0.85/0.90). **L cannot be identified from one snapshot** — L=0.80 (τ=600, k=0.702, SSE 3.91) and L=0.90 (τ=801, k=0.664, SSE 3.40) fit nearly as well; the choice moves the board total from $1.91B to $2.44B, so L=0.85 is the middle of the fitting range, stated plainly, with the sensitivity table on the dashboard. Every category rate is shrunk toward the snapshot-wide rate with pseudo-count K = 5 — shrunk = (n·raw + 5·0.5488) / (n+5) — so a thin category can no longer swing the odds on one member, and there is no fallback cliff at n = 5. A protocol with no listing date uses the snapshot-wide rate as its bucket rate and the bucket form for its odds. Young rows read higher than their bucket rate (Sentora 0.556 vs 0.264 — it has years of runway left); old rows read lower (Polymarket 0.431 vs 0.797 — five years without a launch has mostly exhausted its window). The survivor form's leave-one-out classifier score is worse than the bucket form's (acc 0.4837, Brier 0.3060 vs 0.6605/0.2160) — that test asks a binary classifier to predict whether a traded protocol has a token, and every traded protocol has one, so it penalises the survivor form for the right probabilities; the split-half Brier is essentially tied (Weibull 0.2249 vs bucket 0.2237). The adoption is for the estimand, not for a better LOO score, and the dashboard says so.
- **bands**: the P25–P75 band is implied / 2.71 … implied × 2.71 and the P10–P90 band is implied / 6.40 … implied × 6.40, from the leave-one-out misses.

Validation, all computed from the snapshot at build time: leave-one-out median miss ×2.71 (51.5% within 3×) against a flat-multiple baseline of ×3.51; walk-forward (fit on older comps, price the newer) ×2.26 on the 50/50 split, ×2.40 on 60/40, ×2.83 on 70/30, ×3.75 on 80/20, ×2.34 on a fixed 2024-07-15 cutoff and ×2.69 on a 2025-01-01 cutoff; bands hold for 50.5% / 80.2% of held-out caps; **all 20 of the top 20 stay top 20 in 200 bootstrap refits, and rank 1 is Sentora in 200/200 refits** — the radar-4 rank-1 tie is settled by the survivor form (Sentora 0.556 vs Steakhouse 0.533). The dashboard's Method tab shows the full 10-rung ablation ladder, the bucket-odds bake-off, the small-n rule test, the survivor-form investigation with its L sensitivity table and LOO honesty note, the fair comp-set probes, the farm sensitivity grid, and a decomposition of where the gap to the top entries closed (Sentora: ours 0.556/$55.2M vs nyx77's 0.471/$27.6M — we now price the top row above the leader) and where it did not (dTAO: ours 0.886/$36.3M vs sudhan's 2.714/$73.1M — a multiplier above 1 cannot be decomposed into adoptable parts).

The board: 198 rows, total implied value $2,174,781,100 as built. Rank 1 is Sentora Curator $55,231,543, then Steakhouse Financial $52,949,119, Veda $47,375,396, USDD $44,131,461, Gauntlet $41,317,136. Bittensor dTAO is rank 6 at $36,261,950; Polymarket International is rank 34 at $16,410,561. The watchlist is the floor: every protocol with at least $50M of TVL and no token on record (40 this snapshot). The found set adds 20 pre-token protocols above that floor the watchlist misses, by TVL, and the early radar adds 138 below it, by TVL, excluding exchanges, bridges, liquid staking and restaking, versioned names, and wrapped or staked tokens. Live-token protocols are set aside with their market caps shown. The 758-protocol ledger on the dashboard accounts for every protocol exactly once. No protocol name is special-cased anywhere: the curve, the odds, the board and every farm plan are derived from the snapshot's own figures.

## Farm plans

Each board row carries eight steps with a cost and a time, and a costed netting block: the expected airdrop slice (10% of implied value at the row's odds, on the ticket, time-shared by the hold) minus fees (one transaction per weekly check plus fund, approve, deposit, claim and exit, at the chain's gas, plus a $1.50 allowance) minus forgone yield (a 4% T-bill over the hold), giving net, net per hour, the ticket it pays from, break-even odds and a FARM / THIN / SKIP verdict. **Radar-5 change: the verdict is the expected net — FARM iff the expected net is positive, THIN iff break-even odds ≤ 0.33, otherwise SKIP.** The thresholds did not move; the rule did. The old rule (FARM iff break-even odds ≤ 0.10) netted 0 FARM at $1,000 because it counted rows whose cost was small relative to their slice even when the expected slice was too small to cover the fees. Verdicts by ticket: **$500: 33 FARM / 0 THIN / 165 SKIP; $1,000: 47 / 0 / 151; $5,000: 70 / 0 / 128; $10,000: 77 / 0 / 121.** THIN is 0 at every ticket: no row has break-even odds at or below 0.33 while also failing the net test — rows either clear the net (FARM) or their break-even odds are far above 0.33 (SKIP). Best net/hour at $1,000 is +$28.20/h (Valantis stHYPE Restaking, net +$61.09, break-even odds 0.108). The sensitivity grid shows the binding cost is the 4% forgone yield, not the gas: zeroing it would move 41 rows into FARM at $1,000 (47→88), while doubling gas removes 13 (47→34). The dashboard recomputes the netting live for tickets of $500 / $1,000 / $5,000 / $10,000 and shares of 3.5% / 7% / 10% / 14%. Gas is a stated estimate per chain, not a measured quote. Rank by implied value is not rank by farmability: rank-1 Sentora is SKIP at $1,000 (break-even odds 133.3 — a $1,000 ticket buys almost no slice of a $2.76B TVL), and rank-33 Polymarket is SKIP at every ticket (break-even odds 11.54 — its 1,845-day age gives a time-share of 0.089, so almost no slice accrues).

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
