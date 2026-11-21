# Token Radar

Token Radar builds a local dashboard from a dated DefiLlama snapshot. The coverage strip reconciles the ranked subset to the entire protocol universe, and the ledger assigns every protocol one disposition by slug.

With Node 24, run:

```sh
MAKEFUN_OUTPUT_DIR=../out6 node main.ts --input ../input/snapshot.json
```

Keep the snapshot outside this directory. Serve the output directory and open `dashboard/` to view it.

The board opens on Farm decisions at a $1,000 ticket, 10% share, and the conservative age-bucket proxy. Valuation reorders the same decisions by implied protocol value. Use Odds basis to explore the separately labeled eventual-launch scenario; that scenario assumes an eventual-launch share and has no prospective calibration in the snapshot. Method explains the comparable-token fit, holdouts, and sensitivities. Ledger lets you search by name or slug.

Hash controls include `view=farm|value`, `sc=base|assumed`, `ticket`, `share`, `detail` (slug), source/category/verdict filters, and page. The adjacent detail keeps the decision table in view. Valuation rank is based on the headline odds; scenario valuation ordering is recalculated without changing the row economics.

Only the TVL curve supplies fitted valuation coefficients. The base odds multiply age-bucket token presence by a shrunk category factor, with a 0.25 exponent and 5%–95% clamp. The survivor scenario fixes an assumed L and fits its shape to the same cross-section; L is not identified. Growth is 7-day snapshot change, descriptive in the shipped value formula. Brier tests token presence, not future launch.

Positive modeled net means FARM. Each plan shows its charged fees, forgone yield, wallet buffer, and modeled hold separately. The buffer stays outside the net calculation. The snapshot does not verify deposits, contracts, eligibility, or announcements; plans identify these prerequisites before any funds move.

The builder independently checks board shape, watchlist inclusion, real and unique slugs, value order, ages, bands, rank ranges, economics, eight trimmed plan steps, and ledger membership. It refuses to write when reconciliation fails. It also enforces curve and survivor drift limits before output and verifies serialized files afterward.

The vendor library is unchanged. Its dossier extracts text only from `dashboard/`, so `evidence.json` there carries compact computed row values, the complete ledger partition, fit results, validation summaries, and the two leading FARM plans. Full runtime data stays in output `data.js`. The builder measures the full extraction text, rejects truncation, and compares its extraction byte-for-byte with the vendor dossier once screenshots exist. Without screenshots it explicitly reports the missing verification and does not create a dossier.
