import React, {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { ScanLine } from 'lucide-react';
import { fetchCriteriaSearch, fetchCriteriaImages } from '../api';
import { C, radius, font, shadow, inputStyle, btnPrimary } from './styles';

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
  imgBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  slideImg: {
    width: '100%',
    borderRadius: radius.sm,
    border: `1px solid ${C.border}`,
    display: 'block',
  },
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

// ─── CriteriaPage ─────────────────────────────────────────────────────────────

/**
 * Props
 *   jobRows  – normalized inspection rows from App.js (barcode → productName lookup)
 */
export default function CriteriaPage({ jobRows = [] }) {

  // ── search state ─────────────────────────────────────────────────────────
  const [nameQuery,    setNameQuery]    = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [searchError,  setSearchError]  = useState('');
  const [searching,    setSearching]    = useState(false);
  const [results,      setResults]      = useState(null);   // null = never searched

  // ── barcode ───────────────────────────────────────────────────────────────
  const [showScanner,    setShowScanner]    = useState(false);
  const [barcodeMatches, setBarcodeMatches] = useState([]); // [{productName}] when ambiguous

  // ── image viewer ──────────────────────────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [loadingImages,  setLoadingImages]  = useState(false);
  const [imageData,      setImageData]      = useState(null); // {folderName, images:[]}
  const [imageError,     setImageError]     = useState('');

  // ── barcode → [productName, …] lookup built from jobRows ─────────────────
  const barcodeToNames = useMemo(() => {
    const map = {};
    for (const row of jobRows) {
      const code = (row.barcode || row['바코드'] || '').toString().trim();
      const name = (row.productName || row['품목명'] || '').toString().trim();
      if (!code || !name) continue;
      if (!map[code]) map[code] = new Set();
      map[code].add(name);
    }
    const out = {};
    for (const code of Object.keys(map)) out[code] = [...map[code]];
    return out;
  }, [jobRows]);

  // ── core search API call — stable, receives keyword as parameter ──────────
  const executeSearch = useCallback(async (keyword) => {
    const q = keyword.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);
    setBarcodeMatches([]);
    try {
      const res = await fetchCriteriaSearch(q);
      // Backend returns { ok: true, data: [...] }
      setResults(res.data || []);
    } catch (e) {
      setSearchError(e.message || '검색 중 오류가 발생했습니다.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // ── auto-search: fires 300 ms after the user stops typing ────────────────
  useEffect(() => {
    const q = nameQuery.trim();
    if (!q) {
      // Clear results and viewer when the input is emptied
      setResults(null);
      setImageData(null);
      setSelectedFolder(null);
      setSearchError('');
      return;
    }
    const timer = setTimeout(() => executeSearch(q), 300);
    return () => clearTimeout(timer);
  }, [nameQuery, executeSearch]);

  // ── barcode manual submit ─────────────────────────────────────────────────
  const handleBarcodeSubmit = useCallback(() => {
    const code = barcodeQuery.trim();
    if (!code) return;
    setBarcodeMatches([]);
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);
    setSearchError('');

    const names = barcodeToNames[code];
    if (!names || names.length === 0) {
      setSearchError(`바코드 "${code}"에 해당하는 제품을 찾을 수 없습니다.`);
      return;
    }
    if (names.length === 1) {
      setNameQuery(names[0]);
      // executeSearch will be triggered by the nameQuery change via useEffect
    } else {
      setBarcodeMatches(names.map((n) => ({ productName: n })));
    }
  }, [barcodeQuery, barcodeToNames]);

  // ── barcode scanner callback ──────────────────────────────────────────────
  const handleScan = useCallback((code) => {
    setShowScanner(false);
    setBarcodeQuery(code);
    const names = barcodeToNames[code];
    setBarcodeMatches([]);
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);
    setSearchError('');
    if (!names || names.length === 0) {
      setSearchError(`바코드 "${code}"에 해당하는 제품을 찾을 수 없습니다.`);
      return;
    }
    if (names.length === 1) {
      setNameQuery(names[0]);
      // executeSearch triggered by nameQuery change
    } else {
      setBarcodeMatches(names.map((n) => ({ productName: n })));
    }
  }, [barcodeToNames]);

  // ── load images for a result folder ──────────────────────────────────────
  const handleSelectFolder = useCallback(async (folder) => {
    setSelectedFolder(folder);
    setLoadingImages(true);
    setImageData(null);
    setImageError('');
    try {
      const res = await fetchCriteriaImages(folder.id);
      // Backend returns { ok: true, data: { folderId, folderName, images: [...] } }
      setImageData(res.data);
    } catch (e) {
      setImageError(e.message || '이미지 로딩 중 오류가 발생했습니다.');
    } finally {
      setLoadingImages(false);
    }
  }, []);

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
            onKeyDown={(e) => e.key === 'Enter' && executeSearch(nameQuery)}
          />
          <button
            style={{ ...scanBtnStyle, background: searching ? C.muted : C.primary }}
            onClick={() => executeSearch(nameQuery)}
            disabled={searching || !nameQuery.trim()}
          >
            {searching ? '…' : '검색'}
          </button>
        </div>
        {searchError && !barcodeQuery && <div style={st.errorMsg}>{searchError}</div>}
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
        {searchError && barcodeQuery && <div style={st.errorMsg}>{searchError}</div>}
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
                // auto-search fires via useEffect
              }}
            >
              {m.productName}
            </div>
          ))}
        </div>
      )}

      {/* ── Search results list ── */}
      {results !== null && (
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
              style={st.resultItem(selectedFolder && selectedFolder.id === r.id)}
              onClick={() => handleSelectFolder(r)}
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
      {(loadingImages || imageData || imageError) && (
        <div style={st.card}>
          {selectedFolder && (
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '12px' }}>
              {selectedFolder.name}
            </div>
          )}
          {loadingImages && <div style={st.notice}>이미지 로딩 중…</div>}
          {imageError && <div style={st.errorMsg}>{imageError}</div>}
          {imageData && imageData.images && imageData.images.length === 0 && (
            <div style={st.notice}>이미지가 없습니다.</div>
          )}
          {imageData && imageData.images && imageData.images.length > 0 && (
            <div style={st.imgBlock}>
              {imageData.images.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.name}
                  style={st.slideImg}
                  loading="lazy"
                />
              ))}
            </div>
          )}
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

