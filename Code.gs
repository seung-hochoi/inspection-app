
// ============================================================
// SECTION 1: CONSTANTS / SHEET NAMES / PROPERTY KEYS
// ============================================================

// ── Sheet names and global config ──────────────────────────
const SHEET_NAMES = {
  exclude: "제외목록",
  event: "행사표",
  mapping: "매핑",
  reservation: "사전예약추가",
  jobs: "jobs",
  jobCache: "job_cache",
  records: "return_exchange_records",
  inspection: "inspection_data",
  summary: "inspection_summary",
  returnCenter: "검품 회송내역 (센터포함)",
  returnSummary: "검품 회송내역 (센터미포함)",
  happycall: "happycall_data",
  productImages: "product_image_map",
  photoAssets: "photo_assets",
  dangjdo: "당도",
  history: "이력관리",
  writeConflictLog: "_write_conflict_log",  // diagnostic sheet (temporary)
  users: "USERS",
  userSessions: "user_sessions",
  auditLog: "audit_log",
};
const ADMIN_RESET_PASSWORD = "0000";
const JOB_CACHE_MAX_DATA_ROWS = 30000;
const JOB_CACHE_RETENTION_DAYS = 1;
var operationalReferenceCache_ = null;

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC WRITE-CONFLICT LOGGING
// Set DEBUG_WRITE_CONFLICTS = true to enable.
// Every save is recorded in the "_write_conflict_log" sheet with:
//   timestamp, action, clientId, jobKey, productCode, partnerName,
//   inspQty, returnQty, exchangeQty, version, expectedVersion, payload hash
// When two different clientIds write to the same row key within 10 seconds,
// a "⚠ CONFLICT" flag is written so you can spot the overwrite instantly.
// Set back to false (or delete the sheet) when diagnosis is complete.
// ─────────────────────────────────────────────────────────────────────────────
var DEBUG_WRITE_CONFLICTS = true;

// ── Daily automation sheet lists ───────────────────────────
// ─── Daily Backup & Reset Automation ─────────────────────────────────────────
// Backup at 03:00 AM (Asia/Seoul), Reset at 06:00 AM (Asia/Seoul).
// Installed by setupDailyTriggers_() — never triggered by normal save flows.

var OPERATIONAL_SHEETS_TO_BACKUP_ = [
  "inspection_data",
  "return_exchange_records",
  "검품 회송내역 (센터포함)",
  "검품 회송내역 (센터미포함)",
  "inspection_summary",
  "이력관리",
];

// Sheets that have header rows to preserve during reset (clear data below row 1)
var SHEETS_WITH_HEADERS_ = [
  "inspection_data",
  "return_exchange_records",
  "검품 회송내역 (센터포함)",
  "검품 회송내역 (센터미포함)",
  "inspection_summary",
  "이력관리",
];

// Reference/config sheets that must NEVER be touched
var PROTECTED_SHEETS_ = [
  "매핑", "행사표", "제외목록", "사전예약추가", "당도",
  "jobs", "job_cache", "happycall_data", "product_image_map", "photo_assets",
];

// ============================================================
// SECTION 1.5: AUTH / SESSION / AUDIT
// ============================================================

var ROLE_PERMISSIONS_ = {
  ADMIN:     ["VIEW","EDIT_INSPECTION","EDIT_RETURN_EXCHANGE","UPLOAD_PHOTO","DOWNLOAD_ZIP","VIEW_LOG","MANAGE_USERS"],
  MANAGER:   ["VIEW","EDIT_INSPECTION","EDIT_RETURN_EXCHANGE","UPLOAD_PHOTO","DOWNLOAD_ZIP"],
  INSPECTOR: ["VIEW","EDIT_INSPECTION","UPLOAD_PHOTO"],
  VIEWER:    ["VIEW"],
};

var SESSION_EXPIRY_HOURS_ = 8;

function getRolePermissions_(role) {
  return ROLE_PERMISSIONS_[String(role || "").toUpperCase()] || ["VIEW"];
}

function getUsersSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.users);
}

function getUserSessionsSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.userSessions);
}

function getAuditLogSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.auditLog);
}

function createSessionToken_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

/**
 * Ensures IP_ADDRESS and USER_AGENT columns exist in the user_sessions sheet.
 * Adds any missing columns to the header row (safe for existing data).
 * Mutates the headers array in place.
 * Returns { ipIdx, uaIdx } as 0-based indices.
 */
function ensureSessionIpUaColumns_(sessSheet, headers) {
  var needed = ["IP_ADDRESS", "USER_AGENT"];
  needed.forEach(function(col) {
    if (headers.indexOf(col) < 0) {
      sessSheet.getRange(1, headers.length + 1).setValue(col);
      headers.push(col);
    }
  });
  return {
    ipIdx: headers.indexOf("IP_ADDRESS"),
    uaIdx: headers.indexOf("USER_AGENT"),
  };
}

function nowKst_() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
}

function appendAuditLog_(params) {
  try {
    var sheet = getAuditLogSheet_();
    if (!sheet) return;
    sheet.appendRow([
      params.loggedAt    || nowKst_(),
      params.userId      || "",
      params.userName    || "",
      params.role        || "",
      params.action      || "",
      params.targetType  || "",
      params.targetKey   || "",
      params.jobKey      || "",
      params.productCode || "",
      params.productName || "",
      params.supplier    || "",
      params.beforeValue || "",
      params.afterValue  || "",
      params.result      || "",
      params.message     || "",
      params.clientId    || "",
    ]);
  } catch (err) {
    console.error("[appendAuditLog_] " + err.message);
  }
}

function getSessionUser_(sessionToken) {
  if (!sessionToken) return null;
  var sheet = getUserSessionsSheet_();
  if (!sheet || sheet.getLastRow() < 2) return null;

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tokenIdx    = headers.indexOf("SESSION_TOKEN");
  var userIdIdx   = headers.indexOf("USER_ID");
  var userNameIdx = headers.indexOf("USER_NAME");
  var roleIdx     = headers.indexOf("ROLE");
  var expiresIdx  = headers.indexOf("EXPIRES_AT");
  var activeIdx   = headers.indexOf("ACTIVE");
  var lastSeenIdx = headers.indexOf("LAST_SEEN_AT");

  var now = new Date();
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[tokenIdx] || "").trim() !== sessionToken) continue;
    if (String(row[activeIdx] || "").toUpperCase() !== "TRUE") continue;

    var expiresAt = row[expiresIdx];
    if (expiresAt) {
      var expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime()) && expDate < now) return null;
    }

    if (lastSeenIdx >= 0) {
      sheet.getRange(i + 1, lastSeenIdx + 1).setValue(nowKst_());
    }

    var role = String(row[roleIdx] || "VIEWER").trim().toUpperCase();
    return {
      id:          String(row[userIdIdx]   || ""),
      name:        String(row[userNameIdx] || ""),
      role:        role,
      permissions: getRolePermissions_(role),
    };
  }
  return null;
}

function requirePermission_(sessionToken, permission) {
  var user = getSessionUser_(sessionToken);
  if (!user) throw new Error("인증이 필요합니다. 다시 로그인해 주세요.");
  if (permission && user.permissions.indexOf(permission) < 0) {
    throw new Error("권한이 없습니다. (" + permission + ")");
  }
  return user;
}

function login_(payload) {
  var userId    = String(payload.id        || "").trim();
  var password  = String(payload.password  || "").trim();
  var userAgent = String(payload.userAgent || "").trim();
  // IP is not reliably available in GAS web apps; left blank intentionally.
  var ipAddress = "";

  var sheet = getUsersSheet_();
  if (!sheet || sheet.getLastRow() < 2) {
    appendAuditLog_({ action: "LOGIN_FAIL", userId: userId, result: "FAIL", message: "USERS 시트 없음" });
    return { ok: false, error: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS" };
  }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var idIdx        = headers.indexOf("ID");
  var passIdx      = headers.indexOf("PASSWORD");
  var nameIdx      = headers.indexOf("NAME");
  var activeIdx    = headers.indexOf("ACTIVE");
  var roleIdx      = headers.indexOf("ROLE");
  var permsIdx     = headers.indexOf("PERMISSIONS");
  var updatedIdx   = headers.indexOf("UPDATED_AT");
  var lastLoginIdx = headers.indexOf("LAST_LOGIN_AT");

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[idIdx] || "").trim() !== userId) continue;

    if (String(row[activeIdx] || "").toUpperCase() !== "TRUE") {
      appendAuditLog_({ action: "LOGIN_FAIL", userId: userId, result: "FAIL", message: "비활성 계정" });
      return { ok: false, error: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS" };
    }

    if (String(row[passIdx] || "").trim() !== password) {
      appendAuditLog_({ action: "LOGIN_FAIL", userId: userId, result: "FAIL", message: "비밀번호 불일치" });
      return { ok: false, error: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS" };
    }

    var role        = String(row[roleIdx] || "VIEWER").trim().toUpperCase();
    var userName    = String(row[nameIdx] || userId);
    var permissions = getRolePermissions_(role);
    var now         = nowKst_();

    if (lastLoginIdx >= 0) sheet.getRange(i + 1, lastLoginIdx + 1).setValue(now);
    if (updatedIdx   >= 0) sheet.getRange(i + 1, updatedIdx   + 1).setValue(now);
    if (permsIdx     >= 0) sheet.getRange(i + 1, permsIdx     + 1).setValue(permissions.join(","));

    var token   = createSessionToken_();
    var expDate = new Date();
    expDate.setHours(expDate.getHours() + SESSION_EXPIRY_HOURS_);
    var expiresAt = Utilities.formatDate(expDate, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

    var sessSheet = getUserSessionsSheet_();
    if (sessSheet) {
      // Read (or initialise) the session sheet's header row, then ensure IP/UA columns exist.
      var sessLastCol  = sessSheet.getLastColumn();
      var sessHeaders  = sessLastCol >= 1
        ? sessSheet.getRange(1, 1, 1, sessLastCol).getValues()[0].map(function(h) { return String(h).trim(); })
        : ["SESSION_TOKEN","USER_ID","USER_NAME","ROLE","PERMISSIONS","CREATED_AT","EXPIRES_AT","ACTIVE","LAST_SEEN_AT"];
      var colInfo = ensureSessionIpUaColumns_(sessSheet, sessHeaders);

      // Build a correctly-sized row aligned to the live header.
      var BASE_COLS = ["SESSION_TOKEN","USER_ID","USER_NAME","ROLE","PERMISSIONS","CREATED_AT","EXPIRES_AT","ACTIVE","LAST_SEEN_AT"];
      var BASE_VALS = [token, userId, userName, role, permissions.join(","), now, expiresAt, "TRUE", now];
      var sessRow   = new Array(sessHeaders.length).fill("");
      BASE_COLS.forEach(function(col, bi) {
        var idx = sessHeaders.indexOf(col);
        if (idx >= 0) sessRow[idx] = BASE_VALS[bi]; else sessRow[bi] = BASE_VALS[bi];
      });
      if (colInfo.ipIdx >= 0) sessRow[colInfo.ipIdx] = ipAddress;
      if (colInfo.uaIdx >= 0) sessRow[colInfo.uaIdx] = userAgent;
      sessSheet.appendRow(sessRow);
    }

    var uaSnippet = userAgent ? " UA:" + userAgent.substring(0, 80) : "";
    appendAuditLog_({ action: "LOGIN_SUCCESS", userId: userId, userName: userName, role: role, result: "SUCCESS", message: uaSnippet });
    return {
      ok: true,
      sessionToken: token,
      user: { id: userId, name: userName, role: role, permissions: permissions },
    };
  }

  appendAuditLog_({ action: "LOGIN_FAIL", userId: userId, result: "FAIL", message: "사용자 없음" });
  return { ok: false, error: "INVALID_CREDENTIALS", message: "INVALID_CREDENTIALS" };
}

function validateSession_(sessionToken) {
  var user = getSessionUser_(sessionToken);
  if (!user) return { ok: false, error: "세션이 만료되었거나 유효하지 않습니다" };
  return { ok: true, user: user };
}

function logout_(sessionToken) {
  if (!sessionToken) return { ok: false, error: "토큰이 없습니다" };
  var sheet = getUserSessionsSheet_();
  if (!sheet || sheet.getLastRow() < 2) return { ok: true };

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tokenIdx    = headers.indexOf("SESSION_TOKEN");
  var activeIdx   = headers.indexOf("ACTIVE");
  var userIdIdx   = headers.indexOf("USER_ID");
  var userNameIdx = headers.indexOf("USER_NAME");
  var roleIdx     = headers.indexOf("ROLE");

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][tokenIdx] || "").trim() !== sessionToken) continue;
    if (activeIdx >= 0) sheet.getRange(i + 1, activeIdx + 1).setValue("FALSE");
    appendAuditLog_({
      action: "LOGOUT",
      userId:   String(data[i][userIdIdx]   || ""),
      userName: String(data[i][userNameIdx] || ""),
      role:     String(data[i][roleIdx]     || ""),
      result:   "SUCCESS",
    });
    break;
  }
  return { ok: true };
}

function getActiveSessions_(sessionToken) {
  requirePermission_(sessionToken, "MANAGE_USERS");

  var sheet = getUserSessionsSheet_();
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, sessions: [] };

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tokenIdx    = headers.indexOf("SESSION_TOKEN");
  var userIdIdx   = headers.indexOf("USER_ID");
  var userNameIdx = headers.indexOf("USER_NAME");
  var roleIdx     = headers.indexOf("ROLE");
  var createdIdx  = headers.indexOf("CREATED_AT");
  var lastSeenIdx = headers.indexOf("LAST_SEEN_AT");
  var expiresIdx  = headers.indexOf("EXPIRES_AT");
  var activeIdx   = headers.indexOf("ACTIVE");
  var ipIdx       = headers.indexOf("IP_ADDRESS");
  var uaIdx       = headers.indexOf("USER_AGENT");

  var now = new Date();
  var sessions = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[activeIdx] || "").toUpperCase() !== "TRUE") continue;

    var expiresAt = row[expiresIdx];
    if (expiresAt) {
      var expDate = new Date(expiresAt);
      if (!isNaN(expDate.getTime()) && expDate < now) continue;
    }

    sessions.push({
      SESSION_TOKEN: String(row[tokenIdx]    || ""),
      USER_ID:       String(row[userIdIdx]   || ""),
      USER_NAME:     String(row[userNameIdx] || ""),
      ROLE:          String(row[roleIdx]     || ""),
      CREATED_AT:    String(row[createdIdx]  || ""),
      LAST_SEEN_AT:  String(row[lastSeenIdx] || ""),
      EXPIRES_AT:    String(row[expiresIdx]  || ""),
      IP_ADDRESS:    ipIdx  >= 0 ? String(row[ipIdx]  || "") : "",
      USER_AGENT:    uaIdx  >= 0 ? String(row[uaIdx]  || "") : "",
    });
  }

  return { ok: true, sessions: sessions };
}

function forceLogout_(sessionToken, targetSessionToken) {
  var admin = requirePermission_(sessionToken, "MANAGE_USERS");

  if (!targetSessionToken) throw new Error("targetSessionToken이 필요합니다.");

  var sheet = getUserSessionsSheet_();
  if (!sheet || sheet.getLastRow() < 2) throw new Error("세션 시트를 찾을 수 없습니다.");

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var tokenIdx   = headers.indexOf("SESSION_TOKEN");
  var activeIdx  = headers.indexOf("ACTIVE");
  var userIdIdx  = headers.indexOf("USER_ID");
  var uaIdx      = headers.indexOf("USER_AGENT");

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][tokenIdx] || "").trim() !== targetSessionToken) continue;

    if (activeIdx >= 0) sheet.getRange(i + 1, activeIdx + 1).setValue("FALSE");

    var targetUserId = userIdIdx >= 0 ? String(data[i][userIdIdx] || "") : "";
    var targetUa     = uaIdx     >= 0 ? String(data[i][uaIdx]     || "") : "";
    var uaNote       = targetUa ? " target_ua:" + targetUa.substring(0, 60) : "";

    appendAuditLog_({
      action:     "FORCE_LOGOUT",
      userId:     admin.id,
      userName:   admin.name,
      role:       admin.role,
      targetType: "SESSION",
      targetKey:  targetSessionToken,
      result:     "SUCCESS",
      message:    "target_user:" + targetUserId + uaNote,
    });

    return { ok: true };
  }

  throw new Error("해당 세션을 찾을 수 없습니다.");
}

// ============================================================
// SECTION 2: ENTRY POINTS (doGet / doPost)
// ============================================================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "bootstrap";

    if (action === "bootstrap") {
      return jsonOutput_({
        ok: true,
        data: {
          config: {
            exclude_rows: readObjectsSheet_(SHEET_NAMES.exclude),
            event_rows: readObjectsSheet_(SHEET_NAMES.event),
            reservation_rows: readReservationRows_(),
            mapping_rows: readObjectsSheet_(SHEET_NAMES.mapping),
            dangjdo_rows: readObjectsSheet_(SHEET_NAMES.dangjdo),
          },
          current_job: loadLatestJob_(),
          records: loadRecords_(),
          rows: loadInspectionRows_(),
          worksheet_url: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
          summary: getDashboardSummary_(),
          happycall: getHappycallAnalytics_(),
          product_images: loadProductImageMappings_(),
        },
      });
    }

    if (action === "getRecords") {
      return jsonOutput_({
        ok: true,
        records: loadRecords_(),
      });
    }

    if (action === "getInspectionRows") {
      return jsonOutput_({
        ok: true,
        rows: loadInspectionRows_(),
      });
    }

    if (action === "getHappycallAnalytics") {
      return jsonOutput_({
        ok: true,
        happycall: getHappycallAnalytics_(),
      });
    }

    if (action === "getHistoryData") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var histSheet = ss.getSheetByName(SHEET_NAMES.history);
      if (!histSheet || histSheet.getLastRow() < 2) {
        return jsonOutput_({ ok: true, data: [] });
      }
      var allVals = histSheet.getDataRange().getValues();
      var headers = allVals[0].map(String);
      var histRows = [];
      for (var hi = 1; hi < allVals.length; hi++) {
        var obj = {};
        for (var hj = 0; hj < headers.length; hj++) {
          var v = allVals[hi][hj];
          obj[headers[hj]] = (typeof v === 'number') ? v : String(v);
        }
        histRows.push(obj);
      }
      return jsonOutput_({ ok: true, data: histRows });
    }

    if (action === "getWorkSchedule") {
      return jsonOutput_(getWorkSchedule_());
    }

    if (action === "getFullSchedule") {
      var fsr = getFullSchedule_();
      // Strip rawCells before sending over the wire (internal use only)
      if (fsr.months) {
        fsr.months = fsr.months.map(function(m) {
          return { month: m.month, label: m.label, days: m.days };
        });
      }
      return jsonOutput_(fsr);
    }

    return jsonOutput_({
      ok: false,
      message: "지원하지 않는 action입니다.",
    });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: err.message || "GET 실패",
    });
  }
}

function getWorkSchedule_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ["근무표", "근무일정", "work_schedule"];
  var sheet = null;
  for (var sn = 0; sn < sheetNames.length; sn++) {
    sheet = ss.getSheetByName(sheetNames[sn]);
    if (sheet) { console.log("[getWorkSchedule_] sheet found: " + sheetNames[sn]); break; }
  }
  if (!sheet) {
    console.log("[getWorkSchedule_] ERROR: no schedule sheet found. Tried: " + sheetNames.join(", "));
    return { ok: true, workers: [] };
  }
  if (sheet.getLastRow() < 2) {
    console.log("[getWorkSchedule_] sheet is empty");
    return { ok: true, workers: [] };
  }

  var CORE = ["김민석", "최승호"];
  var now = new Date();
  var todayMonth = now.getMonth() + 1;
  var todayDay   = String(now.getDate());
  console.log("[getWorkSchedule_] today = month:" + todayMonth + " day:" + todayDay);

  // Use the full-schedule parser to find today's block
  var fullResult = getFullSchedule_();
  if (!fullResult.months || fullResult.months.length === 0) {
    console.log("[getWorkSchedule_] no months parsed — falling back to flat-table mode");
    // Flat-table fallback (legacy sheet with row=worker, col=day)
    var data = sheet.getDataRange().getValues();
    var headerRow = data[0];
    var workers = [];
    for (var ri = 1; ri < data.length; ri++) {
      var row = data[ri];
      // Worker name: scan all columns for a CORE name
      var foundName = null;
      var foundNameCol = -1;
      for (var ci = 0; ci < row.length; ci++) {
        var cv = String(row[ci] || "").trim();
        if (CORE.indexOf(cv) >= 0) { foundName = cv; foundNameCol = ci; break; }
      }
      if (!foundName) continue;
      var days = {};
      for (var j = 0; j < headerRow.length; j++) {
        var dayNum = String(headerRow[j] || "").trim();
        var num = parseInt(dayNum, 10);
        if (isNaN(num) || num < 1 || num > 31) continue;
        days[String(num)] = String(row[j] || "").trim();
      }
      var cellToday = days[todayDay];
      console.log("[getWorkSchedule_] flat fallback worker=" + foundName + " day=" + todayDay + " cell=" + JSON.stringify(cellToday));
      workers.push({ name: foundName, days: days });
    }
    return { ok: true, workers: workers };
  }

  // Find this month's block (fall back to last available)
  var todayBlock = null;
  for (var m = 0; m < fullResult.months.length; m++) {
    if (fullResult.months[m].month === todayMonth) { todayBlock = fullResult.months[m]; break; }
  }
  if (!todayBlock) {
    todayBlock = fullResult.months[fullResult.months.length - 1];
    console.log("[getWorkSchedule_] month " + todayMonth + " not found — using last block: " + todayBlock.month);
  } else {
    console.log("[getWorkSchedule_] selected block for month " + todayMonth);
  }

  // Build workers array from this block's raw cells
  var workers = CORE.map(function(name) {
    // Find the cell for today from the block's rawCells map
    var cellVal = (todayBlock.rawCells && todayBlock.rawCells[name])
                  ? (todayBlock.rawCells[name][todayDay] !== undefined ? todayBlock.rawCells[name][todayDay] : null)
                  : null;
    console.log("[getWorkSchedule_] worker=" + name + " todayCell=" + JSON.stringify(cellVal));
    var days = (todayBlock.rawCells && todayBlock.rawCells[name]) ? todayBlock.rawCells[name] : {};
    return { name: name, days: days };
  });
  return { ok: true, workers: workers };
}

