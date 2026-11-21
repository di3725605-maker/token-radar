# Token Radar · Round 7

Token Radar accounts for every protocol in a DefiLlama snapshot and ranks pre-token candidates separately from traded anchors. The first view orders farm decisions by modeled net, with FARM decisions given priority. At the sealed $1,000 ticket and 10% share, the strongest decisions are THIN and the FARM state is empty.

A robust log-log regression estimates token market cap conditional on launch. The adjustment uses observed token presence by age and a category rate shrunk toward the snapshot rate. Break-even odds determine the decision class. The Method view includes held-out errors, the cost model and a survivor sensitivity with unidentified assumptions.

Run with Node 24:

```sh
node main.ts --input ../input/snapshot.json --output ../out-r7
```

Serve the output root with `python3 -m http.server 8765 --directory ../out-r7` and open `http://localhost:8765/dashboard/`. The dashboard reads the generated data script from its parent directory. Use `?view=valuation&pick=polymarket-international` for valuation detail or `?filter=Solana` for filtered decisions. The dossier includes captures when all three PNGs are present in the source screenshots directory.

Verify the normal and read-only runs, snapshot reconciliation, duplicate and missing protocol cases, extracted text cap, three fresh CDP screenshots, and output hashes.
