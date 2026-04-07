import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X as XIcon } from 'lucide-react';
import { C, radius, font, shadow } from './styles';
import { useCriteriaSearch, extractCriteriaKeyword, getBroadCriteriaKeyword } from '../utils/useCriteriaSearch';

// ─── SlideImage ───────────────────────────────────────────────────────────────
// Individual criteria slide with error fallback and filename label.

function SlideImage({ img }) {
  const [failed, setFailed] = React.useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      {failed ? (
        <div style={{
          padding: '12px', borderRadius: radius.sm,
          border: `1px solid ${C.border}`,
          color: C.muted, fontSize: 12, textAlign: 'center',
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
      <div style={{ fontSize: 11, color: C.muted2, marginTop: 3, textAlign: 'center' }}>
        {img.name}
      </div>
    </div>
  );
}

// ─── CriteriaModal ────────────────────────────────────────────────────────────

/**
 * Per-product inspection criteria modal.
 *
 * Props:
 *   productName  {string}  — product name from the inspection row
 *   onClose      {()=>void}
 *
 * Behavior:
 *   - Searches Drive criteria folders immediately on mount using productName
 *   - If exactly one result: auto-loads its images
 *   - If multiple results: shows a selection list first
 *   - If no results: shows "일치하는 검품기준을 찾을 수 없습니다"
 *   - Back button (←) returns to result list when viewing images from a
 *     multi-result search
 */
export default function CriteriaModal({ productName, onClose }) {
  const {
    searching, results, searchErr,
    loadingImages, imageData, imageErr, selectedFolder,
    search, loadImages, clearImages,
  } = useCriteriaSearch();

  // Search on mount.
  // Priority: broad family keyword (e.g. "깐마늘100G" → "마늘") so the user
  // sees all related criteria folders.  Falls back to the cleaned product name
  // (extractCriteriaKeyword) if no broad rule matches.
  useEffect(() => {
    if (productName) {
      const keyword = getBroadCriteriaKeyword(productName) || extractCriteriaKeyword(productName);
      search(keyword);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-load images when there is exactly one match
  useEffect(() => {
    if (results && results.length === 1 && !selectedFolder) {
      loadImages(results[0]);
    }
  }, [results, selectedFolder, loadImages]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const headerTitle = selectedFolder
    ? selectedFolder.name
    : (productName || '검품기준');

  const showBackButton = selectedFolder && results && results.length > 1;

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.52)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px 12px 24px',
        overflowY: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: C.card,
          borderRadius: radius.xl,
          width: '100%', maxWidth: 560,
          boxShadow: shadow.xl,
          display: 'flex', flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
          overflow: 'hidden',
          fontFamily: font.base,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 16px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: C.text,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {headerTitle}
            </div>
            {selectedFolder && selectedFolder.name !== productName && (
              <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                검색어: {productName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              flexShrink: 0, marginLeft: 12,
              width: 30, height: 30, borderRadius: '50%',
              border: `1px solid ${C.border}`, background: C.bgAlt,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.muted,
            }}
          >
            <XIcon size={14} strokeWidth={2.5} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', padding: '12px 16px 24px', flex: 1 }}>

          {/* Searching spinner */}
          {searching && (
            <div style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '32px 0' }}>
              검색 중…
            </div>
          )}

          {/* Search error */}
          {searchErr && (
            <div style={{ color: C.red, fontSize: 13, padding: '8px 0' }}>{searchErr}</div>
          )}

          {/* No results */}
          {!searching && results !== null && results.length === 0 && (
            <div style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '32px 0', lineHeight: 1.6 }}>
              일치하는 검품기준을 찾을 수 없습니다
            </div>
          )}

          {/* Multiple results — show selection list when no folder is selected yet */}
          {!searching && results !== null && results.length > 1 && !selectedFolder && (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: C.muted,
                marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                검색 결과 {results.length}건 · 선택하세요
              </div>
              {results.map((r) => (
                <div
                  key={r.id}
                  onClick={() => loadImages(r)}
                  style={{
                    padding: '10px 14px', borderRadius: radius.sm,
                    border: `1px solid ${C.border}`, marginBottom: 6,
                    cursor: 'pointer', background: C.card,
                  }}
                >
                  <span style={{
                    display: 'inline-block', fontSize: 11, fontWeight: 600,
                    padding: '1px 7px', borderRadius: radius.full,
                    background: C.bgAlt, color: C.primary, marginRight: 6,
                  }}>
                    {r.category}
                  </span>
                  {r.groupName && (
                    <span style={{
                      display: 'inline-block', fontSize: 11, fontWeight: 600,
                      padding: '1px 7px', borderRadius: radius.full,
                      background: C.bgAlt, color: C.muted, marginRight: 6,
                    }}>
                      {r.groupName}
                    </span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Loading images */}
          {loadingImages && (
            <div style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '32px 0' }}>
              이미지 로딩 중…
            </div>
          )}

          {/* Image error */}
          {imageErr && !loadingImages && (
            <div style={{ color: C.red, fontSize: 13, padding: '8px 0' }}>{imageErr}</div>
          )}

          {/* Criteria slide images */}
          {!loadingImages && imageData && (
            <div>
              {/* Back to results list (only when multiple results existed) */}
              {showBackButton && (
                <button
                  onClick={clearImages}
                  style={{
                    background: 'none', border: 'none',
                    color: C.primary, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', padding: '0 0 12px',
                    fontFamily: font.base, display: 'block',
                  }}
                >
                  ← 목록으로
                </button>
              )}

              {imageData.images && imageData.images.length === 0 && (
                <div style={{ textAlign: 'center', color: C.muted, fontSize: 13, padding: '24px 0' }}>
                  이미지가 없습니다.
                </div>
              )}

              {imageData.images && imageData.images.length > 0 &&
                imageData.images.map((img) => (
                  <SlideImage key={img.id} img={img} />
                ))
              }
            </div>
          )}

        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
