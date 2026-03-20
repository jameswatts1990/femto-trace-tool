# Femto Trace Triage Tool (MVP Base Files)

Lightweight internal web-tool scaffold for long-read sequencing operations teams using PacBio workflows.

## What this includes

- Product/operations MVP specification for triaging Femto summary metrics.
- Transparent, configurable rule set (`data/rules.default.json`).
- Static web prototype pages:
  - Quick entry (`app/index.html`)
  - Batch upload/review (`app/batch.html`)
  - Threshold settings (`app/settings.html`)
  - Audit trail (`app/audit.html`)
- Browser-side triage engine (`app/triage.js`) for deterministic explainable outputs.
- CSV template for batch imports (`data/template.csv`).
- Direct upload support for Femto output CSV/TSV exports (auto-mapped to triage fields).

## MVP outputs supported

For each record, the triage engine returns:
- triage status
- confidence level
- short explanation
- triggered reasons/rules
- suggested action
- rationale text


## Batch import compatibility

`app/batch.html` accepts either:

- the native template columns (`data/template.csv`), or
- Femto output exports with columns like `Well`, `Sample ID`, `Size (bp)`, `% (Conc.)`, `Avg. Size`, `TIC (ng/ul)`, `TIM (nmole/L)`.

When Femto exports are uploaded, the parser accepts common header variants (for example `% (Conc.)`, `% (Conc.) (ng/uL)`, and case variations in `TIM (nmole/L)`), handles tab-delimited exports copied from spreadsheets, and ignores blank per-sample summary lines while retaining their TIC/TIM values.

When Femto exports are uploaded, the app aggregates peak rows per sample and computes triage inputs using these factors:

- `percent_0_1000_bp`: sum of `% (Conc.)` values where `Size (bp) <= 1000`
- `avg_fragment_size_bp`: `Avg. Size`
- `peak_size_bp`: size of the peak with the highest `% (Conc.)`
- `concentration_ng_ul`: `TIC (ng/ul)`
- `library_molarity_nM`: `TIM (nmole/L)`
- `sample_id`: `Sample ID`

For missing template-required fields in Femto exports, defaults are applied for triage continuity:

- `date_analyzed`: current date at upload time
- `stage`: inferred as `final_library` when sample id contains `PrLIB`, otherwise `post_library`

These defaults keep uploads reviewable while still making assumptions visible in app status messaging.


## ML assist workflow (human-in-the-loop)

Batch View now includes a low-risk machine-learning assist flow:

- Model suggestion for triage label + confidence score + top factors ("why this prediction").
- Inline human review controls: Agree, or correct label with optional reason tags.
- Feedback logging in browser storage with features, prediction, corrected label, timestamp, reviewer ID/role, and model/data version.
- Retraining button to periodically rebuild stage-level priors from reviewed examples with a lightweight holdout estimate.
- Audit page summarizing corrections and governance metadata.

This keeps the product in assist mode by default while collecting supervised data for safer future automation.

## Quick local run

Because this MVP uses module imports and JSON fetch calls, run with a local static server from repo root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/app/index.html`
- `http://localhost:8000/app/batch.html`

## Notes

- This is intentionally lightweight and explainable.
- It is a decision-support aid, not a replacement for scientific judgement.
- Thresholds are illustrative defaults and should be tuned to internal outcomes.

For full design details, see `docs/mvp-spec.md`.

## GitHub Pages deployment

This project is static and browser-only. When published to GitHub Pages, open the site root and navigate from there:

- `https://<org-or-user>.github.io/<repo>/`

The root page links to:

- Quick entry (`app/index.html`)
- Batch view (`app/batch.html`)
- Threshold settings (`app/settings.html`)
- Audit (`app/audit.html`)
