import React, {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { ScanLine, ChevronDown } from 'lucide-react';
import { C, radius, font, shadow, inputStyle, btnPrimary } from './styles';
import {
  useCriteriaSearch,
  normalizeCriteriaKeyword,
  getBroadCriteriaKeyword,
  extractCriteriaKeyword,
} from '../utils/useCriteriaSearch';
import { fetchCriteriaTree } from '../api';

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
  // inputStyle.fontSize is already 16 (set in styles.js to prevent iOS auto-zoom).
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

// ─── CriteriaBrowser ──────────────────────────────────────────────────────────
// Category accordion for manual folder browsing. Loads the Drive folder tree on
// mount (result cached 10 min on the backend).
//
// Navigation model: category > subfolder(s) > leaf folder
//   • Leaf folders (children === []) are clickable — calls loadImages().
//   • Intermediate folders are expandable accordion sections.
//   • Single-child container layers (like 품질관리팀_상품검수기준표_축산) that
//     contain only leaf nodes are auto-expanded so the user never has to click
//     through an uninformative wrapper level.

// ── FolderNode — renders one node in the recursive tree ───────────────────────
function FolderNode({ node, depth, categoryName, loadImages }) {
  const isLeaf = node.children.length === 0;

  // Auto-open if this node's direct children are all leaves (thin container layer).
  const [open, setOpen] = useState(
    () => !isLeaf && node.children.every((c) => c.children.length === 0)
  );

  if (isLeaf) {
    return (
      <button
        onClick={() => loadImages({ id: node.id, name: node.name, category: categoryName, groupName: null })}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', textAlign: 'left',
          background: 'none', border: 'none',
          borderBottom: `1px solid ${C.border}`,
          padding: `9px ${8 + depth * 12}px`,
          cursor: 'pointer', fontFamily: font.base,
          fontSize: 13, color: C.text, fontWeight: 500,
          transition: 'background 0.1s',
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = C.primaryLight; }}
        onMouseOut={(e)  => { e.currentTarget.style.background = 'none'; }}
        onTouchStart={(e) => { e.currentTarget.style.background = C.primaryLight; }}
        onTouchEnd={(e)   => { e.currentTarget.style.background = 'none'; }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.primaryMid, flexShrink: 0 }} />
        {node.name}
      </button>
    );
  }

  // Container node (has sub-folders).
  const indent = 8 + depth * 12;
  return (
    <div>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', textAlign: 'left',
          background: open ? C.primaryLight : 'none',
          border: 'none',
          borderBottom: `1px solid ${C.border}`,
          padding: `9px ${indent}px`,
          cursor: 'pointer', fontFamily: font.base,
          fontSize: 13, color: C.text, fontWeight: 600,
          transition: 'background 0.15s',
        }}
      >
        <span>{node.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, paddingRight: 4 }}>
          <span style={{ fontSize: 11, color: C.muted }}>{node.children.length}개</span>
          <ChevronDown
            size={13}
            color={C.muted2}
            strokeWidth={2.5}
            style={{ transition: 'transform 0.18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </div>
      </button>
      {open && node.children.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={depth + 1}
          categoryName={categoryName}
          loadImages={loadImages}
        />
      ))}
    </div>
  );
}

