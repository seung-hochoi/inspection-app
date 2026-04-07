import React, {
  lazy,
  Suspense,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { fetchCriteriaSearch, fetchCriteriaImages } from '../api';
import { C, radius, font } from './styles';

// Lazy-load BarcodeScanner so @zxing/browser is not in the initial bundle
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));

// ─── tiny helpers ───────────────────────────────────────────────────────────

const st = {
  page: {
    padding: '16px',
    background: C.bg,
    minHeight: '100vh',
    fontFamily: font.base,
  },
  card: {
    background: C.card,
    borderRadius: radius.lg,
    border: `1px solid ${C.border}`,
    padding: '16px',
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: C.textMid || '#64748b',
    marginBottom: '4px',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${C.borderMid}`,
    borderRadius: radius.md,
    padding: '8px 12px',
    fontSize: '15px',
    outline: 'none',
    fontFamily: font.base,
    background: '#fff',
  },
  btnPrimary: {
    background: C.primary,
    color: '#fff',
    border: 'none',
    borderRadius: radius.md,
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  },
  btnSecondary: {
    background: C.primaryLight,
    color: C.primary,
    border: `1px solid ${C.primaryMid}`,
    borderRadius: radius.md,
    padding: '8px 14px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  },
  resultItem: {
    padding: '10px 14px',
    borderRadius: radius.md,
    border: `1px solid ${C.border}`,
    marginBottom: '6px',
    cursor: 'pointer',
    background: C.card,
    transition: 'background 0.15s',
  },
  resultItemActive: {
    background: C.primaryLight,
    borderColor: C.primaryMid,
  },
  tag: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: '9999px',
    background: C.bgAlt,
    color: C.primary,
    marginRight: '6px',
  },
  imgBlock: {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  slideImg: {
    width: '100%',
    borderRadius: radius.md,
    border: `1px solid ${C.border}`,
    display: 'block',
  },
  notice: {
    color: '#94a3b8',
    fontSize: '13px',
    textAlign: 'center',
    padding: '24px 0',
  },
  errorMsg: {
    color: C.red || '#dc2626',
    fontSize: '13px',
    marginTop: '8px',
  },
};

// ─── CriteriaPage ────────────────────────────────────────────────────────────

/**
 * Props
 *   jobRows  – normalized inspection rows from App.js (used for barcode lookup)
 */
export default function CriteriaPage({ jobRows = [] }) {
  // ── search state ──────────────────────────────────────────────────────────
  const [nameQuery, setNameQuery] = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null); // null = not yet searched

  // ── barcode scanner state ──────────────────────────────────────────────────
  const [showScanner, setShowScanner] = useState(false);

  // ── barcode disambiguation (multiple products share same barcode) ──────────
  const [barcodeMatches, setBarcodeMatches] = useState([]); // [{productName, ...}]

  // ── images state ──────────────────────────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState(null); // {id, name, ...}
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageData, setImageData] = useState(null); // {folderName, images:[]}
  const [imageError, setImageError] = useState('');

  // barcode → unique product names map, built once from jobRows
  const barcodeToNames = useMemo(() => {
    const map = {};
    for (const row of jobRows) {
      const code = (row.barcode || row.바코드 || '').toString().trim();
      const name = (row.productName || row.품목명 || '').toString().trim();
      if (!code || !name) continue;
      if (!map[code]) map[code] = new Set();
      map[code].add(name);
    }
    // convert Sets to arrays
    const out = {};
    for (const code of Object.keys(map)) out[code] = [...map[code]];
    return out;
  }, [jobRows]);

  // ── search by product name ─────────────────────────────────────────────────
  const runNameSearch = useCallback(async (keyword) => {
    const q = (keyword || nameQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);
    setBarcodeMatches([]);
    try {
      const res = await fetchCriteriaSearch(q);
      setResults(res.data || []);
    } catch (e) {
      setSearchError(e.message || '검색 중 오류가 발생했습니다.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [nameQuery]);

  // ── barcode input handler ─────────────────────────────────────────────────
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
      // auto-search
      setNameQuery(names[0]);
      runNameSearch(names[0]);
    } else {
      // show disambiguation list
      setBarcodeMatches(names.map((n) => ({ productName: n })));
    }
  }, [barcodeQuery, barcodeToNames, runNameSearch]);

  // ── barcode scanner callback ───────────────────────────────────────────────
  const handleScan = useCallback((code) => {
    setShowScanner(false);
    setBarcodeQuery(code);
    // resolve after state flush
    setTimeout(() => {
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
        runNameSearch(names[0]);
      } else {
        setBarcodeMatches(names.map((n) => ({ productName: n })));
      }
    }, 0);
  }, [barcodeToNames, runNameSearch]);

  // ── load images for a selected result folder ──────────────────────────────
  const handleSelectFolder = useCallback(async (folder) => {
    setSelectedFolder(folder);
    setLoadingImages(true);
    setImageData(null);
    setImageError('');
    try {
      const res = await fetchCriteriaImages(folder.id);
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

      {/* ── Product name search ── */}
      <div style={st.card}>
        <label style={st.label}>제품명 검색</label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: searchError ? '0' : undefined }}>
          <input
            style={st.input}
            type="text"
            placeholder="예) 가지, 감자, 깐마늘 …"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runNameSearch()}
          />
          <button
            style={st.btnPrimary}
            onClick={() => runNameSearch()}
            disabled={searching || !nameQuery.trim()}
          >
            {searching ? '검색중…' : '검색'}
          </button>
        </div>
        {searchError && <div style={st.errorMsg}>{searchError}</div>}
      </div>

      {/* ── Barcode search ── */}
      <div style={st.card}>
        <label style={st.label}>바코드 검색</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={st.input}
            type="text"
            inputMode="numeric"
            placeholder="바코드 번호 입력 또는 스캔"
            value={barcodeQuery}
            onChange={(e) => setBarcodeQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBarcodeSubmit()}
          />
          <button style={st.btnSecondary} onClick={handleBarcodeSubmit}>
            조회
          </button>
          <button style={st.btnSecondary} onClick={() => setShowScanner(true)}>
            📷
          </button>
        </div>
      </div>

      {/* ── Barcode disambiguation list ── */}
      {barcodeMatches.length > 1 && (
        <div style={st.card}>
          <div style={{ ...st.label, marginBottom: '8px' }}>
            여러 제품이 일치합니다. 선택하세요.
          </div>
          {barcodeMatches.map((m) => (
            <div
              key={m.productName}
              style={st.resultItem}
              onClick={() => {
                setBarcodeMatches([]);
                setNameQuery(m.productName);
                runNameSearch(m.productName);
              }}
            >
              {m.productName}
            </div>
          ))}
        </div>
      )}

      {/* ── Search results ── */}
      {results !== null && (
        <div style={st.card}>
          <div style={{ ...st.label, marginBottom: '8px' }}>
            검색 결과 {results.length}건
          </div>
          {results.length === 0 && (
            <div style={st.notice}>검색 결과가 없습니다.</div>
          )}
          {results.map((r) => (
            <div
              key={r.id}
              style={{
                ...st.resultItem,
                ...(selectedFolder && selectedFolder.id === r.id
                  ? st.resultItemActive
                  : {}),
              }}
              onClick={() => handleSelectFolder(r)}
            >
              <span style={st.tag}>{r.category}</span>
              {r.groupName && <span style={{ ...st.tag, color: '#64748b' }}>{r.groupName}</span>}
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Image viewer ── */}
      {(loadingImages || imageData || imageError) && (
        <div style={st.card}>
          {selectedFolder && (
            <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '12px' }}>
              {selectedFolder.name}
            </div>
          )}
          {loadingImages && <div style={st.notice}>이미지 로딩 중…</div>}
          {imageError && <div style={st.errorMsg}>{imageError}</div>}
          {imageData && imageData.images.length === 0 && (
            <div style={st.notice}>이미지가 없습니다.</div>
          )}
          {imageData && imageData.images.length > 0 && (
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
