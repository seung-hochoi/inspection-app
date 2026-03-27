const SHEET_NAMES = {
  exclude: "제외목록",
  event: "행사표",
  reservation: "사전예약",
  jobs: "jobs",
  jobCache: "job_cache",
  records: "return_exchange_records",
  inspection: "inspection_data",
};
const ADMIN_RESET_PASSWORD = "0000";

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
          },
          current_job: loadLatestJob_(),
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
      return jsonOutput_({
        ok: true,
        job: cacheCsvJob_(body.payload || {}),
      });
    }

    if (action === "saveRecord") {
      return jsonOutput_({
        ok: true,
        record: appendRecord_(body.payload || {}),
        records: loadRecords_(),
      });
    }

    if (action === "deleteRecord") {
      return jsonOutput_({
        ok: true,
        deleted: deleteRecord_(body.payload || {}),
        records: loadRecords_(),
      });
    }

    if (action === "saveInspectionQty") {
      return jsonOutput_({
        ok: true,
        row: saveInspectionQty_(body.payload || {}),
      });
    }

    if (action === "saveInspectionBatch") {
      return jsonOutput_({
        ok: true,
        data: saveInspectionBatch_(body.rows || []),
      });
    }

    if (action === "saveBatch") {
      return jsonOutput_({
        ok: true,
        data: saveBatch_(body.rows || []),
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
      });
    }

    if (action === "cancelMovementEvent") {
      return jsonOutput_({
        ok: true,
        deleted: cancelMovementEvent_(body.payload || {}),
        records: loadRecords_(),
        inspectionRows: loadInspectionRows_(),
      });
    }

    if (action === "downloadPhotoZip") {
      return jsonOutput_(Object.assign({ ok: true }, createPhotoZip_(body.payload || {})));
    }

    if (action === "resetCurrentJobInputData") {
      return jsonOutput_(resetCurrentJobInputData_(body.payload || {}));
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

function makeEntityKey_(jobKey, productCode, partnerName) {
  return [String(jobKey || "").trim(), normalizeCode_(productCode || ""), String(partnerName || "").trim()].join("||");
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
    return loadJobRowsByKey_(ss, jobKey);
  }

  const now = new Date().toISOString();

  jobsSheet.appendRow([now, jobKey, sourceFileName, sourceFileModified, parsedRows.length]);

  if (parsedRows.length > 0) {
    const values = parsedRows.map(function (row, idx) {
      return [now, jobKey, idx, JSON.stringify(row)];
    });

    cacheSheet.getRange(cacheSheet.getLastRow() + 1, 1, values.length, 4).setValues(values);
  }

  var job = loadJobRowsByKey_(ss, jobKey);
  updateInspectionDashboard_(ss);
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
    row["사진미리보기"] =
      row["사진링크"] || existing["사진링크"]
        ? `=IMAGE("${row["사진링크"] || existing["사진링크"]}")`
        : existing["사진미리보기"] || "";
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
  };
}

function buildRecordPayload_(payload) {
  const movementType = String(payload["movementType"] || "").trim().toUpperCase();
  const photos = Array.isArray(payload["사진들"]) ? payload["사진들"] : [];
  const uploaded = photos.length ? savePhotosToDrive_(photos) : [];
  const firstPhoto = uploaded.length ? uploaded[0].viewUrl : "";
  const photoLinks = uploaded.map(function (item) {
    return item.viewUrl;
  });
  const photoFormula = photoLinks.length ? `=IMAGE("${photoLinks[0]}")` : "";

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
    "사진미리보기": photoFormula,
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
    record["사진미리보기"],
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
    current[16] === "총 발주 수량";

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
      row[15] || (photoLink ? `=IMAGE("${photoLink}")` : ""),
      row[16] || 0,
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
    "사진미리보기",
    "총 발주 수량",
  ];
}

function savePhotosToDrive_(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const saved = [];

  list.forEach(function (photo) {
    if (photo && photo.imageBase64) {
      saved.push(savePhotoToDrive_(photo));
    }
  });

  return saved;
}