// ── Full multi-month schedule parser ──────────────────────────────────────────
// Reads the single schedule sheet, scans for month-header rows that contain
// both a month number (N월) and a work-related keyword (근무).
// Parses day-column maps and worker rows for 김민석 and 최승호 only.
// Returns { ok, months: [{ month, label, days: [{ day, workers }], rawCells: {...} }] }
function getFullSchedule_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = ["근무표", "근무일정", "work_schedule"];
  var sheet = null;
  for (var sn = 0; sn < sheetNames.length; sn++) {
    sheet = ss.getSheetByName(sheetNames[sn]);
    if (sheet) { console.log("[getFullSchedule_] sheet: " + sheetNames[sn]); break; }
  }
  if (!sheet || sheet.getLastRow() < 2) {
    console.log("[getFullSchedule_] no sheet or empty");
    return { ok: true, months: [] };
  }

  var CORE = ["김민석", "최승호"];
  var data = sheet.getDataRange().getValues();
  var totalRows = data.length;
  var totalCols = data[0] ? data[0].length : 0;
  console.log("[getFullSchedule_] total rows=" + totalRows + " cols=" + totalCols);

  // ── Pass 1: find all month-header rows ─────────────────────────────────────
  // A row is a month header if ANY cell in the row contains a digit followed by
  // "월" AND (that same cell or another cell in the row) contains "근무".
  var monthHeaders = []; // [{ rowIndex, monthNum }]
  for (var ri = 0; ri < totalRows; ri++) {
    var row = data[ri];
    var rowText = row.map(function(c) { return String(c || "").trim(); }).join(" ");
    var monthMatch = rowText.match(/(\d+)\s*월/);
    var hasGeunmu  = /근무/.test(rowText);
    if (monthMatch && hasGeunmu) {
      var mNum = parseInt(monthMatch[1], 10);
      console.log("[getFullSchedule_] month header found: row=" + ri + " text='" + rowText.slice(0, 60) + "' monthNum=" + mNum);
      monthHeaders.push({ rowIndex: ri, monthNum: mNum });
    }
  }
  if (monthHeaders.length === 0) {
    // Log a few rows to help diagnose
    console.log("[getFullSchedule_] WARNING: no month headers found. Dumping first 10 rows:");
    for (var di = 0; di < Math.min(10, totalRows); di++) {
      var preview = data[di].map(function(c) { return String(c || "").trim(); }).filter(Boolean).join(" | ");
      console.log("  row[" + di + "]: " + preview.slice(0, 80));
    }
    return { ok: true, months: [] };
  }

  // ── Pass 2: parse each month block ─────────────────────────────────────────
  var months = [];

  for (var mhi = 0; mhi < monthHeaders.length; mhi++) {
    var blockStart = monthHeaders[mhi].rowIndex + 1;
    var blockEnd   = mhi + 1 < monthHeaders.length
                     ? monthHeaders[mhi + 1].rowIndex
                     : totalRows;
    var monthNum   = monthHeaders[mhi].monthNum;
    console.log("[getFullSchedule_] parsing month=" + monthNum + " rows [" + blockStart + "," + blockEnd + ")");

    // ── Find day-column header row inside this block ──────────────────────────
    // A day-header row has at least 10 cells whose value is an integer 1–31.
    // Cells may be numbers or strings; handle both.
    var dayColMap = {}; // "1".."31" → colIndex
    var dayHeaderRow = -1;
    for (var r = blockStart; r < blockEnd; r++) {
      var hrow = data[r];
      var tempMap = {};
      for (var c = 0; c < hrow.length; c++) {
        var raw = hrow[c];
        var v = String(raw === null || raw === undefined ? "" : raw).trim();
        // Accept both numeric type and string representation
        var num = (typeof raw === "number") ? raw : parseInt(v, 10);
        if (!isNaN(num) && num >= 1 && num <= 31 && (String(num) === v || raw === num)) {
          tempMap[String(num)] = c;
        }
      }
      if (Object.keys(tempMap).length >= 10) {
        dayColMap = tempMap;
        dayHeaderRow = r;
        console.log("[getFullSchedule_] day-header row=" + r + " found " + Object.keys(tempMap).length + " day cols (1.." + Math.max.apply(null, Object.keys(tempMap).map(Number)) + ")");
        break;
      }
    }
    if (dayHeaderRow === -1) {
      console.log("[getFullSchedule_] WARNING: no day-header row found for month=" + monthNum + ". Dumping block rows:");
      for (var dr = blockStart; dr < Math.min(blockStart + 6, blockEnd); dr++) {
        var dpreview = data[dr].map(function(c) { return String(c === null || c === undefined ? "" : c).trim(); }).filter(Boolean).slice(0, 8).join(" | ");
        console.log("  row[" + dr + "]: " + dpreview);
      }
      continue;
    }

    // ── Find worker rows inside this block (after the day-header row) ─────────
    // Worker name may appear in ANY column of the row (handles merged cells).
    var workerCells = {};
    CORE.forEach(function(n) { workerCells[n] = {}; });
    var foundWorkers = {};
    CORE.forEach(function(n) { foundWorkers[n] = false; });

    for (var wr = dayHeaderRow + 1; wr < blockEnd; wr++) {
      var wrow = data[wr];
      // Find worker name by scanning all cells in the row
      var wname = null;
      for (var wc = 0; wc < wrow.length; wc++) {
        var wcv = String(wrow[wc] === null || wrow[wc] === undefined ? "" : wrow[wc]).trim();
        if (CORE.indexOf(wcv) >= 0) { wname = wcv; break; }
      }
      if (!wname) continue;
      foundWorkers[wname] = true;

      // Read day cells
      for (var dayStr in dayColMap) {
        var dcol = dayColMap[dayStr];
        var cellRaw = wrow[dcol];
        workerCells[wname][dayStr] = String(cellRaw === null || cellRaw === undefined ? "" : cellRaw).trim();
      }
      console.log("[getFullSchedule_] month=" + monthNum + " worker=" + wname + " row=" + wr
        + " sample day1=" + JSON.stringify(workerCells[wname]["1"])
        + " day15=" + JSON.stringify(workerCells[wname]["15"]));
    }

    CORE.forEach(function(n) {
      if (!foundWorkers[n]) {
        console.log("[getFullSchedule_] WARNING: month=" + monthNum + " worker '" + n + "' NOT FOUND in block rows");
      }
    });

    // ── Build frontend day list ───────────────────────────────────────────────
    var maxDay = Object.keys(dayColMap).length > 0
                 ? Math.max.apply(null, Object.keys(dayColMap).map(Number))
                 : 31;
    var days = [];
    for (var d = 1; d <= maxDay; d++) {
      var ds = String(d);
      var working = CORE.filter(function(name) {
        var cell = workerCells[name][ds];
        if (cell === undefined) {
          // data missing for this day — treat as working but note it
          return true;
        }
        return cell !== "휴무";
      });
      days.push({ day: d, workers: working });
    }

    months.push({
      month:    monthNum,
      label:    monthNum + "월",
      days:     days,
      rawCells: workerCells, // kept for getWorkSchedule_ to read today's cell
    });
  }

  console.log("[getFullSchedule_] done. months parsed: " + months.map(function(m) { return m.month; }).join(", "));
  return { ok: true, months: months };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw);
    const action = body.action || "";

    // ── Diagnostic entry-point log ──────────────────────────────────────────
    if (DEBUG_WRITE_CONFLICTS) {
      var _rows = (body.rows || [body.payload]).filter(Boolean);
      _rows.forEach(function(_p) {
        var _clientId  = String(_p["clientId"]  || _p["clientId"]  || "").trim() || "(없음-구버전)";
        var _jobKey    = String(_p["작업기준일또는CSV식별값"] || _p["jobKey"]    || "").trim();
        var _code      = String(_p["상품코드"]   || _p["productCode"] || "").trim();
        var _partner   = String(_p["협력사명"]   || _p["partnerName"] || "").trim();
        var _type      = String(_p["type"]       || "").trim();
        var _version   = String(_p["버전"]       || _p["expectedVersion"] || "").trim();
        console.log("[doPost] action=" + action
          + " rowType=" + _type
          + " clientId=" + _clientId
          + " jobKey=" + _jobKey
          + " code=" + _code
          + " partner=" + _partner
          + " expectedV=" + _version
          + " payloadKeys=" + Object.keys(_p).sort().join(","));
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    if (action === "login") {
      return jsonOutput_(login_(body.payload || {}));
    }

    if (action === "validateSession") {
      return jsonOutput_(validateSession_(body.sessionToken || ""));
    }

    if (action === "logout") {
      return jsonOutput_(logout_(body.sessionToken || ""));
    }

    if (action === "cacheCsv") {
      var cachedJob = cacheCsvJob_(body.payload || {});
      return jsonOutput_({
        ok: true,
        job: cachedJob,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveRecord") {
      var _authR = requirePermission_(body.sessionToken, "EDIT_RETURN_EXCHANGE");
      var savedRecord = appendRecord_(body.payload || {});
      var _rp = body.payload || {};
      appendAuditLog_({ action: "SAVE_RETURN_EXCHANGE", userId: _authR.id, userName: _authR.name, role: _authR.role,
        jobKey: _rp["작업기준일또는CSV식별값"] || "", productCode: _rp["상품코드"] || "",
        productName: _rp["상품명"] || "", supplier: _rp["협력사명"] || "", result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        record: savedRecord,
        records: loadRecords_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "deleteRecord") {
      var _authD = requirePermission_(body.sessionToken, "EDIT_RETURN_EXCHANGE");
      var deletedRecord = deleteRecord_(body.payload || {});
      appendAuditLog_({ action: "SAVE_RETURN_EXCHANGE", userId: _authD.id, userName: _authD.name, role: _authD.role,
        message: "delete rowNumber=" + ((body.payload || {}).rowNumber || ""), result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        deleted: deletedRecord,
        records: loadRecords_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveInspectionQty") {
      var _authU = requirePermission_(body.sessionToken, "EDIT_INSPECTION");
      var savedInspectionRow = saveInspectionQty_(body.payload || {});
      var _p = body.payload || {};
      appendAuditLog_({ action: "SAVE_INSPECTION", userId: _authU.id, userName: _authU.name, role: _authU.role,
        jobKey: _p["작업기준일또는CSV식별값"] || _p.jobKey || "", productCode: _p["상품코드"] || "",
        productName: _p["상품명"] || "", supplier: _p["협력사명"] || "", clientId: _p.clientId || "", result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        row: savedInspectionRow,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveInspectionBatch") {
      var _authU2 = requirePermission_(body.sessionToken, "EDIT_INSPECTION");
      var savedInspectionBatch = saveInspectionBatch_(body.rows || []);
      appendAuditLog_({ action: "SAVE_INSPECTION", userId: _authU2.id, userName: _authU2.name, role: _authU2.role,
        message: "batch rows=" + (body.rows || []).length, result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        data: savedInspectionBatch,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveBatch") {
      var _authU3 = requirePermission_(body.sessionToken, "EDIT_RETURN_EXCHANGE");
      var batchData = saveBatch_(body.rows || []);
      // Auto-sync return sheets when movement rows were saved.
      if (batchData.hasMovement) {
        try {
          syncReturnSheets_(SpreadsheetApp.getActiveSpreadsheet());
        } catch (syncErr) {
          console.error("[doPost] syncReturnSheets_ failed after saveBatch: " + syncErr.message);
        }
        // Include fresh records in the response so the client can update the Records tab
        // without a full bootstrap reload. Falls back gracefully on failure.
        try {
          batchData.freshRecords = loadRecords_();
        } catch (e) {
          console.error("[doPost] loadRecords_ for freshRecords failed: " + e.message);
        }
      }
      appendAuditLog_({ action: "SAVE_RETURN_EXCHANGE", userId: _authU3.id, userName: _authU3.name, role: _authU3.role,
        message: "batch rows=" + (body.rows || []).length, result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        data: batchData,
      });
    }

    if (action === "postSaveSync") {
      return jsonOutput_({ ok: true, data: postSaveSync_(body) });
    }

    if (action === "manualRecalc") {
      return jsonOutput_({
        ok: true,
        data: manualRecalc_(),
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "cancelMovementEvent") {
      var cancelled = cancelMovementEvent_(body.payload || {});
      // Targeted row deletion is now handled inside deleteRecord_ via
      // deleteReturnSheetRowsForRecord_ — no full sheet rebuild needed here.
      return jsonOutput_({
        ok: true,
        deleted: cancelled,
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "downloadPhotoZip") {
      var _authZ = requirePermission_(body.sessionToken, "DOWNLOAD_ZIP");
      var _zipResult = createPhotoZip_(body.payload || {});
      appendAuditLog_({ action: "DOWNLOAD_ZIP", userId: _authZ.id, userName: _authZ.name, role: _authZ.role,
        message: "mode=" + ((body.payload || {}).mode || ""), result: "SUCCESS" });
      return jsonOutput_(Object.assign({ ok: true }, _zipResult));
    }

    if (action === "resetCurrentJobInputData") {
      return jsonOutput_(resetCurrentJobInputData_(body.payload || {}));
    }

    if (action === "importHappycallEmails") {
      return jsonOutput_({
        ok: true,
        data: importHappycallBatch_(body.rows || body.payload || []),
        happycall: getHappycallAnalytics_(),
      });
    }

    if (action === "importHappycallCsv") {
      return jsonOutput_({
        ok: true,
        data: importHappycallCsvRows_(body.rows || body.payload || []),
        happycall: getHappycallAnalytics_(),
      });
    }

    if (action === "saveProductImageMapping") {
      return jsonOutput_({
        ok: true,
        data: saveProductImageMapping_(body.payload || {}),
        product_images: loadProductImageMappings_(),
      });
    }

    if (action === "uploadPhotos") {
      var _authPh = requirePermission_(body.sessionToken, "UPLOAD_PHOTO");
      var _phResult = uploadPhotos_(body.payload || {});
      var _php = body.payload || {};
      appendAuditLog_({ action: "UPLOAD_PHOTO", userId: _authPh.id, userName: _authPh.name, role: _authPh.role,
        jobKey: _php.jobKey || "", productCode: _php.productCode || "",
        productName: _php.productName || "", supplier: _php.partnerName || "",
        message: "photoType=" + (_php.photoType || "") + " count=" + ((_php.photos || []).length),
        result: "SUCCESS" });
      return jsonOutput_({
        ok: true,
        data: _phResult,
      });
    }

    if (action === "savePhotoMeta") {
      var _authPm = requirePermission_(body.sessionToken, "UPLOAD_PHOTO");
      return jsonOutput_({
        ok: true,
        data: savePhotoMeta_(body.payload || {}),
      });
    }

    if (action === "syncHistory") {
      var histSs = SpreadsheetApp.getActiveSpreadsheet();
      syncHistorySheet_(histSs);
      return jsonOutput_({ ok: true });
    }

    if (action === "listSessions") {
      return jsonOutput_(getActiveSessions_(body.sessionToken || ""));
    }

    if (action === "forceLogout") {
      return jsonOutput_(forceLogout_(body.sessionToken || "", body.targetSessionToken || ""));
    }

    return jsonOutput_({
      ok: false,
      message: "지원하지 않는 action입니다.",
    });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: err.message || "POST 실패",
    });
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ============================================================
// SECTION 3: BOOTSTRAP / READ HELPERS
// ============================================================

// ── Operational reference maps ─────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function getOperationalMappingSheet_(ss) {
  var direct =
    ss.getSheetByName(SHEET_NAMES.mapping) ||
    ss.getSheetByName("매핑기준표") ||
    ss.getSheetByName("기준표");

  if (direct) {
    return direct;
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i += 1) {
    var sheet = sheets[i];
    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 8) continue;
    var header = sheet.getRange(1, 1, 1, 8).getValues()[0];
    if (
      String(header[0] || "").trim() === "소분류명" &&
      String(header[1] || "").trim() === "대분류" &&
      String(header[6] || "").trim() === "협력사" &&
      String(header[7] || "").trim() === "값"
    ) {
      return sheet;
    }
  }

  return null;
}

function normalizeOperationalLookupText_(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOperationalMajorCategory_(value) {
  var text = String(value || "").trim();
  if (!text) return "";
  if (text === "채소" || text === "과일" || text === "축산" || text === "수산") {
    return text;
  }
  return "미분류";
}

function getOperationalMajorCategoryPriority_(value) {
  var category = normalizeOperationalMajorCategory_(value);
  if (category === "채소") return 1;
  if (category === "과일") return 2;
  if (category === "축산") return 3;
  if (category === "수산") return 4;
  return 9;
}

function readOperationalReferenceMaps_(ss) {
  if (operationalReferenceCache_) {
    return operationalReferenceCache_;
  }

  var sheet = getOperationalMappingSheet_(ss);
  var maps = {
    subCategoryToMajor: {},
    partnerToStandard: {},
    subCategoryEntries: [],
  };

  if (!sheet || sheet.getLastRow() < 2) {
    operationalReferenceCache_ = maps;
    return maps;
  }

  var values = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 8)).getValues();
  for (var r = 1; r < values.length; r += 1) {
    var row = values[r];
    var subCategory = normalizeOperationalLookupText_(row[0]);
    var majorCategory = normalizeOperationalMajorCategory_(row[1]);
    var partnerOriginal = normalizeOperationalLookupText_(row[6]);
    var partnerStandard = String(row[7] || "").trim();

    if (subCategory && majorCategory) {
      maps.subCategoryToMajor[subCategory] = majorCategory;
      maps.subCategoryEntries.push({
        raw: subCategory,
        normalized: normalizeOperationalLookupText_(subCategory).toLowerCase(),
        tokens: subCategory
          .split("/")
          .map(function (item) {
            return normalizeOperationalLookupText_(item).toLowerCase();
          })
          .filter(Boolean),
        majorCategory: majorCategory,
      });
    }
    if (partnerOriginal && partnerStandard) {
      maps.partnerToStandard[partnerOriginal] = partnerStandard;
    }
  }

  operationalReferenceCache_ = maps;
  return maps;
}

function inferOperationalMetaFromProductName_(productName, maps) {
  var normalizedName = normalizeOperationalLookupText_(productName).toLowerCase();
  if (!normalizedName || !maps || !Array.isArray(maps.subCategoryEntries)) {
    return { subCategory: "", majorCategory: "미분류" };
  }

  var bestMatch = null;
  maps.subCategoryEntries.forEach(function (entry) {
    var matched = false;
    if (entry.normalized && normalizedName.indexOf(entry.normalized) >= 0) {
      matched = true;
    } else {
      for (var i = 0; i < entry.tokens.length; i += 1) {
        var token = entry.tokens[i];
        if (token && normalizedName.indexOf(token) >= 0) {
          matched = true;
          break;
        }
      }
    }

    if (!matched) return;

    if (!bestMatch || entry.normalized.length > bestMatch.normalized.length) {
      bestMatch = entry;
    }
  });

  if (!bestMatch) {
    return { subCategory: "", majorCategory: "미분류" };
  }

  return {
    subCategory: bestMatch.raw,
    majorCategory: bestMatch.majorCategory || "미분류",
  };
}

function standardizeOperationalPartnerName_(value, maps) {
  var rawText = String(value || "").trim();
  var normalizedText = normalizeOperationalLookupText_(value);
  if (!normalizedText) return "";
  return (maps && maps.partnerToStandard && maps.partnerToStandard[normalizedText]) || rawText;
}

function buildOperationalProductMetaMap_(rows, maps) {
  var byCode = {};
  var byName = {};
  var productOrderByName = {};
  var nextOrder = 1;

  (Array.isArray(rows) ? rows : []).forEach(function (row, index) {
    var productCode = normalizeCode_(getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    var productName = String(getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    var nameKey = normalizeText_(productName);
    var subCategory = normalizeOperationalLookupText_(
      getRowFieldValue_(row, ["소분류명", "소분류", "카테고리소", "소카테고리", "중분류명", "중분류"])
    );
    var inferredMeta = inferOperationalMetaFromProductName_(productName, maps);
    if (!subCategory && inferredMeta.subCategory) {
      subCategory = inferredMeta.subCategory;
    }
    var majorCategory =
      normalizeOperationalMajorCategory_(
        getRowFieldValue_(row, ["대분류", "카테고리대", "대카테고리", "과채"])
      ) ||
      ((maps && maps.subCategoryToMajor && maps.subCategoryToMajor[subCategory]) || "") ||
      inferredMeta.majorCategory;

    if (!productCode && !nameKey) return;

    if (nameKey && productOrderByName[nameKey] === undefined) {
      productOrderByName[nameKey] = nextOrder;
      nextOrder += 1;
    }

    var meta = {
      productCode: productCode,
      productName: productName,
      subCategory: subCategory,
      majorCategory: majorCategory || "미분류",
      productOrder: nameKey && productOrderByName[nameKey] !== undefined ? productOrderByName[nameKey] : 999999 + index,
      sourceIndex: index,
    };

    if (productCode && !byCode[productCode]) {
      byCode[productCode] = meta;
    }
    if (nameKey && !byName[nameKey]) {
      byName[nameKey] = meta;
    }
  });

  return {
    byCode: byCode,
    byName: byName,
  };
}

function getOperationalProductMeta_(productMetaMap, productCode, productName) {
  var code = normalizeCode_(productCode);
  var nameKey = normalizeText_(productName);
  if (code && productMetaMap.byCode[code]) {
    return productMetaMap.byCode[code];
  }
  if (nameKey && productMetaMap.byName[nameKey]) {
    return productMetaMap.byName[nameKey];
  }
  return {
    productCode: code,
    productName: String(productName || "").trim(),
    subCategory: "",
    majorCategory: "미분류",
    productOrder: 999999,
    sourceIndex: 999999,
  };
}

function buildOperationalSortContext_(row, productMetaMap, originalOrder) {
  var productCode = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
  var productName = String(row["상품명"] || row["상품 명"] || row["품목명"] || row["품명"] || "").trim();
  var meta = getOperationalProductMeta_(productMetaMap, productCode, productName);

  return {
    majorCategory: meta.majorCategory || "미분류",
    majorPriority: getOperationalMajorCategoryPriority_(meta.majorCategory || "미분류"),
    productOrder: Number(meta.productOrder || 999999),
    originalOrder: Number(originalOrder || 0),
  };
}

function compareOperationalSortContext_(a, b) {
  var priorityDiff = Number(a.majorPriority || 9) - Number(b.majorPriority || 9);
  if (priorityDiff !== 0) return priorityDiff;

  var productOrderDiff = Number(a.productOrder || 999999) - Number(b.productOrder || 999999);
  if (productOrderDiff !== 0) return productOrderDiff;

  return Number(a.originalOrder || 0) - Number(b.originalOrder || 0);
}

function applyOperationalTableBorders_(sheet, width) {
  if (!sheet || sheet.getLastRow() < 1) return;
  var rowCount = Math.max(sheet.getLastRow(), 1);
  sheet
    .getRange(1, 1, rowCount, width)
    .setBorder(true, true, true, true, true, true, "#d1d5db", SpreadsheetApp.BorderStyle.SOLID);
}

function mergeOperationalCategoryColumn_(sheet, rowCount) {
  if (!sheet || rowCount <= 0) return;

  sheet.getRange(2, 1, rowCount, 1).breakApart();
  var values = sheet.getRange(2, 1, rowCount, 1).getValues();
  var startRow = 2;
  var currentValue = String(values[0][0] || "").trim();
  var span = 1;

  for (var i = 1; i < values.length; i += 1) {
    var nextValue = String(values[i][0] || "").trim();
    if (nextValue === currentValue) {
      span += 1;
      continue;
    }

    if (currentValue && span > 1) {
      sheet.getRange(startRow, 1, span, 1).merge();
    }

    startRow = i + 2;
    currentValue = nextValue;
    span = 1;
  }

  if (currentValue && span > 1) {
    sheet.getRange(startRow, 1, span, 1).merge();
  }

  sheet.getRange(2, 1, rowCount, 1).setVerticalAlignment("middle").setHorizontalAlignment("center");
}


// ── Sheet / job-cache helpers ──────────────────────────────
function readObjectsSheet_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) {
    return String(header || "").trim();
  });

  const rows = [];

  for (var r = 1; r < values.length; r += 1) {
    const row = {};
    var hasValue = false;

    for (var c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;

      const value = values[r][c];
      if (value !== "") hasValue = true;
      row[header] = value;
    }

    if (hasValue) {
      if (row["상품코드"] !== undefined) {
        row["상품코드"] = normalizeCode_(row["상품코드"]);
      }
      if (row["협력사"] !== undefined) {
        row["협력사"] = String(row["협력사"] || "").trim();
      }
      rows.push(row);
    }
  }

  return rows;
}

function readReservationRows_() {
  const rows = readObjectsSheet_(SHEET_NAMES.reservation);
  if (rows.length > 0) {
    return rows;
  }
  return readObjectsSheet_("사전예약");
}

function cacheCsvJob_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = getOrCreateSheet_(ss, SHEET_NAMES.jobs);
  const cacheSheet = getOrCreateSheet_(ss, SHEET_NAMES.jobCache);
  pruneExpiredJobCacheRows_(jobsSheet, cacheSheet);

  ensureHeaderRow_(jobsSheet, [
    "created_at",
    "job_key",
    "source_file_name",
    "source_file_modified",
    "row_count",
  ]);
  ensureHeaderRow_(cacheSheet, [
    "created_at",
    "job_key",
    "row_index",
    "row_json",
  ]);

  const jobKey = String(payload.job_key || "").trim();
  const sourceFileName = String(payload.source_file_name || "").trim();
  const sourceFileModified = String(payload.source_file_modified || "").trim();
  var parsedRows = Array.isArray(payload.parsed_rows) ? payload.parsed_rows : [];
  // Frontend sends base64-encoded UTF-8 JSON to avoid CORS preflight issues
  if (!parsedRows.length && payload.parsed_rows_base64) {
    try {
      var decoded = Utilities.newBlob(Utilities.base64Decode(payload.parsed_rows_base64)).getDataAsString("UTF-8");
      var decodedRows = JSON.parse(decoded);
      if (Array.isArray(decodedRows)) parsedRows = decodedRows;
    } catch (_e) {}
  }

  if (!jobKey) {
    throw new Error("job_key가 없습니다.");
  }

  const existingJob = findJobByKey_(jobsSheet, jobKey);
  if (existingJob) {
    return loadJobRowsByKey_(ss, jobKey);
  }

  const now = new Date().toISOString();

  jobsSheet.appendRow([now, jobKey, sourceFileName, sourceFileModified, parsedRows.length]);

  if (parsedRows.length > 0) {
    const values = parsedRows.map(function (row, idx) {
      return [now, jobKey, idx, JSON.stringify(row)];
    });

    cacheSheet.getRange(cacheSheet.getLastRow() + 1, 1, values.length, 4).setValues(values);
    pruneJobCacheRows_(cacheSheet);
  }

  var job = loadJobRowsByKey_(ss, jobKey);
  seedInspectionFromCsv_(parsedRows, jobKey);
  return job;
}

function seedInspectionFromCsv_(parsedRows, jobKey) {
  if (!jobKey || !Array.isArray(parsedRows) || !parsedRows.length) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var inspectionSheet = getInspectionSheet_(ss);
  var exclusionIdx = buildExclusionIndex_();
  var excludedCodes = exclusionIdx.excludedCodes;
  var excludedPairs = exclusionIdx.excludedPairs;
  var excludedPartners = exclusionIdx.excludedPartners;
  var nowIso = new Date().toISOString();
  var grouped = {};

  parsedRows.forEach(function (row) {
    var productCode = normalizeCode_(getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    var productName = String(getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    var partnerName = String(
      getRowFieldValue_(row, ["협력사명", "협력사", "거래처명", "거래처명(구매조건명)"]) || ""
    ).trim();
    var qty = parseNumber_(getRowFieldValue_(row, ["발주수량", "수량"]) || 0);
    if (!productCode) return;
    if (isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners)) return;

    var key = [String(jobKey || "").trim(), productCode, partnerName].join("||");
    if (!grouped[key]) {
      grouped[key] = {
        "작성일시": nowIso,
        "작업기준일또는CSV식별값": jobKey,
        "상품코드": productCode,
        "상품명": productName,
        "협력사명": partnerName,
        "발주수량": 0,
        "검품수량": 0,
        "회송수량": 0,
        "교환수량": 0,
        "불량사유": "",
        "BRIX최저": "",
        "BRIX최고": "",
        "BRIX평균": "",
        "수정일시": "",
        "버전": 0,
      };
    }
    grouped[key]["발주수량"] += qty;
  });

  Object.keys(grouped).forEach(function (key) {
    var row = grouped[key];
    if (!findInspectionRow_(inspectionSheet, row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"])) {
      writeInspectionRow_(inspectionSheet, 0, row);
    }
  });
}

function loadLatestJob_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName(SHEET_NAMES.jobs);
  const cacheSheet = ss.getSheetByName(SHEET_NAMES.jobCache);
  pruneExpiredJobCacheRows_(jobsSheet, cacheSheet);

  if (!jobsSheet || jobsSheet.getLastRow() < 2) {
    return null;
  }

  const values = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, jobsSheet.getLastColumn()).getValues();
  const last = values[values.length - 1];
  const jobKey = String(last[1] || "").trim();

  if (!jobKey) {
    return null;
  }

  return loadJobRowsByKey_(ss, jobKey);
}

function loadJobRowsByKey_(ss, jobKey) {
  const jobsSheet = ss.getSheetByName(SHEET_NAMES.jobs);
  const cacheSheet = ss.getSheetByName(SHEET_NAMES.jobCache);

  if (!jobsSheet || !cacheSheet) {
    return null;
  }

  let jobMeta = null;
  const jobValues = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, jobsSheet.getLastColumn()).getValues();

  for (var i = jobValues.length - 1; i >= 0; i -= 1) {
    if (String(jobValues[i][1] || "").trim() === jobKey) {
      jobMeta = {
        created_at: jobValues[i][0],
        job_key: jobValues[i][1],
        source_file_name: jobValues[i][2],
        source_file_modified: jobValues[i][3],
        row_count: jobValues[i][4],
      };
      break;
    }
  }

  if (!jobMeta) {
    return null;
  }

  if (cacheSheet.getLastRow() < 2) {
    return {
      job_key: jobMeta.job_key,
      source_file_name: jobMeta.source_file_name,
      source_file_modified: jobMeta.source_file_modified,
      created_at: jobMeta.created_at,
      rows: [],
    };
  }

  const cacheValues = cacheSheet.getRange(2, 1, cacheSheet.getLastRow() - 1, 4).getValues();
  const rows = cacheValues
    .filter(function (row) {
      return String(row[1] || "").trim() === jobKey;
    })
    .sort(function (a, b) {
      return Number(a[2] || 0) - Number(b[2] || 0);
    })
    .map(function (row) {
      return JSON.parse(String(row[3] || "{}"));
    });

  return {
    job_key: jobMeta.job_key,
    source_file_name: jobMeta.source_file_name,
    source_file_modified: jobMeta.source_file_modified,
    created_at: jobMeta.created_at,
    rows: rows,
  };
}

function findJobByKey_(jobsSheet, jobKey) {
  if (jobsSheet.getLastRow() < 2) return null;

  const values = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, jobsSheet.getLastColumn()).getValues();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    if (String(values[i][1] || "").trim() === jobKey) {
      return {
        created_at: values[i][0],
        job_key: values[i][1],
        source_file_name: values[i][2],
        source_file_modified: values[i][3],
        row_count: values[i][4],
      };
    }
  }

  return null;
}

function pruneJobCacheRows_(cacheSheet) {
  if (!cacheSheet) return;
  var dataRowCount = Math.max(cacheSheet.getLastRow() - 1, 0);
  if (dataRowCount <= JOB_CACHE_MAX_DATA_ROWS) return;

  var deleteCount = dataRowCount - JOB_CACHE_MAX_DATA_ROWS;
  cacheSheet.deleteRows(2, deleteCount);
}

function pruneExpiredJobCacheRows_(jobsSheet, cacheSheet) {
  if (!jobsSheet || jobsSheet.getLastRow() < 2) return;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - JOB_CACHE_RETENTION_DAYS);

  var jobValues = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, jobsSheet.getLastColumn()).getValues();
  var expiredJobKeys = {};
  var rowsToDelete = [];

  for (var i = 0; i < jobValues.length; i += 1) {
    var createdAt = new Date(jobValues[i][0]);
    if (!createdAt || isNaN(createdAt.getTime())) continue;
    if (createdAt.getTime() < cutoff.getTime()) {
      expiredJobKeys[String(jobValues[i][1] || "").trim()] = true;
      rowsToDelete.push(i + 2);
    }
  }

  rowsToDelete.sort(function (a, b) { return b - a; });
  rowsToDelete.forEach(function (rowNumber) {
    jobsSheet.deleteRow(rowNumber);
  });

  if (!cacheSheet || cacheSheet.getLastRow() < 2 || !Object.keys(expiredJobKeys).length) return;

  var cacheValues = cacheSheet.getRange(2, 1, cacheSheet.getLastRow() - 1, 4).getValues();
  var cacheDeleteRows = [];
  for (var r = 0; r < cacheValues.length; r += 1) {
    var jobKey = String(cacheValues[r][1] || "").trim();
    if (expiredJobKeys[jobKey]) {
      cacheDeleteRows.push(r + 2);
    }
  }

  cacheDeleteRows.sort(function (a, b) { return b - a; });
  cacheDeleteRows.forEach(function (rowNumber) {
    cacheSheet.deleteRow(rowNumber);
  });
}

function autoResizeOperationalSheets_(ss) {
  return;
}

// ── Data loaders ───────────────────────────────────────────
function loadPhotoAssetMap_(ss) {
  var sheet = getPhotoAssetSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var values = sheet.getDataRange().getValues();
  var map = {};

  for (var r = 1; r < values.length; r += 1) {
    var key = String(values[r][0] || "").trim();
    if (!key) continue;
    var categoriesRaw = (values[r][4] !== undefined && values[r][4] !== null)
      ? String(values[r][4]).trim() : "";
    var categories = null;
    if (categoriesRaw) {
      try { categories = JSON.parse(categoriesRaw); } catch (_) {}
    }
    map[key] = {
      rowNumber: r + 1,
      fileIdsText: String(values[r][1] || "").trim(),
      photoCount: parseNumber_(values[r][2] || 0),
      updatedAt: values[r][3] || "",
      categories: categories,
    };
  }

  return map;
}

function getDashboardSummary_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('dashboardSummary');
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getInspectionSummarySheet_(ss);
  if (!sheet || sheet.getLastRow() < 6) {
    return {};
  }

  var labelsTop = sheet.getRange("A1:F1").getValues()[0];
  var valuesTop = sheet.getRange("A2:F2").getValues()[0];
  var labelsMid = sheet.getRange("A3:F3").getValues()[0];
  var valuesMid = sheet.getRange("A4:F4").getValues()[0];
  var labelsBottom = sheet.getRange("A5:F5").getValues()[0];
  var valuesBottom = sheet.getRange("A6:F6").getValues()[0];
  var summary = {};

  [labelsTop, labelsMid, labelsBottom].forEach(function (labels, groupIndex) {
    var values = groupIndex === 0 ? valuesTop : groupIndex === 1 ? valuesMid : valuesBottom;
    labels.forEach(function (label, index) {
      var key = String(label || "").trim();
      if (!key) return;
      summary[key] = values[index];
    });
  });

  try { cache.put('dashboardSummary', JSON.stringify(summary), 30); } catch (_) {}
  return summary;
}

function loadRecords_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRecordSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const photoAssetMap = loadPhotoAssetMap_(ss);

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) {
    return String(header || "").trim();
  });

  const rows = [];

  for (var r = 1; r < values.length; r += 1) {
    const row = { __rowNumber: r + 1 };
    var hasValue = false;

    for (var c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;
      const value = values[r][c];
      if (value !== "") hasValue = true;
      row[header] = value;
    }

    if (hasValue) {
      applyPhotoAssetFieldsToRow_(row, photoAssetMap, "movement");
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["작성일시"] || "").localeCompare(String(a["작성일시"] || ""));
  });

  return rows;
}

