// ─── API layer — all calls to Code.gs backend ─────────────────────────────

// Same hardcoded fallback as App.js so saves/uploads work even without .env.local
const SCRIPT_URL = process.env.REACT_APP_GOOGLE_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";

const RETRY_DELAYS_MS = [800, 2000, 4000];

export { SCRIPT_URL };

// ── Auth session token (set after login) ──────────────────────────────────────
let _sessionToken = null;

export const setSessionToken = (token) => {
  _sessionToken = token || null;
};

// Throw a clear error if the Apps Script URL is not configured
const requireUrl = () => {
  if (!SCRIPT_URL) {
    throw new Error(
      "REACT_APP_GOOGLE_SCRIPT_URL 환경변수가 설정되지 않았습니다.\n" +
      "프로젝트 루트에 .env.local 파일을 만들고 다음 줄을 추가하세요:\n" +
      "REACT_APP_GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/.../exec"
    );
  }
};

const post = async (body) => {
  requireUrl();
  // Inject current session token unless the body already specifies one explicitly
  const bodyWithAuth = _sessionToken && !body.sessionToken
    ? { ...body, sessionToken: _sessionToken }
    : body;
  let text;
  try {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyWithAuth),
    });
    text = await response.text();
    const result = JSON.parse(text);
    if (!response.ok || result.ok === false) {
      const err = new Error(result.message || "서버 오류");
      // Mark server-side logical rejections so withRetry skips them
      err.isLogicalError = true;
      throw err;
    }
    return result;
  } catch (err) {
    if (err.message && err.message.includes("REACT_APP_GOOGLE_SCRIPT_URL")) throw err;
    if (text && text.trim().startsWith("<")) {
      const htmlErr = new Error("백엔드가 HTML을 반환했습니다. 스크립트 URL을 확인하세요.");
      htmlErr.isLogicalError = true;
      throw htmlErr;
    }
    throw err;
  }
};

const get = async (action) => {
  requireUrl();
  let text;
  try {
    const response = await fetch(`${SCRIPT_URL}?action=${action}`);
    text = await response.text();
    const result = JSON.parse(text);
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "서버 오류");
    }
    return result;
  } catch (err) {
    if (err.message && err.message.includes("REACT_APP_GOOGLE_SCRIPT_URL")) throw err;
    if (text && text.trim().startsWith("<")) {
      throw new Error("백엔드가 HTML을 반환했습니다. 스크립트 URL을 확인하세요.");
    }
    throw err;
  }
};

// Like get() but supports additional query parameters beyond action.
const getWithParams = async (action, params = {}) => {
  requireUrl();
  const qs = new URLSearchParams({ action, ...params }).toString();
  let text;
  try {
    const response = await fetch(`${SCRIPT_URL}?${qs}`);
    text = await response.text();
    const result = JSON.parse(text);
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "서버 오류");
    }
    return result;
  } catch (err) {
    if (err.message && err.message.includes("REACT_APP_GOOGLE_SCRIPT_URL")) throw err;
    if (text && text.trim().startsWith("<")) {
      throw new Error("백엔드가 HTML을 반환했습니다. 스크립트 URL을 확인하세요.");
    }
    throw err;
  }
};

export const fetchBootstrap = () => get("bootstrap");
export const fetchRecords = () => get("getRecords");
export const fetchInspectionRows = () => get("getInspectionRows");

// ── Split bootstrap endpoints (parallel load) ─────────────────────────────────
// These hit the fine-grained GAS actions added alongside the monolithic
// `bootstrap` action. Call fetchBootstrapParallel() to fire all five requests
// simultaneously; total wall-clock time becomes max(each) instead of sum(all).
export const fetchConfig     = () => get("getConfig");
export const fetchCurrentJob = () => get("getCurrentJob");
export const fetchDashboard  = () => get("getDashboard");

// Fires all bootstrap requests in parallel via Promise.all and merges the
// results into the same shape that the legacy `bootstrap` action returns,
// so callers need no changes beyond switching to this function.
export const fetchBootstrapParallel = async () => {
  const [configRes, jobRes, recordsRes, inspRes, dashRes] = await Promise.all([
    get("getConfig"),
    get("getCurrentJob"),
    get("getRecords"),
    get("getInspectionRows"),
    get("getDashboard"),
  ]);
  return {
    ok: true,
    data: {
      config:        (configRes.data  || {}).config       || {},
      worksheet_url: (configRes.data  || {}).worksheet_url || "",
      current_job:   (jobRes.data     || {}).current_job  || {},
      records:        recordsRes.records || [],
      rows:           inspRes.rows       || [],
      summary:       (dashRes.data    || {}).summary      || {},
    },
  };
};

export const cacheCsv = (payload) => post({ action: "cacheCsv", payload });

export const saveBatch = (rows) => post({ action: "saveBatch", rows });

export const cancelMovementEvent = (payload) =>
  post({ action: "cancelMovementEvent", payload: typeof payload === 'number' ? { rowNumber: payload } : payload });

export const manualRecalc = () => post({ action: "manualRecalc" });

export const syncHistory = () => post({ action: "syncHistory" });

export const resetCurrentJobInputData = (password) =>
  post({ action: "resetCurrentJobInputData", payload: { password } });

export const importHappycallCsv = (rows) =>
  post({ action: "importHappycallCsv", rows });

export const uploadPhotos = (payload) =>
  post({ action: "uploadPhotos", payload });

export const savePhotoMeta = (payload) =>
  post({ action: "savePhotoMeta", payload });

export const downloadPhotoZip = (payload) =>
  post({ action: "downloadPhotoZip", payload });

export const saveProductImageMapping = (payload) =>
  post({ action: "saveProductImageMapping", payload });

export const fetchHistoryData = () => get("getHistoryData");

export const fetchWorkSchedule = () => get("getWorkSchedule");

export const fetchFullSchedule = () => get("getFullSchedule");

// Request a lightweight server-side sync of return sheets + inspection totals.
// Use after a save when a full bootstrap reload is too expensive.
export const postSaveSync = (payload = {}) =>
  post({ action: "postSaveSync", ...payload });

// Retry wrapper used by save queue
export const withRetry = async (task) => {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      // Do NOT retry server-side logical rejections (conflict, version mismatch, bad request, etc.)
      // Only retry transient network/connectivity failures
      if (err.isLogicalError) throw err;
      if (attempt < RETRY_DELAYS_MS.length - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastError || new Error("request failed");
};

// ── Auth API calls ────────────────────────────────────────────────────────────
export const login = (id, password) =>
  post({ action: "login", payload: { id, password, userAgent: navigator.userAgent } });

export const validateSession = (token) =>
  post({ action: "validateSession", sessionToken: token });

export const logout = (token) =>
  post({ action: "logout", sessionToken: token || _sessionToken || "" });

// ── Admin-only session management ─────────────────────────────────────────────
export const listSessions = () =>
  post({ action: "listSessions" });

export const forceLogoutSession = (targetSessionToken) =>
  post({ action: "forceLogout", targetSessionToken });

// ── Inspection criteria search (검품 기준 검색) ───────────────────────────────
// Searches Drive folder names — no preloading, on-demand only.
export const fetchCriteriaSearch = (keyword, productName) =>
  getWithParams("searchInspectionCriteria", { keyword, productName: productName || '' });

export const fetchCriteriaImages = (folderId) =>
  getWithParams("getInspectionCriteriaImages", { folderId });
