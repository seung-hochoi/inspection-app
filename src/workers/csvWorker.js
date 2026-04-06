/* eslint-disable no-restricted-globals */
/**
 * CSV Web Worker — decodes, parses, and normalizes a CSV file off the main thread.
 *
 * Why: Papa.parse + buildNormalizedRows for a 400-row CSV can take 20–60 ms on the
 * main thread, causing a visible frame drop.  Moving everything here (including
 * encoding detection) lets the browser keep 60 fps while the parse runs.
 *
 * Message in:  { buffer: ArrayBuffer }   (transferred — zero copy)
 * Message out: { type: 'result', normalized: Row[], jobKey: string }
 *           or { type: 'error',  message: string }
 */
import Papa from 'papaparse';

// ── Encoding detection ────────────────────────────────────────────────────────
function decodeCsv(buffer) {
  const tryDecode = (enc) => new TextDecoder(enc).decode(buffer);
  const isBroken  = (t)   => (t.match(/\uFFFD/g) || []).length > 5;
  let text = tryDecode('utf-8');
  if (isBroken(text)) text = tryDecode('euc-kr');
  return text;
}

// ── Normalization helpers (mirrors App.js — keep in sync if App.js changes) ──

const normalizeKey = (key) => String(key || '').replace(/\uFEFF/g, '').trim();

const normalizeText = (value) =>
  String(value ?? '').replace(/\uFEFF/g, '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

const normalizeProductCode = (value) => {
  if (value == null) return '';
  let text = String(value).replace(/\uFEFF/g, '').trim();
  const tMatch = text.match(/^=T\("(.+)"\)$/i);
  if (tMatch) text = tMatch[1];
  text = text.replace(/^"+|"+$/g, '').trim();
  const numericText = text.replace(/,/g, '').trim();
  if (/^\d+(\.0+)?$/.test(numericText)) return numericText.replace(/\.0+$/, '');
  return text;
};

const parseQty = (value) => {
  const num = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isNaN(num) ? 0 : num;
};

const getValue = (row, candidates) => {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return '';
};

const hashString = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return String(hash);
};

const computeJobKey = (rows) =>
  `job_${hashString(JSON.stringify((rows || []).map((r) => ({
    productCode: r.__productCode,
    productName: r.__productName,
    center:      r.__center,
    partner:     r.__partner,
    qty:         r.__qty,
  }))))}`;

function buildNormalizedRows(parsedRows) {
  return (parsedRows || []).map((rawRow, index) => {
    const row = {};
    Object.keys(rawRow || {}).forEach((k) => { row[normalizeKey(k)] = rawRow[k]; });

    const productCode = normalizeProductCode(
      getValue(row, ['상품코드', '상품 코드', '바코드', '코드']) || row.__productCode || ''
    );
    const productName = String(
      getValue(row, ['상품명', '상품 명', '품목명', '품명']) || row.__productName || ''
    ).trim();
    const rawPartner = getValue(
      row,
      ['협력사명(구매조건명)', '협력사명', '거래처명(구매조건명)', '거래처명', '협력사']
    ) || row.__partner || '';
    const partner = String(rawPartner).trim();
    const center  = String(getValue(row, ['센터명', '센터']) || row.__center || '').trim();
    const qty     = parseQty(getValue(row, ['총 발주수량', '발주수량', '수량']) || row.__qty || 0);

    return {
      ...row,
      '협력사명':     partner,
      '상품코드':     productCode,
      '상품명':       productName,
      '센터명':       center,
      '발주수량':     qty,
      '전체발주수량': qty,
      __id: `${productCode || 'empty'}-${center || 'nocenter'}-${partner || 'nopartner'}-${index}`,
      __index: index,
      __productCode: productCode,
      __productName: productName,
      __partner:     partner,
      __center:      center,
      __qty:         qty,
      __productNameNormalized: normalizeText(productName),
      __partnerNormalized:     normalizeText(partner),
    };
  });
}

// ── Worker entry point ────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const { buffer } = e.data;
  try {
    const text       = decodeCsv(buffer);
    const parsed     = Papa.parse(text, { header: true, skipEmptyLines: true });
    const normalized = buildNormalizedRows(parsed.data || []);
    const jobKey     = computeJobKey(normalized);
    self.postMessage({ type: 'result', normalized, jobKey });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || 'CSV 처리 오류' });
  }
};