function loadInspectionRows_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getInspectionSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const photoAssetMap = loadPhotoAssetMap_(ss);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  const rows = [];

  for (var r = 1; r < values.length; r += 1) {
    const row = { __rowNumber: r + 1 };
    var hasValue = false;

    for (var c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;
      const value = values[r][c];
      if (value !== "") hasValue = true;
      row[header] = value;
    }

    if (hasValue) {
      applyPhotoAssetFieldsToRow_(row, photoAssetMap, "inspection");
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["작성일시"] || "").localeCompare(String(a["작성일시"] || ""));
  });

  return rows;
}

function loadProductImageMappings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getProductImageSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });

  return values.slice(1).map(function (row, index) {
    var item = {};
    headers.forEach(function (header, headerIndex) {
      item[header] = row[headerIndex];
    });
    item.__rowNumber = index + 2;
    return item;
  }).filter(function (row) {
    return String(row["맵키"] || "").trim();
  });
}

// ── Happycall analytics ────────────────────────────────────
function happycallHeaders_() {
  return [
    "수집키",
    "메일ID",
    "제목",
    "본문",
    "접수일시",
    "대분류",
    "중분류",
    "소분류",
    "상품명",
    "상품코드",
    "파트너사",
    "본문장애유형",
    "제목감지사유",
    "최종사유",
    "건수",
    "원본JSON",
    "생성일시",
  ];
}

function getHappycallSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.happycall);
  ensureHeaderRow_(sheet, happycallHeaders_());
  return sheet;
}

function loadHappycallRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getHappycallSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  var rows = [];

  for (var r = 1; r < values.length; r += 1) {
    var row = { __rowNumber: r + 1 };
    var hasValue = false;

    for (var c = 0; c < headers.length; c += 1) {
      var header = headers[c];
      if (!header) continue;
      var value = values[r][c];
      if (value !== "") hasValue = true;
      row[header] = value;
    }

    if (hasValue) {
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["접수일시"] || "").localeCompare(String(a["접수일시"] || ""));
  });

  return rows;
}

function importHappycallBatch_(payloadRows) {
  var list = Array.isArray(payloadRows) ? payloadRows : payloadRows ? [payloadRows] : [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getHappycallSheet_(ss);
  var categoryIndex = buildHappycallCategoryIndex_();
  var headerCount = happycallHeaders_().length;
  var saved = [];
  var inserted = 0;
  var updated = 0;
  var existingLastRow = sheet.getLastRow();
  var existingValues = existingLastRow >= 2 ? sheet.getRange(2, 1, existingLastRow - 1, 2).getValues() : [];
  var keyRowMap = {};
  var mailRowMap = {};
  var normalizedMap = {};
  var updates = [];
  var appendRows = [];

  existingValues.forEach(function (valueRow, index) {
    var rowNumber = index + 2;
    var rowKey = String(valueRow[0] || "").trim();
    var rowMail = String(valueRow[1] || "").trim();
    if (rowKey) keyRowMap[rowKey] = rowNumber;
    if (rowMail) mailRowMap[rowMail] = rowNumber;
  });

  list.forEach(function (payload) {
    var row = normalizeHappycallRecord_(payload || {}, categoryIndex);
    if (!row["수집키"]) return;
    normalizedMap[row["수집키"]] = row;
  });

  Object.keys(normalizedMap).forEach(function (collectKey) {
    var row = normalizedMap[collectKey];
    var targetRow = keyRowMap[row["수집키"]] || (row["메일ID"] ? mailRowMap[row["메일ID"]] : 0) || 0;

    if (targetRow > 0) {
      row.__rowNumber = targetRow;
      updated += 1;
      updates.push({
        rowNumber: targetRow,
        values: happycallRowValues_(row),
      });
    } else {
      inserted += 1;
      appendRows.push(row);
    }

    saved.push(row);
  });

  updates.forEach(function (item) {
    sheet.getRange(item.rowNumber, 1, 1, headerCount).setValues([item.values]);
  });

  if (appendRows.length) {
    var appendStartRow = sheet.getLastRow() + 1;
    var appendValues = appendRows.map(function (row, index) {
      row.__rowNumber = appendStartRow + index;
      return happycallRowValues_(row);
    });
    sheet.getRange(appendStartRow, 1, appendValues.length, headerCount).setValues(appendValues);
  }

  // Compute the max date from imported data — purge relative to that, not wall-clock time.
  // This prevents historical uploads from being immediately deleted.
  var maxImportDate = new Date(0);
  saved.forEach(function (row) {
    var d = new Date(row["접수일시"] || "");
    if (!isNaN(d.getTime()) && d > maxImportDate) maxImportDate = d;
  });
  var purgeRef = maxImportDate > new Date(0) ? maxImportDate : new Date();
  purgeOldHappycallRows_(sheet, 30, purgeRef);

  return {
    inserted: inserted,
    updated: updated,
    rows: saved,
  };
}

function importHappycallCsvRows_(payloadRows) {
  return importHappycallBatch_(payloadRows);
}

function normalizeHappycallRecord_(payload, categoryIndex) {
  var subject = String(
    payload.subject || payload["제목"] || payload.title || ""
  ).trim();
  var body = String(
    payload.body || payload["본문"] || payload.content || ""
  ).trim();
  var mailId = String(
    payload.messageId || payload.internetMessageId || payload["메일ID"] || payload.id || ""
  ).trim();
  var parsed = parseHappycallBodyFields_(body);
  var productCode = normalizeCode_(
    payload.productCode || payload["상품코드"] || getHappycallFieldValue_(parsed, ["상품코드", "코드", "바코드"])
  );
  var productName = String(
    payload.productName ||
      payload["상품명"] ||
      getHappycallFieldValue_(parsed, ["상품명", "소분류", "품목명", "품명"]) ||
      ""
  ).trim();
  var partnerName = String(
    payload.partnerName ||
      payload["파트너사"] ||
      payload["협력사명"] ||
      getHappycallFieldValue_(parsed, ["파트너사", "협력사", "협력사명", "거래처명"]) ||
      ""
  ).trim();
  var receivedAt = String(
    payload.receivedAt ||
      payload["접수일시"] ||
      getHappycallFieldValue_(parsed, ["접수일시", "접수일자", "등록일시", "문의일시"]) ||
      payload.createdAt ||
      new Date().toISOString()
  ).trim();
  var bodyReason = String(
    payload.reason ||
      payload["장애유형"] ||
      payload["본문장애유형"] ||
      getHappycallFieldValue_(parsed, ["장애유형", "이상유형", "클레임유형", "사유"]) ||
      ""
  ).trim();
  var explicitMajor = String(
    payload.majorCategory ||
      payload["대분류"] ||
      getHappycallFieldValue_(parsed, ["대분류"]) ||
      ""
  ).trim();
  var explicitMid = String(
    payload.midCategory ||
      payload["중분류"] ||
      getHappycallFieldValue_(parsed, ["중분류"]) ||
      ""
  ).trim();
  var explicitSub = String(
    payload.subCategory ||
      payload["소분류"] ||
      getHappycallFieldValue_(parsed, ["소분류"]) ||
      ""
  ).trim();
  var titleReason = extractHappycallTitleReason_(subject);
  var categoryInfo = lookupHappycallCategoryInfo_(categoryIndex, {
    productCode: productCode,
    productName: productName,
    partnerName: partnerName,
    subject: subject,
  });
  var finalReason = titleReason || normalizeHappycallReason_(bodyReason) || "기타";
  var originalSnapshot = {
    제목: subject,
    메일ID: mailId,
    접수일시: receivedAt,
    대분류: explicitMajor || categoryInfo.majorCategory || "",
    중분류: explicitMid || categoryInfo.midCategory || "",
    소분류: explicitSub || categoryInfo.subCategory || productName || categoryInfo.productName || "",
    상품명: productName || categoryInfo.productName || explicitSub || "",
    상품코드: productCode || categoryInfo.productCode || "",
    파트너사: partnerName || categoryInfo.partnerName || "",
    본문장애유형: bodyReason,
    제목감지사유: titleReason,
    최종사유: finalReason,
  };
  var keyBasis = [
    mailId,
    receivedAt,
    explicitMajor || categoryInfo.majorCategory || "",
    explicitMid || categoryInfo.midCategory || "",
    explicitSub || categoryInfo.subCategory || "",
    productCode,
    productName,
    partnerName,
    finalReason,
  ].join("||");

  return {
    "수집키": mailId || createDigestString_(keyBasis),
    "메일ID": truncateSheetCell_(mailId, 5000),
    "제목": truncateSheetCell_(subject, 5000),
    "본문": truncateSheetCell_(body, 45000),
    "접수일시": truncateSheetCell_(receivedAt, 5000),
    "대분류": truncateSheetCell_(explicitMajor || categoryInfo.majorCategory || "", 5000),
    "중분류": truncateSheetCell_(explicitMid || categoryInfo.midCategory || "", 5000),
    "소분류": truncateSheetCell_(explicitSub || categoryInfo.subCategory || productName || categoryInfo.productName || "", 5000),
    "상품명": truncateSheetCell_(productName || categoryInfo.productName || explicitSub || "", 5000),
    "상품코드": truncateSheetCell_(productCode || categoryInfo.productCode || "", 5000),
    "파트너사": truncateSheetCell_(partnerName || categoryInfo.partnerName || "", 5000),
    "본문장애유형": truncateSheetCell_(bodyReason, 5000),
    "제목감지사유": truncateSheetCell_(titleReason, 5000),
    "최종사유": truncateSheetCell_(finalReason, 5000),
    "건수": 1,
    "원본JSON": truncateSheetCell_(JSON.stringify(originalSnapshot), 45000),
    "생성일시": new Date().toISOString(),
  };
}

function parseHappycallBodyFields_(body) {
  var lines = String(body || "").split(/\r?\n/);
  var result = {};

  lines.forEach(function (line) {
    var text = String(line || "").trim();
    if (!text) return;

    var match = text.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
    if (!match) return;

    var key = normalizeHappycallLabel_(match[1]);
    var value = String(match[2] || "").trim();
    if (!key || !value) return;
    result[key] = value;
  });

  return result;
}

function normalizeHappycallLabel_(value) {
  return String(value || "")
    .replace(/^[\s\-\*\u2022\u25CF\u25A0\u25B6\u2605\[\]\(\)]+/, "")
    .replace(/[\]\)]+$/, "")
    .replace(/\s+/g, "")
    .trim();
}

function getHappycallFieldValue_(parsed, candidates) {
  for (var i = 0; i < candidates.length; i += 1) {
    var key = normalizeHappycallLabel_(candidates[i]);
    if (parsed[key] !== undefined && parsed[key] !== null && parsed[key] !== "") {
      return parsed[key];
    }
  }
  return "";
}

function normalizeHappycallMatchText_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\u3131-\uD79Da-z0-9]/gi, "")
    .trim();
}

function extractHappycallNameTokens_(value) {
  var rawTokens = String(value || "").match(/[가-힣A-Za-z]+/g) || [];
  var tokenMap = {};

  rawTokens.forEach(function (token) {
    var normalized = normalizeHappycallMatchText_(token);
    if (!normalized || normalized.length < 2) return;
    tokenMap[normalized] = true;
  });

  return Object.keys(tokenMap);
}

function isGenericHappycallToken_(token) {
  var text = normalizeHappycallMatchText_(token);
  if (!text) return true;
  return {
    상품: true,
    상품명: true,
    행사상품: true,
    예약: true,
    공동: true,
    긴급: true,
    세부내용: true,
    상태: true,
    변질: true,
    판매용: true,
    클레임: true,
    접수: true,
    확인: true,
  }[text] === true;
}

function getDistinctiveHappycallTokens_() {
  return [
    "프리미엄",
    "클래식",
    "스위티오",
    "고당도",
    "허니",
    "골드",
    "낱개",
    "송이",
    "날개용",
    "점보",
    "특대",
    "대과",
    "소과",
    "망고",
    "바나나",
    "오렌지",
    "감귤",
    "참타리",
    "오이",
    "포장무"
  ].map(normalizeHappycallMatchText_);
}

function extractHappycallUnitHints_(value) {
  var text = String(value || "");
  var hints = [];
  var seen = {};

  function pushHint_(hint) {
    var key = normalizeHappycallMatchText_(hint);
    if (!key || seen[key]) return;
    seen[key] = true;
    hints.push(key);
  }

  (text.match(/\d+\s*(입|개|송이|봉|팩|박스|망|단|줄기|통|판|kg|g|ml|l)/gi) || []).forEach(pushHint_);
  ["낱개", "송이", "박스", "봉", "팩", "망", "단", "줄기", "통", "판", "날개용"].forEach(function (token) {
    if (text.indexOf(token) >= 0) pushHint_(token);
  });

  return hints;
}

function hasMismatchedUnitHint_(textHints, candidateHints) {
  if (!textHints.length || !candidateHints.length) return false;

  var normalizedTextHints = {};
  textHints.forEach(function (hint) {
    normalizedTextHints[normalizeHappycallMatchText_(hint)] = true;
  });

  var normalizedCandidateHints = {};
  candidateHints.forEach(function (hint) {
    normalizedCandidateHints[normalizeHappycallMatchText_(hint)] = true;
  });

  var groupedKinds = [
    ["낱개", "송이", "봉", "팩", "박스", "망", "단", "줄기", "통", "판", "날개용"],
  ];

  for (var i = 0; i < groupedKinds.length; i += 1) {
    var group = groupedKinds[i];
    var textMatched = group.filter(function (hint) {
      return normalizedTextHints[normalizeHappycallMatchText_(hint)];
    });
    var candidateMatched = group.filter(function (hint) {
      return normalizedCandidateHints[normalizeHappycallMatchText_(hint)];
    });

    if (textMatched.length && candidateMatched.length) {
      var overlap = textMatched.some(function (hint) {
        return candidateMatched.indexOf(hint) >= 0;
      });
      if (!overlap) return true;
    }
  }

  return false;
}

function scoreHappycallTextAgainstCandidate_(candidate, normalizedText, textTokens, hasSpecHint, rawText) {
  var matchKey = String(candidate && candidate.matchKey || "");
  if (!matchKey) return 0;

  var score = 0;
  if (normalizedText === matchKey) {
    score += matchKey.length + 1000;
  } else if (normalizedText.indexOf(matchKey) >= 0) {
    score += matchKey.length + 500;
  } else if (matchKey.indexOf(normalizedText) >= 0) {
    score += normalizedText.length + 120;
  }

  var candidateTokens = Array.isArray(candidate && candidate.tokens) ? candidate.tokens : [];
  var candidateHints = Array.isArray(candidate && candidate.unitHints) ? candidate.unitHints : [];
  var textHints = extractHappycallUnitHints_(rawText || normalizedText);
  candidateTokens.forEach(function (token) {
    if (!token || token.length < 2 || isGenericHappycallToken_(token)) return;
    if (normalizedText.indexOf(token) >= 0) {
      score += token.length * 25;
    } else if (textTokens.indexOf(token) >= 0) {
      score += token.length * 18;
    } else {
      for (var i = 0; i < textTokens.length; i += 1) {
        var textToken = textTokens[i];
        if (!textToken || textToken.length < 2 || isGenericHappycallToken_(textToken)) continue;
        if (token.indexOf(textToken) >= 0 || textToken.indexOf(token) >= 0) {
          score += Math.min(token.length, textToken.length) * 10;
          break;
        }
      }
    }
  });

  var distinctiveTokens = getDistinctiveHappycallTokens_();
  distinctiveTokens.forEach(function (token) {
    if (!token || token.length < 2) return;
    var textHas = normalizedText.indexOf(token) >= 0 || textTokens.indexOf(token) >= 0;
    var candidateHas = matchKey.indexOf(token) >= 0 || candidateTokens.indexOf(token) >= 0;

    if (textHas && candidateHas) {
      score += token.length * 40;
    } else if (textHas && !candidateHas) {
      score -= token.length * 25;
    }
  });

  if (textHints.length && candidateHints.length) {
    var matchedHintCount = 0;
    textHints.forEach(function (hint) {
      if (candidateHints.indexOf(hint) >= 0) {
        matchedHintCount += 1;
        score += Math.max(20, hint.length * 18);
      }
    });

    if (matchedHintCount === 0 && hasMismatchedUnitHint_(textHints, candidateHints)) {
      score -= 180;
    }
  }

  if (!hasSpecHint) {
    score += Math.min(Number(candidate && candidate.info && candidate.info.totalQty || 0), 9999) / 1000;
  }

  return score;
}

function pickBestHappycallCandidate_(candidates, normalizedText, textTokens, hasSpecHint, rawText) {
  var best = null;
  var bestScore = -999999;
  var secondScore = -999999;

  (Array.isArray(candidates) ? candidates : []).forEach(function (candidate) {
    var score = scoreHappycallTextAgainstCandidate_(candidate, normalizedText, textTokens, hasSpecHint, rawText);
    if (
      score > bestScore ||
      (score === bestScore &&
        Number(candidate && candidate.info && candidate.info.totalQty || 0) > Number(best && best.info && best.info.totalQty || 0))
    ) {
      secondScore = bestScore;
      bestScore = score;
      best = candidate;
      return;
    }
    if (score > secondScore) {
      secondScore = score;
    }
  });

  return {
    best: best,
    bestScore: bestScore,
    secondScore: secondScore,
  };
}

function normalizeHappycallReason_(value) {
  var text = normalizeHappycallMatchText_(value);
  if (!text) return "";

  var reasonRules = [
    { reason: "썩음", keywords: ["썩", "부패", "곰팡이", "변질부패"] },
    { reason: "무름", keywords: ["무름", "물러", "물컹", "짓무름"] },
    { reason: "갈라짐", keywords: ["갈라", "크랙", "터짐", "찢어"] },
    { reason: "파손", keywords: ["파손", "깨짐", "눌림", "찢김"] },
    { reason: "냄새", keywords: ["냄새", "악취", "이취"] },
    { reason: "이물", keywords: ["이물", "벌레", "벌레먹", "오염"] },
    { reason: "과숙", keywords: ["과숙", "지나치게익", "너무익"] },
    { reason: "미숙", keywords: ["미숙", "덜익", "안익"] },
    { reason: "시듦", keywords: ["시듦", "시들", "건조", "쭈글"] },
    { reason: "상품변질", keywords: ["변질", "상태이상", "이상", "품질저하"] },
  ];

  for (var i = 0; i < reasonRules.length; i += 1) {
    var rule = reasonRules[i];
    for (var j = 0; j < rule.keywords.length; j += 1) {
      if (text.indexOf(rule.keywords[j]) >= 0) {
        return rule.reason;
      }
    }
  }

  return String(value || "").trim();
}

function extractHappycallTitleReason_(subject) {
  var text = String(subject || "").trim();
  if (!text) return "";
  return normalizeHappycallReason_(text);
}

function buildHappycallCategoryIndex_() {
  var index = {
    bySku: {},
    byCode: {},
    byNamePartner: {},
    byName: {},
    productCandidates: [],
    productCandidatesByPartner: {},
    infoByCanonicalKey: {},
    candidateByKey: {},
  };
  var latestJob = loadLatestJob_();
  var sourceRows = buildDashboardSourceRows_(latestJob ? latestJob.rows || [] : [], readReservationRows_());
  var exclusionIdx = buildExclusionIndex_();
  var excludedCodes = exclusionIdx.excludedCodes;
  var excludedPairs = exclusionIdx.excludedPairs;
  var excludedPartners = exclusionIdx.excludedPartners;

  sourceRows.forEach(function (row) {
    var productCode = normalizeCode_(row.__productCode || getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    var productName = String(row.__productName || getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    var partnerName = String(row.__partner || getRowFieldValue_(row, ["협력사명", "협력사", "거래처명"]) || "").trim();
    var qty = parseNumber_(row.__qty || getRowFieldValue_(row, ["총 발주수량", "발주수량", "입고수량", "수량"]));
    if (isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners)) return;
    var skuKey = makeSkuKey_(productCode, partnerName);
    var nameKey = normalizeHappycallMatchText_(productName);
    var namePartnerKey = normalizeHappycallMatchText_(productName) + "||" + normalizeHappycallMatchText_(partnerName);
    var canonicalKey = skuKey || namePartnerKey || nameKey;
    var info = canonicalKey && index.infoByCanonicalKey[canonicalKey];

    if (!info) {
      info = {
        majorCategory: String(getRowFieldValue_(row, ["대분류", "과채", "카테고리대", "대카테고리"]) || "").trim(),
        midCategory: String(getRowFieldValue_(row, ["중분류", "카테고리중", "중카테고리"]) || "").trim(),
        subCategory: String(getRowFieldValue_(row, ["소분류", "카테고리소", "소카테고리"]) || "").trim(),
        productName: productName,
        productCode: productCode,
        partnerName: partnerName,
        totalQty: 0,
      };
      if (canonicalKey) {
        index.infoByCanonicalKey[canonicalKey] = info;
      }
    }

    info.totalQty += qty;

    if (skuKey) index.bySku[skuKey] = info;
    if (productCode) index.byCode[productCode] = info;
    if (nameKey) index.byName[nameKey] = info;
    if (namePartnerKey !== "||") index.byNamePartner[namePartnerKey] = info;
    if (nameKey) {
      var candidateKey = nameKey + "||" + normalizeHappycallMatchText_(partnerName);
      var candidate = index.candidateByKey[candidateKey];
      if (!candidate) {
        candidate = {
          matchKey: nameKey,
          info: info,
          partnerKey: normalizeHappycallMatchText_(partnerName),
          tokens: extractHappycallNameTokens_(productName + " " + info.subCategory),
          unitHints: extractHappycallUnitHints_(productName + " " + info.subCategory),
        };
        index.candidateByKey[candidateKey] = candidate;
        index.productCandidates.push(candidate);
        if (candidate.partnerKey) {
          if (!index.productCandidatesByPartner[candidate.partnerKey]) {
            index.productCandidatesByPartner[candidate.partnerKey] = [];
          }
          index.productCandidatesByPartner[candidate.partnerKey].push(candidate);
        }
      } else {
        candidate.info = info;
      }
    }
  });

  return index;
}

function findHappycallCategoryMatch_(index, record) {
  var productCode = normalizeCode_(record.productCode || "");
  var productName = String(record.productName || "").trim();
  var partnerName = String(record.partnerName || "").trim();
  var subject = String(record.subject || "").trim();
  var body = String(record.body || "").trim();
  var skuKey = makeSkuKey_(productCode, partnerName);
  var nameKey = normalizeHappycallMatchText_(productName);
  var partnerKey = normalizeHappycallMatchText_(partnerName);
  var namePartnerKey = nameKey + "||" + partnerKey;

  if (skuKey && index.bySku[skuKey]) {
    return index.bySku[skuKey];
  }

  if (productCode && index.byCode[productCode]) {
    return index.byCode[productCode];
  }

  // 1차: 협력사 + 상품명 기준으로만 우선 매칭한다.
  if (partnerKey) {
    return (
      (namePartnerKey !== "||" && index.byNamePartner[namePartnerKey]) ||
      findPartnerScopedHappycallMatch_(index, {
        productName: productName,
        subject: subject,
        body: body,
        partnerName: partnerName,
      }) ||
      null
    );
  }

  return (
    (nameKey && index.byName[nameKey]) ||
    inferHappycallProductFromText_(index, [productName, subject, body].join(" "), "") ||
    null
  );
}

function findPartnerScopedHappycallMatch_(index, record) {
  var productName = String(record.productName || "").trim();
  var subject = String(record.subject || "").trim();
  var body = String(record.body || "").trim();
  var partnerName = String(record.partnerName || "").trim();
  var partnerKey = normalizeHappycallMatchText_(partnerName);
  if (!partnerKey) return null;

  var candidates = index && index.productCandidatesByPartner && index.productCandidatesByPartner[partnerKey];
  if (!Array.isArray(candidates) || !candidates.length) return null;

  var nameKey = normalizeHappycallMatchText_(productName);
  if (nameKey) {
    // 1차 exact: 같은 협력사 안에서 상품명이 직접 맞는 후보를 우선 사용.
    var exactCandidates = candidates.filter(function (candidate) {
      return String(candidate.matchKey || "") === nameKey;
    });
    if (exactCandidates.length === 1) {
      return exactCandidates[0].info;
    }
    if (exactCandidates.length > 1) {
      exactCandidates.sort(function (a, b) {
        return Number(b.info && b.info.totalQty || 0) - Number(a.info && a.info.totalQty || 0);
      });
      return exactCandidates[0].info;
    }
  }

  if (productName) {
    var productNameText = normalizeHappycallMatchText_(productName);
    var productNameTokens = extractHappycallNameTokens_(productName);
    var productHasSpecHint = /\d+\s*(입|개|g|kg|ml|l|봉|팩|박스|송이|망|단|줄기|통|판)/i.test(productName);
    var productNamePick = pickBestHappycallCandidate_(
      candidates,
      productNameText,
      productNameTokens,
      productHasSpecHint,
      productName
    );

    if (
      productNamePick.best &&
      productNamePick.bestScore >= 70 &&
      productNamePick.bestScore - productNamePick.secondScore >= 15
    ) {
      return productNamePick.best.info;
    }
  }

  // 2차: 제목/본문까지 봐도 타당성이 충분히 높을 때만 매칭한다.
  return inferHappycallProductFromText_(index, [productName, subject, body].join(" "), partnerName);
}

function lookupHappycallCategoryInfo_(index, record) {
  var productCode = normalizeCode_(record.productCode || "");
  var productName = String(record.productName || "").trim();
  var partnerName = String(record.partnerName || "").trim();
  return (
    findHappycallCategoryMatch_(index, record) || {
      majorCategory: "",
      midCategory: "",
      subCategory: "",
      productName: productName,
      productCode: productCode,
      partnerName: partnerName,
    }
  );
}

function inferHappycallProductFromText_(index, text, partnerName) {
  var normalizedText = normalizeHappycallMatchText_(text);
  if (!normalizedText) return null;
  var textTokens = extractHappycallNameTokens_(text);
  var hasSpecHint = /\d+\s*(입|개|g|kg|ml|l|봉|팩)/i.test(String(text || ""));

  var partnerKey = normalizeHappycallMatchText_(partnerName || "");
  var partnerCandidates = partnerKey && index && index.productCandidatesByPartner && index.productCandidatesByPartner[partnerKey]
    ? index.productCandidatesByPartner[partnerKey]
    : [];
  var candidates = partnerKey
    ? partnerCandidates
    : Array.isArray(index && index.productCandidates)
    ? index.productCandidates
    : [];
  var picked = pickBestHappycallCandidate_(candidates, normalizedText, textTokens, hasSpecHint, text);

  // 애매하면 미분류로 남긴다.
  if (!picked.best) return null;
  if (picked.bestScore < 90) return null;
  if (picked.bestScore - picked.secondScore < 20) return null;
  return picked.best.info;
}

function findHappycallRow_(sheet, collectKey, mailId) {
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var keyText = String(collectKey || "").trim();
  var mailText = String(mailId || "").trim();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    var rowKey = String(values[i][0] || "").trim();
    var rowMail = String(values[i][1] || "").trim();
    if ((keyText && rowKey === keyText) || (mailText && rowMail === mailText)) {
      return i + 2;
    }
  }

  return 0;
}

