const SHEET_NAMES = {
  exclude: "제외목록",
  event: "행사표",
  jobs: "jobs",
  jobCache: "job_cache",
  records: "return_exchange_records",
  inspection: "inspection_data",
};

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
      });
    }

    if (action === "deleteRecord") {
      return jsonOutput_({
        ok: true,
        deleted: deleteRecord_(body.payload || {}),
      });
    }

    if (action === "cancelMovementEvent") {
      return jsonOutput_({
        ok: true,
        deleted: cancelMovementEvent_(body.payload || {}),
      });
    }

    if (action === "saveBatch") {
      return jsonOutput_({
        ok: true,
        data: saveBatch_(body.rows || []),
        records: loadRecords_(),
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
  const jobsSheet = getOrCreateSheet_(ss, SHEET_NAMES.jobs, [
    "created_at",
    "job_key",
    "source_file_name",
    "source_file_modified",
    "row_count",
  ]);
  const cacheSheet = getOrCreateSheet_(ss, SHEET_NAMES.jobCache, [
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

  return loadJobRowsByKey_(ss, jobKey);
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

function loadRecords_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.records);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (header) {
    return String(header || "").trim();
  });

  const rows = [];

  for (var r = 1; r < values.length; r += 1) {
    const row = {
      __rowNumber: r + 1,
    };
    var hasValue = false;

    for (var c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;
      const value = values[r][c];
      if (value !== "") hasValue = true;
      row[header] = value;
    }

    if (hasValue) {
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["작성일시"] || "").localeCompare(String(a["작성일시"] || ""));
  });

  return rows;
}

function appendRecord_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, SHEET_NAMES.records, recordHeaders_());
  const record = buildRecordPayload_(payload || {});

  writeRecordRow_(sheet, 0, record);
  record.__rowNumber = sheet.getLastRow();
  return record;
}

function deleteRecord_(payload) {
  const rowNumber = Number(payload.rowNumber || 0);
  if (!rowNumber || rowNumber <= 1) {
    throw new Error("삭제할 행 번호가 올바르지 않습니다.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.records);

  if (!sheet) {
    throw new Error("기록 시트를 찾을 수 없습니다.");
  }

  if (rowNumber > sheet.getLastRow()) {
    throw new Error("이미 삭제되었거나 존재하지 않는 행입니다.");
  }

  sheet.deleteRow(rowNumber);

  return {
    rowNumber: rowNumber,
  };
}

function cancelMovementEvent_(payload) {
  return deleteRecord_(payload);
}

function saveBatch_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getOrCreateSheet_(ss, SHEET_NAMES.inspection, inspectionHeaders_());
  const recordsSheet = getOrCreateSheet_(ss, SHEET_NAMES.records, recordHeaders_());
  const list = Array.isArray(rows) ? rows : [];

  list.forEach(function (rawRow) {
    const row = rawRow || {};
    const type = String(row.type || "").trim();

    if (type === "inspection") {
      upsertInspectionRow_(inspectionSheet, row);
      return;
    }

    if (type === "movement" || type === "return" || type === "exchange") {
      appendMovementRow_(recordsSheet, row);
    }
  });

  return {
    records: loadRecords_(),
  };
}

function upsertInspectionRow_(sheet, payload) {
  const row = buildInspectionPayload_(payload);
  const targetRow = findInspectionRow_(
    sheet,
    row["작업기준일또는CSV식별값"],
    row["상품코드"],
    row["협력사명"]
  );
  writeInspectionRow_(sheet, targetRow, row);
  row.__rowNumber = targetRow > 0 ? targetRow : sheet.getLastRow();
  return row;
}

function appendMovementRow_(sheet, payload) {
  const row = buildRecordPayload_(payload);
  writeRecordRow_(sheet, 0, row);
  row.__rowNumber = sheet.getLastRow();
  return row;
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
    "상품코드": normalizeCode_(payload["상품코드"] || ""),
    "상품명": payload["상품명"] || "",
    "협력사명": payload["협력사명"] || "",
    "전체발주수량": Number(payload["전체발주수량"] || payload["발주수량"] || 0),
    "발주수량": Number(payload["발주수량"] || payload["전체발주수량"] || 0),
    "검품수량": Number(payload["검품수량"] || 0),
    "회송수량": Number(payload["회송수량"] || 0),
    "교환수량": Number(payload["교환수량"] || 0),
  };
}

function buildRecordPayload_(payload) {
  const record = {
    "작성일시": payload["작성일시"] || new Date().toISOString(),
    "작업기준일또는CSV식별값": payload["작업기준일또는CSV식별값"] || "",
    "상품명": payload["상품명"] || "",
    "상품코드": normalizeCode_(payload["상품코드"] || ""),
    "센터명": payload["센터명"] || "",
    "협력사명": payload["협력사명"] || "",
    "발주수량": Number(payload["발주수량"] || 0),
    "행사여부": payload["행사여부"] || "",
    "행사명": payload["행사명"] || "",
    "처리유형": payload["처리유형"] || "",
    "movementType": payload["movementType"] || "",
    "회송수량": Number(payload["회송수량"] || 0),
    "교환수량": Number(payload["교환수량"] || 0),
    "비고": payload["비고"] || "",
    "사진URL": payload["사진URL"] || "",
    "사진미리보기": payload["사진미리보기"] || "",
    "전체발주수량": Number(payload["전체발주수량"] || payload["발주수량"] || 0),
  };

  const photo = payload["사진"] || null;
  if (photo && photo.imageBase64) {
    const photoInfo = savePhotoToDrive_(photo);
    record["사진URL"] = photoInfo.viewUrl;
    record["사진미리보기"] = `=IMAGE("${photoInfo.viewUrl}")`;
  }

  if (!record["처리유형"]) {
    if (record["회송수량"] > 0) {
      record["처리유형"] = "회송";
    } else if (record["교환수량"] > 0) {
      record["처리유형"] = "교환";
    }
  }

  if (record["처리유형"] === "교환") {
    record["센터명"] = "";
  }

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
    record["행사여부"],
    record["행사명"],
    record["처리유형"],
    record["movementType"],
    record["회송수량"],
    record["교환수량"],
    record["비고"],
    record["사진URL"],
    record["사진미리보기"],
    record["전체발주수량"],
  ]];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
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
    "행사여부",
    "행사명",
    "처리유형",
    "movementType",
    "회송수량",
    "교환수량",
    "비고",
    "사진URL",
    "사진미리보기",
    "전체발주수량",
  ];
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

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (headers && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return sheet;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
