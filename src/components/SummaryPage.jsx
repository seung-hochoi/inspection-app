import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Package, TrendingUp, ClipboardList } from 'lucide-react';
import { C, radius, font, shadow } from './styles';

export default function SummaryPage({ summary = {}, happycall = {}, jobRows = [], historyData = [], config = {}, inspTargetSku: inspTargetSkuProp, onToast, onRefresh }) { // eslint-disable-line no-unused-vars

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => summary || {}, [summary]);

  // ── KPI computation — backend summary is source of truth; CSV is fallback ──
  const { totalOrderedQty, totalSku, inspTargetSku, totalAmount, hasPriceData } = useMemo(() => {
    const reservationRows = Array.isArray(config.reservation_rows) ? config.reservation_rows : [];
    const excludeRows     = Array.isArray(config.exclude_rows)     ? config.exclude_rows     : [];
    const hasJobRows      = Array.isArray(jobRows) && jobRows.length > 0;

    // Read a numeric field from the backend summary object (s).
    // Returns null when the key is absent, empty string, or non-finite.
    // Backend field names match the inspection_summary sheet headers written by
    // updateInspectionDashboard_() in Code.gs.
    const fromSummary = (key) => {
      const v = s[key];
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      return isFinite(n) ? n : null;
    };

    // Priority 1: backend-calculated values (populated by manualRecalc)
    //   "총 입고금액"  → total inbound amount (qty × 입고원가 for all rows)
    //   "총 입고수량"  → total ordered quantity
    //   "입고 SKU"    → distinct product codes across all rows
    //   "검품입고 SKU" → distinct codes after applying 제외목록 exclusions
    const bAmount  = fromSummary('총 입고금액');
    const bQty     = fromSummary('총 입고수량');
    const bSku     = fromSummary('입고 SKU');
    const bInspSku = fromSummary('검품입고 SKU');

    // Fast-path: all four backend values are present — return immediately, no CSV scan needed
    if (bAmount !== null && bQty !== null && bSku !== null && bInspSku !== null) {
      return {
        totalOrderedQty: bQty,
        totalSku:        bSku,
        inspTargetSku:   bInspSku,
        totalAmount:     bAmount,
        hasPriceData:    bAmount > 0,
      };
    }

    // Priority 2 (no CSV rows loaded yet): return whatever backend has, zero-fill the rest
    if (!hasJobRows && reservationRows.length === 0) {
      return {
        totalOrderedQty: bQty  ?? 0,
        totalSku:        bSku  ?? 0,
        inspTargetSku:   bInspSku ?? (bSku ?? 0),
        totalAmount:     bAmount  ?? 0,
        hasPriceData:    bAmount !== null && bAmount > 0,
      };
    }

    // Priority 3: client-side computation from loaded CSV rows (fallback / partial fill)
    const PRICE_COLS      = ['금액', '발주금액', '입고금액', '공급금액', '총금액', '합계금액'];
    const UNIT_PRICE_COLS = ['단가', '공급단가', '매입단가'];
    const COST_COLS       = ['입고원가', '상품원가', '원가'];
    const CODE_COLS       = ['상품코드', '상품 코드', '코드', '바코드'];
    const QTY_COLS        = ['발주수량', '입고수량', '수량'];

    // Normalize raw CSV value → number; handles commas, =T("...") wrappers, quotes
    const toNumber = (raw) => {
      if (raw == null || raw === '') return NaN;
      let str = String(raw).trim();
      const tMatch = str.match(/^=T\("(.+)"\)$/i);
      if (tMatch) str = tMatch[1];
      str = str.replace(/^"+|"+$/g, '').replace(/,/g, '').trim();
      return Number(str);
    };

    const isExcludedRow = (code, partner) => {
      const normCode = String(code || '').trim().toLowerCase();
      if (!normCode) return false;
      for (const ex of excludeRows) {
        const use = String(ex['사용여부'] || '').trim().toUpperCase();
        if (use !== 'TRUE') continue;
        const exCode = String(ex['상품코드'] || '').trim().toLowerCase();
        if (!exCode || exCode !== normCode) continue;
        const exPartner = String(ex['협력사'] || ex['협력사명'] || '').trim().toLowerCase();
        if (!exPartner) return true;
        if (exPartner === String(partner || '').trim().toLowerCase()) return true;
      }
      return false;
    };

    let csvAmount   = 0;
    let csvHasPrice = false;
    const codes     = new Set();
    const inspCodes = new Set();
    let csvQtySum   = 0;

    for (const r of (hasJobRows ? jobRows : [])) {
      const code    = r.__productCode || '';
      const qty     = Number(r.__qty) || 0;
      const partner = r.__partner || r['협력사명'] || '';
      const skuKey  = code + '||' + partner;
      csvQtySum += qty;
      if (code) codes.add(skuKey);
      if (code && qty > 0 && !isExcludedRow(code, partner)) inspCodes.add(skuKey);

      let rowAmount = NaN;
      for (const col of PRICE_COLS) {
        const v = toNumber(r[col]);
        if (!isNaN(v) && v > 0) { rowAmount = v; break; }
      }
      if ((isNaN(rowAmount) || rowAmount === 0) && qty > 0) {
        for (const col of UNIT_PRICE_COLS) {
          const p = toNumber(r[col]);
          if (!isNaN(p) && p > 0) { rowAmount = p * qty; break; }
        }
      }
      if ((isNaN(rowAmount) || rowAmount === 0) && qty > 0) {
        for (const col of COST_COLS) {
          const p = toNumber(r[col]);
          if (!isNaN(p) && p > 0) { rowAmount = p * qty; break; }
        }
      }
      if (!isNaN(rowAmount) && rowAmount > 0) { csvAmount += rowAmount; csvHasPrice = true; }
    }

    for (const r of reservationRows) {
      const getField = (cols) => {
        for (const c of cols) { const v = r[c]; if (v !== undefined && v !== '' && v !== null) return v; }
        return '';
      };
      const code    = String(getField(CODE_COLS) || '').trim();
      const qty     = toNumber(getField(QTY_COLS) || '0') || 0;
      const partner = String(r['협력사명'] || r['협력사'] || '').trim();
      const skuKey  = code + '||' + partner;
      csvQtySum += qty;
      if (code) codes.add(skuKey);
      if (code && qty > 0 && !isExcludedRow(code, partner)) inspCodes.add(skuKey);
      const rawCost = getField(COST_COLS);
      if (rawCost !== '') {
        const cost = toNumber(rawCost);
        if (!isNaN(cost) && cost > 0 && qty > 0) { csvAmount += cost * qty; csvHasPrice = true; }
      }
    }

    // Merge: backend values override CSV-derived values wherever available
    const finalAmount   = (bAmount !== null && bAmount > 0) ? bAmount : csvAmount;
    const finalHasPrice = (bAmount !== null && bAmount > 0) || csvHasPrice;

    return {
      totalOrderedQty: bQty     !== null ? bQty     : csvQtySum,
      totalSku:        bSku     !== null ? bSku     : codes.size,
      inspTargetSku:   bInspSku !== null ? bInspSku : inspCodes.size,
      totalAmount:     finalAmount,
      hasPriceData:    finalHasPrice,
    };
  }, [jobRows, config.reservation_rows, config.exclude_rows, s]);

  // Use the inspection-tab SKU count passed from App.js when available,
  // so the KPI card always matches the header SKU badge exactly.
  const resolvedInspTargetSku = inspTargetSkuProp != null ? inspTargetSkuProp : inspTargetSku;

  // Pull the most recent history row for live metrics (검품수량, 검품률, SKU 커버리지, etc.)
  const latestHistory = useMemo(() => {
    if (!Array.isArray(historyData) || historyData.length === 0) return null;
    // Sanitize 일자 before sorting so timezone strings don't break order
    const safe = (d) => {
      const s = String(d || '');
      const m = s.match(/(\d{1,2})\/(\d{1,2})/);
      if (m) return String(m[1]).padStart(2, '0') + '/' + String(m[2]).padStart(2, '0');
      const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return iso[2] + '/' + iso[3];
      return s;
    };
    return [...historyData].sort((a, b) => safe(b['일자']).localeCompare(safe(a['일자'])))[0];
  }, [historyData]);

  // Read a field from the latest history row. Tries multiple key aliases.
  // Returns a parsed number if valid (including 0), or null if the cell is truly empty.
  const fromHist = (...keys) => {
    if (!latestHistory) return null;
    for (const key of keys) {
      const v = latestHistory[key];
      if (v == null || v === '') continue;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[%,]/g, '').trim());
      if (isFinite(n)) return n;
    }
    return null;
  };

  // Format percentage: always 1 decimal place. Returns '-' only when value is truly null.
  const fmtPct = (v) => v != null ? (v * 100).toFixed(1) + '%' : '-';

  // Format quantity: comma-separated integers.
  const fmtQty = (v) => v != null ? Math.round(v).toLocaleString('ko-KR') : '-';

  // Format monetary amount:
  //   >= 100,000,000 → "X.X억"  (unit "원" is shown in the card's sub label)
  //   otherwise      → comma-separated number
  const fmtAmt = (v) => {
    if (v == null) return '-';
    if (v >= 100_000_000) return (v / 100_000_000).toFixed(1) + '억';
    return Math.round(v).toLocaleString('ko-KR');
  };

  // ── Values from the latest "이력" archive row — sole source of truth for KPI cards ──
  // All 12 KPI cards read exclusively from the latest history snapshot.
  // Rates are stored as plain numbers (e.g. 87.6) after the fmtRate fix in Code.gs.
  // fromHist() tries each alias in order; both space and no-space variants are listed
  // because the actual sheet may have been created before HIST_HEADERS_ was standardised.
  const histTotalAmt     = fromHist('총 입고금액');
  const histTargetAmt    = fromHist('총 입고금액(냉동/가공/계란 제외)',    '총 입고금액 (냉동/가공/계란 제외)');
  const histTotalQty     = fromHist('총 입고수량(개)');
  const histTargetQty    = fromHist('총 입고수량(개)(냉동/가공/계란 제외)', '총 입고수량(개) (냉동/가공/계란 제외)');
  const histInspQty      = fromHist('검품수량(개)');
  const histInspRate     = fromHist('검품률(전체)',                        '검품률 (전체)',                       '검품률');
  const histInspRateExcl = fromHist('검품률(냉동/가공/계란 제외)',          '검품률 (냉동/가공/계란 제외)');
  const histTotalSku     = fromHist('입고 SKU (전체)',                     '입고 SKU(전체)');
  const histTargetSku    = fromHist('검품입고 SKU (검품불가 제외)',          '검품입고 SKU(검품불가 제외)',          '검품대상 SKU');
  const histInspSku      = fromHist('검품 SKU (실진행)',                   '검품 SKU(실진행)');
  const histSkuCovAll    = fromHist('SKU 커버리지(전체)',                   'SKU 커버리지 (전체)');
  const histSkuCovExcl   = fromHist('SKU 커버리지(냉동/가공/계란 제외)',    'SKU 커버리지 (냉동/가공/계란 제외)');

  const kpis = [
    {
      label: '총 금액',
      value: fmtAmt(histTotalAmt),
      sub: '원',
      color: C.primary, bg: C.primaryLight, border: C.primaryMid,
      icon: <BarChart3 size={16} strokeWidth={2} />,
    },
    {
      label: '검품대상 금액',
      value: fmtAmt(histTargetAmt),
      sub: '원 (제외목록 제외)',
      color: C.primary, bg: C.primaryLight, border: C.primaryMid,
      icon: <BarChart3 size={16} strokeWidth={2} />,
    },
    {
      label: '총 SKU',
      value: histTotalSku != null ? String(Math.round(histTotalSku)) : '-',
      sub: '품목',
      color: C.textSec || '#64748b', bg: C.bgAlt, border: C.border,
      icon: <Package size={16} strokeWidth={2} />,
    },
    {
      label: '검품대상 SKU',
      value: histTargetSku != null ? String(Math.round(histTargetSku)) : '-',
      sub: '품목 (제외목록 제외)',
      color: C.orange, bg: C.orangeLight, border: C.orangeMid,
      icon: <ClipboardList size={16} strokeWidth={2} />,
    },
    {
      label: '총 수량',
      value: fmtQty(histTotalQty),
      sub: '개',
      color: C.green, bg: C.greenLight, border: C.greenMid,
      icon: <TrendingUp size={16} strokeWidth={2} />,
    },
    {
      label: '검품대상 수량',
      value: fmtQty(histTargetQty),
      sub: '개 (제외목록 제외)',
      color: C.green, bg: C.greenLight, border: C.greenMid,
      icon: <TrendingUp size={16} strokeWidth={2} />,
    },
    {
      label: '검품수량',
      value: fmtQty(histInspQty),
      sub: '개',
      color: C.primary, bg: C.primaryLight, border: C.primaryMid,
      icon: <ClipboardList size={16} strokeWidth={2} />,
    },
    {
      label: '검품 SKU (실진행)',
      value: histInspSku != null ? String(Math.round(histInspSku)) : '-',
      sub: '품목',
      color: C.orange, bg: C.orangeLight, border: C.orangeMid,
      icon: <Package size={16} strokeWidth={2} />,
    },
    {
      label: '검품률 (전체)',
      value: fmtPct(histInspRate),
      sub: '검품수량 / 총 수량',
      color: C.primary, bg: C.primaryLight, border: C.primaryMid,
      icon: <TrendingUp size={16} strokeWidth={2} />,
    },
    {
      label: '검품률 (대상기준)',
      value: fmtPct(histInspRateExcl),
      sub: '검품수량 / 검품대상 수량',
      color: C.primary, bg: C.primaryLight, border: C.primaryMid,
      icon: <TrendingUp size={16} strokeWidth={2} />,
    },
    {
      label: 'SKU 커버리지 (전체)',
      value: fmtPct(histSkuCovAll),
      sub: '검품SKU / 총SKU',
      color: C.orange, bg: C.orangeLight, border: C.orangeMid,
      icon: <BarChart3 size={16} strokeWidth={2} />,
    },
    {
      label: 'SKU 커버리지 (대상기준)',
      value: fmtPct(histSkuCovExcl),
      sub: '검품SKU / 검품대상SKU',
      color: C.orange, bg: C.orangeLight, border: C.orangeMid,
      icon: <BarChart3 size={16} strokeWidth={2} />,
    },
  ];

  const partnerSummaries = s['협력사별'] || s.partners || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ padding: '14px 12px 80px' }}
    >
      {/* ── 12 KPI cards (3 per row) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 9, marginBottom: 18 }}>
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: i * 0.04 }}
            style={{
              background: k.bg, borderRadius: radius.md,
              border: `1px solid ${k.border}`,
              padding: '13px 12px 11px',
              boxShadow: shadow.xs,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <p style={{ margin: 0, fontSize: 9.5, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: font.base }}>{k.label}</p>
              <span style={{ color: k.color, opacity: 0.65 }}>{k.icon}</span>
            </div>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: k.color, fontFamily: font.base, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{k.value}</p>
            {k.sub && <p style={{ margin: '3px 0 0', fontSize: 10, color: C.muted, fontFamily: font.base }}>{k.sub}</p>}
          </motion.div>
        ))}
      </div>

      {/* ── Trend chart ── */}
      {historyData.length > 0 && (
        <TrendChart historyData={historyData} />
      )}

      {/* ── Per-partner table ── */}
      {Array.isArray(partnerSummaries) && partnerSummaries.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: radius.lg,
          border: `1px solid ${C.border}`, boxShadow: shadow.sm,
          overflow: 'hidden', marginTop: 14,
        }}>
          <div style={{
            padding: '11px 16px', borderBottom: `1px solid ${C.border}`,
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>협력사별 현황</p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontFamily: font.base }}>
              <thead>
                <tr style={{ background: C.bgAlt }}>
                  {['협력사', '발주', '검품', '회송', '교환', '검품률'].map((h) => (
                    <th key={h} style={{
                      padding: '8px 12px', textAlign: h === '협력사' ? 'left' : 'right',
                      color: C.muted2, fontWeight: 700, fontSize: 10.5,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: `1px solid ${C.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partnerSummaries.map((p, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: C.text }}>{p['협력사명'] || p.name || '-'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.textSec, fontWeight: 500 }}>{p['발주수량'] || p.ordered || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 600 }}>{p['검품수량'] || p.inspected || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.red, fontWeight: 600 }}>{p['회송수량'] || p.returned || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.orange, fontWeight: 600 }}>{p['교환수량'] || p.exchanged || 0}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: C.primary, fontWeight: 700 }}>{p['검품률'] || p.rate || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Trend chart sub-component ──────────────────────────────────────────────────
const CHART_METRICS = [
  { key: '총 입고금액',                              label: '총 금액',          color: '#5876a4' },
  { key: '총 입고금액 (냉동/가공/계란 제외)',          label: '검품대상 금액',     color: '#8b5cf6' },
  { key: '총 입고수량(개)',                           label: '총 수량',           color: '#16a34a' },
  { key: '총 입고수량(개) (냉동/가공/계란 제외)',       label: '검품대상 수량',     color: '#059669' },
  { key: '검품수량(개)',                              label: '검품수량',           color: '#2563eb' },
  { key: '입고 SKU (전체)',                           label: '총 SKU',            color: '#d97706' },
  { key: '검품입고 SKU (검품불가 제외)',               label: '검품대상 SKU',      color: '#e11d48' },
  { key: '검품 SKU (실진행)',                         label: '검품 SKU',           color: '#f59e0b' },
  { key: '검품률 (전체)',                             label: '검품률(전체)',        color: '#06b6d4' },
  { key: '검품률 (냉동/가공/계란 제외)',               label: '검품률(대상)',        color: '#0284c7' },
  { key: 'SKU 커버리지 (전체)',                       label: 'SKU 커버리지(전체)', color: '#84cc16' },
  { key: 'SKU 커버리지 (냉동/가공/계란 제외)',         label: 'SKU 커버리지(대상)', color: '#65a30d' },
];

const PERIODS = ['일별', '주별', '월별'];

function isoWeek(dateStr) {
  // dateStr: "MM/dd" — assume current year for charting
  const year = new Date().getFullYear();
  const [m, d] = String(dateStr).split('/').map(Number);
  if (!m || !d) return dateStr;
  const date = new Date(year, m - 1, d);
  const dayOfYear = Math.floor((date - new Date(year, 0, 0)) / 86400000);
  return `${year}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;
}

function isoMonth(dateStr) {
  const [m] = String(dateStr).split('/').map(Number);
  if (!m) return dateStr;
  return `${new Date().getFullYear()}-${String(m).padStart(2, '0')}`;
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(sanitizeDateLabel(r['일자'] || ''));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function aggregateGroup(rows, metricKey) {
  // Use the last row per group (most recent recalc for that period)
  const last = rows[rows.length - 1];
  const v = last[metricKey];
  return (typeof v === 'number') ? v : Number(String(v || '0').replace(/,/g, '')) || 0;
}

// Sanitize a raw 일자 value from the 이력관리 sheet into a clean "M/D" label.
// Handles GAS-formatted "MM/dd" strings, JS Date toStrings with timezone
// text like "(표준시)", and full ISO strings.
function sanitizeDateLabel(raw) {
  const s = String(raw || '').trim();
  // Already in MM/dd or M/d format
  const mSlash = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mSlash) return `${+mSlash[1]}/${+mSlash[2]}`;
  // ISO date: 2025-04-07T...
  const mIso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${+mIso[2]}/${+mIso[3]}`;
  // Fallback: find any NN/NN pattern anywhere in the string
  const mAny = s.match(/(\d{1,2})\/(\d{1,2})/);
  if (mAny) return `${+mAny[1]}/${+mAny[2]}`;
  return s;
}

function TrendChart({ historyData }) {
  const [period, setPeriod] = useState('일별');
  const [metric, setMetric] = useState(0); // index into CHART_METRICS

  const chartData = useMemo(() => {
    const sorted = [...historyData].sort((a, b) => String(a['일자']).localeCompare(String(b['일자'])));
    let grouped;
    if (period === '일별') {
      grouped = groupBy(sorted, (d) => d); // groupBy already calls sanitizeDateLabel
    } else if (period === '주별') {
      grouped = groupBy(sorted, (d) => isoWeek(d));
    } else {
      grouped = groupBy(sorted, (d) => isoMonth(d));
    }
    const mk = CHART_METRICS[metric].key;
    const points = [];
    for (const [label, rows] of grouped) {
      points.push({ label, value: aggregateGroup(rows, mk) });
    }
    return points;
  }, [historyData, period, metric]);

  const maxVal = Math.max(...chartData.map((p) => p.value), 1);
  const m = CHART_METRICS[metric];
  const W = 480; const H = 180; const PAD = { t: 10, r: 10, b: 32, l: 52 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const barW = Math.max(6, Math.min(32, innerW / Math.max(chartData.length, 1) - 6));

  return (
    <div style={{
      background: '#fff', borderRadius: radius.lg,
      border: `1px solid ${C.border}`, boxShadow: shadow.sm,
      overflow: 'hidden', marginBottom: 14,
    }}>
      <div style={{
        padding: '10px 14px 8px',
        borderBottom: `1px solid ${C.border}`,
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>추이</p>
        {/* Period tabs */}
        <div style={{ display: 'flex', gap: 3 }}>
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              height: 26, padding: '0 9px', border: 'none', borderRadius: radius.sm,
              background: period === p ? C.primaryLight : 'transparent',
              color: period === p ? C.primary : C.muted,
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: font.base,
            }}>{p}</button>
          ))}
        </div>
      </div>

      {/* Metric selector */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 14px 0', flexWrap: 'wrap' }}>
        {CHART_METRICS.map((cm, i) => (
          <button key={cm.key} onClick={() => setMetric(i)} style={{
            height: 24, padding: '0 8px', border: `1.5px solid ${i === metric ? cm.color : C.border}`,
            borderRadius: radius.full, fontSize: 10, fontWeight: 700,
            background: i === metric ? cm.color + '18' : 'transparent',
            color: i === metric ? cm.color : C.muted,
            cursor: 'pointer', fontFamily: font.base,
          }}>{cm.label}</button>
        ))}
      </div>

      <div style={{ padding: '8px 14px 12px' }}>
        {chartData.length < 2 ? (
          <p style={{ margin: '12px 0 4px', fontSize: 12, color: C.muted, textAlign: 'center' }}>
            데이터 없음 — 이력관리 기록을 2회 이상 실행하면 추이가 표시됩니다
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', height: 'auto', minHeight: H, display: 'block', overflow: 'visible' }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Y grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const y = PAD.t + innerH * (1 - t);
              const val = maxVal * t;
              const labelText = val >= 100_000_000
                ? (val / 100_000_000).toFixed(1) + '억'
                : val >= 1_000_000
                ? (val / 1_000_000).toFixed(1) + 'M'
                : val >= 1_000
                ? (val / 1_000).toFixed(0) + 'K'
                : String(Math.round(val));
              return (
                <g key={t}>
                  <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={C.border} strokeWidth={0.8} />
                  <text x={PAD.l - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill={C.muted}>{labelText}</text>
                </g>
              );
            })}
            {/* Bars + labels */}
            {chartData.map((pt, i) => {
              const step = innerW / chartData.length;
              const cx = PAD.l + step * i + step / 2;
              const barH = Math.max(2, (pt.value / maxVal) * innerH);
              const bx = cx - barW / 2;
              const by = PAD.t + innerH - barH;
              return (
                <g key={i}>
                  <rect x={bx} y={by} width={barW} height={barH} rx={2}
                    fill={m.color} fillOpacity={0.82} />
                  <text x={cx} y={H - PAD.b + 13} textAnchor="middle" fontSize={8.5} fill={C.muted}>
                    {pt.label}
                  </text>
                </g>
              );
            })}
            {/* Line overlay */}
            {chartData.length >= 2 && (() => {
              const pts = chartData.map((pt, i) => {
                const step = innerW / chartData.length;
                const cx = PAD.l + step * i + step / 2;
                const cy = PAD.t + innerH - Math.max(2, (pt.value / maxVal) * innerH);
                return `${cx},${cy}`;
              });
              return (
                <polyline
                  points={pts.join(' ')}
                  fill="none"
                  stroke={m.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}