function writeHappycallRow_(sheet, targetRow, row) {
  var values = [happycallRowValues_(row)];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

function happycallRowValues_(row) {
  return [
    row["수집키"],
    row["메일ID"],
    row["제목"],
    row["본문"],
    row["접수일시"],
    row["대분류"],
    row["중분류"],
    row["소분류"],
    row["상품명"],
    row["상품코드"],
    row["파트너사"],
    row["본문장애유형"],
    row["제목감지사유"],
    row["최종사유"],
    row["건수"],
    row["원본JSON"],
    row["생성일시"],
  ];
}

function createDigestString_(text) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text || ""))
  ).replace(/=+$/, "");
}

function truncateSheetCell_(value, maxLength) {
  var text = String(value || "");
  var limit = Math.max(100, Number(maxLength || 0) || 50000);
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 12)) + " ...(생략)";
}

function isHappycallWithinDays_(value, days) {
  var date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return false;
  var now = new Date();
  var startAt = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= startAt && date <= now;
}

function purgeOldHappycallRows_(sheet, days, referenceDate) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  // Use provided reference date (e.g. dataset max date) or fall back to current time.
  var ref = (referenceDate instanceof Date && !isNaN(referenceDate.getTime()))
    ? referenceDate
    : new Date();
  var startAt = new Date(ref.getTime() - days * 24 * 60 * 60 * 1000);

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var rowNumbers = [];

  values.forEach(function (row, index) {
    var d = new Date(row[4] || "");
    if (isNaN(d.getTime()) || d < startAt) {
      rowNumbers.push(index + 2);
    }
  });

  rowNumbers.reverse().forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });

  return rowNumbers.length;
}

function getHappycallAnalytics_() {
  var categoryIndex = buildHappycallCategoryIndex_();
  // Load ALL rows first so we can compute the reference date from the dataset itself.
  // This makes historical uploads work correctly — the 30-day window is relative to
  // the LATEST date in the dataset, not the current wall-clock time.
  var allRows = loadHappycallRows_();

  // Step 1: determine reference date from the latest record in the full dataset.
  var now = (function () {
    var maxDate = new Date(0);
    allRows.forEach(function (row) {
      var d = new Date(row["접수일시"] || row["생성일시"] || "");
      if (!isNaN(d.getTime()) && d > maxDate) maxDate = d;
    });
    return maxDate > new Date(0) ? maxDate : new Date();
  })();

  // Step 2: keep only rows within 30 days of the reference date AND with a product match.
  var windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  var rows = allRows.filter(function (row) {
    var d = new Date(row["접수일시"] || row["생성일시"] || "");
    if (isNaN(d.getTime())) return false;
    if (d < windowStart || d > now) return false;
    return !!findHappycallCategoryMatch_(categoryIndex, {
      productCode: row["상품코드"] || "",
      productName: row["상품명"] || row["소분류"] || "",
      partnerName: row["파트너사"] || "",
      subject: row["제목"] || "",
      body: row["본문"] || "",
    });
  });
  var periods = [
    { key: "1d", label: "최근 1일", days: 1 },
    { key: "7d", label: "최근 7일", days: 7 },
    { key: "30d", label: "최근 1달", days: 30 },
  ];
  var periodMap = {};
  var productRanks = {};

  periods.forEach(function (period) {
    var startAt = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
    var filtered = rows.filter(function (row) {
      var receivedAt = new Date(row["접수일시"] || row["생성일시"] || "");
      if (Number.isNaN(receivedAt.getTime())) return false;
      return receivedAt >= startAt && receivedAt <= now;
    });
    var aggregates = buildHappycallAggregates_(filtered);
    var productMetrics = {};
    periodMap[period.key] = {
      label: period.label,
      totalCount: aggregates.totalCount,
      topProducts: aggregates.products.slice(0, 10),
      topMajorCategories: aggregates.majorCategories.slice(0, 5),
      topMidCategories: aggregates.midCategories.slice(0, 5),
      topSubCategories: aggregates.subCategories.slice(0, 5),
      topReasons: aggregates.reasons.slice(0, 5),
      productMetrics: productMetrics,
    };

    aggregates.products.forEach(function (item) {
      buildHappycallLookupKeys_(item).forEach(function (key) {
        if (!key) return;
        productMetrics[key] = {
          count: item.count,
          share: item.share,
          topReason: item.topReason || "",
        };
      });
    });

    aggregates.products.slice(0, 10).forEach(function (item, index) {
      var keys = buildHappycallLookupKeys_(item);
      keys.forEach(function (key) {
        if (!productRanks[key]) productRanks[key] = {};
        productRanks[key][period.key] = {
          rank: index + 1,
          count: item.count,
          share: item.share,
          reason: item.topReason || "",
        };
      });
    });
  });

  return {
    totalCount: rows.length,
    lastUpdated: new Date().toISOString(),
    periods: periodMap,
    productRanks: productRanks,
  };
}

function buildHappycallAggregates_(rows) {
  var totals = {
    totalCount: 0,
    products: {},
    majorCategories: {},
    midCategories: {},
    subCategories: {},
    reasons: {},
  };

  rows.forEach(function (row) {
    var count = Math.max(1, parseNumber_(row["건수"] || 1));
    var productItem = {
      key: row["상품코드"] || normalizeHappycallMatchText_(row["상품명"]),
      productCode: row["상품코드"] || "",
      productName: row["상품명"] || row["소분류"] || "",
      partnerName: row["파트너사"] || "",
      majorCategory: row["대분류"] || "",
      midCategory: row["중분류"] || "",
      subCategory: row["소분류"] || "",
      finalReason: row["최종사유"] || "기타",
      count: count,
    };

    totals.totalCount += count;
    mergeHappycallBucket_(totals.products, productItem.key || productItem.productName || "미분류상품", productItem, count);
    mergeHappycallBucket_(totals.majorCategories, row["대분류"] || "미분류", { name: row["대분류"] || "미분류" }, count);
    mergeHappycallBucket_(totals.midCategories, row["중분류"] || "미분류", { name: row["중분류"] || "미분류" }, count);
    mergeHappycallBucket_(totals.subCategories, row["소분류"] || row["상품명"] || "미분류", { name: row["소분류"] || row["상품명"] || "미분류" }, count);
    mergeHappycallBucket_(totals.reasons, row["최종사유"] || "기타", { name: row["최종사유"] || "기타" }, count);
  });

  return {
    totalCount: totals.totalCount,
    products: finalizeHappycallBuckets_(totals.products, totals.totalCount, true),
    majorCategories: finalizeHappycallBuckets_(totals.majorCategories, totals.totalCount, false),
    midCategories: finalizeHappycallBuckets_(totals.midCategories, totals.totalCount, false),
    subCategories: finalizeHappycallBuckets_(totals.subCategories, totals.totalCount, false),
    reasons: finalizeHappycallBuckets_(totals.reasons, totals.totalCount, false),
  };
}

function mergeHappycallBucket_(bucketMap, key, seed, count) {
  if (!bucketMap[key]) {
    bucketMap[key] = {
      key: key,
      name: seed.name || seed.productName || seed.subCategory || key || "미분류상품",
      productCode: seed.productCode || "",
      productName: seed.productName || seed.subCategory || seed.name || key || "미분류상품",
      partnerName: seed.partnerName || "",
      majorCategory: seed.majorCategory || "",
      midCategory: seed.midCategory || "",
      subCategory: seed.subCategory || "",
      count: 0,
      reasonCounts: {},
    };
  }

  bucketMap[key].count += count;
  if (seed.finalReason) {
    bucketMap[key].reasonCounts[seed.finalReason] =
      (bucketMap[key].reasonCounts[seed.finalReason] || 0) + count;
  }
}

function finalizeHappycallBuckets_(bucketMap, totalCount, includeReason) {
  return Object.keys(bucketMap)
    .map(function (key) {
      var item = bucketMap[key];
      var topReason = "";
      var topReasonCount = -1;

      Object.keys(item.reasonCounts || {}).forEach(function (reason) {
        if (item.reasonCounts[reason] > topReasonCount) {
          topReason = reason;
          topReasonCount = item.reasonCounts[reason];
        }
      });

      return {
        key: item.key,
        name: item.name || item.productName || item.subCategory || item.key || "미분류상품",
        productCode: item.productCode,
        productName: item.productName || item.subCategory || item.name || item.key || "미분류상품",
        partnerName: item.partnerName,
        majorCategory: item.majorCategory,
        midCategory: item.midCategory,
        subCategory: item.subCategory,
        count: item.count,
        share: totalCount > 0 ? item.count / totalCount : 0,
        topReason: includeReason ? topReason : "",
      };
    })
    .sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.name || a.productName || "").localeCompare(String(b.name || b.productName || ""), "ko");
    });
}

function buildHappycallLookupKeys_(item) {
  var keys = [];
  var partner = normalizeText_(item.partnerName || "");
  var code = normalizeCode_(item.productCode || "");
  var name = normalizeHappycallMatchText_(item.productName || item.subCategory || "");

  if (code || partner) keys.push("sku::" + makeSkuKey_(code, partner));
  if (name || partner) keys.push("name::" + name + "||" + normalizeHappycallMatchText_(partner));
  if (code) keys.push("code::" + code);
  if (name) keys.push("nameOnly::" + name);

  return keys.filter(Boolean);
}

// ============================================================
// SECTION 4: SAVE BATCH / SAVE HANDLERS
// ============================================================

// ── Record CRUD ────────────────────────────────────────────
function appendRecord_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordsSheet = getRecordSheet_(ss);
  const record = upsertMovementRow_(recordsSheet, payload || {});
  return record;
}

function deleteRecord_(payload) {
  const rowNumber = Number(payload.rowNumber || 0);
  if (!rowNumber || rowNumber <= 1) {
    throw new Error("삭제할 행 번호가 올바르지 않습니다.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRecordSheet_(ss);

  if (rowNumber > sheet.getLastRow()) {
    throw new Error("이미 삭제되었거나 존재하지 않는 행입니다.");
  }

  var existingRecord = readMovementRow_(sheet, rowNumber);

  // Cross-check: if the caller supplied secondary key fields, verify the row
  // at rowNumber still contains the expected record.  Sheet rows can shift if
  // a concurrent save inserted/deleted rows after the frontend loaded its data.
  var verifyCode = String(payload["상품코드"] || "").trim();
  var verifyType = String(payload["처리유형"] || "").trim();
  if (verifyCode || verifyType) {
    var rowCode = normalizeCode_(existingRecord["상품코드"] || "");
    var rowType = String(existingRecord["처리유형"] || "").trim();
    if (
      (verifyCode && normalizeCode_(verifyCode) !== rowCode) ||
      (verifyType && verifyType !== rowType)
    ) {
      // The row at this position no longer matches — search for the real row.
      console.log("[deleteRecord_] rowNumber=" + rowNumber + " mismatch: expected code=" + verifyCode + " type=" + verifyType
        + " but found code=" + rowCode + " type=" + rowType + ". Searching by key fields.");
      var verifySenter    = String(payload["센터명"]   || "").trim();
      var verifyPartner   = String(payload["협력사명"] || "").trim();
      var verifyJobKey    = String(payload["작업기준일또는CSV식별값"] || "").trim();
      var fallbackRow = findMovementRow_(sheet, verifyJobKey, verifyCode, verifyPartner, verifySenter, verifyType);
      if (!fallbackRow) {
        throw new Error("이미 삭제되었거나 존재하지 않는 행입니다.");
      }
      existingRecord = readMovementRow_(sheet, fallbackRow);
      deletePhotoAsset_(makeMovementPhotoAssetKey_(
        existingRecord["작업기준일또는CSV식별값"],
        existingRecord["상품코드"],
        existingRecord["협력사명"],
        existingRecord["센터명"],
        existingRecord["처리유형"]
      ));
      deleteReturnSheetRowsForRecord_(ss, existingRecord);
      sheet.deleteRow(fallbackRow);
      console.log("[deleteRecord_] deleted fallback row=" + fallbackRow);
      return { rowNumber: fallbackRow };
    }
  }

  console.log("[deleteRecord_] deleting row=" + rowNumber + " code=" + existingRecord["상품코드"] + " type=" + existingRecord["처리유형"]);
  deletePhotoAsset_(makeMovementPhotoAssetKey_(
    existingRecord["작업기준일또는CSV식별값"],
    existingRecord["상품코드"],
    existingRecord["협력사명"],
    existingRecord["센터명"],
    existingRecord["처리유형"]
  ));
  deleteReturnSheetRowsForRecord_(ss, existingRecord);
  sheet.deleteRow(rowNumber);

  return {
    rowNumber: rowNumber,
  };
}

function cancelMovementEvent_(payload) {
  return deleteRecord_(payload);
}

function saveInspectionQty_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const saved = upsertInspectionRow_(inspectionSheet, payload || {});
  return saved;
}

function saveInspectionBatch_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  const list = Array.isArray(rows) ? rows : [];
  const saved = [];

  list.forEach(function (row) {
    saved.push(upsertInspectionRow_(inspectionSheet, row || {}));
  });

  return {
    rows: saved,
  };
}

// ── Batch save ─────────────────────────────────────────────
function saveBatch_(rows) {
  console.log("[saveBatch_] incoming rows=" + (Array.isArray(rows) ? rows.length : 0));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  const photoAssetMap = loadPhotoAssetMap_(ss);

  // Pre-load the entire inspection sheet once for all row lookups in this request.
  // findInspectionRow_ and readInspectionRowByValues_ will use this array instead
  // of issuing separate sheet.getRange() calls per row.
  var inspSheetValues = null;
  if (inspectionSheet && inspectionSheet.getLastRow() >= 2) {
    inspSheetValues = inspectionSheet
      .getRange(2, 1, inspectionSheet.getLastRow() - 1, inspectionSheet.getLastColumn())
      .getValues();
  }

  const list = Array.isArray(rows) ? rows : [];
  const inspectionRows = [];
  const movementRows = [];
  const conflicts = [];

  list.forEach(function (rawRow) {
    const row = rawRow || {};
    const type = String(row.type || "").trim();

    if (type === "inspection") {
      var savedInspection = upsertInspectionRow_(inspectionSheet, row, photoAssetMap, inspSheetValues);
      if (savedInspection && savedInspection.__conflict) {
        conflicts.push(savedInspection);
      } else if (savedInspection && inspSheetValues !== null) {
        // Keep the preloaded in-memory array in sync so later rows in the same
        // batch see the updated state without re-reading the sheet.
        var iHeaders = inspectionHeaders_();
        var updatedRowData = iHeaders.map(function(h) {
          return (savedInspection[h] !== undefined ? savedInspection[h] : "");
        });
        var rowNum = savedInspection.__rowNumber || 0;
        if (rowNum >= 2) {
          var rowIdx = rowNum - 2; // 0-based index into values array
          if (rowIdx < inspSheetValues.length) {
            inspSheetValues[rowIdx] = updatedRowData; // update existing slot
          } else if (rowIdx === inspSheetValues.length) {
            inspSheetValues.push(updatedRowData); // append for new rows
          }
        }
      }
      // Attach per-category photo IDs (from the request payload) to the returned
      // inspection row so the frontend can re-hydrate photo counts from the save
      // response without needing a full page reload.
      if (savedInspection && !savedInspection.__conflict) {
        var setPhotoField_ = function(fieldName) {
          var val = row[fieldName];
          if (Array.isArray(val)) {
            savedInspection[fieldName] = val.filter(function(id) { return String(id || "").trim(); }).join("\n");
          } else if (typeof val === "string" && val) {
            savedInspection[fieldName] = val;
          }
        };
        setPhotoField_("inspPhotoIds");
        setPhotoField_("defectPhotoIds");
        setPhotoField_("weightPhotoIds");
        setPhotoField_("brixPhotoIds");
      }
      inspectionRows.push(savedInspection);
      return;
    }

    if (type === "movement" || type === "return" || type === "exchange") {
      var savedMovement = upsertMovementRow_(recordsSheet, row, photoAssetMap);
      if (savedMovement && savedMovement.__conflict) {
        conflicts.push(savedMovement);
      }
      movementRows.push(savedMovement);
    }
  });

  return {
    inspectionRows: inspectionRows,
    movementRows: movementRows,
    hasInspection: inspectionRows.some(function (row) { return row && !row.__conflict; }),
    hasMovement: movementRows.some(function (row) { return row && !row.__conflict; }),
    conflicts: conflicts,
  };
}

// Runs a targeted post-save sync: syncs return/exchange summary sheets and
// recalculates inspection+movement totals on the inspection sheet.
// Called by the "postSaveSync" action so clients can request a lightweight sync
// without triggering a full bootstrap reload.
function postSaveSync_(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try { syncReturnSheets_(ss); } catch (e) {
    console.error("[postSaveSync_] syncReturnSheets_ failed: " + e.message);
  }
  try {
    syncInspectionMovementTotals_(getInspectionSheet_(ss), getRecordSheet_(ss));
  } catch (e) {
    console.error("[postSaveSync_] syncInspectionMovementTotals_ failed: " + e.message);
  }
  return { synced: true };
}

function manualRecalc_() {
  CacheService.getScriptCache().remove('dashboardSummary');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);
  // Sort inspection_data rows to match the in-app inspection screen order
  // (partners in Korean 가나다 order, within each partner by original CSV row order).
  var latestJob = loadLatestJob_();
  sortInspectionSheet_(ss, latestJob ? (latestJob.rows || []) : []);
  return { ok: true };
}

/**
 * Reorders inspection_data rows to match the in-app display order:
 *   1. Partner (협력사명) in Korean alphabetical (가나다) order
 *   2. Within each partner, by original CSV row position from the job cache
 *   3. Tiebreak by 상품코드 alphabetical
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Array<Object>} jobCacheRows  rows from loadLatestJob_().rows
 */
