const severityRank = {
  hard_fail: 5,
  high_risk: 4,
  review: 3,
  caution: 2,
  info: 1
};

const statusMap = {
  5: 'Fail/hold',
  4: 'High risk',
  3: 'Review',
  2: 'Proceed with caution',
  1: 'Proceed',
  0: 'Proceed'
};

const hasValue = (value) => value !== undefined && value !== null && value !== '';

function compare(operator, value, threshold) {
  if (value === undefined || value === null || value === '') return false;
  const n = Number(value);
  if (Number.isNaN(n)) return false;
  switch (operator) {
    case '>': return n > threshold;
    case '>=': return n >= threshold;
    case '<': return n < threshold;
    case '<=': return n <= threshold;
    case '==': return n === threshold;
    default: return false;
  }
}

export function evaluateRecord(record, rulesConfig) {
  const warnings = [...(record.triage_warnings || [])];
  const missing = rulesConfig.required_fields.filter((f) => !hasValue(record[f]));
  const missingRecommended = rulesConfig.recommended_fields.filter((f) => !hasValue(record[f]));
  if (missing.length) {
    return {
      triage_status: 'Fail/hold',
      confidence: 'low',
      short_explanation: `Record is missing required field(s): ${missing.join(', ')}.`,
      reasons_triggered: ['missing_required_fields'],
      missing_required_fields: missing,
      missing_recommended_fields: missingRecommended,
      warnings,
      suggested_action: 'Complete required fields and re-run triage.',
      rationale: 'Hard fail because required data for triage was not provided.'
    };
  }

  if (record.percent_0_1000_bp < 0 || record.percent_0_1000_bp > 100) {
    return {
      triage_status: 'Fail/hold',
      confidence: 'low',
      short_explanation: '0–1000 bp percentage is out of valid range (0–100).',
      reasons_triggered: ['invalid_percent_range'],
      missing_required_fields: missing,
      missing_recommended_fields: missingRecommended,
      warnings,
      suggested_action: 'Correct invalid value and re-run triage.',
      rationale: 'Hard fail due to impossible percentage value.'
    };
  }

  const stageRules = rulesConfig.stages[record.stage] || [];
  const triggered = stageRules.filter((rule) => rule.enabled && compare(rule.operator, record[rule.metric], rule.threshold));

  let highest = 0;
  triggered.forEach((rule) => {
    highest = Math.max(highest, severityRank[rule.severity] || 0);
  });

  let confidence = 'high';
  if (missingRecommended.length >= 1) confidence = 'medium';
  if (missingRecommended.length >= 2) confidence = 'low';

  if (triggered.length === 0) {
    return {
      triage_status: 'Proceed',
      confidence,
      short_explanation: 'No caution/review/high-risk thresholds were triggered for this stage.',
      reasons_triggered: [],
      missing_required_fields: missing,
      missing_recommended_fields: missingRecommended,
      warnings,
      suggested_action: 'Proceed per SOP; continue routine QC checks.',
      rationale: `Stage ${record.stage}: all configured thresholds passed.${warnings.length ? ` Additional trace context: ${warnings.join(' ')}` : ''}`
    };
  }

  const triage_status = statusMap[highest] || 'Proceed';
  const reasons_triggered = triggered.map((r) => r.id);
  const suggested_action = triggered[0]?.suggested_action || 'Review triggered metrics and apply SOP judgement.';

  return {
    triage_status,
    confidence,
    short_explanation: `${triage_status} due to ${triggered.length} triggered threshold(s).`,
    reasons_triggered,
    missing_required_fields: missing,
    missing_recommended_fields: missingRecommended,
    warnings,
    suggested_action,
    rationale: `${triggered.map((r) => `${r.id}: ${r.message} (metric ${r.metric} ${r.operator} ${r.threshold}).`).join(' ')}${warnings.length ? ` Additional trace context: ${warnings.join(' ')}` : ''}`
  };
}
