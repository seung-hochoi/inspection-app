const SHEET_NAMES = {
  exclude: "제외목록",
  event: "행사표",
  reservation: "사전예약추가",
  jobs: "jobs",
  jobCache: "job_cache",
  records: "return_exchange_records",
  inspection: "inspection_data",
  summary: "inspection_summary",
  returnCenter: "검품 회송내역 (센터포함)",
  returnSummary: "검품 회송내역 (센터미포함)",
  happycall: "happycall_data",
};
const ADMIN_RESET_PASSWORD = "0000";
const JOB_CACHE_MAX_DATA_ROWS = 30000;

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "bootstrap";

    if (action === "bootstrap") {
      updateInspectionDashboard_(SpreadsheetApp.getActiveSpreadsheet());
      return jsonOutput_({
        ok: true,
        data: {
          config: {
            exclude_rows: readObjectsSheet_(SHEET_NAMES.exclude),
            event_rows: readObjectsSheet_(SHEET_NAMES.event),
            reservation_rows: readReservationRows_(),
          },
          current_job: loadLatestJob_(),
          worksheet_url: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
          summary: getDashboardSummary_(),
          happycall: getHappycallAnalytics_(),
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

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw);
    const action = body.action || "";

    if (action === "cacheCsv") {
      var cachedJob = cacheCsvJob_(body.payload || {});
      return jsonOutput_({
        ok: true,
        job: cachedJob,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveRecord") {
      var savedRecord = appendRecord_(body.payload || {});
      return jsonOutput_({
        ok: true,
        record: savedRecord,
        records: loadRecords_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "deleteRecord") {
      var deletedRecord = deleteRecord_(body.payload || {});
      return jsonOutput_({
        ok: true,
        deleted: deletedRecord,
        records: loadRecords_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveInspectionQty") {
      var savedInspectionRow = saveInspectionQty_(body.payload || {});
      return jsonOutput_({
        ok: true,
        row: savedInspectionRow,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveInspectionBatch") {
      var savedInspectionBatch = saveInspectionBatch_(body.rows || []);
      return jsonOutput_({
        ok: true,
        data: savedInspectionBatch,
        summary: getDashboardSummary_(),
      });
    }

    if (action === "saveBatch") {
      var batchData = saveBatch_(body.rows || []);
      return jsonOutput_({
        ok: true,
        data: batchData,
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "cancelMovementEvent") {
      var cancelled = cancelMovementEvent_(body.payload || {});
      return jsonOutput_({
        ok: true,
        deleted: cancelled,
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
        summary: getDashboardSummary_(),
      });
    }

    if (action === "downloadPhotoZip") {
      return jsonOutput_(Object.assign({ ok: true }, createPhotoZip_(body.payload || {})));
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

function normalizeText_(value) {
  return String(value == null ? "" : value).replace(/\uFEFF/g, "").trim();
}

function makeEntityKey_(jobKey, productCode, partnerName) {
  return [String(jobKey || "").trim(), normalizeCode_(productCode || ""), String(partnerName || "").trim()].join("||");
}

function makeSkuKey_(productCode, partnerName) {
  return [normalizeCode_(productCode || ""), normalizeText_(partnerName || "")].join("||");
}

function isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners) {
  var code = normalizeCode_(productCode || "");
  var partner = normalizeText_(partnerName || "");
  if (!code && !partner) return false;
  return !!excludedCodes[code] || !!excludedPairs[code + "||" + partner] || !!excludedPartners[partner];
}

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
  const parsedRows = Array.isArray(payload.parsed_rows) ? payload.parsed_rows : [];

  if (!jobKey) {
    throw new Error("job_key가 없습니다.");
  }

  const existingJob = findJobByKey_(jobsSheet, jobKey);
  if (existingJob) {
    var existingLoadedJob = loadJobRowsByKey_(ss, jobKey);
    updateInspectionDashboard_(ss);
    return existingLoadedJob;
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
  updateInspectionDashboard_(ss);
  autoResizeOperationalSheets_(ss);
  return job;
}

function loadLatestJob_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName(SHEET_NAMES.jobs);

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

function getRecordSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.records);
  migrateRecordSheetIfNeeded_(sheet);
  ensureHeaderRow_(sheet, recordHeaders_());
  return sheet;
}

function getInspectionSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.inspection);
  ensureHeaderRow_(sheet, inspectionHeaders_());
  return sheet;
}

function getInspectionSummarySheet_(ss) {
  return getOrCreateSheet_(ss, SHEET_NAMES.summary);
}

function pruneJobCacheRows_(cacheSheet) {
  if (!cacheSheet) return;
  var dataRowCount = Math.max(cacheSheet.getLastRow() - 1, 0);
  if (dataRowCount <= JOB_CACHE_MAX_DATA_ROWS) return;

  var deleteCount = dataRowCount - JOB_CACHE_MAX_DATA_ROWS;
  cacheSheet.deleteRows(2, deleteCount);
}

function autoResizeOperationalSheets_(ss) {
  var sheets = [
    ss.getSheetByName(SHEET_NAMES.inspection),
    ss.getSheetByName(SHEET_NAMES.records),
    ss.getSheetByName(SHEET_NAMES.summary),
    ss.getSheetByName(SHEET_NAMES.returnCenter),
    ss.getSheetByName(SHEET_NAMES.returnSummary),
  ];

  sheets.forEach(function (sheet) {
    if (!sheet || sheet.getLastColumn() <= 0) return;
    var dataRange = sheet.getDataRange();
    if (dataRange && dataRange.getNumRows() > 0 && dataRange.getNumColumns() > 0) {
      dataRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  });
}

function getDashboardSummary_() {
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

  return summary;
}

function loadRecords_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRecordSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

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
      if (row["사진링크"] && !row["사진URL"]) {
        row["사진URL"] = row["사진링크"];
      }
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

    if (hasValue) rows.push(row);
  }

  rows.sort(function (a, b) {
    return String(b["작성일시"] || "").localeCompare(String(a["작성일시"] || ""));
  });

  return rows;
}

function appendRecord_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordsSheet = getRecordSheet_(ss);
  const inspectionSheet = getInspectionSheet_(ss);
  const record = upsertMovementRow_(recordsSheet, payload || {});
  syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);
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

  sheet.deleteRow(rowNumber);
  syncInspectionMovementTotals_(getInspectionSheet_(ss), sheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);

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
  const recordsSheet = getRecordSheet_(ss);
  const saved = upsertInspectionRow_(inspectionSheet, payload || {});
  syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);
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

  syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);

  return {
    rows: saved,
  };
}

function saveBatch_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  const list = Array.isArray(rows) ? rows : [];
  const inspectionRows = [];
  const movementRows = [];

  list.forEach(function (rawRow) {
    const row = rawRow || {};
    const type = String(row.type || "").trim();

    if (type === "inspection") {
      inspectionRows.push(upsertInspectionRow_(inspectionSheet, row));
      return;
    }

    if (type === "movement" || type === "return" || type === "exchange") {
      movementRows.push(upsertMovementRow_(recordsSheet, row));
    }
  });

  syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
  updateInspectionDashboard_(ss);
  syncReturnSheets_(ss);
  autoResizeOperationalSheets_(ss);

  return {
    inspectionRows: inspectionRows,
    movementRows: movementRows,
    records: loadRecords_(),
    inspectionRowsSnapshot: loadInspectionRows_(),
  };
}

function upsertInspectionRow_(sheet, payload) {
  const row = buildInspectionPayload_(payload || {});
  const targetRow = findInspectionRow_(sheet, row["작업기준일또는CSV식별값"], row["상품코드"], row["협력사명"]);
  if (targetRow > 0) {
    const existingValues = sheet.getRange(targetRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    row["사진링크"] = row["사진링크"] || String(existingValues[10] || "").trim();
    row["사진링크목록"] = mergePhotoLinks_(
      String(existingValues[11] || "").trim(),
      row["사진링크목록"],
      row["사진링크"]
    );
    row["사진파일ID목록"] = mergePhotoLinks_(
      String(existingValues[12] || "").trim(),
      row["사진파일ID목록"],
      ""
    );
  }
  writeInspectionRow_(sheet, targetRow, row);
  row.__rowNumber = targetRow > 0 ? targetRow : sheet.getLastRow();
  return row;
}

function upsertMovementRow_(sheet, payload) {
  const row = buildRecordPayload_(payload || {});
  const targetRow = findMovementRow_(
    sheet,
    row["작업기준일또는CSV식별값"],
    row["상품코드"],
    row["협력사명"],
    row["센터명"],
    row["처리유형"]
  );

  if (targetRow > 0) {
    const existing = readMovementRow_(sheet, targetRow);
    row["회송수량"] = parseNumber_(existing["회송수량"]) + parseNumber_(row["회송수량"]);
    row["교환수량"] = parseNumber_(existing["교환수량"]) + parseNumber_(row["교환수량"]);
    row["발주수량"] = parseNumber_(existing["발주수량"] || row["발주수량"]);
    row["총 발주 수량"] = parseNumber_(existing["총 발주 수량"] || row["총 발주 수량"]);
    row["비고"] = mergeTextValue_(existing["비고"], row["비고"]);
    row["사진링크"] = row["사진링크"] || existing["사진링크"] || "";
    row["사진링크목록"] = mergePhotoLinks_(existing["사진링크목록"], row["사진링크목록"], row["사진링크"]);
    row["사진파일ID목록"] = mergePhotoLinks_(
      existing["사진파일ID목록"],
      row["사진파일ID목록"],
      ""
    );
    writeRecordRow_(sheet, targetRow, row);
    row.__rowNumber = targetRow;
    return row;
  }

  writeRecordRow_(sheet, 0, row);
  row.__rowNumber = sheet.getLastRow();
  return row;
}

function findMovementRow_(sheet, jobKey, productCode, partnerName, centerName, typeName) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    const rowJobKey = String(values[i][1] || "").trim();
    const rowCode = normalizeCode_(values[i][3] || "");
    const rowCenter = String(values[i][4] || "").trim();
    const rowPartner = String(values[i][5] || "").trim();
    const rowType = String(values[i][9] || "").trim();

    if (
      rowJobKey === String(jobKey || "").trim() &&
      rowCode === normalizeCode_(productCode || "") &&
      rowCenter === String(centerName || "").trim() &&
      rowPartner === String(partnerName || "").trim() &&
      rowType === String(typeName || "").trim()
    ) {
      return i + 2;
    }
  }

  return 0;
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

function mergeTextValue_(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (left && right && left !== right) return left + "\n" + right;
  return right || left;
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

function findInspectionRow_(sheet, jobKey, productCode, partnerName) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

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

function buildInspectionPayload_(payload) {
  const photos = Array.isArray(payload["사진들"]) ? payload["사진들"] : [];
  const uploaded = photos.length ? savePhotosToDrive_(photos, payload["상품명"] || payload["productName"] || "검품") : [];
  const firstPhoto = uploaded.length ? uploaded[0].viewUrl : String(payload["사진링크"] || "").trim();
  const photoLinks = uploaded.length
    ? uploaded.map(function (item) {
        return item.viewUrl;
      })
    : splitPhotoSourceText_(payload["사진링크목록"]);
  const photoFileIds = uploaded.length
    ? uploaded.map(function (item) {
        return item.fileId;
      })
    : splitPhotoSourceText_(payload["사진파일ID목록"]);

  return {
    "작성일시": payload["작성일시"] || new Date().toISOString(),
    "작업기준일또는CSV식별값": payload["작업기준일또는CSV식별값"] || "",
    "상품코드": normalizeCode_(payload["상품코드"] || payload["productCode"] || ""),
    "상품명": payload["상품명"] || payload["productName"] || "",
    "협력사명": payload["협력사명"] || payload["partnerName"] || "",
    "전체발주수량": parseNumber_(payload["전체발주수량"] || payload["totalQty"] || payload["발주수량"] || 0),
    "발주수량": parseNumber_(payload["발주수량"] || payload["totalQty"] || payload["전체발주수량"] || 0),
    "검품수량": parseNumber_(payload["검품수량"] || payload["inspectionQty"] || 0),
    "회송수량": parseNumber_(payload["회송수량"] || 0),
    "교환수량": parseNumber_(payload["교환수량"] || 0),
    "사진링크": firstPhoto,
    "사진링크목록": photoLinks.join("\n"),
    "사진파일ID목록": photoFileIds.join("\n"),
  };
}

function buildRecordPayload_(payload) {
  const movementType = String(payload["movementType"] || "").trim().toUpperCase();
  const photos = Array.isArray(payload["사진들"]) ? payload["사진들"] : [];
  const uploaded = photos.length ? savePhotosToDrive_(photos, payload["상품명"] || payload["productName"] || "불량") : [];
  const firstPhoto = uploaded.length ? uploaded[0].viewUrl : "";
  const photoLinks = uploaded.map(function (item) {
    return item.viewUrl;
  });
  const photoFileIds = uploaded.map(function (item) {
    return item.fileId;
  });

  const record = {
    "작성일시": payload["작성일시"] || new Date().toISOString(),
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
    "사진링크": firstPhoto,
    "사진링크목록": photoLinks.join("\n"),
    "사진파일ID목록": photoFileIds.join("\n"),
    "총 발주 수량": parseNumber_(payload["전체발주수량"] || payload["totalQty"] || payload["발주수량"] || 0),
  };

  if (movementType === "RETURN") {
    record["처리유형"] = "회송";
    record["회송수량"] = parseNumber_(payload["qty"] || payload["회송수량"] || 0);
    record["교환수량"] = 0;
  } else if (movementType === "EXCHANGE") {
    record["처리유형"] = "교환";
    record["센터명"] = "";
    record["교환수량"] = parseNumber_(payload["qty"] || payload["교환수량"] || 0);
    record["회송수량"] = 0;
  } else if (!record["처리유형"]) {
    if (record["회송수량"] > 0) {
      record["처리유형"] = "회송";
    } else if (record["교환수량"] > 0) {
      record["처리유형"] = "교환";
      record["센터명"] = "";
    }
  }

  if (record["처리유형"] === "교환") {
    record["센터명"] = "";
  }

  record["사진URL"] = record["사진링크"];

  return record;
}

function writeInspectionRow_(sheet, targetRow, record) {
  const values = [[
    record["작성일시"],
    record["작업기준일또는CSV식별값"],
    record["상품코드"],
    record["상품명"],
    record["협력사명"],
    record["전체발주수량"],
    record["발주수량"],
    record["검품수량"],
    record["회송수량"],
    record["교환수량"],
    record["사진링크"],
    record["사진링크목록"],
    record["사진파일ID목록"],
  ]];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
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
    record["사진링크"],
    record["사진링크목록"],
    record["사진파일ID목록"],
    record["총 발주 수량"],
  ]];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

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
    values[i][8] = totals.returnQty;
    values[i][9] = totals.exchangeQty;
  }

  range.setValues(values);
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
    current[13] === "사진링크" &&
    current[15] === "총 발주 수량";

  if (isNewFormat || sheet.getLastRow() < 2) {
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
      photoLink,
      photoLink,
      "",
      row[16] || row[15] || 0,
    ];
  });

  ensureHeaderRow_(sheet, next);
  if (migrated.length) {
    sheet.getRange(2, 1, migrated.length, next.length).setValues(migrated);
  }
}

