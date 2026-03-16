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

## MVP outputs supported

For each record, the triage engine returns:
- triage status
- confidence level
- short explanation
- triggered reasons/rules
- suggested action
- rationale text

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