function sortInspectionSheet_(ss, jobCacheRows) {
  var sheet = getInspectionSheet_(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return; // nothing to sort (row 1 = header, ≤1 data row)

  // Build a CSV-position map: normalizedPartner||normalizedCode → index
  var orderMap = {};
  var cacheRows = Array.isArray(jobCacheRows) ? jobCacheRows : [];
  cacheRows.forEach(function (row, idx) {
    var code = normalizeCode_(
      String(
        row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"] || ""
      ).trim()
    );
    var partner = String(
      row["협력사명"] || row["협력사"] || row["거래처명"] || ""
    ).trim();
    if (!code) return;
    var key = partner + "||" + code;
    if (!(key in orderMap)) orderMap[key] = idx;
  });

  var numCols = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var partnerCol = headers.indexOf("협력사명"); // 0-based
  var codeCol    = headers.indexOf("상품코드");
  if (partnerCol < 0 || codeCol < 0) {
    console.log("[sortInspectionSheet_] 협력사명 or 상품코드 column not found; skipping sort");
    return;
  }

  var dataValues = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  dataValues.sort(function (a, b) {
    var pA = String(a[partnerCol] || "").trim();
    var pB = String(b[partnerCol] || "").trim();
    var cmp = pA.localeCompare(pB, "ko");
    if (cmp !== 0) return cmp;

    var cA = normalizeCode_(String(a[codeCol] || "").trim());
    var cB = normalizeCode_(String(b[codeCol] || "").trim());
    var keyA = pA + "||" + cA;
    var keyB = pB + "||" + cB;
    var iA = (keyA in orderMap) ? orderMap[keyA] : 999999;
    var iB = (keyB in orderMap) ? orderMap[keyB] : 999999;
    if (iA !== iB) return iA - iB;
    return cA.localeCompare(cB, "ko");
  });

  sheet.getRange(2, 1, dataValues.length, numCols).setValues(dataValues);
  console.log("[sortInspectionSheet_] sorted " + dataValues.length + " rows");
}

// ── Payload builders ───────────────────────────────────────
function buildInspectionPayload_(payload, existingRecord) {
  const photos = Array.isArray(payload["사진들"]) ? payload["사진들"] : [];
  const uploaded = photos.length
    ? savePhotosToDrive_(
        photos,
        payload["상품명"] || payload["productName"] || "검품",
        existingRecord ? existingRecord["사진파일ID목록"] : ""
      )
    : [];
  const existingPhotoFileIds = splitPhotoSourceText_((existingRecord && existingRecord["사진파일ID목록"]) || "");
  const payloadPhotoFileIds = splitPhotoSourceText_(
    payload["사진파일ID목록"] || payload["photoFileIds"] || ""
  );
  const uploadedPhotoFileIds = uploaded.map(function (item) {
    return item.fileId;
  });
  // Collect file IDs from photoTypeFileIdsMap (sent by saveRecordDetail)
  const photoTypeMap = payload["photoTypeFileIdsMap"] || {};
  const typeMapFileIds = Object.values(photoTypeMap).reduce(function (acc, ids) {
    return acc.concat(Array.isArray(ids) ? ids.filter(Boolean) : []);
  }, []);
  const replacePhotoFileIdsMode = !!payload["replacePhotoFileIdsMode"];
  // IDs explicitly deleted by the user — must be stripped from every merged list.
  var deletedPhotoIds = Array.isArray(payload["deletedPhotoIds"])
    ? payload["deletedPhotoIds"].map(function(id) { return String(id || "").trim(); }).filter(Boolean)
    : [];
  var deletedSet = {};
  deletedPhotoIds.forEach(function(id) { deletedSet[id] = true; });
  var stripDeleted = function(ids) {
    return ids.filter(function(id) { return !deletedSet[id]; });
  };

  var mergedPhotoFileIds = replacePhotoFileIdsMode
    ? splitPhotoSourceText_(payloadPhotoFileIds.join("\n") + "\n" + uploadedPhotoFileIds.join("\n") + "\n" + typeMapFileIds.join("\n"))
    : mergePhotoLinks_(
        mergePhotoLinks_(
          mergePhotoLinks_(existingPhotoFileIds.join("\n"), payloadPhotoFileIds.join("\n"), ""),
          uploadedPhotoFileIds.join("\n"),
          ""
        ),
        typeMapFileIds.join("\n"),
        ""
      ).split(/\n+/).filter(Boolean);
  const photoFileIds = stripDeleted(mergedPhotoFileIds);

  // ── Per-category photo IDs ──────────────────────────────────────────────────
  // The new app sends per-category arrays so photo types survive page reload.
  // Fall back to null so older saves (no category data) leave photo_assets unchanged.
  var parseCatArr = function (val) {
    if (Array.isArray(val)) return val.filter(Boolean);
    var text = String(val || "").trim();
    return text ? splitPhotoSourceText_(text) : [];
  };
  // Strip explicitly deleted IDs from each category array as well.
  var catInsp   = stripDeleted(parseCatArr(payload["inspPhotoIds"]));
  var catDefect = stripDeleted(parseCatArr(payload["defectPhotoIds"]));
  var catWeight = stripDeleted(parseCatArr(payload["weightPhotoIds"]));
  var catBrix   = stripDeleted(parseCatArr(payload["brixPhotoIds"]));
  var hasCategories = catInsp.length || catDefect.length || catWeight.length || catBrix.length;
  var photoCategoriesJSON = hasCategories
    ? JSON.stringify({ insp: catInsp, defect: catDefect, weight: catWeight, brix: catBrix })
    : "";

  return {
    "작성일시": formatWrittenAtKst_(payload["작성일시"] || (existingRecord && existingRecord["작성일시"]) || new Date().toISOString()),
    "작업기준일또는CSV식별값": payload["작업기준일또는CSV식별값"] || "",
    "상품코드": normalizeCode_(payload["상품코드"] || payload["productCode"] || ""),
    "상품명": payload["상품명"] || payload["productName"] || "",
    "협력사명": payload["협력사명"] || payload["partnerName"] || "",
    "발주수량": parseNumber_(payload["발주수량"] || payload["totalQty"] || payload["전체발주수량"] || 0),
    "검품수량": parseNumber_(payload["검품수량"] || payload["inspectionQty"] || 0),
    "회송수량": parseNumber_(payload["회송수량"] || 0),
    "교환수량": parseNumber_(payload["교환수량"] || 0),
    "불량사유": payload["불량사유"] || payload["비고"] || payload["memo"] || "",
    "BRIX최저": payload["BRIX최저"] || payload["brixMin"] || "",
    "BRIX최고": payload["BRIX최고"] || payload["brixMax"] || "",
    "BRIX평균": payload["BRIX평균"] || payload["brixAvg"] || "",
    "사진파일ID목록": photoFileIds.join("\n"),
    "photoCategoriesJSON": photoCategoriesJSON,  // passed to upsertPhotoAsset_ below
    "수정일시": new Date().toISOString(),
    "버전": existingRecord ? (parseNumber_(existingRecord["버전"] || 0) + 1) : 1,
    "clientId": String(payload["clientId"] || (existingRecord && existingRecord["clientId"]) || "").trim(),
  };
}

function buildRecordPayload_(payload, existingRecord) {
  var now = new Date().toISOString();
  var version = existingRecord ? getRowVersion_(existingRecord) + 1 : 1;
  var updatedBy = getEditorLabel_(payload);
  const movementType = String(payload["movementType"] || "").trim().toUpperCase();
  const photos = Array.isArray(payload["사진들"]) ? payload["사진들"] : [];
  const uploaded = photos.length
    ? savePhotosToDrive_(
        photos,
        payload["상품명"] || payload["productName"] || "불량",
        existingRecord ? existingRecord["사진파일ID목록"] : ""
      )
    : [];
  const existingPhotoFileIds = splitPhotoSourceText_((existingRecord && existingRecord["사진파일ID목록"]) || "");
  const payloadPhotoFileIds = splitPhotoSourceText_(
    payload["사진파일ID목록"] || payload["photoFileIds"] || ""
  );
  const uploadedPhotoFileIds = uploaded.map(function (item) {
    return item.fileId;
  });
  const replacePhotoFileIdsMode = !!payload["replacePhotoFileIdsMode"];
  const photoFileIds = replacePhotoFileIdsMode
    ? splitPhotoSourceText_(payloadPhotoFileIds.join("\n") + "\n" + uploadedPhotoFileIds.join("\n"))
    : mergePhotoLinks_(
        mergePhotoLinks_(existingPhotoFileIds.join("\n"), payloadPhotoFileIds.join("\n"), ""),
        uploadedPhotoFileIds.join("\n"),
        ""
      ).split(/\n+/).filter(Boolean);

  const record = {
    "작성일시": formatWrittenAtKst_(payload["작성일시"] || (existingRecord && existingRecord["작성일시"]) || now),
    "작업기준일또는CSV식별값": payload["작업기준일또는CSV식별값"] || "",
    "상품명": payload["상품명"] || payload["productName"] || "",
    "상품코드": normalizeCode_(payload["상품코드"] || payload["productCode"] || ""),
    "센터명": payload["센터명"] || payload["centerName"] || "",
    "협력사명": payload["협력사명"] || payload["partnerName"] || "",
    "발주수량": parseNumber_(payload["발주수량"] || payload["qty"] || 0),
    "행사명": payload["행사명"] || payload["eventName"] || "",
    "행사여부": payload["행사여부"] || payload["eventFlag"] || "",
    "처리유형": payload["처리유형"] || "",
    "회송수량": parseNumber_(payload["회송수량"] || 0),
    "교환수량": parseNumber_(payload["교환수량"] || 0),
    "비고": payload["비고"] || payload["memo"] || "",
    "사진파일ID목록": photoFileIds.join("\n"),
    "사진개수": photoFileIds.length,
    "총 발주 수량": parseNumber_(payload["전체발주수량"] || payload["totalQty"] || payload["발주수량"] || 0),
    "수정일시": now,
    "수정자": updatedBy,
    "버전": version,
    "수주수량": parseNumber_(payload["수주수량"] || 0),
  };

  if (movementType === "RETURN") {
    record["처리유형"] = "회송";
    record["회송수량"] = parseNumber_(payload["qty"] || payload["회송수량"] || 0);
    record["교환수량"] = 0;
  } else if (movementType === "EXCHANGE") {
    record["처리유형"] = "교환";
    record["교환수량"] = parseNumber_(payload["qty"] || payload["교환수량"] || 0);
    record["회송수량"] = 0;
  } else if (!record["처리유형"]) {
    if (record["회송수량"] > 0) {
      record["처리유형"] = "회송";
    } else if (record["교환수량"] > 0) {
      record["처리유형"] = "교환";
    }
  }

  return record;
}

// ── Conflict detection — disabled: last-write-wins ──────────
// All saves are allowed regardless of concurrent edits.
function hasRowConflict_(payload, existingRecord) {
  return false;
}

function buildConflictResult_(rowType, payload, existingRecord) {
  var payloadClientId = String((payload && (payload.clientId || payload["clientId"])) || "").trim();
  var existingClientId = String((existingRecord && existingRecord["clientId"]) || "").trim();
  // editorConflict   = two distinct identified sessions both have clientIds
  // legacyConflict   = old-app payload (no clientId) tried to overwrite a new-app row (has clientId)
  // versionConflict  = stale version, same or unknown session
  var conflictType = (payloadClientId && existingClientId && payloadClientId !== existingClientId)
    ? "editorConflict"
    : (!payloadClientId && existingClientId)
    ? "legacyConflict"
    : "versionConflict";
  return {
    __conflict: true,
    type: rowType,
    conflictType: conflictType,
    key: payload.key || "",
    productCode: payload["상품코드"] || payload.productCode || "",
    partnerName: payload["협력사명"] || payload.partnerName || "",
    centerName: payload["센터명"] || payload.centerName || "",
    expectedVersion: parseNumber_(payload.expectedVersion || 0),
    expectedUpdatedAt: String(payload.expectedUpdatedAt || "").trim(),
    currentVersion: getRowVersion_(existingRecord),
    currentUpdatedAt: getRowUpdatedAt_(existingRecord),
    serverRow: existingRecord || null,
  };
}

// ── Totals sync ────────────────────────────────────────────
function syncInspectionMovementTotals_(inspectionSheet, recordsSheet) {
  if (!inspectionSheet || inspectionSheet.getLastRow() < 2) {
    return;
  }

  const totalsMap = buildMovementTotalsMap_(recordsSheet);
  const range = inspectionSheet.getRange(2, 1, inspectionSheet.getLastRow() - 1, inspectionSheet.getLastColumn());
  const values = range.getValues();

  for (var i = 0; i < values.length; i += 1) {
    const jobKey = String(values[i][1] || "").trim();
    const productCode = normalizeCode_(values[i][2] || "");
    const partnerName = String(values[i][4] || "").trim();
    const key = makeEntityKey_(jobKey, productCode, partnerName);
    const totals = totalsMap[key] || { returnQty: 0, exchangeQty: 0 };
    values[i][7] = totals.returnQty;
    values[i][8] = totals.exchangeQty;
  }

  range.setValues(values);
  purgeEmptyInspectionRows_(inspectionSheet);
}

// ── Photo & misc saves ─────────────────────────────────────
function uploadPhotos_(payload) {
  var itemKey = String(payload.itemKey || "").trim();
  var productName = String(payload.productName || payload.baseName || "상품").trim();
  var photos = Array.isArray(payload.photos) ? payload.photos : [];
  var uploaded = savePhotosToDrive_(photos, productName, "");

  return {
    itemKey: itemKey,
    photos: uploaded,
  };
}

function savePhotoMeta_(payload) {
  var raw = payload || {};
  var type = String(raw.type || "").trim().toLowerCase();
  var jobKey = String(raw["작업기준일또는CSV식별값"] || raw.jobKey || "").trim();
  var productCode = normalizeCode_(raw["상품코드"] || raw.productCode || "");
  var partnerName = String(raw["협력사명"] || raw.partnerName || "").trim();
  var centerName = String(raw["센터명"] || raw.centerName || "").trim();
  var typeName = String(raw["처리유형"] || raw.typeName || "").trim();
  var photoAction = String(raw.photoAction || "append").trim().toLowerCase();
  var photoFileId = String(raw.photoFileId || raw["사진파일ID"] || "").trim();
  var uploadedItem = raw.photoItem || null;
  if (!photoFileId && uploadedItem) {
    photoFileId = String(uploadedItem.fileId || "").trim();
  }

  var assetKey = "";
  if (type === "inspection") {
    assetKey = makeInspectionPhotoAssetKey_(jobKey, productCode, partnerName);
  } else {
    if (!typeName) {
      var movementType = String(raw.movementType || "").trim().toUpperCase();
      typeName = movementType === "RETURN" ? "회송" : movementType === "EXCHANGE" ? "교환" : "";
    }
    assetKey = makeMovementPhotoAssetKey_(jobKey, productCode, partnerName, centerName, typeName);
  }

  if (!assetKey) {
    throw new Error("사진 메타 저장 대상 키가 없습니다.");
  }

  var photoAssetMap = loadPhotoAssetMap_(SpreadsheetApp.getActiveSpreadsheet());
  var existing = photoAssetMap[assetKey];
  var fileIds = splitPhotoSourceText_((existing && existing.fileIdsText) || "");

  if (photoAction === "delete") {
    fileIds = fileIds.filter(function (item) {
      return String(item || "").trim() !== photoFileId;
    });
  } else if (photoFileId) {
    fileIds.push(photoFileId);
  }

  var uniqueMap = {};
  var normalized = [];
  fileIds.forEach(function (item) {
    var next = String(item || "").trim();
    if (!next || uniqueMap[next]) return;
    uniqueMap[next] = true;
    normalized.push(next);
  });

  if (normalized.length) {
    upsertPhotoAsset_(assetKey, normalized.join("\n"));
  } else {
    deletePhotoAsset_(assetKey);
  }

  return {
    key: assetKey,
    fileIds: normalized,
    photoCount: normalized.length,
  };
}

function resetCurrentJobInputData_(payload) {
  var jobKey = String(payload.jobKey || "").trim();
  var password = String(payload.password || "").trim();

  if (!jobKey) {
    throw new Error("초기화할 작업키가 없습니다.");
  }

  if (password !== ADMIN_RESET_PASSWORD) {
    throw new Error("관리자 비밀번호가 올바르지 않습니다.");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var recordsSheet = getRecordSheet_(ss);
  var inspectionSheet = getInspectionSheet_(ss);
  var deletedPhotos = trashPhotosForJob_(recordsSheet, jobKey);
  var deletedRecords = deleteRecordRowsByJobKey_(recordsSheet, jobKey);
  var resetInspectionCount = deleteInspectionRowsByJobKey_(inspectionSheet, jobKey);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);

  return {
    ok: true,
    jobKey: jobKey,
    deletedRecords: deletedRecords,
    deletedPhotos: deletedPhotos,
    resetInspectionRows: resetInspectionCount,
    records: loadRecords_(),
    inspectionRows: loadInspectionRows_(),
  };
}

function saveProductImageMapping_(payload) {
  var productCode = normalizeCode_(payload.productCode || payload["상품코드"] || "");
  var partnerName = normalizeText_(payload.partnerName || payload["협력사명"] || payload["협력사"] || "");
  var productName = String(payload.productName || payload["상품명"] || "").trim();
  var photo = payload.photo || payload.image || null;

  if (!productName && !productCode) {
    throw new Error("상품 정보가 없습니다.");
  }

  if (!photo || !photo.imageBase64) {
    throw new Error("등록할 이미지 파일이 없습니다.");
  }

  var mapKey = makeProductImageMapKey_(productCode, partnerName, productName);
  if (!mapKey || mapKey === "name::||") {
    throw new Error("이미지 매핑 키를 만들 수 없습니다.");
  }

  var savedFile = saveProductImageAssetToDrive_(photo, partnerName + "_" + productName, 0);
  var now = new Date().toISOString();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getProductImageSheet_(ss);
  var headers = productImageHeaders_();
  var existingRows = loadProductImageMappings_();
  var target = null;

  for (var i = 0; i < existingRows.length; i += 1) {
    if (String(existingRows[i]["맵키"] || "") === mapKey) {
      target = existingRows[i];
      break;
    }
  }

  var rowObject = {
    "맵키": mapKey,
    "상품코드": productCode,
    "협력사명": partnerName,
    "상품명": productName,
    "이미지URL": savedFile.viewUrl || "",
    "파일ID": savedFile.fileId || "",
    "파일명": savedFile.fileName || "",
    "생성일시": target && target["생성일시"] ? target["생성일시"] : now,
    "수정일시": now,
  };

  var rowValues = headers.map(function (header) {
    return rowObject[header] || "";
  });

  if (target && target.__rowNumber) {
    sheet.getRange(target.__rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return rowObject;
}

// ============================================================
// SECTION 5: INSPECTION ROW HELPERS
// ============================================================

// ── Sheet accessor / headers ───────────────────────────────
function getInspectionSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.inspection);
  migrateInspectionSheetIfNeeded_(sheet);
  ensureHeaderRow_(sheet, inspectionHeaders_());
  return sheet;
}

function getInspectionSummarySheet_(ss) {
  return getOrCreateSheet_(ss, SHEET_NAMES.summary);
}

function makeInspectionPhotoAssetKey_(jobKey, productCode, partnerName) {
  return [
    "inspection",
    String(jobKey || "").trim(),
    normalizeCode_(productCode || ""),
    normalizeText_(partnerName || ""),
  ].join("||");
}

function inspectionHeaders_() {
  return [
    "작성일시",
    "작업기준일또는CSV식별값",
    "상품코드",
    "상품명",
    "협력사명",
    "발주수량",
    "검품수량",
    "회송수량",
    "교환수량",
    "불량사유",
    "BRIX최저",
    "BRIX최고",
    "BRIX평균",
    "수정일시",
    "버전",
    "clientId",
  ];
}

function migrateInspectionSheetIfNeeded_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) {
    return;
  }

  var next = inspectionHeaders_(); // 15 cols
  var currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 19)).getValues()[0];
  var current = currentHeaders.map(function (item) {
    return String(item || "").trim();
  });

  // Already 15-col (current) format: 불량사유 at [9], BRIX평균 at [12], 수정일시 at [13], 버전 at [14]
  var isCurrentFormat = current[9] === "불량사유" && current[12] === "BRIX평균" && current[13] === "수정일시" && current[14] === "버전";
  // Already in the current format — just extend headers for any new columns (e.g. clientId).
  // Existing data rows are untouched; new rows get the new column on next write.
  if (isCurrentFormat) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  if (sheet.getLastRow() < 2) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  // 13-col → 15-col upgrade: add the two new header columns; leave data rows untouched
  // (existing rows get blank 수정일시/버전 which is safe — treated as version 0)
  var is13col = current[9] === "불량사유" && current[12] === "BRIX평균" && current[13] !== "수정일시";
  if (is13col) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  // Detect legacy formats: 19-col (비고 at [10], 사진개수 at [15]) or old 14-col (사진개수 at [10])
  var is19col = current[10] === "비고" && current[15] === "사진개수";
  var isOld14col = current[10] === "사진개수";

  var dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 19));
  var rows = dataRange.getValues();
  var migrated = rows.map(function (row) {
    if (is19col) {
      // 19-col → 15-col: skip 전체발주수량[5]; 비고[10]→불량사유[9]; drop 중량메모[14], 사진개수[15], 수정일시[16], 수정자[17], 버전[18]
      return [
        row[0] || "",   // 작성일시
        row[1] || "",   // 작업기준일또는CSV식별값
        row[2] || "",   // 상품코드
        row[3] || "",   // 상품명
        row[4] || "",   // 협력사명
        row[6] || 0,    // 발주수량 (was [6], skip 전체발주수량[5])
        row[7] || 0,    // 검품수량
        row[8] || 0,    // 회송수량
        row[9] || 0,    // 교환수량
        row[10] || "",  // 불량사유 (was 비고)
        row[11] || "",  // BRIX최저
        row[12] || "",  // BRIX최고
        row[13] || "",  // BRIX평균
        "",             // 수정일시 (new)
        0,              // 버전 (new)
      ];
    } else if (isOld14col) {
      // Old 14-col → 15-col: 사진개수 was at [10], skip it
      return [
        row[0] || "",   // 작성일시
        row[1] || "",   // 작업기준일또는CSV식별값
        row[2] || "",   // 상품코드
        row[3] || "",   // 상품명
        row[4] || "",   // 협력사명
        row[6] || row[5] || 0, // 발주수량
        row[7] || 0,    // 검품수량
        row[8] || 0,    // 회송수량
        row[9] || 0,    // 교환수량
        "",             // 불량사유 (new)
        "",             // BRIX최저 (new)
        "",             // BRIX최고 (new)
        "",             // BRIX평균 (new)
        "",             // 수정일시 (new)
        0,              // 버전 (new)
      ];
    } else {
      // Unknown/partial — best-effort preserve what we can
      return [
        row[0] || "", row[1] || "", row[2] || "", row[3] || "", row[4] || "",
        row[5] || 0, row[6] || 0, row[7] || 0, row[8] || 0,
        "", "", "", "",
        "", 0,
      ];
    }
  });

  ensureHeaderRow_(sheet, next);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, next.length).setValues(migrated);
  }
  if (sheet.getLastColumn() > next.length) {
    sheet.getRange(1, next.length + 1, sheet.getMaxRows(), sheet.getLastColumn() - next.length).clearContent();
  }
}

// ── Upsert / write ─────────────────────────────────────────
function upsertInspectionRow_(sheet, payload, photoAssetMap, preloadedValues) {
  const rawPayload = payload || {};
  const targetRow = findInspectionRow_(
    sheet,
    rawPayload["작업기준일또는CSV식별값"] || rawPayload["jobKey"] || "",
    rawPayload["상품코드"] || rawPayload["productCode"] || "",
    rawPayload["협력사명"] || rawPayload["partnerName"] || "",
    preloadedValues
  );
  const existingRecord = targetRow > 0
    ? (preloadedValues !== undefined
        ? readInspectionRowByValues_(preloadedValues, targetRow - 2, photoAssetMap)
        : readInspectionRow_(sheet, targetRow, photoAssetMap))
    : null;

  // ── Diagnostic: log every write attempt with conflict detection ──
  var conflictFlag = detectVersionDifference_(rawPayload, existingRecord);
  logWriteConflict_("saveInspection", rawPayload, existingRecord, conflictFlag);

  if (hasRowConflict_(rawPayload, existingRecord)) {
    return buildConflictResult_("inspection", rawPayload, existingRecord);
  }
  const row = buildInspectionPayload_(rawPayload, existingRecord);
  console.log("[upsertInspectionRow_] built row=" + JSON.stringify({
    jobKey: row["작업기준일또는CSV식별값"],
    productCode: row["상품코드"],
    productName: row["상품명"],
    partnerName: row["협력사명"],
    orderedQty: row["발주수량"],
    inspectionQty: row["검품수량"],
    photoLinks: row["사진링크목록"],
    memo: row["불량사유"]
  }));
  if (shouldDeleteInspectionRow_(row)) {
    if (targetRow > 0) {
      deletePhotoAsset_(makeInspectionPhotoAssetKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"]));
      sheet.deleteRow(targetRow);
      row.__rowNumber = 0;
    }
    return row;
  }
  writeInspectionRow_(sheet, targetRow, row);
  upsertPhotoAsset_(makeInspectionPhotoAssetKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"]), row["사진파일ID목록"], photoAssetMap, row["photoCategoriesJSON"] || "");
  console.log("[upsertInspectionRow_] written row=" + JSON.stringify({
    rowNumber: targetRow > 0 ? targetRow : sheet.getLastRow(),
    productCode: row["상품코드"],
    partnerName: row["협력사명"],
    inspectionQty: row["검품수량"],
    photoLinks: row["사진링크목록"],
    memo: row["불량사유"]
  }));
  row.__rowNumber = targetRow > 0 ? targetRow : sheet.getLastRow();
  return row;
}

function writeInspectionRow_(sheet, targetRow, record) {
  const values = [[
    record["작성일시"],
    record["작업기준일또는CSV식별값"],
    record["상품코드"],
    record["상품명"],
    record["협력사명"],
    record["발주수량"],
    record["검품수량"],
    record["회송수량"],
    record["교환수량"],
    record["불량사유"],
    record["BRIX최저"],
    record["BRIX최고"],
    record["BRIX평균"],
    record["수정일시"] || "",
    record["버전"] || 0,
    record["clientId"] || "",
  ]];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

// ── Find / read ────────────────────────────────────────────
function findInspectionRow_(sheet, jobKey, productCode, partnerName, preloadedValues) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = preloadedValues !== undefined
    ? preloadedValues
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    const rowJobKey = String(values[i][1] || "").trim();
    const rowCode = normalizeCode_(values[i][2] || "");
    const rowPartner = String(values[i][4] || "").trim();

    if (
      rowJobKey === String(jobKey || "").trim() &&
      rowCode === normalizeCode_(productCode || "") &&
      rowPartner === String(partnerName || "").trim()
    ) {
      return i + 2;
    }
  }

  return 0;
}

function readInspectionRow_(sheet, rowNumber, photoAssetMap) {
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = inspectionHeaders_();
  const row = {};

  for (var i = 0; i < headers.length; i += 1) {
    row[headers[i]] = values[i];
  }

  var map = photoAssetMap !== undefined
    ? photoAssetMap
    : loadPhotoAssetMap_(SpreadsheetApp.getActiveSpreadsheet());
  return applyPhotoAssetFieldsToRow_(row, map, "inspection");
}

// Read an inspection row from an already-loaded values array (row index is 0-based: targetRow - 2).
// Avoids a second sheet.getRange() call when the caller has already read the sheet.
function readInspectionRowByValues_(preloadedValues, rowIndex, photoAssetMap) {
  const headers  = inspectionHeaders_();
  const rowData  = preloadedValues[rowIndex] || [];
  const row      = {};

  for (var i = 0; i < headers.length; i += 1) {
    row[headers[i]] = rowData[i] !== undefined ? rowData[i] : "";
  }

  var map = photoAssetMap !== undefined
    ? photoAssetMap
    : loadPhotoAssetMap_(SpreadsheetApp.getActiveSpreadsheet());
  return applyPhotoAssetFieldsToRow_(row, map, "inspection");
}

// ── Purge / delete ─────────────────────────────────────────
function purgeEmptyInspectionRows_(inspectionSheet) {
  if (!inspectionSheet || inspectionSheet.getLastRow() < 2) return 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const photoAssetMap = loadPhotoAssetMap_(ss);

  const values = inspectionSheet
    .getRange(2, 1, inspectionSheet.getLastRow() - 1, inspectionSheet.getLastColumn())
    .getValues();
  const rowsToDelete = [];

  for (var i = 0; i < values.length; i += 1) {
    const jobKey = String(values[i][1] || "").trim();
    const productCode = normalizeCode_(values[i][2] || "");
    const partnerName = String(values[i][4] || "").trim();
    const assetKey = makeInspectionPhotoAssetKey_(jobKey, productCode, partnerName);
    const photoEntry = photoAssetMap[assetKey];
    const photoFileIds = photoEntry ? String(photoEntry.fileIdsText || "").trim() : "";
    const row = {
      "검품수량": values[i][6],
      "회송수량": values[i][7],
      "교환수량": values[i][8],
      "사진파일ID목록": photoFileIds,
    };
    if (shouldDeleteInspectionRow_(row)) {
      rowsToDelete.push(i + 2);
    }
  }

  rowsToDelete.sort(function (a, b) {
    return b - a;
  });
  rowsToDelete.forEach(function (rowNumber) {
    inspectionSheet.deleteRow(rowNumber);
  });

  return rowsToDelete.length;
}

function shouldDeleteInspectionRow_(row) {
  if (!row) return false;
  var inspectionQty = parseNumber_(row["검품수량"] || 0);
  var returnQty = parseNumber_(row["회송수량"] || 0);
  var exchangeQty = parseNumber_(row["교환수량"] || 0);
  var hasPhoto = !!String(row["사진링크"] || row["사진링크목록"] || row["사진파일ID목록"] || "").trim();
  return inspectionQty <= 0 && returnQty <= 0 && exchangeQty <= 0 && !hasPhoto;
}

function resetInspectionRowsByJobKey_(inspectionSheet, jobKey) {
  if (!inspectionSheet || inspectionSheet.getLastRow() < 2) return 0;

  var range = inspectionSheet.getRange(
    2,
    1,
    inspectionSheet.getLastRow() - 1,
    inspectionSheet.getLastColumn()
  );
  var values = range.getValues();
  var resetCount = 0;

  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][1] || "").trim() !== jobKey) continue;
    values[i][7] = 0;
    values[i][8] = 0;
    values[i][9] = 0;
    resetCount += 1;
  }

  range.setValues(values);
  return resetCount;
}

function deleteInspectionRowsByJobKey_(inspectionSheet, jobKey) {
  if (!inspectionSheet || inspectionSheet.getLastRow() < 2) return 0;

  var rowNumbers = [];
  var values = inspectionSheet
    .getRange(2, 1, inspectionSheet.getLastRow() - 1, inspectionSheet.getLastColumn())
    .getValues();

  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][1] || "").trim() === jobKey) {
      rowNumbers.push(i + 2);
    }
  }

  rowNumbers.sort(function (a, b) {
    return b - a;
  });

  rowNumbers.forEach(function (rowNumber) {
    inspectionSheet.deleteRow(rowNumber);
  });

  return rowNumbers.length;
}

// ── Photo field hydration ──────────────────────────────────
function applyPhotoAssetFieldsToRow_(row, assetMap, kind) {
  var key = makePhotoAssetKeyFromRecord_(row, kind);
  var asset = assetMap[key];
  var fileIds = asset ? splitPhotoSourceText_(asset.fileIdsText) : [];
  var photoLinks = fileIds
    .map(function (fileId) {
      return buildDriveViewUrl_(fileId);
    })
    .filter(Boolean);

  row["사진파일ID목록"] = fileIds.join("\n");
  row["사진링크목록"] = photoLinks.join("\n");
  row["사진링크"] = photoLinks[0] || "";
  row["사진URL"] = row["사진링크"];
  row["사진개수"] = asset ? parseNumber_(asset.photoCount || fileIds.length) : parseNumber_(row["사진개수"] || 0);

  // Set per-category photo ID fields when category data is available.
  // These are consumed by InspectionPage.jsx for type-specific preview hydration on reload.
  if (asset && asset.categories) {
    row["inspPhotoIds"]   = (asset.categories.insp   || []).join("\n");
    row["defectPhotoIds"] = (asset.categories.defect || []).join("\n");
    row["weightPhotoIds"] = (asset.categories.weight || []).join("\n");
    row["brixPhotoIds"]   = (asset.categories.brix   || []).join("\n");
  }

  return row;
}

