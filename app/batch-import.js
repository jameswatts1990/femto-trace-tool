const numericFields = [
  'percent_0_1000_bp',
  'avg_fragment_size_bp',
  'peak_size_bp',
  'library_molarity_nM',
  'concentration_ng_ul',
  'total_dna_ng'
];

const normalizeHeader = (header) => header.replace(/^\uFEFF/, '').trim().toLowerCase();

const normalizeToken = (value) => normalizeHeader(value).replace(/[^a-z0-9]+/g, '');

const headerAliases = {
  well: ['well'],
  sampleId: ['sample id', 'sampleid'],
  sizeBp: ['size (bp)', 'sizebp'],
  peakId: ['peak id', 'peakid'],
  concPercent: ['% (conc.) (ng/ul)', '% (conc.) (ng/uL)', '% (conc.)', 'concpercent'],
  avgSize: ['avg. size', 'avg size', 'avgsize'],
  tic: ['tic (ng/ul)', 'tic ng/ul', 'tic(ng/ul)'],
  tim: ['tim (nmole/l)', 'tim (nmol/l)', 'tim (nmole/liter)', 'tim nmole/l']
};

const resolveHeaderMap = (headers) => {
  const tokenToHeader = new Map(headers.map((header) => [normalizeToken(header), header]));
  const lookup = (aliasList) => {
    for (const alias of aliasList) {
      const found = tokenToHeader.get(normalizeToken(alias));
      if (found) return found;
    }
    return undefined;
  };

  return {
    well: lookup(headerAliases.well),
    sampleId: lookup(headerAliases.sampleId),
    sizeBp: lookup(headerAliases.sizeBp),
    peakId: lookup(headerAliases.peakId),
    concPercent: lookup(headerAliases.concPercent),
    avgSize: lookup(headerAliases.avgSize),
    tic: lookup(headerAliases.tic),
    tim: lookup(headerAliases.tim)
  };
};

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
  const mapped = resolveHeaderMap(headers);
  return Boolean(mapped.well
    && mapped.sampleId
    && mapped.sizeBp
    && mapped.concPercent
    && mapped.avgSize
    && mapped.tic
    && mapped.tim);
};

const normalizeFemtoRecord = (record, defaultDate, headerMap) => {
  const sampleId = record[headerMap.sampleId] || '';
  const stageGuess = sampleId.toLowerCase().includes('prlib') ? 'final_library' : 'post_library';

  const shortPercent = toNumber(record['short_percent']) ?? 0;
  const normalized = {
    sample_id: sampleId,
    project_id: sampleId.includes(':') ? sampleId.split(':')[0] : '',
    batch_id: record[headerMap.well] || '',
    stage: stageGuess,
    date_analyzed: defaultDate,
    percent_0_1000_bp: Math.min(100, Math.max(0, Number(shortPercent.toFixed(3)))),
    avg_fragment_size_bp: toNumber(record[headerMap.avgSize]),
    peak_size_bp: toNumber(record['dominant_peak_size_bp']),
    concentration_ng_ul: toNumber(record[headerMap.tic]),
    library_molarity_nM: toNumber(record[headerMap.tim]),
    total_dna_ng: undefined,
    notes: 'Auto-mapped from Femto output CSV.'
  };

  numericFields.forEach((field) => {
    if (normalized[field] === undefined) delete normalized[field];
  });

  return normalized;
};

const aggregateFemtoRows = (rows, headerMap) => {
  const bySample = new Map();
  const stats = {
    peakRows: 0,
    blankSummaryRows: 0,
    invalidPercentRows: 0
  };

  rows.forEach((row) => {
    const sampleId = row[headerMap.sampleId];
    if (!sampleId) return;

    const key = `${row[headerMap.well] || ''}::${sampleId}`;
    if (!bySample.has(key)) {
      bySample.set(key, {
        ...row,
        short_percent: 0,
        dominant_percent: -1,
        dominant_peak_size_bp: undefined
      });
    }

    const agg = bySample.get(key);
    const sizeBp = toNumber(row[headerMap.sizeBp]);
    const peakId = toNumber(row[headerMap.peakId]);
    const peakPercent = toNumber(row[headerMap.concPercent]);

    if (peakId !== undefined) stats.peakRows += 1;
    if (peakId === undefined && row[headerMap.concPercent] === '') stats.blankSummaryRows += 1;
    if (row[headerMap.concPercent] && peakPercent === undefined) stats.invalidPercentRows += 1;

    if (sizeBp !== undefined && sizeBp <= 1000 && peakPercent !== undefined) {
      agg.short_percent += peakPercent;
    }

    if (peakPercent !== undefined && peakPercent > agg.dominant_percent) {
      agg.dominant_percent = peakPercent;
      agg.dominant_peak_size_bp = sizeBp;
    }

    [headerMap.avgSize, headerMap.tic, headerMap.tim].forEach((field) => {
      if (field && (!agg[field] || agg[field] === '') && row[field]) agg[field] = row[field];
    });
  });

  return {
    rows: [...bySample.values()],
    stats
  };
};

export const parseBatchRows = (text) => {
  const rows = parseDelimited(text);
  if (!rows.length) return { rows: [], format: 'empty' };

  const headers = Object.keys(rows[0]);
  if (isFemtoExport(headers)) {
    const headerMap = resolveHeaderMap(headers);
    const aggregated = aggregateFemtoRows(rows, headerMap);
    const defaultDate = new Date().toISOString().slice(0, 10);
    return {
      rows: aggregated.rows.map((row) => normalizeFemtoRecord(row, defaultDate, headerMap)),
      format: 'femto_export',
      metadata: {
        sourceRows: rows.length,
        sampleCount: aggregated.rows.length,
        ...aggregated.stats
      }
    };
  }

  return {
    rows: rows.map((row) => normalizeTemplateRecord(row)),
    format: 'template'
  };
};