function inspectionHeaders_() {
  return [
    "작성일시",
    "작업기준일또는CSV식별값",
    "상품코드",
    "상품명",
    "협력사명",
    "전체발주수량",
    "발주수량",
    "검품수량",
    "회송수량",
    "교환수량",
    "사진링크",
    "사진링크목록",
    "사진파일ID목록",
  ];
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
    "사진링크",
    "사진링크목록",
    "사진파일ID목록",
    "총 발주 수량",
  ];
}

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

  purgeOldHappycallRows_(sheet, 30);

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
  return String(value || "").replace(/\s+/g, "").trim();
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
  };
  var latestJob = loadLatestJob_();
  var sourceRows = buildDashboardSourceRows_(latestJob ? latestJob.rows || [] : [], readReservationRows_());

  sourceRows.forEach(function (row) {
    var productCode = normalizeCode_(row.__productCode || getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    var productName = String(row.__productName || getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    var partnerName = String(row.__partner || getRowFieldValue_(row, ["협력사명", "협력사", "거래처명"]) || "").trim();
    var info = {
      majorCategory: String(getRowFieldValue_(row, ["대분류", "과채", "카테고리대", "대카테고리"]) || "").trim(),
      midCategory: String(getRowFieldValue_(row, ["중분류", "카테고리중", "중카테고리"]) || "").trim(),
      subCategory: String(getRowFieldValue_(row, ["소분류", "카테고리소", "소카테고리"]) || "").trim(),
      productName: productName,
      productCode: productCode,
      partnerName: partnerName,
    };
    var skuKey = makeSkuKey_(productCode, partnerName);
    var nameKey = normalizeHappycallMatchText_(productName);
    var namePartnerKey = normalizeHappycallMatchText_(productName) + "||" + normalizeHappycallMatchText_(partnerName);

    if (skuKey) index.bySku[skuKey] = info;
    if (productCode) index.byCode[productCode] = info;
    if (nameKey) index.byName[nameKey] = info;
    if (namePartnerKey !== "||") index.byNamePartner[namePartnerKey] = info;
  });

  return index;
}

function lookupHappycallCategoryInfo_(index, record) {
  var productCode = normalizeCode_(record.productCode || "");
  var productName = String(record.productName || "").trim();
  var partnerName = String(record.partnerName || "").trim();
  var skuKey = makeSkuKey_(productCode, partnerName);
  var nameKey = normalizeHappycallMatchText_(productName);
  var namePartnerKey = nameKey + "||" + normalizeHappycallMatchText_(partnerName);

  return (
    (skuKey && index.bySku[skuKey]) ||
    (productCode && index.byCode[productCode]) ||
    (namePartnerKey !== "||" && index.byNamePartner[namePartnerKey]) ||
    (nameKey && index.byName[nameKey]) || {
      majorCategory: "",
      midCategory: "",
      subCategory: "",
      productName: productName,
      productCode: productCode,
      partnerName: partnerName,
    }
  );
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

function purgeOldHappycallRows_(sheet, days) {
  if (!sheet || sheet.getLastRow() < 2) return 0;

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var rowNumbers = [];

  values.forEach(function (row, index) {
    var receivedAt = row[4] || "";
    if (!isHappycallWithinDays_(receivedAt, days)) {
      rowNumbers.push(index + 2);
    }
  });

  rowNumbers.reverse().forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });

  return rowNumbers.length;
}