// ============================================================
// SECTION 6: MOVEMENT ROW HELPERS
// ============================================================

// ── Sheet accessor / headers ───────────────────────────────
function getRecordSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.records);
  migrateRecordSheetIfNeeded_(sheet);
  ensureHeaderRow_(sheet, recordHeaders_());
  return sheet;
}

function makeMovementPhotoAssetKey_(jobKey, productCode, partnerName, centerName, typeName) {
  return [
    "movement",
    String(jobKey || "").trim(),
    normalizeCode_(productCode || ""),
    normalizeText_(partnerName || ""),
    normalizeText_(centerName || ""),
    normalizeText_(typeName || ""),
  ].join("||");
}

function recordHeaders_() {
  return [
    "작성일시",
    "작업기준일또는CSV식별값",
    "상품명",
    "상품코드",
    "센터명",
    "협력사명",
    "발주수량",
    "행사명",
    "행사여부",
    "처리유형",
    "회송수량",
    "교환수량",
    "비고",
    "사진개수",
    "총 발주 수량",
    "수정일시",
    "수정자",
    "버전",
    "수주수량",
  ];
}

function migrateRecordSheetIfNeeded_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) {
    return;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), recordHeaders_().length)).getValues()[0];
  const current = currentHeaders.map(function (item) {
    return String(item || "").trim();
  });
  const next = recordHeaders_();

  const isNewFormat =
    current[9] === "처리유형" &&
    current[10] === "회송수량" &&
    current[11] === "교환수량" &&
    current[12] === "비고" &&
    current[13] === "사진개수" &&
    current[14] === "총 발주 수량";

  if (isNewFormat) {
    // Already in the new format — just ensure the header row includes any new columns
    // (e.g. 수주수량 added as column 19). Existing data rows are left untouched.
    ensureHeaderRow_(sheet, next);
    return;
  }

  if (sheet.getLastRow() < 2) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 17));
  const rows = dataRange.getValues();
  const migrated = rows.map(function (row) {
    const typeValue = String(row[9] || "").trim() || (String(row[10] || "").trim() === "EXCHANGE" ? "교환" : String(row[10] || "").trim() === "RETURN" ? "회송" : "");
    const returnQty = parseNumber_(row[11] || 0);
    const exchangeQty = parseNumber_(row[12] || 0);
    const photoLink = String(row[14] || "").trim();

    return [
      row[0] || "",
      row[1] || "",
      row[2] || "",
      row[3] || "",
      row[4] || "",
      row[5] || "",
      row[6] || "",
      row[8] || "",
      row[7] || "",
      typeValue,
      returnQty,
      exchangeQty,
      row[13] || "",
      [photoLink, row[15] || "", row[14] || ""].filter(Boolean).length,
      row[16] || row[15] || 0,
    ];
  });

  ensureHeaderRow_(sheet, next);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, next.length).setValues(migrated);
  }
  if (sheet.getLastColumn() > next.length) {
    sheet.getRange(1, next.length + 1, sheet.getMaxRows(), sheet.getLastColumn() - next.length).clearContent();
  }
}

// ── Upsert / write ─────────────────────────────────────────
function upsertMovementRow_(sheet, payload, photoAssetMap) {
  const rawPayload = payload || {};
  const targetRow = findMovementRow_(
    sheet,
    rawPayload["작업기준일또는CSV식별값"] || rawPayload["jobKey"] || "",
    rawPayload["상품코드"] || rawPayload["productCode"] || "",
    rawPayload["협력사명"] || rawPayload["partnerName"] || "",
    rawPayload["센터명"] || rawPayload["centerName"] || "",
    rawPayload["처리유형"] || (String(rawPayload["movementType"] || "").trim().toUpperCase() === "RETURN" ? "회송" : String(rawPayload["movementType"] || "").trim().toUpperCase() === "EXCHANGE" ? "교환" : "")
  );
  const existingRecord = targetRow > 0 ? readMovementRow_(sheet, targetRow) : null;

  // ── Diagnostic: log every movement write attempt with conflict detection ──
  var conflictFlag = detectVersionDifference_(rawPayload, existingRecord);
  logWriteConflict_("saveMovement", rawPayload, existingRecord, conflictFlag);

  if (hasRowConflict_(rawPayload, existingRecord)) {
    return buildConflictResult_("movement", rawPayload, existingRecord);
  }
  const row = buildRecordPayload_(rawPayload, existingRecord);
  console.log("[upsertMovementRow_] built row(before merge)=" + JSON.stringify({
    jobKey: row["작업기준일또는CSV식별값"],
    productCode: row["상품코드"],
    partnerName: row["협력사명"],
    centerName: row["센터명"],
    typeName: row["처리유형"],
    returnQty: row["회송수량"],
    exchangeQty: row["교환수량"],
    orderedQty: row["발주수량"],
    totalOrderedQty: row["총 발주 수량"]
  }));

  // Only skip/delete for brand-new rows with no data.
  // For existing rows, merge first then check — so we never delete accumulated data.
  if (targetRow === 0 && shouldDeleteMovementRow_(row)) {
    return row;
  }

  if (targetRow > 0) {
    const existing = readMovementRow_(sheet, targetRow);
    if (rawPayload.replaceQtyMode) {
      row["회송수량"] = parseNumber_(row["회송수량"]);
      row["교환수량"] = parseNumber_(row["교환수량"]);
      row["비고"] = String(rawPayload["비고"] || rawPayload["memo"] || row["비고"] || "").trim();
    } else {
      row["회송수량"] = parseNumber_(existing["회송수량"]) + parseNumber_(row["회송수량"]);
      row["교환수량"] = parseNumber_(existing["교환수량"]) + parseNumber_(row["교환수량"]);
      row["비고"] = row["비고"] || existing["비고"]; // last non-empty value wins; no concatenation
    }
    row["발주수량"] = parseNumber_(existing["발주수량"] || row["발주수량"]);
    row["총 발주 수량"] = parseNumber_(existing["총 발주 수량"] || row["총 발주 수량"]);
    console.log("[upsertMovementRow_] merged row(before write)=" + JSON.stringify({
      rowNumber: targetRow,
      typeName: row["처리유형"],
      returnQty: row["회송수량"],
      exchangeQty: row["교환수량"],
      totalOrderedQty: row["총 발주 수량"]
    }));

    // After merge, delete only if merged result is completely empty.
    if (shouldDeleteMovementRow_(row)) {
      deletePhotoAsset_(makeMovementPhotoAssetKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"], row["센터명"], row["처리유형"]));
      sheet.deleteRow(targetRow);
      row.__rowNumber = 0;
      return row;
    }

    writeRecordRow_(sheet, targetRow, row);
    upsertPhotoAsset_(makeMovementPhotoAssetKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"], row["센터명"], row["처리유형"]), row["사진파일ID목록"], photoAssetMap);
    row.__rowNumber = targetRow;
    return row;
  }

  console.log("[upsertMovementRow_] new row(before write)=" + JSON.stringify({
    typeName: row["처리유형"],
    returnQty: row["회송수량"],
    exchangeQty: row["교환수량"],
    totalOrderedQty: row["총 발주 수량"]
  }));
  writeRecordRow_(sheet, 0, row);
  upsertPhotoAsset_(makeMovementPhotoAssetKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"], row["센터명"], row["처리유형"]), row["사진파일ID목록"], photoAssetMap);
  row.__rowNumber = sheet.getLastRow();
  return row;
}

function writeRecordRow_(sheet, targetRow, record) {
  const values = [[
    record["작성일시"],
    record["작업기준일또는CSV식별값"],
    record["상품명"],
    record["상품코드"],
    record["센터명"],
    record["협력사명"],
    record["발주수량"],
    record["행사명"],
    record["행사여부"],
    record["처리유형"],
    record["회송수량"],
    record["교환수량"],
    record["비고"],
    record["사진개수"],
    record["총 발주 수량"],
    record["수정일시"],
    record["수정자"],
    record["버전"],
    record["수주수량"] || 0,
  ]];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

// ── Find / read ────────────────────────────────────────────
function findMovementRow_(sheet, jobKey, productCode, partnerName, centerName, typeName) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const normalizedJobKey = String(jobKey || "").trim();
  const normalizedCode = normalizeCode_(productCode || "");
  const normalizedCenter = String(centerName || "").trim();
  const normalizedPartner = String(partnerName || "").trim();
  const normalizedType = String(typeName || "").trim();
  var fallbackRow = 0;

  for (var i = values.length - 1; i >= 0; i -= 1) {
    const rowJobKey = String(values[i][1] || "").trim();
    const rowCode = normalizeCode_(values[i][3] || "");
    const rowCenter = String(values[i][4] || "").trim();
    const rowPartner = String(values[i][5] || "").trim();
    const rowType = String(values[i][9] || "").trim();

    if (
      rowJobKey === normalizedJobKey &&
      rowCode === normalizedCode &&
      rowCenter === normalizedCenter &&
      rowPartner === normalizedPartner &&
      rowType === normalizedType
    ) {
      return i + 2;
    }

    if (
      !fallbackRow &&
      rowCode === normalizedCode &&
      rowCenter === normalizedCenter &&
      rowPartner === normalizedPartner &&
      rowType === normalizedType
    ) {
      fallbackRow = i + 2;
    }
  }

  return fallbackRow;
}

function readMovementRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = recordHeaders_();
  const row = {};

  for (var i = 0; i < headers.length; i += 1) {
    row[headers[i]] = values[i];
  }

  return row;
}

// ── Totals / delete ────────────────────────────────────────
function buildMovementTotalsMap_(recordsSheet) {
  const totalsMap = {};
  if (!recordsSheet || recordsSheet.getLastRow() < 2) {
    return totalsMap;
  }

  const values = recordsSheet.getDataRange().getValues();
  const headers = values[0].map(function (header) {
    return String(header || "").trim();
  });

  for (var r = 1; r < values.length; r += 1) {
    const row = {};
    for (var c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;
      row[header] = values[r][c];
    }

    const key = makeEntityKey_(row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"]);
    if (!totalsMap[key]) {
      totalsMap[key] = { returnQty: 0, exchangeQty: 0 };
    }

    totalsMap[key].returnQty += parseNumber_(row["회송수량"] || 0);
    totalsMap[key].exchangeQty += parseNumber_(row["교환수량"] || 0);
  }

  return totalsMap;
}

function shouldDeleteMovementRow_(row) {
  if (!row) return false;
  var returnQty = parseNumber_(row["회송수량"] || 0);
  var exchangeQty = parseNumber_(row["교환수량"] || 0);
  var memo = String(row["비고"] || "").trim();
  var hasPhoto =
    parseNumber_(row["사진개수"] || 0) > 0 ||
    !!String(row["사진링크"] || row["사진링크목록"] || row["사진파일ID목록"] || "").trim();
  return returnQty <= 0 && exchangeQty <= 0 && !memo && !hasPhoto;
}

function deleteRecordRowsByJobKey_(recordsSheet, jobKey) {
  if (!recordsSheet || recordsSheet.getLastRow() < 2) return 0;

  var rowNumbers = [];
  var values = recordsSheet
    .getRange(2, 1, recordsSheet.getLastRow() - 1, recordsSheet.getLastColumn())
    .getValues();

  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][1] || "").trim() === jobKey) {
      rowNumbers.push(i + 2);
    }
  }

  rowNumbers.sort(function (a, b) {
    return b - a;
  });

  rowNumbers.forEach(function (rowNumber) {
    recordsSheet.deleteRow(rowNumber);
  });

  return rowNumbers.length;
}

// ── Return sheet sync ──────────────────────────────────────
function syncReturnSheets_(ss) {
  var centerSheet = getOrCreateSheet_(ss, SHEET_NAMES.returnCenter);
  var summarySheet = getOrCreateSheet_(ss, SHEET_NAMES.returnSummary);
  var latestJob = loadLatestJob_();
  var currentJobKey = latestJob && latestJob.job_key ? String(latestJob.job_key).trim() : "";
  operationalReferenceCache_ = null;
  var referenceMaps = readOperationalReferenceMaps_(ss);
  var records = loadRecords_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var inspectionRows = loadInspectionRows_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var productMetaMap = buildOperationalProductMetaMap_(
    (latestJob && Array.isArray(latestJob.rows) ? latestJob.rows : []).concat(records).concat(inspectionRows),
    referenceMaps
  );
  var memoMap = {};
  var inspectionMap = {};
  var movementTotalsMap = {};
  var skuRowMap = {};

  records.forEach(function (row) {
    var key = makeSkuKey_(row["상품코드"], row["협력사명"]);
    if (!key) return;
    var memoValue = String(row["비고"] || "").trim();
    if (memoValue && !isLikelyPhotoLinkText_(memoValue)) {
      memoMap[key] = memoValue; // keep last entered value only
    }

    if (!movementTotalsMap[key]) {
      movementTotalsMap[key] = {
        returnQty: 0,
        exchangeQty: 0,
      };
    }

    movementTotalsMap[key].returnQty += parseNumber_(row["회송수량"]);
    movementTotalsMap[key].exchangeQty += parseNumber_(row["교환수량"]);

    if (!skuRowMap[key]) {
      skuRowMap[key] = row;
    }
  });

  inspectionRows.forEach(function (row) {
    var key = makeSkuKey_(row["상품코드"], row["협력사명"]);
    if (!key) return;
    inspectionMap[key] = row;
    // Also populate memoMap from 불량사유 in inspection sheet
    var defectReason = String(row["불량사유"] || "").trim();
    if (defectReason && !isLikelyPhotoLinkText_(defectReason)) {
      memoMap[key] = defectReason; // keep last entered value only
    }
    if (!skuRowMap[key]) {
      skuRowMap[key] = row;
    }
  });

  ensureHeaderRow_(centerSheet, [
    "날짜",
    "협력사명",
    "상품코드",
    "상품명",
    "미출수량",
    "수주수량",
    "전산유형",
    "센터",
    "상세",
    "작업기준일또는CSV식별값",
  ]);

  ensureHeaderRow_(summarySheet, [
    "대분류",
    "상품코드",
    "파트너사",
    "상품명",
    "단위",
    "입고량",
    "검품량",
    "검품률",
    "교환 회송 내용",
    "불량률",
    "교환량",
    "회송량",
    "처리형태",
    "검품담당",
    "작업기준일또는CSV식별값",
  ]);

  clearSheetBody_(centerSheet, 9);
  clearSheetBody_(summarySheet, 14);
  sortRecordSheetForCurrentJob_(ss, currentJobKey, productMetaMap);

  var centerValues = records
    .filter(function (row) {
      // Only return events go into 검품 회송내역 (센터포함)
      return parseNumber_(row["회송수량"]) > 0;
    })
    .map(function (row) {
      var returnQty = parseNumber_(row["회송수량"]);
      return {
        sortContext: buildOperationalSortContext_(row, productMetaMap, row.__rowNumber || 0),
        values: [
        formatSheetDate_(row["작성일시"]),
        row["협력사명"] || "",
        row["상품코드"] || "",
        row["상품명"] || "",
        returnQty,                          // 미출수량: return quantity for this center
        parseNumber_(row["수주수량"] || 0), // 수주수량: center-specific ordered qty
        "",                                 // 전산유형: leave empty
        row["센터명"] || "",
        "검품회송",  // 상세: always this label
        row["작업기준일또는CSV식별값"] || "", // lookup key for targeted row deletion
        ],
      };
    })
    .sort(function (a, b) {
      return compareOperationalSortContext_(a.sortContext, b.sortContext);
    })
    .map(function (item) {
      return item.values;
    });

  if (centerValues.length > 0) {
    centerSheet.getRange(2, 1, centerValues.length, 10).setValues(centerValues);
  }
  applyOperationalTableBorders_(centerSheet, 10);

  var summaryRows = Object.keys(skuRowMap)
    .map(function (key) {
      var baseRow = skuRowMap[key] || {};
      var inspectionRow = inspectionMap[key] || {};
      var movementTotals = movementTotalsMap[key] || { returnQty: 0, exchangeQty: 0 };
      var inboundQty = parseNumber_(
        inspectionRow["전체발주수량"] ||
        inspectionRow["발주수량"] ||
        baseRow["전체발주수량"] ||
        baseRow["발주수량"]
      );
      var inspectionQty = parseNumber_(inspectionRow["검품수량"]);
      var exchangeQty = parseNumber_(movementTotals.exchangeQty);
      var returnQty = parseNumber_(movementTotals.returnQty);

      if (exchangeQty <= 0 && returnQty <= 0) {
        return null;
      }

      var defectRate = inboundQty > 0 ? (exchangeQty + returnQty) / inboundQty : 0;
      var inspectionRate = inboundQty > 0 ? inspectionQty / inboundQty : 0;
      var memo = memoMap[key] || "";

      return {
        sortContext: buildOperationalSortContext_(
          {
            상품코드: baseRow["상품코드"] || inspectionRow["상품코드"] || "",
            상품명: baseRow["상품명"] || inspectionRow["상품명"] || "",
          },
          productMetaMap,
          Math.min(
            Number(baseRow.__rowNumber || 999999),
            Number(inspectionRow.__rowNumber || 999999)
          )
        ),
        values: [
          getOperationalProductMeta_(
            productMetaMap,
            baseRow["상품코드"] || inspectionRow["상품코드"] || "",
            baseRow["상품명"] || inspectionRow["상품명"] || ""
          ).majorCategory || "미분류",
          baseRow["상품코드"] || inspectionRow["상품코드"] || "",
          standardizeOperationalPartnerName_(
            baseRow["협력사명"] || inspectionRow["협력사명"] || "",
            referenceMaps
          ),
          baseRow["상품명"] || inspectionRow["상품명"] || "",
          "",
          inboundQty,
          inspectionQty,
          inspectionRate,
          memo,
          defectRate,
          exchangeQty,
          returnQty,
          getActionTypeByDefectRate_(defectRate),
          "",
          baseRow["작업기준일또는CSV식별값"] || currentJobKey || "", // lookup key for targeted row deletion
        ],
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return compareOperationalSortContext_(a.sortContext, b.sortContext);
    });

  var summaryValues = summaryRows.map(function (item) {
    return item.values;
  });

  if (summaryValues.length > 0) {
    summarySheet.getRange(2, 1, summaryValues.length, 15).setValues(summaryValues);
    summarySheet.getRange(2, 8, summaryValues.length, 1).setNumberFormat("0.0%");
    summarySheet.getRange(2, 10, summaryValues.length, 1).setNumberFormat("0.0%");
    mergeOperationalCategoryColumn_(summarySheet, summaryValues.length);
  }
  applyOperationalTableBorders_(summarySheet, 15);
  applyOperationalTableBorders_(getRecordSheet_(ss), recordHeaders_().length);

  return;
}

// ── Targeted row deletion from return output sheets ────────────────────────
// Called after a single source record is deleted so both output sheets lose
// only the exact corresponding row — no full sheet rebuild required.
function deleteReturnSheetRowsForRecord_(ss, record) {
  var jobKey      = String(record["작업기준일또는CSV식별값"] || "").trim();
  var productCode = normalizeCode_(String(record["상품코드"] || "").trim());
  var partnerName = String(record["협력사명"] || "").trim();
  var centerName  = String(record["센터명"]   || "").trim();

  // 검품 회송내역 (센터포함): one row per return event.
  // Composite key: 작업기준일또는CSV식별값 + 상품코드 + 협력사명 + 센터
  _deleteOutputSheetRows_(
    ss.getSheetByName(SHEET_NAMES.returnCenter),
    function (headers, row) {
      var colJK = headers.indexOf("작업기준일또는CSV식별값");
      var colPC = headers.indexOf("상품코드");
      var colPN = headers.indexOf("협력사명");
      var colCN = headers.indexOf("센터");
      return (
        colJK >= 0 && String(row[colJK] || "").trim() === jobKey &&
        colPC >= 0 && normalizeCode_(String(row[colPC] || "").trim()) === productCode &&
        colPN >= 0 && String(row[colPN] || "").trim() === partnerName &&
        colCN >= 0 && String(row[colCN] || "").trim() === centerName
      );
    }
  );

  // 검품 회송내역 (센터미포함): one aggregated row per SKU.
  // Composite key: 작업기준일또는CSV식별값 + 상품코드
  // (파트너사 stores a standardized name that may differ from raw 협력사명,
  //  so we rely on jobKey + productCode which is unique per SKU within a job.)
  _deleteOutputSheetRows_(
    ss.getSheetByName(SHEET_NAMES.returnSummary),
    function (headers, row) {
      var colJK = headers.indexOf("작업기준일또는CSV식별값");
      var colPC = headers.indexOf("상품코드");
      return (
        colJK >= 0 && String(row[colJK] || "").trim() === jobKey &&
        colPC >= 0 && normalizeCode_(String(row[colPC] || "").trim()) === productCode
      );
    }
  );
}

// Reads every data row in sheet, calls matchFn(headers, rowValues) for each,
// and deletes matching rows bottom-to-top so indices stay valid.
function _deleteOutputSheetRows_(sheet, matchFn) {
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || "").trim();
  });
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    if (matchFn(headers, data[i])) {
      sheet.deleteRow(i + 2); // +2: row 1 is header, data array is 0-indexed
    }
  }
}

function sortRecordSheetForCurrentJob_(ss, currentJobKey, productMetaMap) {
  if (!currentJobKey) return;

  var sheet = getRecordSheet_(ss);
  if (!sheet || sheet.getLastRow() < 3) return;

  var headers = recordHeaders_();
  var width = headers.length;
  var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, width);
  var values = range.getValues();
  var currentRows = [];

  values.forEach(function (valueRow, index) {
    var row = {};
    for (var c = 0; c < headers.length; c += 1) {
      row[headers[c]] = valueRow[c];
    }

    if (String(row["작업기준일또는CSV식별값"] || "").trim() !== currentJobKey) {
      return;
    }

    currentRows.push({
      position: index,
      values: valueRow,
      sortContext: buildOperationalSortContext_(row, productMetaMap, index),
    });
  });

  if (currentRows.length < 2) return;

  var sortedRows = currentRows.slice().sort(function (a, b) {
    return compareOperationalSortContext_(a.sortContext, b.sortContext);
  });

  var positions = currentRows.map(function (row) {
    return row.position;
  });

  positions.forEach(function (position, index) {
    values[position] = sortedRows[index].values;
  });

  range.setValues(values);
}

// ============================================================
// SECTION 7: PHOTO ASSET HELPERS
// ============================================================

// ── Photo asset sheet ──────────────────────────────────────
function photoAssetHeaders_() {
  return [
    "키",
    "사진파일ID목록",
    "사진개수",
    "수정일시",
    "photoCategoriesJSON",  // per-category photo IDs — added for type-specific hydration
  ];
}

function getPhotoAssetSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.photoAssets);
  ensureHeaderRow_(sheet, photoAssetHeaders_());
  if (!sheet.isSheetHidden()) {
    sheet.hideSheet();
  }
  return sheet;
}

function makePhotoAssetKeyFromRecord_(record, kind) {
  if (kind === "inspection") {
    return makeInspectionPhotoAssetKey_(
      record["작업기준일또는CSV식별값"],
      record["상품코드"],
      record["협력사명"]
    );
  }

  return makeMovementPhotoAssetKey_(
    record["작업기준일또는CSV식별값"],
    record["상품코드"],
    record["협력사명"],
    record["센터명"],
    record["처리유형"]
  );
}

function upsertPhotoAsset_(assetKey, fileIdsText, preloadedMap, categoriesJSON) {
  var key = String(assetKey || "").trim();
  if (!key) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var normalizedFileIds = splitPhotoSourceText_(fileIdsText).join("\n");
  if (!normalizedFileIds) {
    deletePhotoAsset_(key);
    return;
  }

  var sheet = getPhotoAssetSheet_(ss);
  var map = preloadedMap !== undefined ? preloadedMap : loadPhotoAssetMap_(ss);
  var photoCount = splitPhotoSourceText_(normalizedFileIds).length;
  var rowValues = [[key, normalizedFileIds, photoCount, new Date().toISOString(), categoriesJSON || ""]];
  var existing = map[key];

  if (existing && existing.rowNumber) {
    sheet.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    sheet.appendRow(rowValues[0]);
  }
}

function deletePhotoAsset_(assetKey) {
  var key = String(assetKey || "").trim();
  if (!key) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var map = loadPhotoAssetMap_(ss);
  var existing = map[key];
  if (!existing || !existing.rowNumber) return;

  getPhotoAssetSheet_(ss).deleteRow(existing.rowNumber);
}

function buildDriveViewUrl_(fileId) {
  var id = extractGoogleDriveId_(fileId);
  return id ? "https://drive.google.com/uc?export=view&id=" + id : "";
}

// ── Drive upload ───────────────────────────────────────────
function savePhotosToDrive_(photos, baseName, existingFileIdsText) {
  const list = Array.isArray(photos) ? photos : [];
  const saved = [];
  const existingNames = getExistingPhotoNameMap_(existingFileIdsText);
  const incomingNames = {};

  list.forEach(function (photo, index) {
    if (photo && photo.imageBase64) {
      var preferredFileName = buildPreferredPhotoFileName_(photo, baseName, saved.length);
      var dedupeKey = String(preferredFileName || "").trim().toLowerCase();
      if (!dedupeKey || existingNames[dedupeKey] || incomingNames[dedupeKey]) {
        return;
      }

      incomingNames[dedupeKey] = true;
      saved.push(savePhotoToDrive_(photo, baseName, saved.length, preferredFileName));
    }
  });

  return saved;
}

function getOrCreatePhotoFolder_() {
  // ── Primary: always try the designated inspection-photo Drive folder first ──
  // This folder ID is fixed and must be used for all new photo uploads.
  var DESIGNATED_FOLDER_ID = '1q2ZCBXNACyCGtPXdl3rr-qVRKc2VHl-F';
  try {
    DriveApp.getFolderById(DESIGNATED_FOLDER_ID);
    // Keep the script property in sync so any code that reads it directly also works.
    PropertiesService.getScriptProperties().setProperty('PHOTO_FOLDER_ID', DESIGNATED_FOLDER_ID);
    return DESIGNATED_FOLDER_ID;
  } catch (_) {
    // Designated folder inaccessible (wrong account / permissions) — fall through.
    console.warn('[getOrCreatePhotoFolder_] Designated folder inaccessible, trying property fallback.');
  }

  // ── Fallback: property-stored folder ID (from a previous run) ──
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId && folderId !== DESIGNATED_FOLDER_ID) {
    try {
      DriveApp.getFolderById(folderId);
      return folderId;
    } catch (_) {
      // Property folder also inaccessible — fall through to create.
    }
  }

  // ── Last resort: create a new folder (should never happen if permissions are correct) ──
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folderName = 'GS25검품_사진_' + ss.getId().slice(0, 8);
  var newFolder = DriveApp.createFolder(folderName);
  folderId = newFolder.getId();
  props.setProperty('PHOTO_FOLDER_ID', folderId);
  console.warn('[getOrCreatePhotoFolder_] Created fallback folder: ' + folderId);
  return folderId;
}