// ── CriteriaBrowser — top-level category accordion ────────────────────────────
function CriteriaBrowser({ loadImages }) {
  const [tree,    setTree]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [openCat, setOpenCat] = useState(null);

  useEffect(() => {
    fetchCriteriaTree()
      .then((res) => setTree(res.data?.categories || []))
      .catch((e)  => setError(e.message || '폴더 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={st.notice}>폴더 목록 로딩 중…</div>;
  if (error)   return <div style={{ ...st.errorMsg, marginTop: 8 }}>{error}</div>;
  if (!tree || tree.length === 0) return null;

  // Count leaf folders for each category (displayed in header badge).
  function countLeaves(nodes) {
    let n = 0;
    for (const node of nodes) {
      if (node.children.length === 0) n += 1;
      else n += countLeaves(node.children);
    }
    return n;
  }

  return (
    <div>
      {tree.map((cat) => {
        const isOpen = openCat === cat.name;
        const leafCount = countLeaves(cat.children);
        return (
          <div key={cat.name} style={{ marginBottom: 8 }}>
            {/* Category header */}
            <button
              onClick={() => setOpenCat((p) => (p === cat.name ? null : cat.name))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                background: isOpen
                  ? `linear-gradient(135deg, ${C.primaryLight} 0%, #e0eaff 100%)`
                  : 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                border: `1px solid ${isOpen ? C.primaryMid : C.border}`,
                borderRadius: isOpen ? `${radius.sm}px ${radius.sm}px 0 0` : radius.sm,
                padding: '11px 14px', cursor: 'pointer',
                fontFamily: font.base, fontWeight: 700,
                fontSize: 14, color: C.text,
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <span>{cat.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>
                  {leafCount}개
                </span>
                <ChevronDown
                  size={15}
                  color={C.muted2}
                  strokeWidth={2.5}
                  style={{
                    transition: 'transform 0.2s',
                    transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                  }}
                />
              </div>
            </button>

            {/* Nested tree */}
            {isOpen && (
              <div style={{
                border: `1px solid ${C.primaryMid}`,
                borderTop: 'none',
                borderRadius: `0 0 ${radius.sm}px ${radius.sm}px`,
                background: C.card,
                overflow: 'hidden',
              }}>
                {cat.children.map((child) => (
                  <FolderNode
                    key={child.id}
                    node={child}
                    depth={0}
                    categoryName={cat.name}
                    loadImages={loadImages}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the best search keyword from a raw product name.
 * Products with brand/brand prefixes like "FCS)..." or "신선특별시)..." need
 * broad extraction; plain names use the normalizer.
 */
function resolveSearchQuery(raw) {
  if (!raw) return '';
  return raw.includes(')')
    ? (getBroadCriteriaKeyword(raw) || extractCriteriaKeyword(raw))
    : normalizeCriteriaKeyword(raw);
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
    const raw = nameQuery.trim();
    if (!raw) {
      reset();
      setBarcodeMatches([]);
      setBarcodeError('');
      return;
    }
    // For product names that still contain brand-prefix decorators like "FCS)"
    // or "신선특별시)", apply smart extraction first; otherwise send as-is.
    const q = resolveSearchQuery(raw);
    const timer = setTimeout(() => search(q, raw), 300);
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const raw = nameQuery.trim();
              search(resolveSearchQuery(raw), raw);
            }}
          />
          <button
            style={{ ...scanBtnStyle, background: searching ? C.muted : C.primary }}
            onClick={() => {
              const raw = nameQuery.trim();
              search(resolveSearchQuery(raw), raw);
            }}
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
      {results !== null && !selectedFolder && (() => {
        // Detect when ALL results are category-level fallbacks (no direct keyword match).
        const allFallback = results.length > 0 && results.every((r) => r.isCategoryFallback);
        const labelText = allFallback
          ? `'${nameQuery}' 직접 일치 없음 — ${results[0]?.category || ''} 전체 목록`
          : `검색 결과 ${results.length}건`;
        return (
          <div style={st.card}>
            <span style={{ ...st.sectionLabel, marginBottom: '8px', display: 'block' }}>
              {labelText}
            </span>
            {results.length === 0 && (
              <div style={st.notice}>
                검색 결과가 없습니다.
                <br />
                <span style={{ fontSize: 12, color: C.muted }}>
                  아래 카테고리 탐색에서 직접 찾아보세요.
                </span>
              </div>
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
        );
      })()}

      {/* ── Criteria image viewer ── */}
      {(loadingImages || imageData || imageErr) && (
        <div style={st.card}>
          {selectedFolder && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {/* Show back button when: multiple search results exist, OR browsing
                  mode (results === null means user came from the category browser) */}
              {(results === null || (results && results.length > 1)) && (
                <button
                  onClick={clearImages}
                  style={{
                    background: 'none', border: 'none',
                    color: C.primary, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', padding: 0, fontFamily: font.base,
                    flexShrink: 0,
                  }}
                >
                  ← 목록
                </button>
              )}
              <div style={{ fontWeight: 700, fontSize: '15px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFolder.name}
              </div>
              {selectedFolder.category && (
                <span style={{ ...st.tag(false), flexShrink: 0 }}>
                  {selectedFolder.category}
                </span>
              )}
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

      {/* ── Category accordion browser ────────────────────────────────────────
           Always visible below search results. Lets users find criteria when
           the product name search fails or when they want to browse manually. */}
      <div style={st.card}>
        <span style={{ ...st.sectionLabel, marginBottom: '10px', display: 'block' }}>
          카테고리 탐색
        </span>
        <CriteriaBrowser loadImages={loadImages} />
      </div>

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
