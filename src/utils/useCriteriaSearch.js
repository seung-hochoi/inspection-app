import { useState, useCallback, useRef } from 'react';
import { fetchCriteriaSearch, fetchCriteriaImages } from '../api';

// ─── Module-level session caches ─────────────────────────────────────────────
// These Maps live for the lifetime of the browser tab.  They prevent duplicate
// Drive API calls when the same keyword is searched more than once in a session,
// and when the same product folder's images are opened multiple times.
const searchResultsCache = new Map(); // normalizedKeyword → results[]
const imageDataCache     = new Map(); // folderId → { folderName, images:[] }

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Conservative normalization for Drive criteria folder search keywords.
 * Only trims edge whitespace and collapses internal runs of whitespace.
 * Does NOT strip brackets, special characters, or translate romanization —
 * Drive folder names are in Korean and partial matching is done on the backend.
 */
export function normalizeCriteriaKeyword(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Extract a clean search keyword from a machine-supplied CSV product name.
 *
 * CSV product names often contain decorations that are absent from Drive folder
 * names.  The backend does folderName.includes(keyword), so sending the full
 * decorated name returns 0 results even when a matching folder exists.
 *
 * Rules applied in order:
 *   1. Strip leading bracket groups like [행사], [냉장], [특가]
 *   2. Strip trailing parenthetical groups like (국산), (수입), (벌크), (박스)
 *   3. Strip trailing unit patterns like 500g, 1kg, 100ml, 2box, 3팩, 10개
 *   4. Collapse internal whitespace
 *
 * Safety: only leading brackets and TRAILING parentheses/units are removed.
 * Mid-word parentheses (e.g. 봄동(박스)겉절이) and leading parentheses are preserved.
 *
 * Examples:
 *   "[냉장] 당근 (국산) 500g" → "당근"
 *   "[행사] 사과 1kg"         → "사과"
 *   "딸기 500g"               → "딸기"
 *   "깐마늘(벌크)"            → "깐마늘"
 *   "봄동겉절이"              → "봄동겉절이"  (unchanged)
 */
export function extractCriteriaKeyword(productName) {
  let s = String(productName || '').trim();
  // 1. Remove one or more leading [bracket] groups (with optional trailing space)
  s = s.replace(/^(?:\[[^\]]*\]\s*)+/, '').trim();
  // 2. Remove trailing parenthetical group (국산), (수입), etc.
  //    Only removes the LAST group at the end of the string.
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // 3. Remove trailing weight/unit pattern: optional space + digits + unit
  s = s.replace(/\s*\d+\s*(g|kg|ml|l|box|개|봉|팩)$/i, '').trim();
  // 4. Collapse any internal whitespace runs
  s = s.replace(/\s+/g, ' ');
  return s;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Shared hook for criteria search + image loading.
 *
 * Used by:
 *   - CriteriaPage  — standalone 검품기준 tab
 *   - CriteriaModal — per-product quick-open modal in ProductRow
 *
 * Returned API:
 *   search(keyword)   — searches Drive folder names, caches results
 *   loadImages(folder)— loads PNG slides for a product folder, caches result
 *   clearImages()     — resets image view without clearing search results
 *   reset()           — resets all state
 *   searching         — boolean
 *   results           — null (not searched) | [] (empty) | [{id,name,category,groupName}]
 *   searchErr         — string
 *   loadingImages     — boolean
 *   imageData         — null | { folderId, folderName, images:[{id,name,url}] }
 *   imageErr          — string
 *   selectedFolder    — null | {id, name, category, groupName}
 */
export function useCriteriaSearch() {
  const [searching,      setSearching]      = useState(false);
  const [results,        setResults]        = useState(null);
  const [searchErr,      setSearchErr]      = useState('');

  const [loadingImages,  setLoadingImages]  = useState(false);
  const [imageData,      setImageData]      = useState(null);
  const [imageErr,       setImageErr]       = useState('');
  const [selectedFolder, setSelectedFolder] = useState(null);

  // Tracks which folder the most recent loadImages call was for.
  // Responses that arrive for an older folder ID are discarded.
  const loadingForRef = useRef(null);

  // ── reset all state ─────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);
    setSearchErr('');
    setImageErr('');
  }, []);

  // ── clear only the image view (go back to results list) ────────────────────
  const clearImages = useCallback(() => {
    setSelectedFolder(null);
    setImageData(null);
    setImageErr('');
  }, []);

  // ── search Drive criteria folder names ─────────────────────────────────────
  const search = useCallback(async (keyword) => {
    const q = normalizeCriteriaKeyword(keyword);
    if (!q) {
      reset();
      return;
    }

    // Serve from cache if available
    if (searchResultsCache.has(q)) {
      setResults(searchResultsCache.get(q));
      setImageData(null);
      setSelectedFolder(null);
      setSearchErr('');
      return;
    }

    setSearching(true);
    setSearchErr('');
    setResults(null);
    setImageData(null);
    setSelectedFolder(null);

    try {
      const res = await fetchCriteriaSearch(q);
      const data = res.data || [];
      searchResultsCache.set(q, data);
      setResults(data);
    } catch (e) {
      setSearchErr(e.message || '검색 오류가 발생했습니다.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [reset]);

  // ── load PNG slides for a matched product folder ────────────────────────────
  const loadImages = useCallback(async (folder) => {
    // Register this call as the latest; any earlier in-flight call will be ignored.
    loadingForRef.current = folder.id;

    setSelectedFolder(folder);
    setImageData(null);
    setImageErr('');

    // Serve from cache if available
    if (imageDataCache.has(folder.id)) {
      setImageData(imageDataCache.get(folder.id));
      return;
    }

    setLoadingImages(true);
    try {
      const res = await fetchCriteriaImages(folder.id);
      // Discard this response if the user already clicked a different folder.
      if (loadingForRef.current !== folder.id) return;
      const data = res.data;
      if (!data) {
        setImageErr('이미지 데이터를 받지 못했습니다.');
        return;
      }
      imageDataCache.set(folder.id, data);
      setImageData(data);
    } catch (e) {
      if (loadingForRef.current !== folder.id) return;
      setImageErr(e.message || '이미지 로딩 오류가 발생했습니다.');
    } finally {
      if (loadingForRef.current === folder.id) setLoadingImages(false);
    }
  }, []);

  return {
    searching, results, searchErr,
    loadingImages, imageData, imageErr, selectedFolder,
    search, loadImages, clearImages, reset,
  };
}
