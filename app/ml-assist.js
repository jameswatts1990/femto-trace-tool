const MODEL_STATE_KEY = 'femto_ml_model_state_v1';
const FEEDBACK_KEY = 'femto_ml_feedback_v1';

const DEFAULT_STATE = {
  mode: 'assist',
  modelVersion: 'ml-baseline-v0.1.0',
  datasetVersion: 'reviewed-feedback-v0',
  trainedAt: null,
  confidenceThresholds: {
    autoAccept: 0.9,
    review: 0.65
  },
  stageOverrides: {},
  holdoutAccuracy: null
};

const ANOMALY_KEYWORDS = [
  { key: 'adapter_dimer_risk', tokens: ['adapter', 'dimer'] },
  { key: 'short_fragment_excess', tokens: ['0-1000', 'short'] },
  { key: 'low_molarity', tokens: ['molarity'] },
  { key: 'yield_concern', tokens: ['concentration', 'total_dna'] }
];

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const getModelState = () => safeParse(localStorage.getItem(MODEL_STATE_KEY), DEFAULT_STATE);

export const getFeedbackLog = () => safeParse(localStorage.getItem(FEEDBACK_KEY), []);

const saveModelState = (state) => localStorage.setItem(MODEL_STATE_KEY, JSON.stringify(state));
const saveFeedbackLog = (entries) => localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));

const normalizeReasonTags = (tags = []) => tags.filter(Boolean).map((tag) => String(tag).trim().toLowerCase());

const inferAnomalyType = (result) => {
  const reasonText = `${result.reasons_triggered || []}`.toLowerCase();
  const matched = ANOMALY_KEYWORDS.find(({ tokens }) => tokens.some((token) => reasonText.includes(token)));
  return matched ? matched.key : 'general_quality_signal';
};

const buildTopFactors = (record, result, learnedLabel) => {
  const factors = [];
  if (record.percent_0_1000_bp !== undefined && record.percent_0_1000_bp !== '') {
    factors.push(`% 0-1000 bp: ${record.percent_0_1000_bp}`);
  }
  if (record.library_molarity_nM !== undefined && record.library_molarity_nM !== '') {
    factors.push(`Library molarity nM: ${record.library_molarity_nM}`);
  }
  if (record.percent_0_1000_bp_source) {
    factors.push(`Short-fragment source: ${record.percent_0_1000_bp_source}`);
  }
  if (result.reasons_triggered?.length) {
    factors.push(`Triggered rules: ${result.reasons_triggered.slice(0, 2).join(', ')}`);
  }
  if (learnedLabel) {
    factors.push(`Prior reviewed outcome for stage: ${learnedLabel}`);
  }
  return factors.slice(0, 3);
};

const confidenceBucket = (score) => {
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
};

export const predictAssistedLabel = (record, result, modelState = getModelState()) => {
  const stageLearned = modelState.stageOverrides?.[record.stage];
  const baseMatchBoost = stageLearned && stageLearned === result.triage_status ? 0.1 : 0;
  const stageConflictPenalty = stageLearned && stageLearned !== result.triage_status ? 0.12 : 0;
  const ruleConfidenceBoost = result.confidence === 'high' ? 0.2 : result.confidence === 'medium' ? 0.05 : -0.05;

  const numericConfidence = Math.max(
    0.35,
    Math.min(0.98, 0.65 + baseMatchBoost + ruleConfidenceBoost - stageConflictPenalty)
  );

  const predictedLabel = stageConflictPenalty > 0 ? stageLearned : result.triage_status;
  const bucket = confidenceBucket(numericConfidence);
  const reviewRequired = numericConfidence < modelState.confidenceThresholds.autoAccept
    || result.triage_status === 'High risk'
    || result.triage_status === 'Fail/hold';

  return {
    predictionType: 'triage_status',
    predictedLabel,
    numericConfidence,
    confidenceBucket: bucket,
    reviewRequired,
    anomalyType: inferAnomalyType(result),
    rootCauseCandidate: result.reasons_triggered?.[0] || 'insufficient_signal',
    topFactors: buildTopFactors(record, result, stageLearned)
  };
};

export const recordReviewFeedback = ({
  record,
  prediction,
  correctedLabel,
  reviewerId,
  reviewerRole,
  reasonTags
}) => {
  const entries = getFeedbackLog();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    inputFeatures: {
      sample_id: record.sample_id,
      stage: record.stage,
      percent_0_1000_bp: record.percent_0_1000_bp,
      avg_fragment_size_bp: record.avg_fragment_size_bp,
      concentration_ng_ul: record.concentration_ng_ul,
      library_molarity_nM: record.library_molarity_nM
    },
    modelPrediction: prediction.predictedLabel,
    modelConfidence: prediction.numericConfidence,
    anomalyType: prediction.anomalyType,
    rootCauseCandidate: prediction.rootCauseCandidate,
    correctedLabel,
    decision: correctedLabel === prediction.predictedLabel ? 'agree' : 'corrected',
    reasonTags: normalizeReasonTags(reasonTags),
    reviewerId: reviewerId || 'anonymous',
    reviewerRole: reviewerRole || 'operator',
    modelVersion: getModelState().modelVersion,
    datasetVersion: getModelState().datasetVersion
  };
  entries.push(entry);
  saveFeedbackLog(entries);
  return entry;
};

const isHoldoutEntry = (entry) => {
  const source = `${entry.inputFeatures.sample_id || ''}${entry.timestamp}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 5 === 0;
};

const deriveStageOverrides = (entries) => {
  const counts = {};
  entries.forEach((entry) => {
    const stage = entry.inputFeatures.stage || 'unknown';
    counts[stage] = counts[stage] || {};
    counts[stage][entry.correctedLabel] = (counts[stage][entry.correctedLabel] || 0) + 1;
  });

  return Object.fromEntries(Object.entries(counts).map(([stage, stageCounts]) => {
    const [label] = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0];
    return [stage, label];
  }));
};

export const retrainModelFromFeedback = () => {
  const feedback = getFeedbackLog();
  if (!feedback.length) return null;

  const trainSet = feedback.filter((entry) => !isHoldoutEntry(entry));
  const holdoutSet = feedback.filter((entry) => isHoldoutEntry(entry));
  if (!trainSet.length) return null;

  const state = getModelState();
  const stageOverrides = deriveStageOverrides(trainSet);

  let holdoutMatches = 0;
  holdoutSet.forEach((entry) => {
    const predicted = stageOverrides[entry.inputFeatures.stage] || entry.modelPrediction;
    if (predicted === entry.correctedLabel) holdoutMatches += 1;
  });

  const holdoutAccuracy = holdoutSet.length ? holdoutMatches / holdoutSet.length : null;
  const nextVersionNum = Number((state.modelVersion.match(/v(\d+\.\d+\.\d+)$/)?.[1] || '0.1.0').split('.')[2]) + 1;
  const nextState = {
    ...state,
    modelVersion: `ml-baseline-v0.1.${nextVersionNum}`,
    datasetVersion: `reviewed-feedback-v${feedback.length}`,
    trainedAt: new Date().toISOString(),
    stageOverrides,
    holdoutAccuracy
  };
  saveModelState(nextState);
  return nextState;
};

export const getReviewQueueSummary = () => {
  const feedback = getFeedbackLog();
  const needsReviewReasons = ['false positive', 'missing context', 'low confidence'];
  const taggedForFocus = feedback.filter((entry) =>
    entry.reasonTags.some((tag) => needsReviewReasons.includes(tag))
  ).length;

  return {
    totalReviewed: feedback.length,
    highPriorityExamples: taggedForFocus
  };
};
