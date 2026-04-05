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

export const fetchBootstrap = () => get("bootstrap");
export const fetchRecords = () => get("getRecords");
export const fetchInspectionRows = () => get("getInspectionRows");

export const cacheCsv = (payload) => post({ action: "cacheCsv", payload });

export const saveBatch = (rows) => post({ action: "saveBatch", rows });

export const cancelMovementEvent = (rowNumber) =>
  post({ action: "cancelMovementEvent", payload: { rowNumber } });

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
  post({ action: "login", payload: { id, password } });

export const validateSession = (token) =>
  post({ action: "validateSession", sessionToken: token });

export const logout = (token) =>
  post({ action: "logout", sessionToken: token || _sessionToken || "" });