function savePhotoToDrive_(photo, baseName, index, preferredFileName) {
  const folderId = getOrCreatePhotoFolder_();

  const folder = DriveApp.getFolderById(folderId);
  const safeBaseName = sanitizeFileName_(baseName || "상품");
  const extension = getExtensionFromMimeType_(photo.mimeType || "") || getExtensionFromFileName_(photo.fileName || "") || "jpg";
  const fileName =
    sanitizeFileName_(preferredFileName || "") ||
    (safeBaseName + (index > 0 ? "_" + (index + 1) : "") + "." + extension);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(photo.imageBase64),
    photo.mimeType || "application/octet-stream",
    fileName
  );

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId = file.getId();
  const viewUrl = "https://drive.google.com/uc?export=view&id=" + fileId;
  const previewUrl = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1200";

  return {
    fileId: fileId,
    viewUrl: viewUrl,
    previewUrl: previewUrl,
    driveUrl: file.getUrl(),
    fileName: file.getName(),
  };
}

function buildPreferredPhotoFileName_(photo, baseName, index) {
  var rawName = sanitizeFileName_(String((photo && photo.fileName) || "").trim());
  if (rawName) {
    return rawName;
  }

  var safeBaseName = sanitizeFileName_(baseName || "상품");
  var extension =
    getExtensionFromMimeType_((photo && photo.mimeType) || "") ||
    getExtensionFromFileName_((photo && photo.fileName) || "") ||
    "jpg";

  return safeBaseName + (index > 0 ? "_" + (index + 1) : "") + "." + extension;
}

function getExistingPhotoNameMap_(fileIdsText) {
  var map = {};

  splitPhotoSourceText_(fileIdsText).forEach(function (item) {
    var driveId = extractGoogleDriveId_(item);
    if (!driveId) return;

    try {
      var fileName = String(DriveApp.getFileById(driveId).getName() || "").trim();
      if (!fileName) return;
      map[fileName.toLowerCase()] = true;
    } catch (_) {
      // Ignore unreadable existing files.
    }
  });

  return map;
}

// ── Product image assets ───────────────────────────────────
function productImageHeaders_() {
  return [
    "맵키",
    "상품코드",
    "협력사명",
    "상품명",
    "이미지URL",
    "파일ID",
    "파일명",
    "생성일시",
    "수정일시",
  ];
}

function getProductImageSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.productImages);
  ensureHeaderRow_(sheet, productImageHeaders_());
  return sheet;
}

function saveProductImageAssetToDrive_(photo, baseName, index) {
  var folderId =
    PropertiesService.getScriptProperties().getProperty("PRODUCT_IMAGE_FOLDER_ID") ||
    PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");

  if (!folderId) {
    throw new Error("이미지 업로드 실패: PRODUCT_IMAGE_FOLDER_ID 또는 PHOTO_FOLDER_ID가 설정되지 않았습니다.");
  }

  var folder = DriveApp.getFolderById(folderId);
  var safeBaseName = sanitizeFileName_(baseName || "product_image");
  var extension =
    getExtensionFromMimeType_(photo.mimeType || "") ||
    getExtensionFromFileName_(photo.fileName || "") ||
    "jpg";
  var blob = Utilities.newBlob(
    Utilities.base64Decode(photo.imageBase64),
    photo.mimeType || "application/octet-stream",
    safeBaseName + (index > 0 ? "_" + (index + 1) : "") + "." + extension
  );

  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    viewUrl: "https://drive.google.com/uc?export=view&id=" + file.getId(),
  };
}

// ============================================================
// SECTION 8: SUMMARY / SYNC HELPERS
// ============================================================

// ── Dashboard update ───────────────────────────────────────
function buildDashboardSourceRows_(latestRows, reservationRows) {
  var merged = Array.isArray(latestRows) ? latestRows.slice() : [];

  (Array.isArray(reservationRows) ? reservationRows : []).forEach(function (row, index) {
    var productCode = normalizeCode_(
      getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"])
    );
    var partnerName = normalizeText_(
      getRowFieldValue_(row, ["협력사명", "협력사", "거래처명"])
    );
    var productName = String(
      getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"])
    ).trim();
    var centerName = String(getRowFieldValue_(row, ["센터", "센터명"])).trim();
    var qty = parseNumber_(getRowFieldValue_(row, ["발주수량", "입고수량", "수량"]));
    var cost = parseNumber_(getRowFieldValue_(row, ["상품원가", "입고원가", "원가"]));

    if (!productCode && !partnerName && !productName) {
      return;
    }

    merged.push({
      __id: "reservation-dashboard-" + index,
      __reservationRow: true,
      __productCode: productCode,
      __productName: productName,
      __partner: partnerName,
      __center: centerName,
      __qty: qty,
      __incomingCost: cost,
      상품코드: productCode,
      상품명: productName,
      협력사명: partnerName,
      센터명: centerName,
      발주수량: qty,
      상품원가: cost,
      입고원가: cost,
    });
  });

  return merged;
}

function updateInspectionDashboard_(ss) {
  var inspectionSheet = getInspectionSheet_(ss);
  var summarySheet = getInspectionSummarySheet_(ss);
  if (!inspectionSheet || !summarySheet) return;

  var latestJob = loadLatestJob_();
  var currentJobKey = latestJob && latestJob.job_key ? String(latestJob.job_key).trim() : "";
  var latestRows = latestJob && Array.isArray(latestJob.rows) ? latestJob.rows : [];
  var reservationRows = readReservationRows_();
  var sourceRows = buildDashboardSourceRows_(latestRows, reservationRows);
  var inspectionRows = loadInspectionRows_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var recordRows = loadRecords_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var eventRows = readObjectsSheet_(SHEET_NAMES.event);
  var exclusionIdx = buildExclusionIndex_();
  var excludedCodes = exclusionIdx.excludedCodes;
  var excludedPairs = exclusionIdx.excludedPairs;
  var excludedPartners = exclusionIdx.excludedPartners;

  var totalInboundAmount = 0;
  var totalInboundQty = 0;
  var targetInboundAmount = 0;
  var targetInboundQty = 0;
  var totalSkuMap = {};
  var targetSkuMap = {};
  var inspectedSkuMap = {};
  var eventSkuMap = {};
  var returnQtyTotal = 0;
  var exchangeQtyTotal = 0;
  var eventCodeMap = {};

  eventRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    if (code) {
      eventCodeMap[code] = true;
    }
  });

  sourceRows.forEach(function (row) {
    var code = normalizeCode_(row.__productCode || getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    var partner = normalizeText_(row.__partner || getRowFieldValue_(row, ["거래처명(구매조건명)", "거래처명", "협력사", "협력사명"]) || "");
    var qty = parseNumber_(row.__qty || getRowFieldValue_(row, ["총 발주수량", "발주수량", "입고수량", "수량"]));
    var cost = parseNumber_(row.__incomingCost || getRowFieldValue_(row, ["상품원가", "입고원가", "원가"]));
    var skuKey = getRowSkuKey_(row);
    var excluded = isExcludedByRules_(code, partner, excludedCodes, excludedPairs, excludedPartners);

    totalInboundQty += qty;
    totalInboundAmount += qty * cost;

    if (skuKey) {
      totalSkuMap[skuKey] = true;
    }

    if (eventCodeMap[code] && skuKey) {
      eventSkuMap[skuKey || code] = true;
    }

    if (excluded) return;

    targetInboundQty += qty;
    targetInboundAmount += qty * cost;

    if (skuKey) {
      targetSkuMap[skuKey] = true;
    }
  });

  var inspectionQtyTotal = 0;
  var inspectionPhotoCount = 0;
  inspectionRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"]);
    var partner = normalizeText_(row["협력사명"] || "");
    var excluded = isExcludedByRules_(code, partner, excludedCodes, excludedPairs, excludedPartners);
    if (excluded) return;

    var inspectionQty = parseNumber_(row["검품수량"] || 0);
    var returnQty = parseNumber_(row["회송수량"] || 0);
    var exchangeQty = parseNumber_(row["교환수량"] || 0);
    inspectionQtyTotal += inspectionQty;
    returnQtyTotal += returnQty;
    exchangeQtyTotal += exchangeQty;

    var skuKey = makeSkuKey_(row["상품코드"], row["협력사명"]) || String(row["상품명"] || "").trim();
    if (inspectionQty > 0 && skuKey) {
      inspectedSkuMap[skuKey] = true;
    }

    if (getPhotoSourcesFromRecord_(row).length > 0) {
      inspectionPhotoCount += 1;
    }
  });

  var photoRecordCount = 0;
  recordRows.forEach(function (row) {
    if (getPhotoSourcesFromRecord_(row).length > 0) {
      photoRecordCount += 1;
    }
  });

  var targetSkuCount = Object.keys(targetSkuMap).length;
  var totalSkuCount = Object.keys(totalSkuMap).length;
  var inspectedSkuCount = Object.keys(inspectedSkuMap).length;
  var eventSkuCount = Object.keys(eventSkuMap).length;
  var values = [
    ["총 입고금액", "총 입고수량", "검품 수량", "검품률", "실검품률", "최근 갱신"],
    [
      totalInboundAmount,
      totalInboundQty,
      inspectionQtyTotal,
      totalInboundQty > 0 ? inspectionQtyTotal / totalInboundQty : 0,
      targetInboundQty > 0 ? inspectionQtyTotal / targetInboundQty : 0,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
    ],
    ["검품 입고금액", "입고 SKU", "검품 SKU", "SKU 커버리지", "검품입고 SKU", "실제 SKU 커버리지"],
    [
      targetInboundAmount,
      totalSkuCount,
      inspectedSkuCount,
      totalSkuCount > 0 ? inspectedSkuCount / totalSkuCount : 0,
      targetSkuCount,
      targetSkuCount > 0 ? inspectedSkuCount / targetSkuCount : 0,
    ],
    ["행사 SKU", "검품입고 SKU", "검품 입고수량", "회송 수량", "교환 수량", "사진 기록 건수"],
    [
      eventSkuCount,
      targetSkuCount,
      targetInboundQty,
      returnQtyTotal,
      exchangeQtyTotal,
      photoRecordCount + inspectionPhotoCount,
    ],
  ];

  inspectionSheet.getRange("L2:Q7").clearContent().clearFormat();

  summarySheet.getRange("A1:F6").clearContent().clearFormat();
  summarySheet.getRange("A1:F6").setValues(values);
  summarySheet.getRange("A1:F1").setBackground("#c6efce").setFontWeight("bold");
  summarySheet.getRange("A3:F3").setBackground("#fff2cc").setFontWeight("bold");
  summarySheet.getRange("A5:F5").setBackground("#d9ead3").setFontWeight("bold");
  summarySheet.getRange("A2:F2").setNumberFormats([["#,##0", "#,##0", "#,##0", "0.0%", "0.0%", "@"]]);
  summarySheet.getRange("A4:F4").setNumberFormats([["#,##0", "#,##0", "#,##0", "0.0%", "#,##0", "0.0%"]]);
  summarySheet.getRange("A6:F6").setNumberFormats([["#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0"]]);
  summarySheet.autoResizeColumns(1, 6);
  [1, 2, 3, 4, 5, 6].forEach(function (col) {
    if (summarySheet.getColumnWidth(col) < 110) {
      summarySheet.setColumnWidth(col, 110);
    }
  });
}

// ── Sheet formatting helpers ───────────────────────────────
function clearSheetBody_(sheet, width) {
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.deleteRows(2, sheet.getLastRow() - 1);
}

function formatSheetDate_(value) {
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "";
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function getActionTypeByDefectRate_(defectRate) {
  if (defectRate >= 0.07) return "경고조치";
  if (defectRate >= 0.03) return "주의조치";
  return "개선요청";
}

// ── Backup / reset automation ──────────────────────────────
function createOperationalBackup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheets = [
    SHEET_NAMES.inspection,
    SHEET_NAMES.records,
    SHEET_NAMES.returnCenter,
    SHEET_NAMES.returnSummary,
    SHEET_NAMES.summary,
  ];
  var dateLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM'월'dd'일'");
  var backupName = dateLabel;
  var suffix = 1;

  while (ss.getSheetByName(backupName)) {
    backupName = dateLabel + "_" + suffix;
    suffix += 1;
  }

  var backupSheet = ss.insertSheet(backupName);
  var cursorRow = 1;

  sourceSheets.forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    if (!data.length) return;

    backupSheet.getRange(cursorRow, 1).setValue("[" + sheetName + "]");
    backupSheet.getRange(cursorRow, 1).setFontWeight("bold");
    cursorRow += 1;
    backupSheet.getRange(cursorRow, 1, data.length, data[0].length).setValues(data);
    cursorRow += data.length + 2;
  });

  backupSheet.autoResizeColumns(1, Math.max(backupSheet.getLastColumn(), 8));
  return backupName;
}

function autoResetOperationalData_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var inspectionSheet = getInspectionSheet_(ss);
  var recordSheet = getRecordSheet_(ss);
  var centerSheet = getOrCreateSheet_(ss, SHEET_NAMES.returnCenter);
  var summarySheet = getOrCreateSheet_(ss, SHEET_NAMES.returnSummary);

  trashPhotosInSheet_(inspectionSheet);
  trashPhotosInSheet_(recordSheet);
  clearSheetBody_(inspectionSheet, inspectionSheet.getLastColumn());
  clearSheetBody_(recordSheet, recordSheet.getLastColumn());
  clearSheetBody_(centerSheet, centerSheet.getLastColumn());
  clearSheetBody_(summarySheet, summarySheet.getLastColumn());

  var dashboardSheet = getInspectionSummarySheet_(ss);
  dashboardSheet.getRange("A1:F6").clearContent().clearFormat();
}

function backupAndResetDaily_() {
  createOperationalBackup_();
  autoResetOperationalData_();
}

function setupDailyMaintenanceTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === "runDailyBackup_" || handler === "runDailyReset_" || handler === "backupAndResetDaily_") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("runDailyBackup_")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  ScriptApp.newTrigger("runDailyReset_")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

function runDailyBackup_() {
  createOperationalBackup_();
}

function runDailyReset_() {
  autoResetOperationalData_();
}

// ── History sync ───────────────────────────────────────────
// ─── 이력관리 sheet sync ───────────────────────────────────────────────────────
// Called ONLY by the manual "이력관리 기록" button in the 요약 tab.
// Never auto-triggered by save actions, photo uploads, or app load.
function syncHistorySheet_(ss) {
  // ── 1. Load current job ───────────────────────────────────────────────────
  var latestJob = loadLatestJob_();
  if (!latestJob || !latestJob.job_key || !Array.isArray(latestJob.rows) || latestJob.rows.length === 0) {
    console.log("[syncHistorySheet_] No active job with rows — skipping.");
    return;
  }
  var jobKey  = latestJob.job_key;
  var csvRows = latestJob.rows; // one row per CSV line (center-level)

  // ── 2. Build exclusion index (reuses existing helper) ────────────────────
  var excl = buildExclusionIndex_();
  var isRowExcluded = function(productCode, partnerName) {
    return (
      !!excl.excludedCodes[productCode] ||
      !!excl.excludedPairs[productCode + "||" + partnerName] ||
      !!excl.excludedPartners[partnerName]
    );
  };

  // ── 3. Load inspection rows for this job ─────────────────────────────────
  var allInspRows = loadInspectionRows_();
  var inspRows = allInspRows.filter(function(ir) {
    return String(ir["작업기준일또는CSV식별값"] || "").trim() === jobKey;
  });

  // ── 4. Accumulate CSV-based totals ───────────────────────────────────────
  // Distinct SKU key = normalizeCode_(상품코드)  — partner is NOT part of SKU key.
  var totalInboundAmount    = 0;  // B
  var totalInboundQty       = 0;  // C
  var nonExclInboundAmount  = 0;  // D
  var nonExclInboundQty     = 0;  // E
  var totalSkuSet           = {}; // I — all distinct codes
  var nonExclSkuSet         = {}; // J — non-excluded distinct codes
  // Code+partner -> excluded flag: used later for inspection numerator of H
  var codePartnerExclMap    = {};

  csvRows.forEach(function(row) {
    var code    = normalizeCode_(row["상품코드"] || row.__productCode || "");
    var partner = normalizeText_(row["협력사명"] || row.__partner || "");
    var qty     = parseNumber_(row["발주수량"] || row.__qty || 0);
    var cost    = parseNumber_(row.__incomingCost || row["입고원가"] || row["상품원가"] || 0);
    var excluded = isRowExcluded(code, partner);

    totalInboundAmount += qty * cost;
    totalInboundQty    += qty;
    totalSkuSet[code]   = true;
    codePartnerExclMap[code + "||" + partner] = excluded;

    if (!excluded) {
      nonExclInboundAmount  += qty * cost;
      nonExclInboundQty     += qty;
      nonExclSkuSet[code]    = true;
    }
  });

  // ── 5. Accumulate inspection totals ──────────────────────────────────────
  // inspection_data is keyed at productCode + partnerName level (no center).
  var totalInspectedQty      = 0;  // F
  var nonExclInspectedQty    = 0;  // H numerator
  var inspectedSkuSet        = {}; // K — any qty > 0
  var nonExclInspectedSkuSet = {}; // M numerator

  inspRows.forEach(function(ir) {
    var code    = normalizeCode_(ir["상품코드"] || "");
    var partner = normalizeText_(ir["협력사명"] || "");
    var qty     = parseNumber_(ir["검품수량"] || 0);
    var key     = code + "||" + partner;
    // Use CSV-derived excluded flag; fall back to direct exclusion check
    var excluded = (codePartnerExclMap[key] !== undefined)
      ? codePartnerExclMap[key]
      : isRowExcluded(code, partner);

    totalInspectedQty += qty;
    if (qty > 0) inspectedSkuSet[code] = true;

    if (!excluded) {
      nonExclInspectedQty += qty;
      if (qty > 0) nonExclInspectedSkuSet[code] = true;
    }
  });

  // ── 6. Derived counts ────────────────────────────────────────────────────
  var totalSkuCount         = Object.keys(totalSkuSet).length;          // I
  var nonExclSkuCount       = Object.keys(nonExclSkuSet).length;        // J
  var inspectedSkuCount     = Object.keys(inspectedSkuSet).length;      // K
  var nonExclInspSkuCount   = Object.keys(nonExclInspectedSkuSet).length; // M num

  // ── 7. Rate calculations ──────────────────────────────────────────────────
  var fmtRate = function(num, den) {
    if (!den) return "0%";
    return (Math.round(num / den * 10000) / 100) + "%";
  };
  var overallInspRate = fmtRate(totalInspectedQty, totalInboundQty);     // G
  var nonExclInspRate = fmtRate(nonExclInspectedQty, nonExclInboundQty); // H
  var skuCovAll       = fmtRate(inspectedSkuCount, totalSkuCount);       // L
  var skuCovNonExcl   = fmtRate(nonExclInspSkuCount, nonExclSkuCount);  // M

  // ── 8. Date string ────────────────────────────────────────────────────────
  // Use today's date in Asia/Seoul timezone (the day the recalc button was pressed).
  var dateStr = Utilities.formatDate(new Date(), "Asia/Seoul", "MM/dd");

  // ── 9. Write to 이력관리 sheet ──────────────────────────────────────────────
  // Keep exactly: Row 1 = header, Row 2 = latest result.
  // Every recalculation clears old data rows and rewrites a single fresh row so
  // the sheet never accumulates duplicate or stale history rows.
  var HIST_HEADERS = [
    "일자",
    "총 입고금액",
    "총 입고수량(개)",
    "총 입고금액 (냉동/가공/계란 제외)",
    "총 입고수량(개) (냉동/가공/계란 제외)",
    "검품수량(개)",
    "검품률 (전체)",
    "검품률 (냉동/가공/계란 제외)",
    "입고 SKU (전체)",
    "검품입고 SKU (검품불가 제외)",
    "검품 SKU (실진행)",
    "SKU 커버리지 (전체)",
    "SKU 커버리지 (냉동/가공/계란 제외)",
  ];

  var histSheet = getOrCreateSheet_(ss, SHEET_NAMES.history);

  // Ensure header row exists in row 1.
  var needsHeader = histSheet.getLastRow() < 1 ||
      String(histSheet.getRange(1, 1).getValue()).trim() !== "일자";
  if (needsHeader) {
    if (histSheet.getLastRow() >= 1 &&
        String(histSheet.getRange(1, 1).getValue()).trim() !== "일자") {
      histSheet.insertRowBefore(1);
    }
    histSheet.getRange(1, 1, 1, HIST_HEADERS.length).setValues([HIST_HEADERS]);
    histSheet.getRange(1, 1, 1, HIST_HEADERS.length).setFontWeight("bold");
  }

  var rowValues = [
    dateStr,
    totalInboundAmount,
    totalInboundQty,
    nonExclInboundAmount,
    nonExclInboundQty,
    totalInspectedQty,
    overallInspRate,
    nonExclInspRate,
    totalSkuCount,
    nonExclSkuCount,
    inspectedSkuCount,
    skuCovAll,
    skuCovNonExcl,
  ];

  // Append or update today's row. Deduplicate by date so multiple runs on the
  // same day overwrite the existing row instead of creating duplicates.
  var lastRow = histSheet.getLastRow();
  var existingDateRow = -1;
  if (lastRow >= 2) {
    var dateCol = histSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var di = 0; di < dateCol.length; di++) {
      if (String(dateCol[di][0]).trim() === dateStr) {
        existingDateRow = di + 2; // convert to 1-based sheet row number
        break;
      }
    }
  }
  if (existingDateRow > 0) {
    // Update the existing row for today
    histSheet.getRange(existingDateRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    // No row for today yet — append a new one
    histSheet.appendRow(rowValues);
  }
  console.log("[syncHistorySheet_] wrote row for date=" + dateStr + (existingDateRow > 0 ? " (updated)" : " (appended)"));
}

// ── Daily scheduled jobs ───────────────────────────────────
/**
 * Runs at 03:00 AM. Creates date-stamped backup copies of all operational sheets.
 * Example backup name: "inspection_data_2026-04-05"
 */
function dailyBackupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || "Asia/Seoul";
  var dateLabel = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var log = [];

  for (var i = 0; i < OPERATIONAL_SHEETS_TO_BACKUP_.length; i++) {
    var name  = OPERATIONAL_SHEETS_TO_BACKUP_[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      log.push("[SKIP] Sheet not found: " + name);
      continue;
    }
    var backupName = name + "_" + dateLabel;
    // Avoid duplicate backups for the same date
    if (ss.getSheetByName(backupName)) {
      log.push("[SKIP] Backup already exists: " + backupName);
      continue;
    }
    try {
      sheet.copyTo(ss).setName(backupName);
      log.push("[OK] Backed up: " + backupName);
    } catch (e) {
      log.push("[ERR] Failed to backup " + name + ": " + e.message);
    }
  }

  writeExecutionLog_(ss, "dailyBackupSheets", log);
  console.log("[dailyBackupSheets] " + log.join(" | "));
}

/**
 * Runs at 06:00 AM. Clears daily data from operational sheets.
 * SAFETY: Only runs if today's backup rows exist for at least the first backup-eligible sheet.
 * Headers (row 1) are always preserved.
 */
function dailyResetSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone() || "Asia/Seoul";
  var dateLabel = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var log = [];

  // Safety check: ensure backup was created for today before wiping data
  var firstBackupName = OPERATIONAL_SHEETS_TO_BACKUP_[0] + "_" + dateLabel;
  if (!ss.getSheetByName(firstBackupName)) {
    var safetyMsg = "[ABORT] Backup not found for today (" + firstBackupName + "). Reset skipped.";
    log.push(safetyMsg);
    writeExecutionLog_(ss, "dailyResetSheets", log);
    console.log("[dailyResetSheets] " + safetyMsg);
    return;
  }

  for (var i = 0; i < SHEETS_WITH_HEADERS_.length; i++) {
    var name  = SHEETS_WITH_HEADERS_[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      log.push("[SKIP] Sheet not found: " + name);
      continue;
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      log.push("[SKIP] Already empty (no data below header): " + name);
      continue;
    }
    try {
      sheet.deleteRows(2, lastRow - 1);
      log.push("[OK] Reset: " + name);
    } catch (e) {
      log.push("[ERR] Failed to reset " + name + ": " + e.message);
    }
  }

  writeExecutionLog_(ss, "dailyResetSheets", log);
  console.log("[dailyResetSheets] " + log.join(" | "));
}

/**
 * Writes a simple execution log entry to a hidden "execution_log" sheet.
 */
function writeExecutionLog_(ss, funcName, logLines) {
  try {
    var tz        = ss.getSpreadsheetTimeZone() || "Asia/Seoul";
    var timestamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
    var logSheet  = ss.getSheetByName("execution_log");
    if (!logSheet) {
      logSheet = ss.insertSheet("execution_log");
      logSheet.hideSheet();
      logSheet.getRange(1, 1, 1, 3).setValues([["timestamp", "function", "result"]]);
      logSheet.getRange(1, 1, 1, 3).setFontWeight("bold");
    }
    logSheet.appendRow([timestamp, funcName, logLines.join(" | ")]);
  } catch (e) {
    console.log("[writeExecutionLog_] Could not write log: " + e.message);
  }
}

/**
 * Call this function ONCE from the Apps Script editor to install the two time-driven triggers.
 * It safely removes existing duplicates before installing fresh ones.
 *
 * How to run:
 *   Apps Script editor → Run → setupDailyTriggers
 */
function setupDailyTriggers() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || "Asia/Seoul";

  // Remove any existing triggers for dailyBackupSheets / dailyResetSheets to prevent duplicates
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var t = existing[i];
    var fn = t.getHandlerFunction();
    if (fn === "dailyBackupSheets" || fn === "dailyResetSheets") {
      ScriptApp.deleteTrigger(t);
    }
  }

  // 03:00 AM backup trigger
  ScriptApp.newTrigger("dailyBackupSheets")
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone(tz)
    .create();

  // 06:00 AM reset trigger
  ScriptApp.newTrigger("dailyResetSheets")
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .inTimezone(tz)
    .create();

  console.log("[setupDailyTriggers] Installed backup trigger at 03:00 and reset trigger at 06:00 in timezone: " + tz);
}

// ============================================================
// SECTION 9: ZIP HELPERS
// ============================================================