function savePhotoToDrive_(photo) {
  const folderId = PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");

  if (!folderId) {
    throw new Error("사진 업로드 실패: PHOTO_FOLDER_ID가 설정되지 않았습니다.");
  }

  const folder = DriveApp.getFolderById(folderId);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(photo.imageBase64),
    photo.mimeType || "application/octet-stream",
    photo.fileName || ("photo_" + new Date().getTime())
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
    sheet = ss.insertSheet(name);
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
  var records = loadRecords_();
  var blobs = [];
  var usedNames = {};
  var skippedCount = 0;

  records.forEach(function (record) {
    var photos = getPhotoSourcesFromRecord_(record);
    if (!photos.length) return;

    var hasMovement = isMovementRecord_(record);
    if (mode === "movement" && !hasMovement) return;
    if (mode !== "movement" && hasMovement) return;

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
    .concat([record["사진URL"], record["사진링크"], record["사진미리보기"]])
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
  var resetInspectionCount = resetInspectionRowsByJobKey_(inspectionSheet, jobKey);
  updateInspectionDashboard_(ss);

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

function updateInspectionDashboard_(ss) {
  var inspectionSheet = getInspectionSheet_(ss);
  if (!inspectionSheet) return;

  var inspectionRows = loadInspectionRows_();
  var recordRows = loadRecords_();
  var excludeRows = readObjectsSheet_(SHEET_NAMES.exclude);
  var eventRows = readObjectsSheet_(SHEET_NAMES.event);
  var reservationRows = readObjectsSheet_(SHEET_NAMES.reservation);

  var excludedCodes = {};
  var excludedPairs = {};

  excludeRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    var partner = String(row["협력사"] || row["협력사명"] || "").trim();
    if (!code) return;
    if (partner) {
      excludedPairs[code + "||" + partner] = true;
    } else {
      excludedCodes[code] = true;
    }
  });

  var eventCodes = {};
  eventRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    if (code) {
      eventCodes[code] = true;
    }
  });

  var costMap = {};
  reservationRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    var partner = String(row["협력사명"] || row["협력사"] || "").trim();
    var cost = parseNumber_(row["입고원가"] || row["원가"] || 0);
    if (!code || cost <= 0) return;
    costMap[code + "||" + partner] = cost;
    if (!costMap[code]) {
      costMap[code] = cost;
    }
  });

  var totalInboundAmount = 0;
  var totalInboundQty = 0;
  var targetInboundAmount = 0;
  var targetInboundQty = 0;
  var totalSkuMap = {};
  var targetSkuMap = {};
  var inspectedSkuMap = {};
  var realInspectedSkuMap = {};
  var eventSkuMap = {};
  var returnQtyTotal = 0;
  var exchangeQtyTotal = 0;

  inspectionRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"]);
    var partner = String(row["협력사명"] || "").trim();
    var qty = parseNumber_(row["발주수량"] || 0);
    var inspectionQty = parseNumber_(row["검품수량"] || 0);
    var returnQty = parseNumber_(row["회송수량"] || 0);
    var exchangeQty = parseNumber_(row["교환수량"] || 0);
    var pairKey = code + "||" + partner;
    var cost = parseNumber_(costMap[pairKey] || costMap[code] || 0);
    var excluded = !!excludedCodes[code] || !!excludedPairs[pairKey];

    if (code) {
      totalSkuMap[code] = true;
      if (eventCodes[code]) {
        eventSkuMap[code] = true;
      }
    }

    totalInboundQty += qty;
    totalInboundAmount += qty * cost;

    if (excluded) return;

    targetInboundQty += qty;
    targetInboundAmount += qty * cost;
    returnQtyTotal += returnQty;
    exchangeQtyTotal += exchangeQty;

    if (code) {
      targetSkuMap[code] = true;
      if (inspectionQty > 0) {
        inspectedSkuMap[code] = true;
      }
      if (Math.max(inspectionQty - returnQty - exchangeQty, 0) > 0) {
        realInspectedSkuMap[code] = true;
      }
    }
  });

  var inspectionQtyTotal = 0;
  var realInspectionQtyTotal = 0;
  inspectionRows.forEach(function (row) {
    var code = normalizeCode_(row["상품코드"]);
    var partner = String(row["협력사명"] || "").trim();
    var pairKey = code + "||" + partner;
    var excluded = !!excludedCodes[code] || !!excludedPairs[pairKey];
    if (excluded) return;

    var inspectionQty = parseNumber_(row["검품수량"] || 0);
    var returnQty = parseNumber_(row["회송수량"] || 0);
    var exchangeQty = parseNumber_(row["교환수량"] || 0);
    inspectionQtyTotal += inspectionQty;
    realInspectionQtyTotal += Math.max(inspectionQty - returnQty - exchangeQty, 0);
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
  var realInspectedSkuCount = Object.keys(realInspectedSkuMap).length;
  var eventSkuCount = Object.keys(eventSkuMap).length;

  var values = [
    ["총 입고금액", "총 입고수량", "검품 수량", "검품율", "실 검품율", "최근 갱신"],
    [
      totalInboundAmount,
      totalInboundQty,
      inspectionQtyTotal,
      targetInboundQty > 0 ? inspectionQtyTotal / targetInboundQty : 0,
      targetInboundQty > 0 ? realInspectionQtyTotal / targetInboundQty : 0,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
    ],
    ["검품 입고금액", "입고 SKU", "검품 SKU", "SKU 커버리지", "검품 입고 SKU", "실제 SKU 커버리지"],
    [
      targetInboundAmount,
      totalSkuCount,
      inspectedSkuCount,
      targetSkuCount > 0 ? inspectedSkuCount / targetSkuCount : 0,
      targetSkuCount,
      targetSkuCount > 0 ? realInspectedSkuCount / targetSkuCount : 0,
    ],
    ["행사 SKU", "검품 대상 SKU", "검품 입고수량", "회송 수량", "교환 수량", "사진 기록 건수"],
    [
      eventSkuCount,
      targetSkuCount,
      targetInboundQty,
      returnQtyTotal,
      exchangeQtyTotal,
      photoRecordCount,
    ],
  ];

  inspectionSheet.getRange("L2:Q7").setValues(values);
  inspectionSheet.getRange("L2:Q2").setBackground("#c6efce").setFontWeight("bold");
  inspectionSheet.getRange("L4:Q4").setBackground("#fff2cc").setFontWeight("bold");
  inspectionSheet.getRange("L6:Q6").setBackground("#d9ead3").setFontWeight("bold");
  inspectionSheet.getRange("L3:Q3").setNumberFormats([["#,##0", "#,##0", "#,##0", "0.0%", "0.0%", "@"]]);
  inspectionSheet.getRange("L5:Q5").setNumberFormats([["#,##0", "#,##0", "#,##0", "0.0%", "#,##0", "0.0%"]]);
  inspectionSheet.getRange("L7:Q7").setNumberFormats([["#,##0", "#,##0", "#,##0", "#,##0", "#,##0", "#,##0"]]);
  inspectionSheet.autoResizeColumns(12, 6);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
