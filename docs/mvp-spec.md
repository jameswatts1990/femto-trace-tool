# Femto Trace Triage Tool — MVP Specification

## 1) MVP feature list

### Core capabilities
1. **Single-record quick triage**
   - Manual form entry for one sample/library record.
   - Immediate triage output with rationale and triggered rules.
2. **Batch CSV triage**
   - Upload CSV with multiple records.
   - Validate required fields and stage-specific constraints.
   - Return per-record triage plus batch summary counts.
3. **Transparent rules engine (configurable)**
   - Stage-aware threshold rules loaded from config (JSON/YAML/DB table).
   - Distinguish hard fail rules vs caution rules.
   - Explain exactly which threshold(s) triggered a result.
4. **Result states and confidence**
   - Triage statuses: Proceed, Proceed with caution, Review, High risk, Fail/hold.
   - Confidence based on input completeness and rule agreement.
5. **Operational review workflow**
   - Record-level notes and review status.
   - Override suggested triage with required reason.
   - Audit trail entries for creation, review, and override events.
6. **Threshold settings page (admin)**
   - Edit rule thresholds by analysis stage.
   - Version rulesets and activate/deactivate versions.
   - Preview impact on a small test set before publishing.
7. **Batch operations page**
   - Counts by triage category.
   - Sort/filter by project, stage, date, and status.
   - Export reviewed results to CSV.

### Sensible minimum required input set (MVP)
Required across all stages:
- sample_id
- stage (pre_library_gdna | post_library | post_size_selection | final_library)
- date_analyzed
- percent_0_1000_bp

Recommended required for better confidence:
- avg_fragment_size_bp
- peak_size_bp

Optional but valuable:
- project_id/batch_id, concentration, total_dna_ng, library_molarity_nM, notes, larger-band percentages.

---

## 2) Recommended screen/page structure

1. **Dashboard / Batch Results** (`/`)
   - KPI cards: counts by triage status.
   - Filter panel (project, date range, stage, status, confidence).
   - Sortable results table + export button.
2. **Quick Entry** (`/entry`)
   - One-record manual form.
   - Inline validation and real-time triage preview.
   - Submit/save and view full rationale.
3. **CSV Upload** (`/upload`)
   - Download template.
   - Upload + parse preview.
   - Validation errors panel.
   - Run triage and route to batch results.
4. **Record Detail** (`/records/:id`)
   - Inputs, triage output, triggered rules, rationale text.
   - Review actions: mark reviewed, override triage, add note.
   - Audit timeline.
5. **Threshold Settings (Admin)** (`/admin/rules`)
   - Stage-specific thresholds.
   - Hard vs soft rule tags.
   - Version history and publish.
6. **Audit Log** (`/audit`)
   - Filterable list of review/override/config changes.

---

## 3) Proposed data model

### `records`
- `id` (uuid)
- `sample_id` (string, indexed)
- `project_id` (string, nullable, indexed)
- `batch_id` (string, nullable)
- `stage` (enum)
- `date_analyzed` (date)
- `percent_0_1000_bp` (numeric)
- `percent_gt_10000_bp` (numeric, nullable)
- `avg_fragment_size_bp` (numeric, nullable)
- `peak_size_bp` (numeric, nullable)
- `concentration_ng_ul` (numeric, nullable)
- `total_dna_ng` (numeric, nullable)
- `library_molarity_nM` (numeric, nullable)
- `notes` (text, nullable)
- `created_at`, `created_by`

### `triage_results`
- `id` (uuid)
- `record_id` (fk)
- `ruleset_version` (string)
- `triage_status` (enum)
- `confidence` (enum: low/medium/high)
- `short_explanation` (text)
- `reasons_triggered` (json array)
- `suggested_action` (text)
- `historical_pattern_match` (json, nullable)
- `is_overridden` (bool)
- `override_status` (enum, nullable)
- `override_reason` (text, nullable)
- `computed_at`

### `rulesets`
- `id` (uuid)
- `version` (string)
- `is_active` (bool)
- `definition_json` (json)
- `created_by`, `created_at`

### `audit_events`
- `id` (uuid)
- `entity_type` (record/result/ruleset)
- `entity_id` (uuid)
- `event_type` (created/reviewed/overridden/ruleset_published)
- `event_payload` (json)
- `event_at`, `event_by`

---

## 4) Rule-based triage framework (transparent and configurable)

## Rule model
Each rule has:
- `id`
- `stage_scope` (one or many stages)
- `metric`
- `operator` (>, >=, between, etc.)
- `threshold`
- `severity` (`hard_fail`, `high_risk`, `review`, `caution`, `info`)
- `message`
- `suggested_action`
- `enabled`

### Decision layering
1. Evaluate all enabled rules for stage.
2. If any `hard_fail`, status = **Fail/hold**.
3. Else if any `high_risk`, status = **High risk**.
4. Else if `review` rule count ≥ configured minimum, status = **Review**.
5. Else if any `caution`, status = **Proceed with caution**.
6. Else status = **Proceed**.

### Confidence heuristic (MVP)
- Start at `high`.
- Downgrade to `medium` if one recommended field missing.
- Downgrade to `low` if key metrics missing or conflicting rule outcomes.

