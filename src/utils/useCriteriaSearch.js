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

// ─── Broad keyword rules ─────────────────────────────────────────────────────
//
// Maps product-name fragments to a broader search keyword.
// getBroadCriteriaKeyword() scans these in order; the first matching rule wins.
//
// Ordering notes:
//   • More-specific terms must appear in their own rule BEFORE any rule whose
//     match array contains a substring of that term.
//     e.g. '파프리카' rule must precede any rule with bare '파'.
//   • Bare single-character terms (무, 배, 파) are intentionally omitted where
//     they are common substrings of unrelated words (무화과, 배추, 파프리카).
//
// To extend: add a new entry to the appropriate section.  Longer/more-specific
// terms in the match array naturally shadow shorter ones because iteration stops
// at the first matching rule.
const BROAD_KEYWORD_RULES = [
  // ── 채소 ────────────────────────────────────────────────────────────────────
  { match: ['파프리카'],                                         search: '파프리카' },
  { match: ['깐마늘', '통마늘', '마늘쫑', '마늘종', '마늘'],    search: '마늘' },
  { match: ['건고추', '청양고추', '홍고추', '꽈리고추', '오이고추', '풋고추', '고추'], search: '고추' },
  { match: ['대파', '쪽파', '실파'],                             search: '파' },
  { match: ['자색양파', '미니양파', '양파'],                     search: '양파' },
  { match: ['당근'],                                             search: '당근' },
  { match: ['왕감자', '감자'],                                   search: '감자' },
  { match: ['자색고구마', '고구마'],                             search: '고구마' },
  { match: ['절임배추', '봄배추', '배추'],                       search: '배추' },
  { match: ['로메인상추', '오크상추', '적상추', '상추'],         search: '상추' },
  { match: ['브로콜리'],                                         search: '브로콜리' },
  { match: ['시금치'],                                           search: '시금치' },
  { match: ['깻잎'],                                             search: '깻잎' },
  { match: ['취청오이', '오이'],                                 search: '오이' },
  { match: ['알타리무', '총각무'],                               search: '무' },
  { match: ['부추'],                                             search: '부추' },
  { match: ['봄동'],                                             search: '봄동' },
  { match: ['콩나물', '숙주나물'],                               search: '나물' },
  { match: ['가지'],                                             search: '가지' },
  { match: ['단호박', '애호박', '호박'],                         search: '호박' },
  { match: ['도라지'],                                           search: '도라지' },
  { match: ['연근'],                                             search: '연근' },
  { match: ['더덕'],                                             search: '더덕' },
  // ── 과일 ────────────────────────────────────────────────────────────────────
  { match: ['냉동딸기', '딸기'],                                 search: '딸기' },
  { match: ['스위티오바나나', '바나나'],                         search: '바나나' },
  { match: ['수박'],                                             search: '수박' },
  { match: ['참외'],                                             search: '참외' },
  { match: ['천중도복숭아', '복숭아'],                           search: '복숭아' },
  { match: ['샤인머스캣', '거봉포도', '청포도', '포도'],         search: '포도' },
  { match: ['홍로사과', '후지사과', '아오리사과', '사과'],       search: '사과' },
  { match: ['신고배', '원황배'],                                 search: '배' },
  { match: ['단감', '홍시', '곶감', '감'],                       search: '감' },
  { match: ['한라봉', '천혜향', '레드향', '귤'],                 search: '귤' },
  { match: ['애플망고', '망고'],                                 search: '망고' },
  { match: ['골드키위', '키위'],                                 search: '키위' },
  { match: ['멜론'],                                             search: '멜론' },
  { match: ['체리'],                                             search: '체리' },
  { match: ['자두'],                                             search: '자두' },
  { match: ['블루베리'],                                         search: '블루베리' },
];

/**
 * Return a broader search keyword for a machine-supplied CSV product name by
 * looking up the rule table above.
 *
 * Returns the rule's search keyword if any match term is found as a substring
 * of the product name (case-insensitive).  Returns null if no rule matches —
 * callers should then fall back to extractCriteriaKeyword().
 *
 * Examples:
 *   "신선특별시)깐마늘100G(봉)" → "마늘"
 *   "청양고추150G"             → "고추"
 *   "스위티오바나나2입"        → "바나나"
 *   "유기농 콜라비"            → null  (no rule → fall back)
 */
export function getBroadCriteriaKeyword(productName) {
  const s = String(productName || '').toLowerCase();
  for (const rule of BROAD_KEYWORD_RULES) {
    for (const term of rule.match) {
      if (s.includes(term)) return rule.search;
    }
  }
  return null;
}


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
