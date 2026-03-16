const numericFields = [
  'percent_0_1000_bp',
  'avg_fragment_size_bp',
  'peak_size_bp',
  'library_molarity_nM',
  'concentration_ng_ul',
  'total_dna_ng'
];

const normalizeHeader = (header) => header.trim().toLowerCase();

const parseDelimited = (text) => {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const firstLine = trimmed.split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];

    if (ch === '"') {
      if (inQuotes && trimmed[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && trimmed[i + 1] === '\n') i += 1;
      row.push(current.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    if (row.some((cell) => cell !== '')) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const record = {};
    headers.forEach((h, i) => {
      record[h] = (cols[i] || '').trim();
    });
    return record;
  });
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeTemplateRecord = (record) => {
  const normalized = { ...record };
  numericFields.forEach((field) => {
    const n = toNumber(normalized[field]);
    if (n !== undefined) normalized[field] = n;
  });
  return normalized;
};

const isFemtoExport = (headers) => {
  const normalized = headers.map(normalizeHeader);
  return normalized.includes('well')
    && normalized.includes('sample id')
    && normalized.includes('size (bp)')
    && normalized.some((h) => h.startsWith('% (conc.)'))
    && normalized.includes('avg. size')
    && normalized.includes('tic (ng/ul)')
    && normalized.some((h) => h.startsWith('tim (nmole/'));
};

const normalizeFemtoRecord = (record, defaultDate) => {
  const sampleId = record['Sample ID'] || '';
  const stageGuess = sampleId.toLowerCase().includes('prlib') ? 'final_library' : 'post_library';

  const shortPercent = toNumber(record['short_percent']) ?? 0;
  const normalized = {
    sample_id: sampleId,
    project_id: sampleId.includes(':') ? sampleId.split(':')[0] : '',
    batch_id: record['Well'] || '',
    stage: stageGuess,
    date_analyzed: defaultDate,
    percent_0_1000_bp: Math.min(100, Math.max(0, Number(shortPercent.toFixed(3)))),
    avg_fragment_size_bp: toNumber(record['Avg. Size']),
    peak_size_bp: toNumber(record['dominant_peak_size_bp']),
    concentration_ng_ul: toNumber(record['TIC (ng/ul)']),
    library_molarity_nM: toNumber(record['TIM (nmole/L)']),
    total_dna_ng: undefined,
    notes: 'Auto-mapped from Femto output CSV.'
  };

  numericFields.forEach((field) => {
    if (normalized[field] === undefined) delete normalized[field];
  });

  return normalized;
};

const aggregateFemtoRows = (rows) => {
  const bySample = new Map();

  rows.forEach((row) => {
    const sampleId = row['Sample ID'];
    if (!sampleId) return;

    const key = `${row['Well'] || ''}::${sampleId}`;
    if (!bySample.has(key)) {
      bySample.set(key, {
        ...row,
        short_percent: 0,
        dominant_percent: -1,
        dominant_peak_size_bp: undefined
      });
    }

    const agg = bySample.get(key);
    const sizeBp = toNumber(row['Size (bp)']);
    const peakPercent = toNumber(row['% (Conc.) (ng/uL)'] ?? row['% (Conc.)']);

    if (sizeBp !== undefined && sizeBp <= 1000 && peakPercent !== undefined) {
      agg.short_percent += peakPercent;
    }

    if (peakPercent !== undefined && peakPercent > agg.dominant_percent) {
      agg.dominant_percent = peakPercent;
      agg.dominant_peak_size_bp = sizeBp;
    }

    ['Avg. Size', 'TIC (ng/ul)', 'TIM (nmole/L)', 'TIM (nmole/l)'].forEach((field) => {
      if ((!agg[field] || agg[field] === '') && row[field]) agg[field] = row[field];
    });
  });

  return [...bySample.values()];
};

export const parseBatchRows = (text) => {
  const rows = parseDelimited(text);
  if (!rows.length) return { rows: [], format: 'empty' };

  const headers = Object.keys(rows[0]);
  if (isFemtoExport(headers)) {
    const aggregated = aggregateFemtoRows(rows);
    const defaultDate = new Date().toISOString().slice(0, 10);
    return {
      rows: aggregated.map((row) => normalizeFemtoRecord(row, defaultDate)),
      format: 'femto_export'
    };
  }

  return {
    rows: rows.map((row) => normalizeTemplateRecord(row)),
    format: 'template'
  };
};