// ── Photo ZIP creation ─────────────────────────────────────
function createPhotoZip_(payload) {
  var mode = String(payload.mode || "movement").trim();
  // sugar and weight photos live in inspection rows (photo type columns), not movement records
  var usesInspectionSheet = mode === "inspection" || mode === "sugar" || mode === "weight";
  var records = usesInspectionSheet ? loadInspectionRows_() : loadRecords_();
  var maxZipBytes = 20 * 1024 * 1024;
  var baseFileName = zipFileName_(mode);

  // ── Phase 1: Pre-compute reference maps ONCE (avoids per-file sheet read) ──
  var refMaps = readOperationalReferenceMaps_(SpreadsheetApp.getActiveSpreadsheet());

  // ── Phase 2: Collect photo entries without fetching any blobs ──
  var photoEntries = []; // { record, source, index }
  records.forEach(function (record) {
    var photos = getPhotoSourcesFromRecord_(record);
    if (!photos.length) return;

    if (mode === "inspection") {
      var hasInspPh =
        !!String(record["사진링크"] || "").trim() ||
        !!String(record["사진링크목록"] || "").trim() ||
        !!String(record["사진파일ID목록"] || "").trim();
      if (!hasInspPh) return;
    } else if (mode === "sugar") {
      // brixPhotoIds is a newline-separated string of Drive file IDs set by applyPhotoAssetFieldsToRow_
      photos = splitPhotoSourceText_(record["brixPhotoIds"] || "");
      if (!photos.length) return;
    } else if (mode === "weight") {
      photos = splitPhotoSourceText_(record["weightPhotoIds"] || "");
      if (!photos.length) return;
    } else {
      var isMov = isMovementRecord_(record);
      if (mode === "movement" && !isMov) return;
      if (mode !== "movement" && isMov) return;
    }

    photos.forEach(function (source, index) {
      photoEntries.push({ record: record, source: source, index: index, modeHint: (mode === "sugar" || mode === "weight") ? mode : null });
    });
  });

  if (!photoEntries.length) {
    return {
      fileName: baseFileName, mimeType: "application/zip",
      zipBase64: "", downloadUrl: "", fileId: "",
      addedCount: 0, skippedCount: 0, zipFiles: [],
    };
  }

  // ── Phase 3: Collect unique Drive file IDs and batch-fetch blobs in parallel ──
  // Using UrlFetchApp.fetchAll() + Drive API v3 instead of N sequential DriveApp calls.
  var blobCache = {}; // fileId → Blob
  var driveIds = [];
  var driveIdSet = {};
  photoEntries.forEach(function (entry) {
    var text = extractImageFormulaUrl_(entry.source);
    var id = extractGoogleDriveId_(text);
    if (id && !driveIdSet[id]) {
      driveIdSet[id] = true;
      driveIds.push(id);
    }
  });

  if (driveIds.length > 0) {
    var token = ScriptApp.getOAuthToken();
    var BATCH_SIZE = 10; // fetchAll concurrency cap per call
    for (var bi = 0; bi < driveIds.length; bi += BATCH_SIZE) {
      var chunk = driveIds.slice(bi, bi + BATCH_SIZE);
      var requests = chunk.map(function (id) {
        return {
          url: "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
          headers: { "Authorization": "Bearer " + token },
          muteHttpExceptions: true,
        };
      });
      var responses = UrlFetchApp.fetchAll(requests);
      responses.forEach(function (resp, ri) {
        var code = resp.getResponseCode();
        if (code >= 200 && code < 300) {
          blobCache[chunk[ri]] = resp.getBlob();
        } else {
          console.warn("[createPhotoZip_] Drive fetch failed id=" + chunk[ri] + " status=" + code);
        }
      });
    }
  }

  // ── Phase 4: Process entries with cached blobs and build ZIP parts ──
  var zipParts = [];
  var currentPart = [];
  var currentBytes = 0;
  var usedNames = {};
  var skippedCount = 0;

  photoEntries.forEach(function (entry) {
    try {
      var blob = getPhotoBlob_(entry.source, blobCache);
      if (!blob) { skippedCount += 1; return; }

      var finalName = buildPhotoZipFileName_(entry.record, entry.index + 1, blob, entry.source, refMaps, entry.modeHint);
      var dedupeKey = finalName.toLowerCase();
      var dupSuffix = 2;
      while (usedNames[dedupeKey]) {
        finalName = appendDuplicateSuffixToFileName_(finalName, dupSuffix);
        dedupeKey = finalName.toLowerCase();
        dupSuffix += 1;
      }
      usedNames[dedupeKey] = true;

      var namedBlob = blob.copyBlob().setName(finalName);
      var blobBytes = namedBlob.getBytes().length;
      if (currentPart.length > 0 && currentBytes + blobBytes > maxZipBytes) {
        zipParts.push(currentPart);
        currentPart = [];
        currentBytes = 0;
      }
      currentPart.push(namedBlob);
      currentBytes += blobBytes;
    } catch (err) {
      skippedCount += 1;
      console.error("[createPhotoZip_] " + err.message);
    }
  });

  if (currentPart.length > 0) zipParts.push(currentPart);

  if (!zipParts.length) {
    return {
      fileName: baseFileName, mimeType: "application/zip",
      zipBase64: "", downloadUrl: "", fileId: "",
      addedCount: 0, skippedCount: skippedCount, zipFiles: [],
    };
  }

  // ── Phase 5: Build and save ZIP archives ──
  var savedFiles = zipParts.map(function (partBlobs, index) {
    var partName = zipParts.length > 1 ? appendZipPartSuffix_(baseFileName, index + 1) : baseFileName;
    var zipBlob = Utilities.zip(partBlobs, partName).setName(partName);
    var saved = saveZipToDrive_(zipBlob, partName);
    return {
      fileName: partName,
      mimeType: zipBlob.getContentType() || "application/zip",
      downloadUrl: saved.downloadUrl,
      fileId: saved.fileId,
      driveUrl: saved.driveUrl,
      addedCount: partBlobs.length,
    };
  });

  var primaryFile = savedFiles[0];
  return {
    fileName: primaryFile.fileName,
    mimeType: primaryFile.mimeType,
    zipBase64: "",
    downloadUrl: primaryFile.downloadUrl,
    fileId: primaryFile.fileId,
    driveUrl: primaryFile.driveUrl,
    addedCount: savedFiles.reduce(function (sum, f) { return sum + f.addedCount; }, 0),
    skippedCount: skippedCount,
    zipFiles: savedFiles,
  };
}

// ── Blob fetching ──────────────────────────────────────────
// Returns the Blob for a photo source using the pre-built blob cache.
// Falls back to a live URL fetch for non-Drive HTTP sources (rare).
function getPhotoBlob_(source, blobCache) {
  var text = extractImageFormulaUrl_(source);
  var driveId = extractGoogleDriveId_(text);
  if (driveId) return blobCache[driveId] || null;
  if (/^https?:\/\//i.test(text)) {
    var resp = UrlFetchApp.fetch(text, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) return resp.getBlob();
  }
  return null;
}

function getPhotoBlobFromSource_(source) {
  var asset = getPhotoAssetFromSource_(source);
  return asset ? asset.blob : null;
}

function getPhotoAssetFromSource_(source) {
  var text = extractImageFormulaUrl_(source);
  var driveId = extractGoogleDriveId_(text);

  if (driveId) {
    var driveFile = DriveApp.getFileById(driveId);
    return {
      blob: driveFile.getBlob(),
      fileName: driveFile.getName(),
    };
  }

  if (/^https?:\/\//i.test(text)) {
    var response = UrlFetchApp.fetch(text, {
      muteHttpExceptions: true,
      followRedirects: true,
    });

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return {
        blob: response.getBlob(),
        fileName: getFileNameFromUrl_(text),
      };
    }
  }

  return null;
}

function getFileNameFromUrl_(value) {
  var text = String(value || "").trim();
  var match = text.match(/\/([^\/?#]+)(?:[?#].*)?$/);
  return match ? match[1] : "";
}

function getBlobExtension_(blob, source) {
  var contentType = String((blob && blob.getContentType && blob.getContentType()) || "").toLowerCase();
  if (contentType.indexOf("png") >= 0) return "png";
  if (contentType.indexOf("gif") >= 0) return "gif";
  if (contentType.indexOf("webp") >= 0) return "webp";
  if (contentType.indexOf("bmp") >= 0) return "bmp";
  if (contentType.indexOf("heic") >= 0) return "heic";

  var text = String(source || "").toLowerCase();
  if (text.indexOf(".png") >= 0) return "png";
  if (text.indexOf(".gif") >= 0) return "gif";
  if (text.indexOf(".webp") >= 0) return "webp";
  return "jpg";
}

// ── ZIP naming helpers ─────────────────────────────────────
// Build the output ZIP file name for a given mode.
function zipFileName_(mode) {
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  if (mode === "movement")   return "불량_"  + dateStr + ".zip";
  if (mode === "inspection") return "검품_"  + dateStr + ".zip";
  if (mode === "sugar")      return "당도_"  + dateStr + ".zip";
  if (mode === "weight")     return "중량_"  + dateStr + ".zip";
  return "사진_" + dateStr + ".zip";
}

// maps is now pre-computed by the caller (avoids a sheet read per photo file).
function buildPhotoZipFileName_(record, sequence, blob, source, maps, modeHint) {
  if (!maps) maps = readOperationalReferenceMaps_(SpreadsheetApp.getActiveSpreadsheet());
  var typeLabel = modeHint === "sugar"  ? "당도" :
                  modeHint === "weight" ? "중량" :
                  getPhotoZipTypeLabel_(record, source);
  var rawPartner = String(record["협력사명"] || record["파트너사"] || "협력사").trim();
  var partnerKey = normalizeOperationalLookupText_(rawPartner);
  var partnerName = sanitizeFileName_((maps.partnerToStandard && maps.partnerToStandard[partnerKey]) || rawPartner);
  var productName = sanitizeFileName_(record["상품명"] || record["상품코드"] || "상품");
  var extension = getBlobExtension_(blob, source);
  // 중량사진 omits productName/partnerName per naming convention
  if (typeLabel === "중량") {
    return typeLabel + "_" + sequence + "." + extension;
  }
  return typeLabel + "_" + productName + "_" + partnerName + "_" + sequence + "." + extension;
}

function getPhotoZipTypeLabel_(record, source) {
  var sourceText = String(source || "").toLowerCase();
  if (sourceText.indexOf("sugar") >= 0) return "당도";
  if (sourceText.indexOf("weight") >= 0) return "중량";
  if (sourceText.indexOf("exchange") >= 0) return "불량";
  if (sourceText.indexOf("return") >= 0) return "불량";
  var type = String(getRecordType_(record) || "").trim();
  if (type === "회송" || type === "교환") return "불량";
  if (type) return sanitizeFileName_(type);
  return "검품";
}

function appendZipPartSuffix_(fileName, partNumber) {
  var text = String(fileName || "photos.zip");
  var match = text.match(/^(.*?)(\.[a-zA-Z0-9]+)?$/);
  var base = match ? match[1] : text;
  var extension = match && match[2] ? match[2] : ".zip";
  var padded = partNumber < 10 ? "0" + partNumber : String(partNumber);
  return base + "_" + padded + extension;
}

function appendDuplicateSuffixToFileName_(fileName, suffix) {
  var text = String(fileName || "image.jpg");
  var match = text.match(/^(.*?)(\.[a-zA-Z0-9]+)?$/);
  var base = match ? match[1] : text;
  var extension = match && match[2] ? match[2] : "";
  return base + "_" + suffix + extension;
}

// ── Photo source iteration ─────────────────────────────────
function getPhotoSourcesFromRecord_(record) {
  var rawItems = []
    .concat([record["사진URL"], record["사진링크"]])
    .concat(splitPhotoSourceText_(record["사진링크목록"]))
    .concat(splitPhotoSourceText_(record["사진파일ID목록"]));

  var seen = {};
  var sources = [];

  rawItems.forEach(function (item) {
    var normalized = extractImageFormulaUrl_(item);
    var text = String(normalized || "").trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    sources.push(text);
  });

  return sources;
}

// ── ZIP Drive save ─────────────────────────────────────────
function saveZipToDrive_(zipBlob, fileName) {
  var folderId =
    PropertiesService.getScriptProperties().getProperty("ZIP_FOLDER_ID") ||
    PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
  var file = folder.createFile(zipBlob.setName(fileName));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    fileId: file.getId(),
    downloadUrl: "https://drive.google.com/uc?export=download&id=" + file.getId(),
    driveUrl: file.getUrl(),
  };
}

// ============================================================
// SECTION 10: UTILITY HELPERS
// ============================================================

// ── Write-conflict diagnostics ─────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC HELPERS  (write-conflict detection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns (or creates) the diagnostic log sheet.
 * Adds a header row on first creation.
 */
function getWriteConflictLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.writeConflictLog);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.writeConflictLog);
    sheet.appendRow([
      "기록시각(KST)", "action", "rowKey",
      "clientId", "jobKey", "상품코드", "협력사명",
      "검품수량", "회송수량", "교환수량",
      "version", "expectedVersion",
      "hasPhotos", "payloadKeys",
      "기존clientId", "기존version", "기존수정일시",
      "충돌여부",
    ]);
    sheet.setFrozenRows(1);
    try { sheet.getRange(1, 1, 1, 18).setFontWeight("bold"); } catch (_) {}
  }
  return sheet;
}

/**
 * Build a short human-readable row key for a save payload.
 */
function makeWriteConflictKey_(payload) {
  var jobKey   = String(payload["작업기준일또는CSV식별값"] || payload["jobKey"] || "").trim();
  var code     = normalizeCode_(payload["상품코드"] || payload["productCode"] || "");
  var partner  = String(payload["협력사명"] || payload["partnerName"] || "").trim();
  var center   = String(payload["센터명"]   || payload["centerName"]  || "").trim();
  var type     = String(payload["처리유형"] || payload["movementType"]|| "").trim();
  return [jobKey, code, partner, center, type].filter(Boolean).join(" | ");
}

/**
 * Write one diagnostic log row.
 * existingRecord = the row that was in the sheet BEFORE this save (may be null).
 * conflictFlag   = "" | "⚠ 다른 clientId 덮어쓰기" | "⚠ 버전 불일치" | "⚠ 동시 저장"
 */
function logWriteConflict_(action, payload, existingRecord, conflictFlag) {
  if (!DEBUG_WRITE_CONFLICTS) return;
  try {
    var sheet = getWriteConflictLogSheet_();
    var now   = new Date();
    var kst   = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    var ts    = Utilities.formatDate(kst, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

    var clientId        = String(payload["clientId"] || "").trim() || "(없음-구버전)";
    var jobKey          = String(payload["작업기준일또는CSV식별값"] || payload["jobKey"] || "").trim();
    var code            = normalizeCode_(payload["상품코드"] || payload["productCode"] || "");
    var partner         = String(payload["협력사명"] || payload["partnerName"] || "").trim();
    var inspQty         = parseNumber_(payload["검품수량"] || payload["inspectionQty"] || 0);
    var returnQty       = parseNumber_(payload["회송수량"] || 0);
    var exchangeQty     = parseNumber_(payload["교환수량"] || 0);
    var version         = parseNumber_(payload["버전"] || 0);
    var expectedVersion = parseNumber_(payload["expectedVersion"] || 0);
    var hasPhotos       = !!(String(payload["사진파일ID목록"] || "").trim());
    var payloadKeys     = Object.keys(payload || {}).sort().join(",");

    var existingClientId  = existingRecord ? String(existingRecord["clientId"]  || "(없음)").trim() : "";
    var existingVersion   = existingRecord ? parseNumber_(existingRecord["버전"] || 0) : "";
    var existingUpdatedAt = existingRecord ? String(existingRecord["수정일시"]   || "").trim() : "";
    var rowKey = makeWriteConflictKey_(payload);

    sheet.appendRow([
      ts, action, rowKey,
      clientId, jobKey, code, partner,
      inspQty, returnQty, exchangeQty,
      version, expectedVersion,
      hasPhotos ? "Y" : "", payloadKeys,
      existingClientId, existingVersion, existingUpdatedAt,
      conflictFlag || "",
    ]);

    // Also log to Cloud Logging (visible in GAS Executions > Logs)
    console.log("[WRITE_LOG] action=" + action
      + " key=" + rowKey
      + " clientId=" + clientId
      + " v=" + version + "/expected=" + expectedVersion
      + " conflict=" + (conflictFlag || "none"));
  } catch (logErr) {
    console.error("[logWriteConflict_] failed: " + logErr.message);
  }
}

/**
 * Determine if two save payloads look like different app versions.
 * Returns a description string or "" if no version difference detected.
 */
function detectVersionDifference_(payload, existingRecord) {
  if (!existingRecord) return "";

  var payloadClientId  = String(payload["clientId"] || "").trim();
  var existingClientId = String(existingRecord["clientId"] || "").trim();

  // Old app sends no clientId at all
  if (!payloadClientId && existingClientId) {
    return "⚠ 구버전 앱이 신버전 행을 덮어씀 (clientId 없음)";
  }
  if (payloadClientId && !existingClientId) {
    return "⚠ 신버전 앱이 구버전 행을 덮어씀";
  }
  if (payloadClientId && existingClientId && payloadClientId !== existingClientId) {
    // Different clientIds = different browser sessions (possibly different users/versions)
    var expectedVersion  = parseNumber_(payload["expectedVersion"] || 0);
    var existingVersion  = parseNumber_(existingRecord["버전"] || 0);
    if (expectedVersion > 0 && existingVersion > expectedVersion) {
      return "⚠ 다른 clientId + 버전 충돌 (다른 사용자가 먼저 저장함)";
    }
    return "⚠ 다른 clientId 덮어쓰기";
  }
  // Same clientId but version mismatch (same user, stale page)
  var expected  = parseNumber_(payload["expectedVersion"] || 0);
  var current   = parseNumber_(existingRecord["버전"] || 0);
  if (expected > 0 && current !== expected) {
    return "⚠ 버전 불일치 (동일 clientId, 페이지 새로고침 필요)";
  }
  return "";
}


// ── Core normalizers ───────────────────────────────────────
function normalizeCode_(value) {
  if (value == null) return "";

  var text = String(value).replace(/\uFEFF/g, "").trim();
  var match = text.match(/^=T\("(.+)"\)$/i);

  if (match) {
    text = match[1];
  }

  text = text.replace(/^"+|"+$/g, "").trim();

  var numericText = text.replace(/,/g, "").trim();
  if (/^\d+(\.0+)?$/.test(numericText)) {
    return numericText.replace(/\.0+$/, "");
  }

  return text;
}

function parseNumber_(value) {
  var num = Number(String(value == null ? "" : value).replace(/,/g, "").trim());
  return Number.isNaN(num) ? 0 : num;
}

function formatWrittenAtKst_(value) {
  var date = value ? new Date(value) : new Date();
  if (String(date) === "Invalid Date") {
    date = new Date();
  }

  var timezone = "Asia/Seoul";
  var weekdayMap = {
    "1": "월",
    "2": "화",
    "3": "수",
    "4": "목",
    "5": "금",
    "6": "토",
    "7": "일",
  };
  var weekdayNumber = Utilities.formatDate(date, timezone, "u");
  var weekdayLabel = weekdayMap[weekdayNumber] || "월";

  return Utilities.formatDate(date, timezone, "MM.dd") + "(" + weekdayLabel + ") " +
    Utilities.formatDate(date, timezone, "HH:mm:ss");
}

function normalizeText_(value) {
  return String(value == null ? "" : value).replace(/\uFEFF/g, "").trim();
}

function makeEntityKey_(jobKey, productCode, partnerName) {
  return [String(jobKey || "").trim(), normalizeCode_(productCode || ""), String(partnerName || "").trim()].join("||");
}

function makeSkuKey_(productCode, partnerName) {
  return [normalizeCode_(productCode || ""), normalizeText_(partnerName || "")].join("||");
}

function normalizeImageLookupText_(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\u3131-\uD79Da-z0-9]/gi, "")
    .trim();
}

function makeProductImageMapKey_(productCode, partnerName, productName) {
  var code = normalizeCode_(productCode || "");
  var partner = normalizeText_(partnerName || "");
  if (code || partner) {
    return "sku::" + makeSkuKey_(code, partner);
  }
  return "name::" + normalizeImageLookupText_(productName || "") + "||" + normalizeImageLookupText_(partnerName || "");
}

function isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners) {
  var code = normalizeCode_(productCode || "");
  var partner = normalizeText_(partnerName || "");
  if (!code && !partner) return false;
  return !!excludedCodes[code] || !!excludedPairs[code + "||" + partner] || !!excludedPartners[partner];
}

function isExclusionRowActive_(row) {
  var val = String(row["사용여부"] || "").trim().toLowerCase();
  if (!val) return true; // treat blank as active (backward compat)
  return val === "y" || val === "yes" || val === "사용" || val === "활성" || val === "1" || val === "true";
}

function buildExclusionIndex_() {
  var excludeRows = readObjectsSheet_(SHEET_NAMES.exclude);
  var excludedCodes = {};
  var excludedPairs = {};
  var excludedPartners = {};
  excludeRows.forEach(function (row) {
    if (!isExclusionRowActive_(row)) return;
    var code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    var partner = normalizeText_(row["협력사"] || row["협력사명"] || "");
    if (!code && !partner) return;
    if (partner) {
      if (code) {
        excludedPairs[code + "||" + partner] = true;
      } else {
        excludedPartners[partner] = true;
      }
    } else {
      excludedCodes[code] = true;
    }
  });
  return { excludedCodes: excludedCodes, excludedPairs: excludedPairs, excludedPartners: excludedPartners };
}

// ── Row / record utilities ─────────────────────────────────
function getEditorLabel_(payload) {
  var explicitLabel = String(
    (payload && (payload.updatedBy || payload["수정자"] || payload.editorName || payload.userName || payload.userEmail)) || ""
  ).trim();
  if (explicitLabel) return explicitLabel;

  try {
    var email = String(Session.getActiveUser().getEmail() || "").trim();
    if (email) return email;
  } catch (err) {}

  try {
    var tempKey = String(Session.getTemporaryActiveUserKey() || "").trim();
    if (tempKey) return "user:" + tempKey.slice(0, 8);
  } catch (err2) {}

  return "unknown";
}

function mergeTextValue_(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (left && right && left !== right) return left + "\n" + right;
  return right || left;
}

function getRowVersion_(row) {
  return parseNumber_(row && row["버전"] ? row["버전"] : 0);
}

function getRowUpdatedAt_(row) {
  return String((row && row["수정일시"]) || "").trim();
}

function mergePhotoLinks_(existingLinksText, newLinksText, newPrimaryLink) {
  const map = {};
  String(existingLinksText || "")
    .split(/\n+/)
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean)
    .forEach(function (item) {
      map[item] = true;
    });

  String(newLinksText || "")
    .split(/\n+/)
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean)
    .forEach(function (item) {
      map[item] = true;
    });

  if (newPrimaryLink) {
    map[String(newPrimaryLink).trim()] = true;
  }

  return Object.keys(map).join("\n");
}

function isLikelyPhotoLinkText_(value) {
  var lines = String(value || "")
    .split(/\n+/)
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean);

  if (!lines.length) return false;

  return lines.every(function (line) {
    return /^https?:\/\/.+/i.test(line) || !!extractGoogleDriveId_(line);
  });
}

function getRecordType_(record) {
  var type = String(record["처리유형"] || "").trim();
  if (type) return type;
  if (parseNumber_(record["회송수량"]) > 0) return "회송";
  if (parseNumber_(record["교환수량"]) > 0) return "교환";
  return "기타";
}

function isMovementRecord_(record) {
  var type = String(getRecordType_(record) || "").trim().toUpperCase();
  if (["회송", "교환", "RETURN", "EXCHANGE"].indexOf(type) >= 0) return true;
  return parseNumber_(record["회송수량"]) > 0 || parseNumber_(record["교환수량"]) > 0;
}

function trashPhotosForJob_(recordsSheet, jobKey) {
  if (!recordsSheet || recordsSheet.getLastRow() < 2) return 0;

  var values = recordsSheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  var seenIds = {};
  var deletedCount = 0;

  for (var r = 1; r < values.length; r += 1) {
    var row = {};
    for (var c = 0; c < headers.length; c += 1) {
      if (!headers[c]) continue;
      row[headers[c]] = values[r][c];
    }

    if (String(row["작업기준일또는CSV식별값"] || "").trim() !== jobKey) continue;

    getPhotoSourcesFromRecord_(row).forEach(function (source) {
      var driveId = extractGoogleDriveId_(source);
      if (!driveId || seenIds[driveId]) return;
      seenIds[driveId] = true;

      try {
        DriveApp.getFileById(driveId).setTrashed(true);
        deletedCount += 1;
      } catch (_) {
        // Ignore photo deletion failures and continue.
      }
    });
  }

  return deletedCount;
}

function trashPhotosInSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  var seenIds = {};
  var deletedCount = 0;

  for (var r = 1; r < values.length; r += 1) {
    var row = {};
    for (var c = 0; c < headers.length; c += 1) {
      if (!headers[c]) continue;
      row[headers[c]] = values[r][c];
    }

    getPhotoSourcesFromRecord_(row).forEach(function (source) {
      var driveId = extractGoogleDriveId_(source);
      if (!driveId || seenIds[driveId]) return;
      seenIds[driveId] = true;

      try {
        DriveApp.getFileById(driveId).setTrashed(true);
        deletedCount += 1;
      } catch (_) {
        // Ignore deletion failures during bulk cleanup.
      }
    });
  }

  return deletedCount;
}

function getRowFieldValue_(row, candidates) {
  for (var i = 0; i < candidates.length; i += 1) {
    var key = candidates[i];
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function getRowSkuKey_(row) {
  var code = normalizeCode_(getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
  var partner = normalizeText_(
    getRowFieldValue_(row, ["협력사명", "협력사", "거래처명(구매조건명)", "거래처명"])
  );
  if (code || partner) return makeSkuKey_(code, partner);
  return String(getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
}

// ── String / file utilities ────────────────────────────────
function splitPhotoSourceText_(value) {
  return String(value || "")
    .split(/\r?\n|[,;]+/)
    .map(function (item) {
      return String(item || "").trim();
    })
    .filter(Boolean);
}

function extractImageFormulaUrl_(value) {
  var text = String(value || "").trim();
  var match = text.match(/^=IMAGE\("(.+)"\)$/i);
  return match ? match[1] : text;
}

function extractGoogleDriveId_(value) {
  var text = String(value || "").trim();
  if (!text) return "";

  var directId = text.match(/^[a-zA-Z0-9_-]{20,}$/);
  if (directId) return directId[0];

  var fileMatch = text.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  var openMatch = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  var ucMatch = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (ucMatch) return ucMatch[1];

  return "";
}

function getExtensionFromMimeType_(mimeType) {
  var text = String(mimeType || "").toLowerCase();
  if (text.indexOf("png") >= 0) return "png";
  if (text.indexOf("gif") >= 0) return "gif";
  if (text.indexOf("webp") >= 0) return "webp";
  if (text.indexOf("bmp") >= 0) return "bmp";
  if (text.indexOf("heic") >= 0) return "heic";
  if (text.indexOf("jpeg") >= 0 || text.indexOf("jpg") >= 0) return "jpg";
  return "";
}

function getExtensionFromFileName_(fileName) {
  var text = String(fileName || "");
  var match = text.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function sanitizeFileName_(name) {
  var text = String(name || "상품")
    .replace(/[\\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .trim();

  return text || "상품";
}

// ── Sheet utilities ────────────────────────────────────────
function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    try {
      sheet = ss.insertSheet(name);
    } catch (err) {
      var message = String((err && err.message) || err || "");
      if (message.indexOf("already exists") >= 0 || message.indexOf("이미 있습니다") >= 0) {
        sheet = ss.getSheetByName(name);
      } else {
        throw err;
      }
    }
  }
  if (!sheet) {
    throw new Error("시트를 찾을 수 없습니다: " + name);
  }
  return sheet;
}

function ensureHeaderRow_(sheet, headers) {
  if (!sheet || !headers || !headers.length) return;

  const width = headers.length;
  const existing = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (value) {
    return String(value || "").trim();
  });

  var changed = false;
  for (var i = 0; i < width; i += 1) {
    if (existing[i] !== headers[i]) {
      changed = true;
      break;
    }
  }

  if (sheet.getLastRow() === 0 || changed) {
    sheet.getRange(1, 1, 1, width).setValues([headers]);
  }
}