function getHappycallAnalytics_() {
  var rows = loadHappycallRows_().filter(function (row) {
    return isHappycallWithinDays_(row["접수일시"] || row["생성일시"], 30);
  });
  var now = new Date();
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
      topProducts: aggregates.products.slice(0, 5),
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

    aggregates.products.slice(0, 5).forEach(function (item, index) {
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
      name: seed.name || "",
      productCode: seed.productCode || "",
      productName: seed.productName || seed.name || "",
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
        name: item.name || item.productName || item.key,
        productCode: item.productCode,
        productName: item.productName,
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

function savePhotosToDrive_(photos, baseName) {
  const list = Array.isArray(photos) ? photos : [];
  const saved = [];

  list.forEach(function (photo, index) {
    if (photo && photo.imageBase64) {
      saved.push(savePhotoToDrive_(photo, baseName, index));
    }
  });

  return saved;
}

function savePhotoToDrive_(photo, baseName, index) {
  const folderId = PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");

  if (!folderId) {
    throw new Error("사진 업로드 실패: PHOTO_FOLDER_ID가 설정되지 않았습니다.");
  }

  const folder = DriveApp.getFolderById(folderId);
  const safeBaseName = sanitizeFileName_(baseName || "상품");
  const extension = getExtensionFromMimeType_(photo.mimeType || "") || getExtensionFromFileName_(photo.fileName || "") || "jpg";
  const blob = Utilities.newBlob(
    Utilities.base64Decode(photo.imageBase64),
    photo.mimeType || "application/octet-stream",
    safeBaseName + (index > 0 ? "_" + (index + 1) : "") + "." + extension
  );

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const fileId = file.getId();
  const viewUrl = "https://drive.google.com/uc?export=view&id=" + fileId;

  return {
    fileId: fileId,
    viewUrl: viewUrl,
    driveUrl: file.getUrl(),
  };
}

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

function createPhotoZip_(payload) {
  var mode = String(payload.mode || "movement").trim();
  var records = mode === "inspection" ? loadInspectionRows_() : loadRecords_();
  var blobs = [];
  var usedNames = {};
  var skippedCount = 0;

  records.forEach(function (record) {
    var photos = getPhotoSourcesFromRecord_(record);
    if (!photos.length) return;

    if (mode === "inspection") {
      if (parseNumber_(record["검품수량"]) <= 0) return;
    } else {
    var hasMovement = isMovementRecord_(record);
    if (mode === "movement" && !hasMovement) return;
    if (mode !== "movement" && hasMovement) return;
    }

    photos.forEach(function (source, index) {
      try {
        var blob = getPhotoBlobFromSource_(source);
        if (!blob) {
          skippedCount += 1;
          return;
        }

        var baseName = sanitizeFileName_(record["상품명"] || "상품") + "_" + (index + 1);
        var count = (usedNames[baseName] || 0) + 1;
        usedNames[baseName] = count;
        var finalName =
          baseName + (count > 1 ? "_" + count : "") + "." + getBlobExtension_(blob, source);

        blobs.push(blob.setName(finalName));
      } catch (err) {
        skippedCount += 1;
      }
    });
  });

  var fileName =
    mode === "movement"
      ? "회송_교환_사진_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip"
      : mode === "inspection"
      ? "검품사진_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip"
      : "사진만있는상품_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip";

  if (!blobs.length) {
    return {
      fileName: fileName,
      mimeType: "application/zip",
      zipBase64: "",
      addedCount: 0,
      skippedCount: skippedCount,
    };
  }

  var zipBlob = Utilities.zip(blobs, fileName);
  return {
    fileName: fileName,
    mimeType: zipBlob.getContentType() || "application/zip",
    zipBase64: Utilities.base64Encode(zipBlob.getBytes()),
    addedCount: blobs.length,
    skippedCount: skippedCount,
  };
}

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

function getPhotoBlobFromSource_(source) {
  var text = extractImageFormulaUrl_(source);
  var driveId = extractGoogleDriveId_(text);

  if (driveId) {
    return DriveApp.getFileById(driveId).getBlob();
  }

  if (/^https?:\/\//i.test(text)) {
    var response = UrlFetchApp.fetch(text, {
      muteHttpExceptions: true,
      followRedirects: true,
    });

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return response.getBlob();
    }
  }

  return null;
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
  var excludeRows = readObjectsSheet_(SHEET_NAMES.exclude);
  var eventRows = readObjectsSheet_(SHEET_NAMES.event);

  var excludedCodes = {};
  var excludedPairs = {};
  var excludedPartners = {};

  excludeRows.forEach(function (row) {
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

function syncReturnSheets_(ss) {
  var centerSheet = getOrCreateSheet_(ss, SHEET_NAMES.returnCenter);
  var summarySheet = getOrCreateSheet_(ss, SHEET_NAMES.returnSummary);
  var latestJob = loadLatestJob_();
  var currentJobKey = latestJob && latestJob.job_key ? String(latestJob.job_key).trim() : "";
  var records = loadRecords_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var inspectionRows = loadInspectionRows_().filter(function (row) {
    return String(row["작업기준일또는CSV식별값"] || "").trim() === currentJobKey;
  });
  var memoMap = {};

  records.forEach(function (row) {
    var key = makeSkuKey_(row["상품코드"], row["협력사명"]);
    if (!key) return;
    memoMap[key] = mergeTextValue_(memoMap[key], row["비고"]);
  });

  ensureHeaderRow_(centerSheet, [
    "날짜",
    "협력사명",
    "상품코드",
    "상품명",
    "미출수량",
    "수주수량",
    "잔여수량",
    "센터",
    "상세",
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
  ]);

  clearSheetBody_(centerSheet, 9);
  clearSheetBody_(summarySheet, 14);

  var centerValues = records
    .filter(function (row) {
      return parseNumber_(row["회송수량"]) > 0;
    })
    .sort(compareRowsByPartnerAndName_)
    .map(function (row) {
      return [
        formatSheetDate_(row["작성일시"]),
        row["협력사명"] || "",
        row["상품코드"] || "",
        row["상품명"] || "",
        parseNumber_(row["회송수량"]),
        parseNumber_(row["발주수량"]),
        "",
        row["센터명"] || "",
        "검품 회송",
      ];
    });

  if (centerValues.length > 0) {
    centerSheet.getRange(2, 1, centerValues.length, 9).setValues(centerValues);
  }

  var summaryValues = inspectionRows
    .filter(function (row) {
      return (
        parseNumber_(row["검품수량"]) > 0 ||
        parseNumber_(row["회송수량"]) > 0 ||
        parseNumber_(row["교환수량"]) > 0
      );
    })
    .sort(compareRowsByPartnerAndName_)
    .map(function (row) {
      var inboundQty = parseNumber_(row["전체발주수량"] || row["발주수량"]);
      var inspectionQty = parseNumber_(row["검품수량"]);
      var exchangeQty = parseNumber_(row["교환수량"]);
      var returnQty = parseNumber_(row["회송수량"]);
      var defectRate = inspectionQty > 0 ? (exchangeQty + returnQty) / inspectionQty : 0;
      var memo = memoMap[makeSkuKey_(row["상품코드"], row["협력사명"])] || "";

      return [
        "",
        row["상품코드"] || "",
        row["협력사명"] || "",
        row["상품명"] || "",
        "",
        inboundQty,
        inspectionQty,
        inboundQty > 0 ? inspectionQty / inboundQty : 0,
        memo,
        defectRate,
        exchangeQty,
        returnQty,
        getActionTypeByDefectRate_(defectRate),
        "",
      ];
    });

  if (summaryValues.length > 0) {
    summarySheet.getRange(2, 1, summaryValues.length, 14).setValues(summaryValues);
    summarySheet.getRange(2, 8, summaryValues.length, 1).setNumberFormat("0.0%");
    summarySheet.getRange(2, 10, summaryValues.length, 1).setNumberFormat("0.0%");
  }

  centerSheet.autoResizeColumns(1, 9);
  summarySheet.autoResizeColumns(1, 14);
}

function compareRowsByPartnerAndName_(a, b) {
  var partnerA = String(a["협력사명"] || "").trim();
  var partnerB = String(b["협력사명"] || "").trim();
  var partnerCompare = partnerA.localeCompare(partnerB, "ko");
  if (partnerCompare !== 0) return partnerCompare;
  return String(a["상품명"] || "").trim().localeCompare(String(b["상품명"] || "").trim(), "ko");
}

function clearSheetBody_(sheet, width) {
  if (!sheet || sheet.getLastRow() < 2) return;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
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

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