### Example threshold set (starting point)
These are illustrative defaults and should be tuned with local data:

#### `pre_library_gdna`
- `percent_0_1000_bp > 35` → **high_risk** (risk of downstream poor library profile)
- `percent_0_1000_bp 25–35` → **review**
- `avg_fragment_size_bp < 12000` → **caution**

#### `post_library`
- `percent_0_1000_bp > 30` → **review**
- `percent_0_1000_bp > 40` → **high_risk**
- `peak_size_bp < 8000` → **caution**

#### `post_size_selection`
- `percent_0_1000_bp > 20` → **review**
- `percent_0_1000_bp > 30` → **high_risk**

#### `final_library`
- `percent_0_1000_bp > 15` → **review**
- `percent_0_1000_bp > 25` → **high_risk**
- `library_molarity_nM < 5` (if provided) → **caution**

### Hard fail examples (configurable)
- Impossible values (negative percentages, >100%)
- Missing mandatory fields
- Optional future: explicit SOP-based stop criteria per assay type

### Explainability format
Return structured reasoning:
- `triggered_rule_ids`
- human-readable reasons list
- top-level sentence:
  - “Flagged as **Review** because 0–1000 bp fraction (27%) exceeded pre-library review threshold (25%).”

### Evolving with historical data (without opaque model)
1. Add descriptive historical overlays (non-decisioning):
   - “Historically, samples with similar pre-library profile had 2.1× higher chance of final library review flag.”
2. Add confidence calibration by cohort.
3. Keep triage decision rule-based; use historical statistics only as additive context.
4. Add a rule tuning dashboard (e.g., sensitivity/specificity against known outcomes).

---

## 5) Example user flows

### A) Single sample review
1. User opens Quick Entry.
2. Enters required metrics + optional values.
3. Clicks “Run triage”.
4. Tool computes status + confidence + rationale.
5. User optionally adds note and marks reviewed.
6. If user disagrees, they override with mandatory reason.
7. Audit event saved.

### B) Batch upload review
1. User downloads CSV template and fills records.
2. Uploads file on CSV page.
3. Tool validates rows and shows row-level errors.
4. User confirms valid rows and runs triage.
5. Results shown in sortable/filterable table with category counts.
6. Team filters to `Review`/`High risk` and adjudicates.
7. Export reviewed subset.

### C) Admin threshold editing
1. Admin opens Rules page.
2. Duplicates active ruleset to draft.
3. Edits stage thresholds and severities.
4. Runs “preview impact” on recent records.
5. Publishes new version with changelog note.
6. Audit event created.

---

## 6) Recommended tech stack (lightweight internal app)

### Preferred stack
- **Frontend:** React + TypeScript + Vite
- **UI:** Tailwind CSS + minimal component library (e.g., shadcn/ui)
- **Backend:** FastAPI (Python) or Node/Express (TypeScript)
- **Database:** SQLite for MVP (or Postgres if internal infra already standardized)
- **Auth:** Internal SSO proxy/header auth if available, otherwise simple role layer for MVP
- **CSV parsing:** PapaParse (frontend) or Python `pandas/csv` backend route

### Why this is suitable
- Fast to build and maintain.
- Rule engine can be plain JSON + deterministic evaluator.
- Simple deployment (single container) for internal operations.

---

## 7) Wireframe descriptions

### Dashboard / Batch Results
- Top row: KPI cards for each triage category.
- Left rail: filters (project/date/stage/status/confidence).
- Main: sortable table with status pill color coding.
- Row action: “View details”.

### Quick Entry
- Compact form in logical sections:
  - Sample metadata
  - Stage
  - Femto metrics
  - Optional context fields
- Right panel (or below): live triage preview card with explanation.
- Submit bar: save, clear, run triage.

### CSV Upload
- Step 1: download template.
- Step 2: drag-and-drop uploader.
- Step 3: validation panel (errors/warnings).
- Step 4: run triage button and summary preview.

### Record Detail
- Header: sample + stage + status + confidence.
- Sections: input metrics, triggered rules, rationale, suggested action.
- Expandable “Why this status?” block.
- Review controls + override modal.
- Audit timeline at bottom.

### Threshold Settings
- Stage tabs.
- Table of rules with threshold editors.
- Severity selector and enable/disable toggle.
- Draft/publish controls and version history.

### Audit Log
- Table of review and config actions.
- Filters by user/date/event type.
- Record link-out.

---

## 8) Risks, limitations, and guardrails

### Risks/limitations
- Thresholds may be over- or under-sensitive initially.
- Different projects may have different acceptable ranges.
- Missing optional metrics can reduce certainty.
- Users may over-trust tool output.

### Guardrails
- Persistent banner: **decision support only**.
- Require rationale for any override.
- Show exact triggered rules to prevent black-box behavior.
- Track outcome feedback to improve thresholds.
- Separate “recommended action” from mandatory SOP decisions.

---

## 9) Future enhancements (still explainable)

1. Project-specific threshold profiles.
2. Historical comparator panel by assay/project/cohort.
3. Rule performance analytics against outcomes.
4. Semi-automated threshold suggestions (human-approved only).
5. Import adapters for common lab export formats.
6. Alerting for recurrent high-risk patterns.
7. Quality trend dashboard over time.
