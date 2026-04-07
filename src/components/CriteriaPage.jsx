import React, {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { ScanLine } from 'lucide-react';
import { C, radius, font, shadow, inputStyle, btnPrimary } from './styles';
import { useCriteriaSearch, normalizeCriteriaKeyword } from '../utils/useCriteriaSearch';

// Lazy-load BarcodeScanner so @zxing/browser (~5 MB) is not in the initial bundle
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

// ─── local style tokens ──────────────────────────────────────────────────────

const st = {
  page: {
    padding: '12px 16px 32px',
    background: C.bg,
    minHeight: '100vh',
    fontFamily: font.base,
  },
  card: {
    background: C.card,
    borderRadius: radius.lg,
    border: `1px solid ${C.border}`,
    boxShadow: shadow.sm,
    padding: '14px 16px',
    marginBottom: '10px',
  },
  sectionLabel: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 700,
    color: C.muted,
    marginBottom: '6px',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  resultItem: (active) => ({
    padding: '10px 14px',
    borderRadius: radius.sm,
    border: `1px solid ${active ? C.primaryMid : C.border}`,
    marginBottom: '6px',
    cursor: 'pointer',
    background: active ? C.primaryLight : C.card,
    transition: 'background 0.13s, border-color 0.13s',
  }),
  tag: (muted) => ({
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 600,
    padding: '1px 7px',
    borderRadius: radius.full,
    background: C.bgAlt,
    color: muted ? C.muted : C.primary,
    marginRight: '6px',
    verticalAlign: 'middle',
  }),
  notice: {
    color: C.muted2 || '#94a3b8',
    fontSize: '13px',
    textAlign: 'center',
    padding: '20px 0',
  },
  errorMsg: {
    color: C.red,
    fontSize: '13px',
    marginTop: '8px',
  },
};

// Scan button — identical style to InspectionPage scan button
const scanBtnStyle = {
  ...btnPrimary,
  height: 40,
  padding: '0 14px',
  fontSize: 12.5,
  flexShrink: 0,
};

// Search input — reuses shared inputStyle, fixed height
const searchInputStyle = {
  ...inputStyle,
  paddingLeft: 14,
  height: 40,
  fontSize: 13,
};

// ─── SlideImage ───────────────────────────────────────────────────────────────

function SlideImage({ img }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      {failed ? (
        <div style={{
          ...st.notice,
          border: `1px solid ${C.border}`,
          borderRadius: radius.sm,
          padding: '12px',
        }}>
          이미지를 불러올 수 없습니다
        </div>
      ) : (
        <img
          src={img.url}
          alt={img.name}
          style={{ width: '100%', display: 'block', borderRadius: radius.sm, border: `1px solid ${C.border}` }}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px', textAlign: 'center' }}>
        {img.name}
      </div>
    </div>
  );
}

// ─── CriteriaPage ─────────────────────────────────────────────────────────────

/**
 * Props
 *   jobRows  – normalized inspection rows from App.js (barcode -> productName lookup)
 */
export default function CriteriaPage({ jobRows = [] }) {

  // ── criteria search/image states from shared hook ─────────────────────────
  const {
    searching, results, searchErr,
    loadingImages, imageData, imageErr, selectedFolder,
    search, loadImages, clearImages, reset,
  } = useCriteriaSearch();

  // ── UI-local state ────────────────────────────────────────────────────────
  const [nameQuery,      setNameQuery]      = useState('');
  const [barcodeQuery,   setBarcodeQuery]   = useState('');
  const [barcodeMatches, setBarcodeMatches] = useState([]); // ambiguous barcode results
  const [barcodeError,   setBarcodeError]   = useState('');
  const [showScanner,    setShowScanner]    = useState(false);

  // ── barcode -> [productName, ...] lookup ──────────────────────────────────
  const barcodeToNames = useMemo(() => {
    const map = {};
    for (const row of jobRows) {
      const code = (row.barcode || row['바코드'] || '').toString().trim();
      const name = (row['상품명'] || row.productName || row['품목명'] || '').toString().trim();
      if (!code || !name) continue;
      if (!map[code]) map[code] = new Set();
      map[code].add(name);
    }
    const out = {};
    for (const code of Object.keys(map)) out[code] = [...map[code]];
    return out;
  }, [jobRows]);

  // ── auto-search: debounced 300 ms after typing stops ─────────────────────
  useEffect(() => {
    const q = normalizeCriteriaKeyword(nameQuery);
    if (!q) {
      reset();
      setBarcodeMatches([]);
      setBarcodeError('');
      return;
    }
    const timer = setTimeout(() => search(q), 300);
    return () => clearTimeout(timer);
  }, [nameQuery, search, reset]);

  // ── barcode manual submit ─────────────────────────────────────────────────
  const handleBarcodeSubmit = useCallback(() => {
    const code = barcodeQuery.trim();
    if (!code) return;
    setBarcodeMatches([]);
    setBarcodeError('');
    reset();

    const names = barcodeToNames[code];
    if (!names || names.length === 0) {
      setBarcodeError(`바코드 "${code}"에 해당하는 제품을 찾을 수 없습니다.`);
      return;
    }
    if (names.length === 1) {
      setNameQuery(names[0]);
      // auto-search fires via the nameQuery useEffect
    } else {
      setBarcodeMatches(names.map((n) => ({ productName: n })));
    }
  }, [barcodeQuery, barcodeToNames, reset]);

  // ── barcode scanner callback ──────────────────────────────────────────────
  const handleScan = useCallback((code) => {
    setShowScanner(false);
    setBarcodeQuery(code);
    setBarcodeMatches([]);
    setBarcodeError('');
    reset();

    const names = barcodeToNames[code];
    if (!names || names.length === 0) {
      setBarcodeError(`바코드 "${code}"에 해당하는 제품을 찾을 수 없습니다.`);
      return;
    }
    if (names.length === 1) {
      setNameQuery(names[0]);
      // auto-search fires via the nameQuery useEffect
    } else {
      setBarcodeMatches(names.map((n) => ({ productName: n })));
    }
  }, [barcodeToNames, reset]);

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div style={st.page}>

      {/* ── Product name search (auto-search on typing) ── */}
      <div style={st.card}>
        <span style={st.sectionLabel}>제품명 검색</span>
        <div style={st.row}>
          <input
            style={{ ...searchInputStyle, flex: 1 }}
            type="text"
            placeholder="예) 가지, 감자, 깐마늘 …"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(normalizeCriteriaKeyword(nameQuery))}
          />
          <button
            style={{ ...scanBtnStyle, background: searching ? C.muted : C.primary }}
            onClick={() => search(normalizeCriteriaKeyword(nameQuery))}
            disabled={searching || !nameQuery.trim()}
          >
            {searching ? '…' : '검색'}
          </button>
        </div>
        {searchErr && <div style={st.errorMsg}>{searchErr}</div>}
      </div>

      {/* ── Barcode search ── */}
      <div style={st.card}>
        <span style={st.sectionLabel}>바코드 검색</span>
        <div style={st.row}>
          <input
            style={{ ...searchInputStyle, flex: 1 }}
            type="text"
            inputMode="numeric"
            placeholder="바코드 번호 입력 또는 스캔"
            value={barcodeQuery}
            onChange={(e) => setBarcodeQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSubmit()}
          />
          <button style={scanBtnStyle} onClick={handleBarcodeSubmit}>
            조회
          </button>
          <button style={scanBtnStyle} onClick={() => setShowScanner(true)}>
            <ScanLine size={14} strokeWidth={2} />
            스캔
          </button>
        </div>
        {barcodeError && <div style={st.errorMsg}>{barcodeError}</div>}
      </div>

      {/* ── Barcode disambiguation list ── */}
      {barcodeMatches.length > 1 && (
        <div style={st.card}>
          <span style={{ ...st.sectionLabel, marginBottom: '8px', display: 'block' }}>
            여러 제품이 일치합니다. 선택하세요.
          </span>
          {barcodeMatches.map((m) => (
            <div
              key={m.productName}
              style={st.resultItem(false)}
              onClick={() => {
                setBarcodeMatches([]);
                setNameQuery(m.productName);
              }}
            >
              {m.productName}
            </div>
          ))}
        </div>
      )}

      {/* ── Search results list ── */}
      {results !== null && !selectedFolder && (
        <div style={st.card}>
          <span style={{ ...st.sectionLabel, marginBottom: '8px', display: 'block' }}>
            검색 결과 {results.length}건
          </span>
          {results.length === 0 && (
            <div style={st.notice}>검색 결과가 없습니다.</div>
          )}
          {results.map((r) => (
            <div
              key={r.id}
              style={st.resultItem(false)}
              onClick={() => loadImages(r)}
            >
              <span style={st.tag(false)}>{r.category}</span>
              {r.groupName && <span style={st.tag(true)}>{r.groupName}</span>}
              <span style={{ fontWeight: 600, fontSize: '14px', verticalAlign: 'middle' }}>
                {r.name}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Criteria image viewer ── */}
      {(loadingImages || imageData || imageErr) && (
        <div style={st.card}>
          {selectedFolder && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {results && results.length > 1 && (
                <button
                  onClick={clearImages}
                  style={{
                    background: 'none', border: 'none',
                    color: C.primary, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', padding: 0, fontFamily: font.base,
                    flexShrink: 0,
                  }}
                >
                  ←
                </button>
              )}
              <div style={{ fontWeight: 700, fontSize: '15px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFolder.name}
              </div>
            </div>
          )}
          {loadingImages && <div style={st.notice}>이미지 로딩 중…</div>}
          {imageErr && <div style={st.errorMsg}>{imageErr}</div>}
          {imageData && imageData.images && imageData.images.length === 0 && (
            <div style={st.notice}>이미지가 없습니다.</div>
          )}
          {imageData && imageData.images && imageData.images.length > 0 &&
            imageData.images.map((img) => (
              <SlideImage key={img.id} img={img} />
            ))
          }
        </div>
      )}

      {/* ── Barcode scanner overlay ── */}
      {showScanner && (
        <Suspense fallback={<div style={st.notice}>카메라 로딩 중…</div>}>
          <BarcodeScanner
            onScan={handleScan}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
