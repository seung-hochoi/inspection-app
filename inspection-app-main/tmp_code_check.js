const SHEET_NAMES = {
  exclude: "?쒖쇅紐⑸줉",
  event: "?됱궗??,
  mapping: "留ㅽ븨",
  reservation: "?ъ쟾?덉빟異붽?",
  jobs: "jobs",
  jobCache: "job_cache",
  records: "return_exchange_records",
  inspection: "inspection_data",
  summary: "inspection_summary",
  returnCenter: "寃???뚯넚?댁뿭 (?쇳꽣?ы븿)",
  returnSummary: "寃???뚯넚?댁뿭 (?쇳꽣誘명룷??",
  happycall: "happycall_data",
  productImages: "product_image_map",
  photoAssets: "photo_assets",
  editLocks: "edit_locks",
  operationLog: "operation_log",
};
const ADMIN_RESET_PASSWORD = "0000";
const JOB_CACHE_MAX_DATA_ROWS = 30000;
const EDIT_LOCK_TTL_MS = 90 * 1000;
const PHOTO_ZIP_MAX_BYTES = 20 * 1024 * 1024;
var operationalReferenceCache_ = null;

function getOperationalMappingSheet_(ss) {
  var direct =
    ss.getSheetByName(SHEET_NAMES.mapping) ||
    ss.getSheetByName("留ㅽ븨湲곗???) ||
    ss.getSheetByName("湲곗???);

  if (direct) {
    return direct;
  }

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i += 1) {
    var sheet = sheets[i];
    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 8) continue;
    var header = sheet.getRange(1, 1, 1, 8).getValues()[0];
    if (
      String(header[0] || "").trim() === "?뚮텇瑜섎챸" &&
      String(header[1] || "").trim() === "?遺꾨쪟" &&
      String(header[6] || "").trim() === "?묐젰?? &&
      String(header[7] || "").trim() === "媛?
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
  if (text === "梨꾩냼" || text === "怨쇱씪" || text === "異뺤궛" || text === "?섏궛") {
    return text;
  }
  return "誘몃텇瑜?;
}

function getOperationalMajorCategoryPriority_(value) {
  var category = normalizeOperationalMajorCategory_(value);
  if (category === "梨꾩냼") return 1;
  if (category === "怨쇱씪") return 2;
  if (category === "異뺤궛") return 3;
  if (category === "?섏궛") return 4;
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
    return { subCategory: "", majorCategory: "誘몃텇瑜? };
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
    return { subCategory: "", majorCategory: "誘몃텇瑜? };
  }

  return {
    subCategory: bestMatch.raw,
    majorCategory: bestMatch.majorCategory || "誘몃텇瑜?,
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
    var productCode = normalizeCode_(getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??]));
    var productName = String(getRowFieldValue_(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || "").trim();
    var nameKey = normalizeText_(productName);
    var subCategory = normalizeOperationalLookupText_(
      getRowFieldValue_(row, ["?뚮텇瑜섎챸", "?뚮텇瑜?, "移댄뀒怨좊━??, "?뚯뭅?뚭퀬由?, "以묐텇瑜섎챸", "以묐텇瑜?])
    );
    var inferredMeta = inferOperationalMetaFromProductName_(productName, maps);
    if (!subCategory && inferredMeta.subCategory) {
      subCategory = inferredMeta.subCategory;
    }
    var majorCategory =
      normalizeOperationalMajorCategory_(
        getRowFieldValue_(row, ["?遺꾨쪟", "移댄뀒怨좊━?", "?移댄뀒怨좊━", "怨쇱콈"])
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
      majorCategory: majorCategory || "誘몃텇瑜?,
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
    majorCategory: "誘몃텇瑜?,
    productOrder: 999999,
    sourceIndex: 999999,
  };
}

function buildOperationalSortContext_(row, productMetaMap, originalOrder) {
  var productCode = normalizeCode_(row["?곹뭹肄붾뱶"] || row["?곹뭹 肄붾뱶"] || row["肄붾뱶"] || row["諛붿퐫??]);
  var productName = String(row["?곹뭹紐?] || row["?곹뭹 紐?] || row["?덈ぉ紐?] || row["?덈챸"] || "").trim();
  var meta = getOperationalProductMeta_(productMetaMap, productCode, productName);

  return {
    majorCategory: meta.majorCategory || "誘몃텇瑜?,
    majorPriority: getOperationalMajorCategoryPriority_(meta.majorCategory || "誘몃텇瑜?),
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

  function doGet(e) {
    try {
      const action = (e && e.parameter && e.parameter.action) || "bootstrap";

      if (action === "bootstrap") {
        var latestJobResult = tryLoadLatestJobWithError_();
        return jsonOutput_({
          ok: true,
        data: {
          config: {
            exclude_rows: readObjectsSheet_(SHEET_NAMES.exclude),
            event_rows: readObjectsSheet_(SHEET_NAMES.event),
            reservation_rows: readReservationRows_(),
          },
          current_job: latestJobResult.job,
          current_job_load_error: latestJobResult.error,
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

    if (action === "getEditLocks") {
      return jsonOutput_({
        ok: true,
        locks: loadEditLocks_(),
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
      message: "吏?먰븯吏 ?딅뒗 action?낅땲??",
    });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: err.message || "GET ?ㅽ뙣",
    });
  }
}

function shouldUseScriptLockForAction_(action) {
  return [
    "cacheCsv",
    "saveRecord",
    "deleteRecord",
    "saveInspectionQty",
    "saveInspectionBatch",
    "saveBatch",
    "postSaveSync",
    "cancelMovementEvent",
    "savePhotoMeta",
    "acquireEditLock",
    "heartbeatEditLock",
    "releaseEditLock",
    "resetCurrentJobInputData",
    "importHappycallEmails",
    "importHappycallCsv",
    "saveProductImageMapping",
  ].indexOf(String(action || "").trim()) >= 0;
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw);
    const action = body.action || "";
    const execute = function () {

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
          record: savedRecord.record,
          hasInspection: savedRecord.hasInspection,
          hasMovement: savedRecord.hasMovement,
          summary: getDashboardSummary_(),
          syncDeferred: savedRecord.syncDeferred,
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
          row: savedInspectionRow.row,
          hasInspection: savedInspectionRow.hasInspection,
          hasMovement: savedInspectionRow.hasMovement,
          summary: getDashboardSummary_(),
          syncDeferred: savedInspectionRow.syncDeferred,
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
        });
      }

      if (action === "postSaveSync") {
        var syncData = postSaveSync_(body.payload || {});
        return jsonOutput_({
          ok: true,
          data: syncData,
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
          data: importHappycallBatch_(decodeHappycallRowsPayload_(body)),
          happycall: getHappycallAnalytics_(),
        });
      }

      if (action === "importHappycallCsv") {
        return jsonOutput_({
          ok: true,
          data: importHappycallCsvRows_(decodeHappycallRowsPayload_(body)),
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
        var photoPayload = body.payload || {};
        var uploadOperationId = String(photoPayload.operationId || "").trim();
        var cachedUpload = loadOperationResult_("uploadPhotos", uploadOperationId);
        if (cachedUpload) {
          return jsonOutput_({
            ok: true,
            data: cachedUpload,
            deduped: true,
          });
        }
        var uploadData = uploadPhotos_(photoPayload);
        saveOperationResult_("uploadPhotos", uploadOperationId, photoPayload.itemKey || "", uploadData);
        return jsonOutput_({
          ok: true,
          data: uploadData,
        });
      }

      if (action === "savePhotoMeta") {
        var metaPayload = body.payload || {};
        var metaOperationId = String(metaPayload.operationId || "").trim();
        var cachedMeta = loadOperationResult_("savePhotoMeta", metaOperationId);
        if (cachedMeta) {
          return jsonOutput_({
            ok: true,
            data: cachedMeta,
            deduped: true,
          });
        }
        var metaData = savePhotoMeta_(metaPayload);
        saveOperationResult_("savePhotoMeta", metaOperationId, metaPayload.key || "", metaData);
        return jsonOutput_({
          ok: true,
          data: metaData,
        });
      }

      if (action === "acquireEditLock" || action === "heartbeatEditLock") {
        return jsonOutput_(upsertEditLock_(body.payload || {}));
      }

      if (action === "releaseEditLock") {
        return jsonOutput_(releaseEditLock_(body.payload || {}));
      }

      return jsonOutput_({
        ok: false,
        message: "吏?먰븯吏 ?딅뒗 action?낅땲??",
      });
    };

    if (!shouldUseScriptLockForAction_(action)) {
      return execute();
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      return execute();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput_({
      ok: false,
      message: err.message || "POST ?ㅽ뙣",
    });
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

function formatWrittenAtKst_(value) {
  var date = value ? new Date(value) : new Date();
  if (String(date) === "Invalid Date") {
    date = new Date();
  }

  var timezone = "Asia/Seoul";
  var weekdayMap = {
    "1": "??,
    "2": "??,
    "3": "??,
    "4": "紐?,
    "5": "湲?,
    "6": "??,
    "7": "??,
  };
  var weekdayNumber = Utilities.formatDate(date, timezone, "u");
  var weekdayLabel = weekdayMap[weekdayNumber] || "??;

  return Utilities.formatDate(date, timezone, "MM.dd") + "(" + weekdayLabel + ") " +
    Utilities.formatDate(date, timezone, "HH:mm:ss");
}

function normalizeText_(value) {
  return String(value == null ? "" : value).replace(/\uFEFF/g, "").trim();
}

function decodeUtf8Base64JsonRows_(encodedRows) {
  return (Array.isArray(encodedRows) ? encodedRows : [])
    .map(function (item, index) {
      try {
        var decoded = Utilities.newBlob(Utilities.base64Decode(String(item || ""))).getDataAsString("UTF-8");
        return JSON.parse(decoded);
      } catch (err) {
        throw new Error("CSV ??蹂듭썝 ?ㅽ뙣: row_index=" + index + ", " + (err && err.message ? String(err.message) : "decode error"));
      }
    });
}

function decodeHappycallRowsPayload_(body) {
  if (Array.isArray(body && body.rows_base64)) {
    return decodeUtf8Base64JsonRows_(body.rows_base64);
  }
  return body.rows || body.payload || [];
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

function operationLogHeaders_() {
  return ["operationId", "action", "itemKey", "status", "responseJson", "createdAt", "updatedAt"];
}

function getOperationLogSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.operationLog);
  ensureHeaderRow_(sheet, operationLogHeaders_());
  return sheet;
}

function findOperationLogRow_(sheet, operationId) {
  if (!sheet || sheet.getLastRow() < 2 || !operationId) return 0;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || "").trim() === operationId) {
      return i + 2;
    }
  }
  return 0;
}

function loadOperationResult_(action, operationId) {
  if (!operationId) return null;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOperationLogSheet_(ss);
  var rowNumber = findOperationLogRow_(sheet, operationId);
  if (!rowNumber) return null;
  var row = sheet.getRange(rowNumber, 1, 1, operationLogHeaders_().length).getValues()[0];
  if (String(row[1] || "").trim() !== String(action || "").trim()) return null;
  var status = String(row[3] || "").trim();
  var responseJson = String(row[4] || "").trim();
  if (status !== "success" || !responseJson) return null;
  try {
    return JSON.parse(responseJson);
  } catch (_) {
    return null;
  }
}

function saveOperationResult_(action, operationId, itemKey, responsePayload) {
  if (!operationId) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOperationLogSheet_(ss);
  var rowNumber = findOperationLogRow_(sheet, operationId);
  var now = new Date().toISOString();
  var values = [
    operationId,
    action || "",
    itemKey || "",
    "success",
    JSON.stringify(responsePayload || {}),
    now,
    now,
  ];

  if (rowNumber) {
    var existingCreatedAt = sheet.getRange(rowNumber, 6).getValue();
    if (existingCreatedAt) values[5] = existingCreatedAt;
    sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
    return;
  }

  sheet.appendRow(values);
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
      if (row["?곹뭹肄붾뱶"] !== undefined) {
        row["?곹뭹肄붾뱶"] = normalizeCode_(row["?곹뭹肄붾뱶"]);
      }
      if (row["?묐젰??] !== undefined) {
        row["?묐젰??] = String(row["?묐젰??] || "").trim();
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
  return readObjectsSheet_("?ъ쟾?덉빟");
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
  const parsedRows = Array.isArray(payload.parsed_rows_base64)
    ? decodeUtf8Base64JsonRows_(payload.parsed_rows_base64)
    : (Array.isArray(payload.parsed_rows) ? payload.parsed_rows : []);

  if (!jobKey) {
    throw new Error("job_key媛 ?놁뒿?덈떎.");
  }

  if (isNonOperationalJob_(jobKey, sourceFileName)) {
    return {
      job_key: jobKey,
      source_file_name: sourceFileName,
      source_file_modified: sourceFileModified,
      created_at: new Date().toISOString(),
      rows: parsedRows,
    };
  }

  const existingJob = findJobByKey_(jobsSheet, jobKey);
  if (existingJob) {
      return loadJobRowsByKey_(ss, jobKey);
  }

  const now = new Date().toISOString();

  jobsSheet.appendRow([now, jobKey, sourceFileName, sourceFileModified, parsedRows.length]);
  verifyCachedJobMeta_(jobsSheet, jobKey, sourceFileName, parsedRows.length);

  if (parsedRows.length > 0) {
    const values = parsedRows.map(function (row, idx) {
      return [now, jobKey, idx, JSON.stringify(row)];
    });

    cacheSheet.getRange(cacheSheet.getLastRow() + 1, 1, values.length, 4).setValues(values);
    pruneJobCacheRows_(cacheSheet);
    seedInspectionRowsForJob_(ss, jobKey, parsedRows, now);
  }

  verifyCachedJobRows_(cacheSheet, jobKey, parsedRows.length);

  return loadJobRowsByKey_(ss, jobKey);
}

function seedInspectionRowsForJob_(ss, jobKey, parsedRows, nowIso) {
  if (!jobKey || !Array.isArray(parsedRows) || !parsedRows.length) return;

  var inspectionSheet = getInspectionSheet_(ss);
  var grouped = {};

  parsedRows.forEach(function (row) {
    var productCode = normalizeCode_(getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??]));
    var productName = String(getRowFieldValue_(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || "").trim();
    var partnerName = String(
      getRowFieldValue_(row, ["?묐젰?щ챸", "?묐젰??, "嫄곕옒泥섎챸", "嫄곕옒泥섎챸(援щℓ議곌굔紐?"]) || ""
    ).trim();
    var qty = parseNumber_(getRowFieldValue_(row, ["諛쒖＜?섎웾", "?섎웾"]) || 0);
    if (!productCode) return;

    var key = [String(jobKey || "").trim(), productCode, partnerName].join("||");
    if (!grouped[key]) {
      grouped[key] = {
        "?묒꽦?쇱떆": nowIso,
        "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?: jobKey,
        "?곹뭹肄붾뱶": productCode,
        "?곹뭹紐?: productName,
        "?묐젰?щ챸": partnerName,
        "?꾩껜諛쒖＜?섎웾": 0,
        "諛쒖＜?섎웾": 0,
        "寃?덉닔??: 0,
        "?뚯넚?섎웾": 0,
        "援먰솚?섎웾": 0,
        "?ъ쭊媛쒖닔": 0,
        "?섏젙?쇱떆": nowIso,
        "?섏젙??: "system",
        "?섏젙?륤D": "system",
        "?ъ쭊?섏젙?쇱떆": "",
        "?ъ쭊?섏젙??: "",
        "踰꾩쟾": 1,
      };
    }

    grouped[key]["?꾩껜諛쒖＜?섎웾"] += qty;
    grouped[key]["諛쒖＜?섎웾"] += qty;
  });

  Object.keys(grouped).forEach(function (key) {
    var row = grouped[key];
    if (!findInspectionRow_(inspectionSheet, row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?], row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"])) {
      writeInspectionRow_(inspectionSheet, 0, row);
    }
  });
}

function isNonOperationalJob_(jobKey, sourceFileName) {
  var normalizedJobKey = String(jobKey || "").trim().toLowerCase();
  var normalizedSourceName = String(sourceFileName || "").trim().toLowerCase();

  if (!normalizedJobKey && !normalizedSourceName) {
    return false;
  }

  if (/^(test|debug)[_-]/.test(normalizedJobKey)) {
    return true;
  }

  if (normalizedSourceName === "t.csv" || normalizedSourceName === "test.csv" || normalizedSourceName === "debug.csv") {
    return true;
  }

  return false;
}

function loadLatestJob_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobsSheet = ss.getSheetByName(SHEET_NAMES.jobs);

  if (!jobsSheet || jobsSheet.getLastRow() < 2) {
    return null;
  }

  const values = jobsSheet.getRange(2, 1, jobsSheet.getLastRow() - 1, jobsSheet.getLastColumn()).getValues();

  for (var i = values.length - 1; i >= 0; i -= 1) {
    var jobKey = String(values[i][1] || "").trim();
    var sourceFileName = String(values[i][2] || "").trim();
    if (!jobKey) continue;
    if (isNonOperationalJob_(jobKey, sourceFileName)) continue;
    return loadJobRowsByKey_(ss, jobKey);
  }

  return null;
}

function tryLoadLatestJobWithError_() {
  try {
    return {
      job: loadLatestJob_(),
      error: "",
    };
  } catch (err) {
    return {
      job: null,
      error: err && err.message ? String(err.message) : "current_job 濡쒕뱶 ?ㅽ뙣",
    };
  }
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
  const parseErrors = [];
  const rows = cacheValues
    .filter(function (row) {
      return String(row[1] || "").trim() === jobKey;
    })
    .sort(function (a, b) {
      return Number(a[2] || 0) - Number(b[2] || 0);
    })
    .map(function (row) {
      try {
        return JSON.parse(String(row[3] || "{}"));
      } catch (err) {
        parseErrors.push({
          row_index: Number(row[2] || 0),
          message: err && err.message ? String(err.message) : "row_json parse ?ㅽ뙣",
        });
        return null;
      }
    })
    .filter(function (row) {
      return !!row;
    });

  if (parseErrors.length > 0) {
    throw new Error(
      "job_cache 蹂듭썝 ?ㅽ뙣: job_key=" +
        jobKey +
        ", parse_error_rows=" +
        parseErrors.map(function (item) { return item.row_index; }).join(",")
    );
  }

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
  migrateInspectionSheetIfNeeded_(sheet);
  ensureHeaderRow_(sheet, inspectionHeaders_());
  return sheet;
}

function getInspectionSummarySheet_(ss) {
  return getOrCreateSheet_(ss, SHEET_NAMES.summary);
}

function editLockHeaders_() {
  return ["?곹뭹??, "?몄쭛?륤D", "?몄쭛?먮챸", "?섏젙?쇱떆", "留뚮즺?쇱떆"];
}

function getEditLockSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.editLocks);
  ensureHeaderRow_(sheet, editLockHeaders_());
  return sheet;
}

function cleanupExpiredEditLocks_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  var now = Date.now();
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, editLockHeaders_().length).getValues();
  for (var i = values.length - 1; i >= 0; i -= 1) {
    var expiresAt = new Date(values[i][4] || "").getTime();
    if (!expiresAt || expiresAt < now) {
      sheet.deleteRow(i + 2);
    }
  }
}

function loadEditLocks_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getEditLockSheet_(ss);
  cleanupExpiredEditLocks_(sheet);
  if (sheet.getLastRow() < 2) return {};

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, editLockHeaders_().length).getValues();
  var map = {};
  values.forEach(function (row, index) {
    var key = String(row[0] || "").trim();
    if (!key) return;
    map[key] = {
      rowNumber: index + 2,
      editorId: String(row[1] || "").trim(),
      editorName: String(row[2] || "").trim(),
      updatedAt: row[3] || "",
      expiresAt: row[4] || "",
    };
  });
  return map;
}

function upsertEditLock_(payload) {
  var itemKey = String(payload.itemKey || "").trim();
  var editorId = String(payload.editorId || "").trim();
  var editorName = String(payload.editorName || "").trim();
  if (!itemKey || !editorId) {
    throw new Error("?좉툑 ????먮뒗 ?몄쭛???뺣낫媛 ?놁뒿?덈떎.");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getEditLockSheet_(ss);
  var lockMap = loadEditLocks_();
  var existing = lockMap[itemKey];
  var nowIso = new Date().toISOString();
  var expiresAtIso = new Date(Date.now() + EDIT_LOCK_TTL_MS).toISOString();

  if (existing && existing.editorId && existing.editorId !== editorId) {
    return {
      ok: false,
      conflict: true,
      lock: existing,
    };
  }

  var rowValues = [[itemKey, editorId, editorName, nowIso, expiresAtIso]];
  if (existing && existing.rowNumber) {
    sheet.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    sheet.appendRow(rowValues[0]);
  }

  return {
    ok: true,
    conflict: false,
    lock: {
      itemKey: itemKey,
      editorId: editorId,
      editorName: editorName,
      updatedAt: nowIso,
      expiresAt: expiresAtIso,
    },
  };
}

function releaseEditLock_(payload) {
  var itemKey = String(payload.itemKey || "").trim();
  var editorId = String(payload.editorId || "").trim();
  if (!itemKey || !editorId) return { ok: true };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getEditLockSheet_(ss);
  var lockMap = loadEditLocks_();
  var existing = lockMap[itemKey];
  if (existing && existing.rowNumber && existing.editorId === editorId) {
    sheet.deleteRow(existing.rowNumber);
  }
  return { ok: true };
}

function photoAssetHeaders_() {
  return ["assetKey", "photoType", "fileIdsText", "photoCount", "updatedAt"];
}

function getPhotoAssetSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.photoAssets);
  ensureHeaderRow_(sheet, photoAssetHeaders_());
  if (!sheet.isSheetHidden()) {
    sheet.hideSheet();
  }
  return sheet;
}

function makeInspectionPhotoAssetKey_(jobKey, productCode, partnerName) {
  return [
    "inspection",
    String(jobKey || "").trim(),
    normalizeCode_(productCode || ""),
    normalizeText_(partnerName || ""),
  ].join("||");
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

function photoTypeList_() {
  return ["inspection", "return", "exchange", "sugar", "weight", "default"];
}

function normalizePhotoType_(photoType) {
  var value = String(photoType || "").trim().toLowerCase();
  if (photoTypeList_().indexOf(value) >= 0) return value;
  return "default";
}

function getDefaultPhotoTypeForRecord_(record, kind) {
  if (kind === "inspection") return "inspection";
  var typeName = String((record && record["처리유형"]) || "").trim();
  if (typeName === "회송") return "return";
  if (typeName === "교환") return "exchange";
  return "default";
}

function ensurePhotoAssetGroup_(map, assetKey) {
  if (!map[assetKey]) {
    map[assetKey] = {};
  }
  return map[assetKey];
}

function makePhotoAssetKeyFromRecord_(record, kind) {
  if (kind === "inspection") {
    return makeInspectionPhotoAssetKey_(
      record["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?],
      record["?곹뭹肄붾뱶"],
      record["?묐젰?щ챸"]
    );
  }

  return makeMovementPhotoAssetKey_(
    record["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?],
    record["?곹뭹肄붾뱶"],
    record["?묐젰?щ챸"],
    record["?쇳꽣紐?],
    record["泥섎━?좏삎"]
  );
}

function loadPhotoAssetMap_(ss) {
  var sheet = getPhotoAssetSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return {};

  var values = sheet.getDataRange().getValues();
  var map = {};

  for (var r = 1; r < values.length; r += 1) {
    var assetKey = String(values[r][0] || "").trim();
    if (!assetKey) continue;
    var legacyOrPhotoType = String(values[r][1] || "").trim();
    var hasFiveColumns = values[0].length >= 5;
    var photoType = hasFiveColumns ? normalizePhotoType_(legacyOrPhotoType || "default") : "default";
    var fileIdsText = hasFiveColumns ? String(values[r][2] || "").trim() : String(values[r][1] || "").trim();
    var photoCount = hasFiveColumns ? parseNumber_(values[r][3] || 0) : parseNumber_(values[r][2] || 0);
    var updatedAt = hasFiveColumns ? values[r][4] || "" : values[r][3] || "";
    var group = ensurePhotoAssetGroup_(map, assetKey);
    group[photoType] = {
      rowNumber: r + 1,
      assetKey: assetKey,
      photoType: photoType,
      fileIdsText: fileIdsText,
      photoCount: photoCount,
      updatedAt: updatedAt,
    };
  }

  return map;
}

function upsertPhotoAsset_(assetKey, fileIdsText, photoType) {
  var key = String(assetKey || "").trim();
  if (!key) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var normalizedFileIds = splitPhotoSourceText_(fileIdsText).join("\n");
  var normalizedPhotoType = normalizePhotoType_(photoType || "default");
  if (!normalizedFileIds) {
    deletePhotoAsset_(key, normalizedPhotoType);
    return;
  }

  var sheet = getPhotoAssetSheet_(ss);
  var map = loadPhotoAssetMap_(ss);
  var group = map[key] || {};
  var existing = group[normalizedPhotoType];
  var photoCount = splitPhotoSourceText_(normalizedFileIds).length;
  var rowValues = [[key, normalizedPhotoType, normalizedFileIds, photoCount, new Date().toISOString()]];

  if (existing && existing.rowNumber) {
    sheet.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    sheet.appendRow(rowValues[0]);
  }
}

function deletePhotoAsset_(assetKey, photoType) {
  var key = String(assetKey || "").trim();
  if (!key) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var map = loadPhotoAssetMap_(ss);
  var group = map[key];
  if (!group) return;

  var rowNumbers = [];
  if (photoType) {
    var existing = group[normalizePhotoType_(photoType)];
    if (existing && existing.rowNumber) rowNumbers.push(existing.rowNumber);
  } else {
    Object.keys(group).forEach(function (typeKey) {
      if (group[typeKey] && group[typeKey].rowNumber) {
        rowNumbers.push(group[typeKey].rowNumber);
      }
    });
  }

  rowNumbers
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (rowNumber) {
      getPhotoAssetSheet_(ss).deleteRow(rowNumber);
    });
}

function buildDriveViewUrl_(fileId) {
  var id = extractGoogleDriveId_(fileId);
  return id ? "https://drive.google.com/uc?export=view&id=" + id : "";
}

function buildPhotoSourcesFromFileIds_(fileIds) {
  return (Array.isArray(fileIds) ? fileIds : [])
    .filter(Boolean)
    .map(function (fileId) {
      var driveId = extractGoogleDriveId_(fileId);
      var viewUrl = buildDriveViewUrl_(driveId || fileId);
      var fileName = "";
      try {
        if (driveId) fileName = String(DriveApp.getFileById(driveId).getName() || "").trim();
      } catch (_) {}
      return {
        fileId: driveId || fileId,
        url: viewUrl,
        fileName: fileName,
      };
    });
}

function applyPhotoAssetFieldsToRow_(row, assetMap, kind) {
  var key = makePhotoAssetKeyFromRecord_(row, kind);
  var assetGroup = assetMap[key] || {};
  var defaultPhotoType = getDefaultPhotoTypeForRecord_(row, kind);
  var typedMap = {};

  photoTypeList_().forEach(function (photoType) {
    var asset = assetGroup[photoType];
    if (!asset) return;
    var fileIds = splitPhotoSourceText_(asset.fileIdsText);
    typedMap[photoType] = {
      fileIds: fileIds,
      photoCount: parseNumber_(asset.photoCount || fileIds.length),
      sources: buildPhotoSourcesFromFileIds_(fileIds),
    };
  });

  if (!typedMap[defaultPhotoType] && typedMap.default) {
    typedMap[defaultPhotoType] = typedMap.default;
  }

  row.photoAssetMap = typedMap;
  row.inspectionPhotos = (typedMap.inspection && typedMap.inspection.sources) || [];
  row.returnPhotos = (typedMap.return && typedMap.return.sources) || [];
  row.exchangePhotos = (typedMap.exchange && typedMap.exchange.sources) || [];
  row.sugarPhotos = (typedMap.sugar && typedMap.sugar.sources) || [];
  row.weightPhotos = (typedMap.weight && typedMap.weight.sources) || [];

  var legacyAsset = typedMap[defaultPhotoType] || typedMap.default || null;
  var legacyFileIds = legacyAsset ? legacyAsset.fileIds : [];
  var legacyLinks = legacyAsset
    ? legacyAsset.sources.map(function (item) {
        return item.url;
      })
    : [];

  row["사진파일ID목록"] = legacyFileIds.join("\n");
  row["사진링크목록"] = legacyLinks.join("\n");
  row["사진링크"] = legacyLinks[0] || "";
  row["사진URL"] = row["사진링크"];
  row["사진개수"] = legacyAsset ? parseNumber_(legacyAsset.photoCount || legacyFileIds.length) : parseNumber_(row["사진개수"] || 0);
  return row;
}

function applyClientFieldAliases_(row, kind) {
  if (!row) return row;

  row.jobKey = row.jobKey || row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "";
  row.productCode = row.productCode || row["?곹뭹肄붾뱶"] || "";
  row.productName = row.productName || row["?곹뭹紐?] || "";
  row.partnerName = row.partnerName || row["?묐젰?щ챸"] || "";
  row["상품코드"] = row["상품코드"] || row.productCode;
  row["상품명"] = row["상품명"] || row.productName;
  row["협력사명"] = row["협력사명"] || row.partnerName;
  row["작업기준일또는CSV식별값"] = row["작업기준일또는CSV식별값"] || row.jobKey;
  row["작성일시"] = row["작성일시"] || row["?묒꽦?쇱떆"] || "";
  row["수정일시"] = row["수정일시"] || row["?섏젙?쇱떆"] || "";
  row["버전"] = row["버전"] || row["踰꾩쟾"] || 0;

  if (kind === "inspection") {
    row.inspectionQty = parseNumber_(row.inspectionQty || row["寃?덉닔??] || 0);
    row.returnQty = parseNumber_(row.returnQty || row["?뚯넚?섎웾"] || 0);
    row.exchangeQty = parseNumber_(row.exchangeQty || row["援먰솚?섎웾"] || 0);
    row.memo = String(row.memo || row["비고"] || row["鍮꾧퀬"] || "").trim();
    row.brixMin = row.brixMin !== undefined && row.brixMin !== "" ? row.brixMin : row["BRIX최저"];
    row.brixMax = row.brixMax !== undefined && row.brixMax !== "" ? row.brixMax : row["BRIX최고"];
    row.brixAvg = row.brixAvg !== undefined && row.brixAvg !== "" ? row.brixAvg : row["BRIX평균"];
    row.weightNote = row.weightNote || row["중량메모"] || "";
    row["검품수량"] = row["검품수량"] || row.inspectionQty;
    row["회송수량"] = row["회송수량"] || row.returnQty;
    row["교환수량"] = row["교환수량"] || row.exchangeQty;
    row["비고"] = row["비고"] || row.memo;
  } else if (kind === "movement") {
    row.centerName = row.centerName || row["?쇳꽣紐?] || "";
    row.typeName = row.typeName || row["泥섎━?좏삎"] || "";
    row.returnQty = parseNumber_(row.returnQty || row["?뚯넚?섎웾"] || 0);
    row.exchangeQty = parseNumber_(row.exchangeQty || row["援먰솚?섎웾"] || 0);
    row.memo = String(row.memo || row["鍮꾧퀬"] || row["비고"] || "").trim();
    row["센터명"] = row["센터명"] || row.centerName;
    row["처리유형"] = row["처리유형"] || row.typeName;
    row["회송수량"] = row["회송수량"] || row.returnQty;
    row["교환수량"] = row["교환수량"] || row.exchangeQty;
    row["비고"] = row["비고"] || row.memo;
  }

  return row;
}

function clonePhotoTypeFileIdsMap_(map) {
  var next = {};
  Object.keys(map || {}).forEach(function (photoType) {
    next[photoType] = (Array.isArray(map[photoType]) ? map[photoType] : []).slice();
  });
  return next;
}

function extractPhotoTypeFileIdsMap_(record, kind) {
  var next = {};
  if (record && record.photoAssetMap) {
    Object.keys(record.photoAssetMap).forEach(function (photoType) {
      next[photoType] = splitPhotoSourceText_(
        ((record.photoAssetMap[photoType] && record.photoAssetMap[photoType].fileIds) || []).join("\n")
      );
    });
  }

  var fallbackType = getDefaultPhotoTypeForRecord_(record || {}, kind);
  var legacyFileIds = splitPhotoSourceText_((record && record["?ъ쭊?뚯씪ID紐⑸줉"]) || "");
  if (legacyFileIds.length) {
    next[fallbackType] = legacyFileIds;
  }

  return next;
}

function resolvePhotoTypeFileIdsMap_(payload, existingRecord, kind, fallbackType, uploadedPhotoFileIds) {
  var next = clonePhotoTypeFileIdsMap_(extractPhotoTypeFileIdsMap_(existingRecord, kind));
  var incoming = payload && payload.photoTypeFileIdsMap && typeof payload.photoTypeFileIdsMap === "object"
    ? payload.photoTypeFileIdsMap
    : {};

  Object.keys(incoming).forEach(function (photoType) {
    next[normalizePhotoType_(photoType)] = splitPhotoSourceText_((incoming[photoType] || []).join("\n"));
  });

  var normalizedFallbackType = normalizePhotoType_(fallbackType || "default");
  var targetType = normalizePhotoType_(
    (payload && payload.photoKind) || (payload && payload.photoType) || normalizedFallbackType
  );
  var payloadPhotoFileIds = splitPhotoSourceText_(
    (payload && (payload["?ъ쭊?뚯씪ID紐⑸줉"] || payload.photoFileIds)) || ""
  );
  var currentTargetIds = splitPhotoSourceText_(((next[targetType] || []).join("\n")));
  var mergedTargetIds = mergePhotoLinks_(
    currentTargetIds.join("\n"),
    payloadPhotoFileIds.join("\n"),
    (uploadedPhotoFileIds || []).join("\n")
  ).split(/\n+/).filter(Boolean);
  var photoMutation = String((payload && payload.photoMutation) || "").trim().toLowerCase();
  var mutationPhotoFileId = String((payload && payload.photoFileId) || "").trim();

  if (photoMutation === "append" && mutationPhotoFileId && mergedTargetIds.indexOf(mutationPhotoFileId) === -1) {
    mergedTargetIds.push(mutationPhotoFileId);
  }
  if (photoMutation === "delete" && mutationPhotoFileId) {
    mergedTargetIds = mergedTargetIds.filter(function (item) {
      return item !== mutationPhotoFileId;
    });
  }

  if (
    mergedTargetIds.length ||
    payloadPhotoFileIds.length ||
    (uploadedPhotoFileIds || []).length ||
    photoMutation
  ) {
    next[targetType] = mergedTargetIds;
  }

  Object.keys(next).forEach(function (photoType) {
    next[photoType] = splitPhotoSourceText_((next[photoType] || []).join("\n"));
    if (!next[photoType].length) {
      delete next[photoType];
    }
  });

  return next;
}

function getLegacyPhotoFileIdsFromMap_(photoTypeFileIdsMap, fallbackType) {
  var normalizedFallbackType = normalizePhotoType_(fallbackType || "default");
  if (photoTypeFileIdsMap[normalizedFallbackType] && photoTypeFileIdsMap[normalizedFallbackType].length) {
    return photoTypeFileIdsMap[normalizedFallbackType];
  }
  if (photoTypeFileIdsMap.default && photoTypeFileIdsMap.default.length) {
    return photoTypeFileIdsMap.default;
  }
  return [];
}

function upsertTypedPhotoAssetsForRow_(row, kind) {
  if (!row) return;

  var jobKey = row.jobKey || row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "";
  var productCode = row.productCode || row["?곹뭹肄붾뱶"] || "";
  var partnerName = row.partnerName || row["?묐젰?щ챸"] || "";
  var centerName = row.centerName || row["?쇳꽣紐?] || "";
  var typeName = row.typeName || row["泥섎━?좏삎"] || "";

  var assetKey =
    kind === "inspection"
      ? makeInspectionPhotoAssetKey_(jobKey, productCode, partnerName)
      : makeMovementPhotoAssetKey_(jobKey, productCode, partnerName, centerName, typeName);

  Object.keys(row.photoTypeFileIdsMap || {}).forEach(function (photoType) {
    upsertPhotoAsset_(assetKey, ((row.photoTypeFileIdsMap[photoType] || []).join("\n")), photoType);
  });
}

function pruneJobCacheRows_(cacheSheet) {
  if (!cacheSheet) return;
  var dataRowCount = Math.max(cacheSheet.getLastRow() - 1, 0);
  if (dataRowCount <= JOB_CACHE_MAX_DATA_ROWS) return;

  var deleteCount = dataRowCount - JOB_CACHE_MAX_DATA_ROWS;
  cacheSheet.deleteRows(2, deleteCount);
}

function autoResizeOperationalSheets_(ss) {
  return;
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
      applyClientFieldAliases_(row, "movement");
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["?묒꽦?쇱떆"] || "").localeCompare(String(a["?묒꽦?쇱떆"] || ""));
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
      applyClientFieldAliases_(row, "inspection");
      rows.push(row);
    }
  }

  rows.sort(function (a, b) {
    return String(b["?묒꽦?쇱떆"] || "").localeCompare(String(a["?묒꽦?쇱떆"] || ""));
  });

  return rows;
}

function appendRecord_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const recordsSheet = getRecordSheet_(ss);
  const record = upsertMovementRow_(recordsSheet, payload || {});
  return {
    record: record,
    hasInspection: false,
    hasMovement: !record.__conflict,
    syncDeferred: true,
  };
}

function deleteRecord_(payload) {
  const rowNumber = Number(payload.rowNumber || 0);
  if (!rowNumber || rowNumber <= 1) {
    throw new Error("??젣????踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getRecordSheet_(ss);

  if (rowNumber > sheet.getLastRow()) {
    throw new Error("?대? ??젣?섏뿀嫄곕굹 議댁옱?섏? ?딅뒗 ?됱엯?덈떎.");
  }

  var existingRecord = readMovementRow_(sheet, rowNumber);
  deletePhotoAsset_(makeMovementPhotoAssetKey_(
    existingRecord["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?],
    existingRecord["?곹뭹肄붾뱶"],
    existingRecord["?묐젰?щ챸"],
    existingRecord["?쇳꽣紐?],
    existingRecord["泥섎━?좏삎"]
  ));
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
  const saved = upsertInspectionRow_(inspectionSheet, payload || {});
  return {
    row: saved,
    hasInspection: !saved.__conflict,
    hasMovement: false,
    syncDeferred: true,
  };
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
  console.log("[saveBatch_] incoming rows=" + JSON.stringify(rows || []));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  const list = Array.isArray(rows) ? rows : [];
  const inspectionRows = [];
  const movementRows = [];
  const conflicts = [];

  list.forEach(function (rawRow) {
    const row = rawRow || {};
    const type = String(row.type || "").trim();
    const operationId = String(row.operationId || "").trim();
    const cached = loadOperationResult_("saveBatch", operationId);

    if (cached) {
      if (Array.isArray(cached.inspectionRows)) {
        inspectionRows.push.apply(inspectionRows, cached.inspectionRows);
      }
      if (Array.isArray(cached.movementRows)) {
        movementRows.push.apply(movementRows, cached.movementRows);
      }
      if (Array.isArray(cached.conflicts)) {
        conflicts.push.apply(conflicts, cached.conflicts);
      }
      return;
    }

    if (type === "inspection") {
      var savedInspectionRow = upsertInspectionRow_(inspectionSheet, row);
      if (savedInspectionRow && savedInspectionRow.__conflict) {
        conflicts.push(savedInspectionRow);
      } else {
        inspectionRows.push(savedInspectionRow);
      }
      saveOperationResult_("saveBatch", operationId, row.key || "", {
        inspectionRows: savedInspectionRow && !savedInspectionRow.__conflict ? [savedInspectionRow] : [],
        movementRows: [],
        conflicts: savedInspectionRow && savedInspectionRow.__conflict ? [savedInspectionRow] : [],
        hasInspection: !!(savedInspectionRow && !savedInspectionRow.__conflict),
        hasMovement: false,
      });
      return;
    }

    if (type === "movement" || type === "return" || type === "exchange") {
      var savedMovementRow = upsertMovementRow_(recordsSheet, row);
      if (savedMovementRow && savedMovementRow.__conflict) {
        conflicts.push(savedMovementRow);
      } else {
        movementRows.push(savedMovementRow);
      }
      saveOperationResult_("saveBatch", operationId, row.key || "", {
        inspectionRows: [],
        movementRows: savedMovementRow && !savedMovementRow.__conflict ? [savedMovementRow] : [],
        conflicts: savedMovementRow && savedMovementRow.__conflict ? [savedMovementRow] : [],
        hasInspection: false,
        hasMovement: !!(savedMovementRow && !savedMovementRow.__conflict),
      });
    }
  });

  return {
    inspectionRows: inspectionRows,
    movementRows: movementRows,
    conflicts: conflicts,
    hasInspection: inspectionRows.length > 0,
    hasMovement: movementRows.length > 0,
  };
}

function postSaveSync_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inspectionSheet = getInspectionSheet_(ss);
  const recordsSheet = getRecordSheet_(ss);
  const hasInspection = !!payload.hasInspection;
  const hasMovement = !!payload.hasMovement;

  if (hasInspection || hasMovement) {
    syncInspectionMovementTotals_(inspectionSheet, recordsSheet);
    updateInspectionDashboard_(ss);
  }

  if (hasInspection || hasMovement) {
    syncReturnSheets_(ss);
  }

  autoResizeOperationalSheets_(ss);

  return {
    hasInspection: hasInspection,
    hasMovement: hasMovement,
  };
}

function upsertInspectionRow_(sheet, payload) {
  const rawPayload = payload || {};
  const targetRow = findInspectionRow_(
    sheet,
    rawPayload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || rawPayload["jobKey"] || "",
    rawPayload["?곹뭹肄붾뱶"] || rawPayload["productCode"] || "",
    rawPayload["?묐젰?щ챸"] || rawPayload["partnerName"] || ""
  );
  const existingRecord = targetRow > 0 ? readInspectionRow_(sheet, targetRow) : null;
  if (hasRowConflict_(rawPayload, existingRecord)) {
    return {
      __conflict: true,
      __rowNumber: targetRow,
      serverRecord: existingRecord,
      key: makeEntityKey_(
        rawPayload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || rawPayload["jobKey"] || "",
        rawPayload["?곹뭹肄붾뱶"] || rawPayload["productCode"] || "",
        rawPayload["?묐젰?щ챸"] || rawPayload["partnerName"] || ""
      ),
    };
  }
  const row = buildInspectionPayload_(rawPayload, existingRecord);
  console.log("[upsertInspectionRow_] built row=" + JSON.stringify({
    jobKey: row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?],
    productCode: row["?곹뭹肄붾뱶"],
    productName: row["?곹뭹紐?],
    partnerName: row["?묐젰?щ챸"],
    orderedQty: row["諛쒖＜?섎웾"],
    inspectionQty: row["寃?덉닔??],
    photoLinks: row["?ъ쭊留곹겕紐⑸줉"],
    memo: row["鍮꾧퀬"]
  }));
  if (shouldDeleteInspectionRow_(row)) {
    if (targetRow > 0) {
      deletePhotoAsset_(makeInspectionPhotoAssetKey_(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?], row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"]));
      sheet.deleteRow(targetRow);
      row.__rowNumber = 0;
    }
    return row;
  }
  writeInspectionRow_(sheet, targetRow, row);
  upsertTypedPhotoAssetsForRow_(row, "inspection");
  console.log("[upsertInspectionRow_] written row=" + JSON.stringify({
    rowNumber: targetRow > 0 ? targetRow : sheet.getLastRow(),
    productCode: row["?곹뭹肄붾뱶"],
    partnerName: row["?묐젰?щ챸"],
    inspectionQty: row["寃?덉닔??],
    photoLinks: row["?ъ쭊留곹겕紐⑸줉"],
    memo: row["鍮꾧퀬"]
  }));
  row.__rowNumber = targetRow > 0 ? targetRow : sheet.getLastRow();
  return row;
}

function upsertMovementRow_(sheet, payload) {
  const rawPayload = payload || {};
  const targetRow = findMovementRow_(
    sheet,
    rawPayload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || rawPayload["jobKey"] || "",
    rawPayload["?곹뭹肄붾뱶"] || rawPayload["productCode"] || "",
    rawPayload["?묐젰?щ챸"] || rawPayload["partnerName"] || "",
    rawPayload["?쇳꽣紐?] || rawPayload["centerName"] || "",
    rawPayload["泥섎━?좏삎"] || (String(rawPayload["movementType"] || "").trim().toUpperCase() === "RETURN" ? "?뚯넚" : String(rawPayload["movementType"] || "").trim().toUpperCase() === "EXCHANGE" ? "援먰솚" : "")
  );
  const existingRecord = targetRow > 0 ? readMovementRow_(sheet, targetRow) : null;
  if (hasRowConflict_(rawPayload, existingRecord)) {
    return {
      __conflict: true,
      __rowNumber: targetRow,
      serverRecord: existingRecord,
      key: makeMovementPendingKey_(
        String(rawPayload["movementType"] || "").trim().toUpperCase() || String(rawPayload["泥섎━?좏삎"] || "").trim(),
        rawPayload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || rawPayload["jobKey"] || "",
        rawPayload["?곹뭹肄붾뱶"] || rawPayload["productCode"] || "",
        rawPayload["?묐젰?щ챸"] || rawPayload["partnerName"] || "",
        rawPayload["?쇳꽣紐?] || rawPayload["centerName"] || ""
      ),
    };
  }
  const row = buildRecordPayload_(rawPayload, existingRecord);
  console.log("[upsertMovementRow_] built row(before merge)=" + JSON.stringify({
    jobKey: row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?],
    productCode: row["?곹뭹肄붾뱶"],
    partnerName: row["?묐젰?щ챸"],
    centerName: row["?쇳꽣紐?],
    typeName: row["泥섎━?좏삎"],
    returnQty: row["?뚯넚?섎웾"],
    exchangeQty: row["援먰솚?섎웾"],
    orderedQty: row["諛쒖＜?섎웾"],
    totalOrderedQty: row["珥?諛쒖＜ ?섎웾"]
  }));
  if (shouldDeleteMovementRow_(row)) {
    if (targetRow > 0) {
      deletePhotoAsset_(makeMovementPhotoAssetKey_(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?], row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"], row["?쇳꽣紐?], row["泥섎━?좏삎"]));
      sheet.deleteRow(targetRow);
      row.__rowNumber = 0;
    }
    return row;
  }

  if (targetRow > 0) {
    const existing = readMovementRow_(sheet, targetRow);
    const replaceQtyMode =
      rawPayload["replaceQtyMode"] === true ||
      String(rawPayload["replaceQtyMode"] || "").toLowerCase() === "true";

    if (replaceQtyMode) {
      row["?뚯넚?섎웾"] = parseNumber_(rawPayload["returnQty"] || rawPayload["?뚯넚?섎웾"] || 0);
      row["援먰솚?섎웾"] = parseNumber_(rawPayload["exchangeQty"] || rawPayload["援먰솚?섎웾"] || 0);
      row["諛쒖＜?섎웾"] = parseNumber_(existing["諛쒖＜?섎웾"] || row["諛쒖＜?섎웾"]);
      row["珥?諛쒖＜ ?섎웾"] = parseNumber_(existing["珥?諛쒖＜ ?섎웾"] || row["珥?諛쒖＜ ?섎웾"]);
    } else {
      row["?뚯넚?섎웾"] = parseNumber_(existing["?뚯넚?섎웾"]) + parseNumber_(row["?뚯넚?섎웾"]);
      row["援먰솚?섎웾"] = parseNumber_(existing["援먰솚?섎웾"]) + parseNumber_(row["援먰솚?섎웾"]);
      row["諛쒖＜?섎웾"] = parseNumber_(existing["諛쒖＜?섎웾"] || row["諛쒖＜?섎웾"]);
      row["珥?諛쒖＜ ?섎웾"] = parseNumber_(existing["珥?諛쒖＜ ?섎웾"] || row["珥?諛쒖＜ ?섎웾"]);
    }
    row["鍮꾧퀬"] = mergeTextValue_(existing["鍮꾧퀬"], row["鍮꾧퀬"]);
    console.log("[upsertMovementRow_] merged row(before write)=" + JSON.stringify({
      rowNumber: targetRow,
      typeName: row["泥섎━?좏삎"],
      returnQty: row["?뚯넚?섎웾"],
      exchangeQty: row["援먰솚?섎웾"],
      totalOrderedQty: row["珥?諛쒖＜ ?섎웾"]
    }));
    writeRecordRow_(sheet, targetRow, row);
    upsertTypedPhotoAssetsForRow_(row, "movement");
    row.__rowNumber = targetRow;
    return row;
  }

  console.log("[upsertMovementRow_] new row(before write)=" + JSON.stringify({
    typeName: row["泥섎━?좏삎"],
    returnQty: row["?뚯넚?섎웾"],
    exchangeQty: row["援먰솚?섎웾"],
    totalOrderedQty: row["珥?諛쒖＜ ?섎웾"]
  }));
  writeRecordRow_(sheet, 0, row);
  upsertTypedPhotoAssetsForRow_(row, "movement");
  row.__rowNumber = sheet.getLastRow();
  return row;
}

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

  applyPhotoAssetFieldsToRow_(row, loadPhotoAssetMap_(SpreadsheetApp.getActiveSpreadsheet()), "movement");
  return applyClientFieldAliases_(row, "movement");
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

function readInspectionRow_(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const headers = inspectionHeaders_();
  const row = {};

  for (var i = 0; i < headers.length; i += 1) {
    row[headers[i]] = values[i];
  }

  applyPhotoAssetFieldsToRow_(row, loadPhotoAssetMap_(SpreadsheetApp.getActiveSpreadsheet()), "inspection");
  return applyClientFieldAliases_(row, "inspection");
}

function buildInspectionPayload_(payload, existingRecord) {
  const photos = Array.isArray(payload["?ъ쭊??]) ? payload["?ъ쭊??] : [];
  const photoMutation = String(payload["photoMutation"] || "").trim().toLowerCase();
  const mutationPhotoFileId = String(payload["photoFileId"] || "").trim();
  const uploaded = photos.length
    ? savePhotosToDrive_(
        photos,
        payload["?곹뭹紐?] || payload["productName"] || "寃??,
        existingRecord ? existingRecord["?ъ쭊?뚯씪ID紐⑸줉"] : ""
      )
    : [];
  const existingPhotoFileIds = splitPhotoSourceText_((existingRecord && existingRecord["?ъ쭊?뚯씪ID紐⑸줉"]) || "");
  const payloadPhotoFileIds = splitPhotoSourceText_(
    payload["?ъ쭊?뚯씪ID紐⑸줉"] || payload["photoFileIds"] || ""
  );
  const uploadedPhotoFileIds = uploaded.map(function (item) {
    return item.fileId;
  });
  const mergedExistingAndPayload = mergePhotoLinks_(
    existingPhotoFileIds.join("\n"),
    payloadPhotoFileIds.join("\n"),
    ""
  );
  const photoFileIds = mergePhotoLinks_(
    mergedExistingAndPayload,
    uploadedPhotoFileIds.join("\n"),
    ""
  ).split(/\n+/).filter(Boolean);
  let nextPhotoFileIds = photoFileIds.slice();
  if (photoMutation === "append" && mutationPhotoFileId && nextPhotoFileIds.indexOf(mutationPhotoFileId) === -1) {
    nextPhotoFileIds.push(mutationPhotoFileId);
  }
  if (photoMutation === "delete" && mutationPhotoFileId) {
    nextPhotoFileIds = nextPhotoFileIds.filter(function (item) {
      return item !== mutationPhotoFileId;
    });
  }
  const nowIso = new Date().toISOString();
  const editorName = String(payload["?섏젙??] || payload["editorName"] || "").trim();
  const editorId = String(payload["?섏젙?륤D"] || payload["editorId"] || "").trim();
  const photoTypeFileIdsMap = resolvePhotoTypeFileIdsMap_(
    payload,
    existingRecord,
    "inspection",
    "inspection",
    uploadedPhotoFileIds
  );
  if (photoMutation === "delete" && mutationPhotoFileId && !payload.photoTypeFileIdsMap) {
    photoTypeFileIdsMap[normalizePhotoType_(payload.photoKind || "inspection")] = nextPhotoFileIds;
  }
  const legacyPhotoFileIds = getLegacyPhotoFileIdsFromMap_(photoTypeFileIdsMap, "inspection");
  const previousPhotoIds = getLegacyPhotoFileIdsFromMap_(extractPhotoTypeFileIdsMap_(existingRecord, "inspection"), "inspection");
  const hasPhotoChanged = previousPhotoIds.join("\n") !== legacyPhotoFileIds.join("\n");
  const previousVersion = parseNumber_((existingRecord && existingRecord["踰꾩쟾"]) || 0);
  const brixMin = payload["BRIX최저"] !== undefined ? payload["BRIX최저"] : payload["brixMin"];
  const brixMax = payload["BRIX최고"] !== undefined ? payload["BRIX최고"] : payload["brixMax"];
  const brixAvg = payload["BRIX평균"] !== undefined ? payload["BRIX평균"] : payload["brixAvg"];
  const memo = payload["비고"] !== undefined ? payload["비고"] : (payload["鍮꾧퀬"] || payload["memo"] || "");
  const weightNote = payload["중량메모"] !== undefined ? payload["중량메모"] : (payload["weightNote"] || "");

  return {
    "?묒꽦?쇱떆": formatWrittenAtKst_(payload["?묒꽦?쇱떆"]),
    "???????????SV?????: payload["???????????SV?????"] || payload["jobKey"] || "",
    "?곹뭹肄붾뱶": normalizeCode_(payload["?곹뭹肄붾뱶"] || payload["productCode"] || ""),
    "?곹뭹紐?: payload["?곹뭹紐?] || payload["productName"] || "",
    "?묐젰?щ챸": payload["?묐젰?щ챸"] || payload["partnerName"] || "",
    "?꾩껜諛쒖＜?섎웾": parseNumber_(payload["?꾩껜諛쒖＜?섎웾"] || payload["totalQty"] || payload["諛쒖＜?섎웾"] || 0),
    "諛쒖＜?섎웾": parseNumber_(payload["諛쒖＜?섎웾"] || payload["totalQty"] || payload["?꾩껜諛쒖＜?섎웾"] || 0),
    "寃?덉닔??: parseNumber_(payload["寃?덉닔??] || payload["inspectionQty"] || 0),
    "?뚯넚?섎웾": parseNumber_(payload["?뚯넚?섎웾"] || 0),
    "援먰솚?섎웾": parseNumber_(payload["援먰솚?섎웾"] || 0),
    "?ъ쭊?뚯씪ID紐⑸줉": legacyPhotoFileIds.join("\n"),
    "?ъ쭊媛쒖닔": legacyPhotoFileIds.length,
    "비고": String(memo || "").trim(),
    "BRIX최저": brixMin === "" || brixMin === null || brixMin === undefined ? "" : parseNumber_(brixMin),
    "BRIX최고": brixMax === "" || brixMax === null || brixMax === undefined ? "" : parseNumber_(brixMax),
    "BRIX평균": brixAvg === "" || brixAvg === null || brixAvg === undefined ? "" : parseNumber_(brixAvg),
    "중량메모": String(weightNote || "").trim(),
    "?섏젙?쇱떆": nowIso,
    "?섏젙??: editorName || (existingRecord && existingRecord["?섏젙??]) || "",
    "?섏젙?륤D": editorId || (existingRecord && existingRecord["?섏젙?륤D"]) || "",
    "?ъ쭊?섏젙?쇱떆": hasPhotoChanged ? nowIso : ((existingRecord && existingRecord["?ъ쭊?섏젙?쇱떆"]) || ""),
    "?ъ쭊?섏젙??: hasPhotoChanged ? (editorName || "") : ((existingRecord && existingRecord["?ъ쭊?섏젙??]) || ""),
    "踰꾩쟾": previousVersion + 1,
    photoTypeFileIdsMap: photoTypeFileIdsMap,
  };
}

function buildRecordPayload_(payload, existingRecord) {
  const movementType = String(payload["movementType"] || "").trim().toUpperCase();
  const photoMutation = String(payload["photoMutation"] || "").trim().toLowerCase();
  const mutationPhotoFileId = String(payload["photoFileId"] || "").trim();
  const photos = Array.isArray(payload["?ъ쭊??]) ? payload["?ъ쭊??] : [];
  const uploaded = photos.length
    ? savePhotosToDrive_(
        photos,
        payload["?곹뭹紐?] || payload["productName"] || "遺덈웾",
        existingRecord ? existingRecord["?ъ쭊?뚯씪ID紐⑸줉"] : ""
      )
    : [];
  const existingPhotoFileIds = splitPhotoSourceText_((existingRecord && existingRecord["?ъ쭊?뚯씪ID紐⑸줉"]) || "");
  const payloadPhotoFileIds = splitPhotoSourceText_(
    payload["?ъ쭊?뚯씪ID紐⑸줉"] || payload["photoFileIds"] || ""
  );
  const uploadedPhotoFileIds = uploaded.map(function (item) {
    return item.fileId;
  });
  const mergedExistingAndPayload = mergePhotoLinks_(
    existingPhotoFileIds.join("\n"),
    payloadPhotoFileIds.join("\n"),
    ""
  );
  const photoFileIds = mergePhotoLinks_(
    mergedExistingAndPayload,
    uploadedPhotoFileIds.join("\n"),
    ""
  ).split(/\n+/).filter(Boolean);
  let nextPhotoFileIds = photoFileIds.slice();
  if (photoMutation === "append" && mutationPhotoFileId && nextPhotoFileIds.indexOf(mutationPhotoFileId) === -1) {
    nextPhotoFileIds.push(mutationPhotoFileId);
  }
  if (photoMutation === "delete" && mutationPhotoFileId) {
    nextPhotoFileIds = nextPhotoFileIds.filter(function (item) {
      return item !== mutationPhotoFileId;
    });
  }
  const nowIso = new Date().toISOString();
  const editorName = String(payload["?섏젙??] || payload["editorName"] || "").trim();
  const editorId = String(payload["?섏젙?륤D"] || payload["editorId"] || "").trim();
  const previousVersion = parseNumber_((existingRecord && existingRecord["踰꾩쟾"]) || 0);
  const resolvedMovementType = movementType || String(payload["泥섎━?좏삎"] || "").trim().toUpperCase();
  const defaultPhotoType =
    resolvedMovementType === "RETURN" || String(payload["泥섎━?좏삎"] || "").trim() === "?뚯넚"
      ? "return"
      : resolvedMovementType === "EXCHANGE" || String(payload["泥섎━?좏삎"] || "").trim() === "援먰솚"
      ? "exchange"
      : "default";
  const photoTypeFileIdsMap = resolvePhotoTypeFileIdsMap_(
    payload,
    existingRecord,
    "movement",
    defaultPhotoType,
    uploadedPhotoFileIds
  );
  if (photoMutation === "delete" && mutationPhotoFileId && !payload.photoTypeFileIdsMap) {
    photoTypeFileIdsMap[normalizePhotoType_(payload.photoKind || defaultPhotoType)] = nextPhotoFileIds;
  }
  const legacyPhotoFileIds = getLegacyPhotoFileIdsFromMap_(photoTypeFileIdsMap, defaultPhotoType);
  const previousPhotoIds = getLegacyPhotoFileIdsFromMap_(extractPhotoTypeFileIdsMap_(existingRecord, "movement"), defaultPhotoType);
  const hasPhotoChanged = previousPhotoIds.join("\n") !== legacyPhotoFileIds.join("\n");
  const memo = payload["비고"] !== undefined ? payload["비고"] : (payload["鍮꾧퀬"] || payload["memo"] || "");

  const record = {
    "?묒꽦?쇱떆": formatWrittenAtKst_(payload["?묒꽦?쇱떆"]),
    "???????????SV?????: payload["???????????SV?????"] || payload["jobKey"] || "",
    "?곹뭹紐?: payload["?곹뭹紐?] || payload["productName"] || "",
    "?곹뭹肄붾뱶": normalizeCode_(payload["?곹뭹肄붾뱶"] || payload["productCode"] || ""),
    "?쇳꽣紐?: payload["?쇳꽣紐?] || payload["centerName"] || "",
    "?묐젰?щ챸": payload["?묐젰?щ챸"] || payload["partnerName"] || "",
    "??????": parseNumber_(payload["??????"] || payload["orderQty"] || payload["qty"] || 0),
    "?됱궗紐?: payload["?됱궗紐?] || payload["eventName"] || "",
    "?됱궗?щ?": payload["?됱궗?щ?"] || payload["eventFlag"] || "",
    "泥섎━?좏삎": payload["泥섎━?좏삎"] || "",
    "?뚯넚?섎웾": parseNumber_(payload["?뚯넚?섎웾"] || 0),
    "援먰솚?섎웾": parseNumber_(payload["援먰솚?섎웾"] || 0),
    "鍮꾧퀬": String(memo || "").trim(),
    "?ъ쭊?뚯씪ID紐⑸줉": legacyPhotoFileIds.join("\n"),
    "?ъ쭊媛쒖닔": legacyPhotoFileIds.length,
    "珥?諛쒖＜ ?섎웾": parseNumber_(payload["?꾩껜諛쒖＜?섎웾"] || payload["totalQty"] || payload["諛쒖＜?섎웾"] || 0),
    "?섏젙?쇱떆": nowIso,
    "?섏젙??: editorName || (existingRecord && existingRecord["?섏젙??]) || "",
    "?섏젙?륤D": editorId || (existingRecord && existingRecord["?섏젙?륤D"]) || "",
    "?ъ쭊?섏젙?쇱떆": hasPhotoChanged ? nowIso : ((existingRecord && existingRecord["?ъ쭊?섏젙?쇱떆"]) || ""),
    "?ъ쭊?섏젙??: hasPhotoChanged ? (editorName || "") : ((existingRecord && existingRecord["?ъ쭊?섏젙??]) || ""),
    "踰꾩쟾": previousVersion + 1,
    photoTypeFileIdsMap: photoTypeFileIdsMap,
  };

  if (movementType === "RETURN") {
    record["泥섎━?좏삎"] = "?뚯넚";
    record["?뚯넚?섎웾"] = parseNumber_(payload["qty"] || payload["?뚯넚?섎웾"] || 0);
    record["援먰솚?섎웾"] = 0;
  } else if (movementType === "EXCHANGE") {
    record["泥섎━?좏삎"] = "援먰솚";
    record["援먰솚?섎웾"] = parseNumber_(payload["qty"] || payload["援먰솚?섎웾"] || 0);
    record["?뚯넚?섎웾"] = 0;
  } else if (!record["泥섎━?좏삎"]) {
    if (record["?뚯넚?섎웾"] > 0) {
      record["泥섎━?좏삎"] = "?뚯넚";
    } else if (record["援먰솚?섎웾"] > 0) {
      record["泥섎━?좏삎"] = "援먰솚";
    }
  }

  return record;
}

function shouldDeleteInspectionRow_(row) {
  if (!row) return false;
  var inspectionQty = parseNumber_(row["寃?덉닔??] || 0);
  var returnQty = parseNumber_(row["?뚯넚?섎웾"] || 0);
  var exchangeQty = parseNumber_(row["援먰솚?섎웾"] || 0);
  var memo = String(row["비고"] || row["鍮꾧퀬"] || row["memo"] || "").trim();
  var hasBrix =
    String(row["BRIX최저"] || "").trim() ||
    String(row["BRIX최고"] || "").trim() ||
    String(row["BRIX평균"] || "").trim();
  var hasWeightNote = String(row["중량메모"] || row["weightNote"] || "").trim();
  var hasPhoto =
    parseNumber_(row["?ъ쭊媛쒖닔"] || 0) > 0 ||
    !!String(row["?ъ쭊留곹겕"] || row["?ъ쭊留곹겕紐⑸줉"] || row["?ъ쭊?뚯씪ID紐⑸줉"] || "").trim() ||
    Object.keys(row.photoTypeFileIdsMap || {}).some(function (photoType) {
      return (row.photoTypeFileIdsMap[photoType] || []).length > 0;
    });
  return inspectionQty <= 0 && returnQty <= 0 && exchangeQty <= 0 && !memo && !hasBrix && !hasWeightNote && !hasPhoto;
}

function shouldDeleteMovementRow_(row) {
  if (!row) return false;
  var returnQty = parseNumber_(row["?뚯넚?섎웾"] || 0);
  var exchangeQty = parseNumber_(row["援먰솚?섎웾"] || 0);
  var memo = String(row["鍮꾧퀬"] || "").trim();
  var hasPhoto =
    parseNumber_(row["?ъ쭊媛쒖닔"] || 0) > 0 ||
    !!String(row["?ъ쭊留곹겕"] || row["?ъ쭊留곹겕紐⑸줉"] || row["?ъ쭊?뚯씪ID紐⑸줉"] || "").trim() ||
    Object.keys(row.photoTypeFileIdsMap || {}).some(function (photoType) {
      return (row.photoTypeFileIdsMap[photoType] || []).length > 0;
    });
  return returnQty <= 0 && exchangeQty <= 0 && !memo && !hasPhoto;
}

function hasRowConflict_(payload, existingRecord) {
  if (!existingRecord) return false;

  var expectedVersion = parseNumber_(payload["expectedVersion"] || payload["湲곕?踰꾩쟾"] || 0);
  var expectedUpdatedAt = String(payload["expectedUpdatedAt"] || payload["湲곕??섏젙?쇱떆"] || "").trim();
  var currentVersion = parseNumber_(existingRecord["踰꾩쟾"] || 0);
  var currentUpdatedAt = String(existingRecord["?섏젙?쇱떆"] || "").trim();

  if (expectedVersion > 0 && currentVersion !== expectedVersion) {
    return true;
  }

  if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
    return true;
  }

  return false;
}

function writeInspectionRow_(sheet, targetRow, record) {
  const headers = inspectionHeaders_();
  const values = [headers.map(function (header) {
    return record[header] !== undefined ? record[header] : "";
  })];

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, values[0].length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

function writeRecordRow_(sheet, targetRow, record) {
  const headers = recordHeaders_();
  const values = [headers.map(function (header) {
    return record[header] !== undefined ? record[header] : "";
  })];

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

    const key = makeEntityKey_(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?], row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"]);
    if (!totalsMap[key]) {
      totalsMap[key] = { returnQty: 0, exchangeQty: 0 };
    }

    totalsMap[key].returnQty += parseNumber_(row["?뚯넚?섎웾"] || 0);
    totalsMap[key].exchangeQty += parseNumber_(row["援먰솚?섎웾"] || 0);
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
  purgeEmptyInspectionRows_(inspectionSheet);
}

function purgeEmptyInspectionRows_(inspectionSheet) {
  if (!inspectionSheet || inspectionSheet.getLastRow() < 2) return 0;

  const values = inspectionSheet
    .getRange(2, 1, inspectionSheet.getLastRow() - 1, inspectionSheet.getLastColumn())
    .getValues();
  const rowsToDelete = [];

  for (var i = 0; i < values.length; i += 1) {
    const row = {
      "寃?덉닔??: values[i][7],
      "?뚯넚?섎웾": values[i][8],
      "援먰솚?섎웾": values[i][9],
      "?ъ쭊媛쒖닔": values[i][10],
      "비고": values[i][11],
      "BRIX최저": values[i][12],
      "BRIX최고": values[i][13],
      "BRIX평균": values[i][14],
      "중량메모": values[i][15],
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
    current[9] === "泥섎━?좏삎" &&
    current[10] === "?뚯넚?섎웾" &&
    current[11] === "援먰솚?섎웾" &&
    current[12] === "鍮꾧퀬" &&
    current[13] === "?ъ쭊媛쒖닔" &&
    current[14] === "珥?諛쒖＜ ?섎웾";

  if (isNewFormat && sheet.getLastColumn() === recordHeaders_().length) {
    return;
  }

  if (sheet.getLastRow() < 2) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 17));
  const rows = dataRange.getValues();
  const migrated = rows.map(function (row) {
    const typeValue = String(row[9] || "").trim() || (String(row[10] || "").trim() === "EXCHANGE" ? "援먰솚" : String(row[10] || "").trim() === "RETURN" ? "?뚯넚" : "");
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

function migrateInspectionSheetIfNeeded_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) {
    return;
  }

  var next = inspectionHeaders_();
  var currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), next.length)).getValues()[0];
  var current = currentHeaders.map(function (item) {
    return String(item || "").trim();
  });
  var isNewFormat =
    current[7] === "寃?덉닔?? &&
    current[8] === "?뚯넚?섎웾" &&
    current[9] === "援먰솚?섎웾" &&
    current[10] === "?ъ쭊媛쒖닔";

  if (isNewFormat && sheet.getLastColumn() === next.length) {
    return;
  }

  if (sheet.getLastRow() < 2) {
    ensureHeaderRow_(sheet, next);
    return;
  }

  var dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 13));
  var rows = dataRange.getValues();
  var migrated = rows.map(function (row) {
    var count = [row[10] || "", row[11] || "", row[12] || ""].filter(function (item) {
      return String(item || "").trim();
    }).length;

    return [
      row[0] || "",
      row[1] || "",
      row[2] || "",
      row[3] || "",
      row[4] || "",
      row[5] || 0,
      row[6] || 0,
      row[7] || 0,
      row[8] || 0,
      row[9] || 0,
      count,
      "",
      "",
      "",
      "",
      "",
      row[11] || "",
      row[12] || "",
      row[13] || "",
      row[14] || "",
      row[15] || "",
      row[16] || 0,
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

function inspectionHeaders_() {
  return [
    "?묒꽦?쇱떆",
    "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?,
    "?곹뭹肄붾뱶",
    "?곹뭹紐?,
    "?묐젰?щ챸",
    "?꾩껜諛쒖＜?섎웾",
    "諛쒖＜?섎웾",
    "寃?덉닔??,
    "?뚯넚?섎웾",
    "援먰솚?섎웾",
    "?ъ쭊媛쒖닔",
    "비고",
    "BRIX최저",
    "BRIX최고",
    "BRIX평균",
    "중량메모",
    "?섏젙?쇱떆",
    "?섏젙??,
    "?섏젙?륤D",
    "?ъ쭊?섏젙?쇱떆",
    "?ъ쭊?섏젙??,
    "踰꾩쟾",
  ];
}

function recordHeaders_() {
  return [
    "?묒꽦?쇱떆",
    "?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?,
    "?곹뭹紐?,
    "?곹뭹肄붾뱶",
    "?쇳꽣紐?,
    "?묐젰?щ챸",
    "諛쒖＜?섎웾",
    "?됱궗紐?,
    "?됱궗?щ?",
    "泥섎━?좏삎",
    "?뚯넚?섎웾",
    "援먰솚?섎웾",
    "鍮꾧퀬",
    "?ъ쭊媛쒖닔",
    "珥?諛쒖＜ ?섎웾",
    "?섏젙?쇱떆",
    "?섏젙??,
    "?섏젙?륤D",
    "?ъ쭊?섏젙?쇱떆",
    "?ъ쭊?섏젙??,
    "踰꾩쟾",
  ];
}

function happycallHeaders_() {
  return [
    "?섏쭛??,
    "硫붿씪ID",
    "?쒕ぉ",
    "蹂몃Ц",
    "?묒닔?쇱떆",
    "?遺꾨쪟",
    "以묐텇瑜?,
    "?뚮텇瑜?,
    "?곹뭹紐?,
    "?곹뭹肄붾뱶",
    "?뚰듃?덉궗",
    "蹂몃Ц?μ븷?좏삎",
    "?쒕ぉ媛먯??ъ쑀",
    "理쒖쥌?ъ쑀",
    "嫄댁닔",
    "?먮낯JSON",
    "?앹꽦?쇱떆",
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
    return String(b["?묒닔?쇱떆"] || "").localeCompare(String(a["?묒닔?쇱떆"] || ""));
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
    if (!row["?섏쭛??]) return;
    normalizedMap[row["?섏쭛??]] = row;
  });

  Object.keys(normalizedMap).forEach(function (collectKey) {
    var row = normalizedMap[collectKey];
    var targetRow = keyRowMap[row["?섏쭛??]] || (row["硫붿씪ID"] ? mailRowMap[row["硫붿씪ID"]] : 0) || 0;

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
    payload.subject || payload["?쒕ぉ"] || payload.title || ""
  ).trim();
  var body = String(
    payload.body || payload["蹂몃Ц"] || payload.content || ""
  ).trim();
  var mailId = String(
    payload.messageId || payload.internetMessageId || payload["硫붿씪ID"] || payload.id || ""
  ).trim();
  var parsed = parseHappycallBodyFields_(body);
  var productCode = normalizeCode_(
    payload.productCode || payload["?곹뭹肄붾뱶"] || getHappycallFieldValue_(parsed, ["?곹뭹肄붾뱶", "肄붾뱶", "諛붿퐫??])
  );
  var productName = String(
    payload.productName ||
      payload["?곹뭹紐?] ||
      getHappycallFieldValue_(parsed, ["?곹뭹紐?, "?뚮텇瑜?, "?덈ぉ紐?, "?덈챸"]) ||
      ""
  ).trim();
  var partnerName = String(
    payload.partnerName ||
      payload["?뚰듃?덉궗"] ||
      payload["?묐젰?щ챸"] ||
      getHappycallFieldValue_(parsed, ["?뚰듃?덉궗", "?묐젰??, "?묐젰?щ챸", "嫄곕옒泥섎챸"]) ||
      ""
  ).trim();
  var receivedAt = String(
    payload.receivedAt ||
      payload["?묒닔?쇱떆"] ||
      getHappycallFieldValue_(parsed, ["?묒닔?쇱떆", "?묒닔?쇱옄", "?깅줉?쇱떆", "臾몄쓽?쇱떆"]) ||
      payload.createdAt ||
      new Date().toISOString()
  ).trim();
  var bodyReason = String(
    payload.reason ||
      payload["?μ븷?좏삎"] ||
      payload["蹂몃Ц?μ븷?좏삎"] ||
      getHappycallFieldValue_(parsed, ["?μ븷?좏삎", "?댁긽?좏삎", "?대젅?꾩쑀??, "?ъ쑀"]) ||
      ""
  ).trim();
  var explicitMajor = String(
    payload.majorCategory ||
      payload["?遺꾨쪟"] ||
      getHappycallFieldValue_(parsed, ["?遺꾨쪟"]) ||
      ""
  ).trim();
  var explicitMid = String(
    payload.midCategory ||
      payload["以묐텇瑜?] ||
      getHappycallFieldValue_(parsed, ["以묐텇瑜?]) ||
      ""
  ).trim();
  var explicitSub = String(
    payload.subCategory ||
      payload["?뚮텇瑜?] ||
      getHappycallFieldValue_(parsed, ["?뚮텇瑜?]) ||
      ""
  ).trim();
  var titleReason = extractHappycallTitleReason_(subject);
  var categoryInfo = lookupHappycallCategoryInfo_(categoryIndex, {
    productCode: productCode,
    productName: productName,
    partnerName: partnerName,
    subject: subject,
  });
  var finalReason = titleReason || normalizeHappycallReason_(bodyReason) || "湲고?";
  var originalSnapshot = {
    ?쒕ぉ: subject,
    硫붿씪ID: mailId,
    ?묒닔?쇱떆: receivedAt,
    ?遺꾨쪟: explicitMajor || categoryInfo.majorCategory || "",
    以묐텇瑜? explicitMid || categoryInfo.midCategory || "",
    ?뚮텇瑜? explicitSub || categoryInfo.subCategory || productName || categoryInfo.productName || "",
    ?곹뭹紐? productName || categoryInfo.productName || explicitSub || "",
    ?곹뭹肄붾뱶: productCode || categoryInfo.productCode || "",
    ?뚰듃?덉궗: partnerName || categoryInfo.partnerName || "",
    蹂몃Ц?μ븷?좏삎: bodyReason,
    ?쒕ぉ媛먯??ъ쑀: titleReason,
    理쒖쥌?ъ쑀: finalReason,
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
    "?섏쭛??: mailId || createDigestString_(keyBasis),
    "硫붿씪ID": truncateSheetCell_(mailId, 5000),
    "?쒕ぉ": truncateSheetCell_(subject, 5000),
    "蹂몃Ц": truncateSheetCell_(body, 45000),
    "?묒닔?쇱떆": truncateSheetCell_(receivedAt, 5000),
    "?遺꾨쪟": truncateSheetCell_(explicitMajor || categoryInfo.majorCategory || "", 5000),
    "以묐텇瑜?: truncateSheetCell_(explicitMid || categoryInfo.midCategory || "", 5000),
    "?뚮텇瑜?: truncateSheetCell_(explicitSub || categoryInfo.subCategory || productName || categoryInfo.productName || "", 5000),
    "?곹뭹紐?: truncateSheetCell_(productName || categoryInfo.productName || explicitSub || "", 5000),
    "?곹뭹肄붾뱶": truncateSheetCell_(productCode || categoryInfo.productCode || "", 5000),
    "?뚰듃?덉궗": truncateSheetCell_(partnerName || categoryInfo.partnerName || "", 5000),
    "蹂몃Ц?μ븷?좏삎": truncateSheetCell_(bodyReason, 5000),
    "?쒕ぉ媛먯??ъ쑀": truncateSheetCell_(titleReason, 5000),
    "理쒖쥌?ъ쑀": truncateSheetCell_(finalReason, 5000),
    "嫄댁닔": 1,
    "?먮낯JSON": truncateSheetCell_(JSON.stringify(originalSnapshot), 45000),
    "?앹꽦?쇱떆": new Date().toISOString(),
  };
}

function parseHappycallBodyFields_(body) {
  var lines = String(body || "").split(/\r?\n/);
  var result = {};

  lines.forEach(function (line) {
    var text = String(line || "").trim();
    if (!text) return;

    var match = text.match(/^([^:竊?+)\s*[:竊?\s*(.+)$/);
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
  var rawTokens = String(value || "").match(/[媛-?쥱-Za-z]+/g) || [];
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
    ?곹뭹: true,
    ?곹뭹紐? true,
    ?됱궗?곹뭹: true,
    ?덉빟: true,
    怨듬룞: true,
    湲닿툒: true,
    ?몃??댁슜: true,
    ?곹깭: true,
    蹂吏? true,
    ?먮ℓ?? true,
    ?대젅?? true,
    ?묒닔: true,
    ?뺤씤: true,
  }[text] === true;
}

function getDistinctiveHappycallTokens_() {
  return [
    "?꾨━誘몄뾼",
    "?대옒??,
    "?ㅼ쐞?곗삤",
    "怨좊떦??,
    "?덈땲",
    "怨⑤뱶",
    "?깃컻",
    "?≪씠",
    "?좉컻??,
    "?먮낫",
    "?밸?",
    "?怨?,
    "?뚭낵",
    "留앷퀬",
    "諛붾굹??,
    "?ㅻ젋吏",
    "媛먭랠",
    "李명?由?,
    "?ㅼ씠",
    "?ъ옣臾?
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

  (text.match(/\d+\s*(??媛??≪씠|遊???諛뺤뒪|留???以꾧린|????kg|g|ml|l)/gi) || []).forEach(pushHint_);
  ["?깃컻", "?≪씠", "諛뺤뒪", "遊?, "??, "留?, "??, "以꾧린", "??, "??, "?좉컻??].forEach(function (token) {
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
    ["?깃컻", "?≪씠", "遊?, "??, "諛뺤뒪", "留?, "??, "以꾧린", "??, "??, "?좉컻??],
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
    { reason: "?⑹쓬", keywords: ["??, "遺??, "怨고뙜??, "蹂吏덈???] },
    { reason: "臾대쫫", keywords: ["臾대쫫", "臾쇰윭", "臾쇱뻘", "吏볥Т由?] },
    { reason: "媛덈씪吏?, keywords: ["媛덈씪", "?щ옓", "?곗쭚", "李?뼱"] },
    { reason: "?뚯넀", keywords: ["?뚯넀", "源⑥쭚", "?뚮┝", "李??"] },
    { reason: "?꾩깉", keywords: ["?꾩깉", "?낆랬", "?댁랬"] },
    { reason: "?대Ъ", keywords: ["?대Ъ", "踰뚮젅", "踰뚮젅癒?, "?ㅼ뿼"] },
    { reason: "怨쇱닕", keywords: ["怨쇱닕", "吏?섏튂寃뚯씡", "?덈Т??] },
    { reason: "誘몄닕", keywords: ["誘몄닕", "?쒖씡", "?덉씡"] },
    { reason: "?쒕벀", keywords: ["?쒕벀", "?쒕뱾", "嫄댁“", "彛덇?"] },
    { reason: "?곹뭹蹂吏?, keywords: ["蹂吏?, "?곹깭?댁긽", "?댁긽", "?덉쭏???] },
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
  var excludeRows = readObjectsSheet_(SHEET_NAMES.exclude);
  var excludedCodes = {};
  var excludedPairs = {};
  var excludedPartners = {};

  excludeRows.forEach(function (row) {
    var code = normalizeCode_(row["?곹뭹肄붾뱶"] || row["?곹뭹 肄붾뱶"] || row["肄붾뱶"] || row["諛붿퐫??]);
    var partner = normalizeText_(row["?묐젰??] || row["?묐젰?щ챸"] || "");
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

  sourceRows.forEach(function (row) {
    var productCode = normalizeCode_(row.__productCode || getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??]));
    var productName = String(row.__productName || getRowFieldValue_(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || "").trim();
    var partnerName = String(row.__partner || getRowFieldValue_(row, ["?묐젰?щ챸", "?묐젰??, "嫄곕옒泥섎챸"]) || "").trim();
    var qty = parseNumber_(row.__qty || getRowFieldValue_(row, ["珥?諛쒖＜?섎웾", "諛쒖＜?섎웾", "?낃퀬?섎웾", "?섎웾"]));
    if (isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners)) return;
    var skuKey = makeSkuKey_(productCode, partnerName);
    var nameKey = normalizeHappycallMatchText_(productName);
    var namePartnerKey = normalizeHappycallMatchText_(productName) + "||" + normalizeHappycallMatchText_(partnerName);
    var canonicalKey = skuKey || namePartnerKey || nameKey;
    var info = canonicalKey && index.infoByCanonicalKey[canonicalKey];

    if (!info) {
      info = {
        majorCategory: String(getRowFieldValue_(row, ["?遺꾨쪟", "怨쇱콈", "移댄뀒怨좊━?", "?移댄뀒怨좊━"]) || "").trim(),
        midCategory: String(getRowFieldValue_(row, ["以묐텇瑜?, "移댄뀒怨좊━以?, "以묒뭅?뚭퀬由?]) || "").trim(),
        subCategory: String(getRowFieldValue_(row, ["?뚮텇瑜?, "移댄뀒怨좊━??, "?뚯뭅?뚭퀬由?]) || "").trim(),
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

  // 1李? ?묐젰??+ ?곹뭹紐?湲곗??쇰줈留??곗꽑 留ㅼ묶?쒕떎.
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
    // 1李?exact: 媛숈? ?묐젰???덉뿉???곹뭹紐낆씠 吏곸젒 留욌뒗 ?꾨낫瑜??곗꽑 ?ъ슜.
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
    var productHasSpecHint = /\d+\s*(??媛?g|kg|ml|l|遊???諛뺤뒪|?≪씠|留???以꾧린|????/i.test(productName);
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

  // 2李? ?쒕ぉ/蹂몃Ц源뚯? 遊먮룄 ??뱀꽦??異⑸텇???믪쓣 ?뚮쭔 留ㅼ묶?쒕떎.
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
  var hasSpecHint = /\d+\s*(??媛?g|kg|ml|l|遊???/i.test(String(text || ""));

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

  // ?좊ℓ?섎㈃ 誘몃텇瑜섎줈 ?④릿??
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
    row["?섏쭛??],
    row["硫붿씪ID"],
    row["?쒕ぉ"],
    row["蹂몃Ц"],
    row["?묒닔?쇱떆"],
    row["?遺꾨쪟"],
    row["以묐텇瑜?],
    row["?뚮텇瑜?],
    row["?곹뭹紐?],
    row["?곹뭹肄붾뱶"],
    row["?뚰듃?덉궗"],
    row["蹂몃Ц?μ븷?좏삎"],
    row["?쒕ぉ媛먯??ъ쑀"],
    row["理쒖쥌?ъ쑀"],
    row["嫄댁닔"],
    row["?먮낯JSON"],
    row["?앹꽦?쇱떆"],
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
  return text.slice(0, Math.max(0, limit - 12)) + " ...(?앸왂)";
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
  var categoryIndex = buildHappycallCategoryIndex_();
  var rows = loadHappycallRows_().filter(function (row) {
    if (!isHappycallWithinDays_(row["?묒닔?쇱떆"] || row["?앹꽦?쇱떆"], 30)) return false;
    return !!findHappycallCategoryMatch_(categoryIndex, {
      productCode: row["?곹뭹肄붾뱶"] || "",
      productName: row["?곹뭹紐?] || row["?뚮텇瑜?] || "",
      partnerName: row["?뚰듃?덉궗"] || "",
      subject: row["?쒕ぉ"] || "",
      body: row["蹂몃Ц"] || "",
    });
  });
  var now = new Date();
  var periods = [
    { key: "1d", label: "理쒓렐 1??, days: 1 },
    { key: "7d", label: "理쒓렐 7??, days: 7 },
    { key: "30d", label: "理쒓렐 1??, days: 30 },
  ];
  var periodMap = {};
  var productRanks = {};

  periods.forEach(function (period) {
    var startAt = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
    var filtered = rows.filter(function (row) {
      var receivedAt = new Date(row["?묒닔?쇱떆"] || row["?앹꽦?쇱떆"] || "");
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
    var count = Math.max(1, parseNumber_(row["嫄댁닔"] || 1));
    var productItem = {
      key: row["?곹뭹肄붾뱶"] || normalizeHappycallMatchText_(row["?곹뭹紐?]),
      productCode: row["?곹뭹肄붾뱶"] || "",
      productName: row["?곹뭹紐?] || row["?뚮텇瑜?] || "",
      partnerName: row["?뚰듃?덉궗"] || "",
      majorCategory: row["?遺꾨쪟"] || "",
      midCategory: row["以묐텇瑜?] || "",
      subCategory: row["?뚮텇瑜?] || "",
      finalReason: row["理쒖쥌?ъ쑀"] || "湲고?",
      count: count,
    };

    totals.totalCount += count;
    mergeHappycallBucket_(totals.products, productItem.key || productItem.productName || "誘몃텇瑜섏긽??, productItem, count);
    mergeHappycallBucket_(totals.majorCategories, row["?遺꾨쪟"] || "誘몃텇瑜?, { name: row["?遺꾨쪟"] || "誘몃텇瑜? }, count);
    mergeHappycallBucket_(totals.midCategories, row["以묐텇瑜?] || "誘몃텇瑜?, { name: row["以묐텇瑜?] || "誘몃텇瑜? }, count);
    mergeHappycallBucket_(totals.subCategories, row["?뚮텇瑜?] || row["?곹뭹紐?] || "誘몃텇瑜?, { name: row["?뚮텇瑜?] || row["?곹뭹紐?] || "誘몃텇瑜? }, count);
    mergeHappycallBucket_(totals.reasons, row["理쒖쥌?ъ쑀"] || "湲고?", { name: row["理쒖쥌?ъ쑀"] || "湲고?" }, count);
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
      name: seed.name || seed.productName || seed.subCategory || key || "誘몃텇瑜섏긽??,
      productCode: seed.productCode || "",
      productName: seed.productName || seed.subCategory || seed.name || key || "誘몃텇瑜섏긽??,
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
        name: item.name || item.productName || item.subCategory || item.key || "誘몃텇瑜섏긽??,
        productCode: item.productCode,
        productName: item.productName || item.subCategory || item.name || item.key || "誘몃텇瑜섏긽??,
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

function uploadPhotos_(payload) {
  var itemKey = String(payload.itemKey || "").trim();
  var productName = String(payload.productName || payload.baseName || "?곹뭹").trim();
  var partnerName = String(payload.partnerName || "").trim();
  var photoKind = String(payload.photoKind || "").trim().toLowerCase();
  var photos = Array.isArray(payload.photos) ? payload.photos : [];
  var namePrefix =
    photoKind === "inspection"
      ? "寃??
      : photoKind === "defect"
      ? "遺덈웾"
      : "?ъ쭊";
  var uploadBaseName = [namePrefix, partnerName, productName].filter(Boolean).join("_");
  var uploaded = savePhotosToDrive_(photos, uploadBaseName, "");

  return {
    itemKey: itemKey,
    photos: uploaded,
  };
}

function savePhotoMeta_(payload) {
  var action = String(payload.photoAction || "append").trim().toLowerCase();
  var photoItem = payload.photoItem || null;
  var photoFileId = String(payload.photoFileId || (photoItem && photoItem.fileId) || "").trim();
  var photoKind = String(payload.photoKind || "").trim().toLowerCase();
  var existingRecord = null;
  var row = null;
  var response = {
    photoSaved: false,
    photoKind: photoKind,
    retryable: true,
    conflict: false,
  };

  if (!photoFileId) {
    throw new Error("?ъ쭊 ?뚯씪 ID媛 ?놁뒿?덈떎.");
  }

  if (String(payload.type || "").trim() === "inspection" || !String(payload["?쇳꽣紐?] || payload.centerName || "").trim()) {
    var inspectionSheet = getInspectionSheet_(SpreadsheetApp.getActiveSpreadsheet());
    var inspectionRow = findInspectionRow_(
      inspectionSheet,
      payload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || payload.jobKey || "",
      payload["?곹뭹肄붾뱶"] || payload.productCode || "",
      payload["?묐젰?щ챸"] || payload.partnerName || ""
    );
    existingRecord = inspectionRow > 0 ? readInspectionRow_(inspectionSheet, inspectionRow) : null;
    if (hasRowConflict_(payload, existingRecord)) {
      return {
        conflicts: [{
          __conflict: true,
          serverRecord: existingRecord,
        }],
        photoSaved: false,
        retryable: false,
        conflict: true,
      };
    }

    row = buildInspectionPayload_(
      {
        ...payload,
        photoMutation: action,
        photoFileId: photoFileId,
        photoKind: photoKind,
      },
      existingRecord
    );
    writeInspectionRow_(inspectionSheet, inspectionRow, row);
    upsertTypedPhotoAssetsForRow_(row, "inspection");
    response.photoSaved = true;
    response.inspectionRow = row;
    response.hasInspection = true;
    response.hasMovement = false;
    return response;
  }

  var recordsSheet = getRecordSheet_(SpreadsheetApp.getActiveSpreadsheet());
  var movementRow = findMovementRow_(
    recordsSheet,
    payload["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || payload.jobKey || "",
    payload["?곹뭹肄붾뱶"] || payload.productCode || "",
    payload["?묐젰?щ챸"] || payload.partnerName || "",
    payload["?쇳꽣紐?] || payload.centerName || "",
    payload["泥섎━?좏삎"] || payload.movementType || ""
  );
  existingRecord = movementRow > 0 ? readMovementRow_(recordsSheet, movementRow) : null;
  if (hasRowConflict_(payload, existingRecord)) {
    return {
      conflicts: [{
        __conflict: true,
        serverRecord: existingRecord,
      }],
      photoSaved: false,
      retryable: false,
      conflict: true,
    };
  }

  row = buildRecordPayload_(
    {
      ...payload,
      photoMutation: action,
      photoFileId: photoFileId,
      photoKind: photoKind,
    },
    existingRecord
  );
  writeRecordRow_(recordsSheet, movementRow, row);
  upsertTypedPhotoAssetsForRow_(row, "movement");
  response.photoSaved = true;
  response.movementRow = row;
  response.hasInspection = false;
  response.hasMovement = true;
  return response;
}

function savePhotoToDrive_(photo, baseName, index, preferredFileName) {
  const folderId = PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");

  if (!folderId) {
    throw new Error("?ъ쭊 ?낅줈???ㅽ뙣: PHOTO_FOLDER_ID媛 ?ㅼ젙?섏? ?딆븯?듬땲??");
  }

  const folder = DriveApp.getFolderById(folderId);
  const safeBaseName = sanitizeFileName_(baseName || "?곹뭹");
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
  var safeBaseName = sanitizeFileName_(baseName || "?곹뭹");
  var extension =
    getExtensionFromMimeType_((photo && photo.mimeType) || "") ||
    getExtensionFromFileName_((photo && photo.fileName) || "") ||
    "jpg";
  var order = index + 1;
  var padded = order < 10 ? "0" + order : String(order);
  return safeBaseName + "_" + padded + "." + extension;
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

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    try {
      sheet = ss.insertSheet(name);
    } catch (err) {
      var message = String((err && err.message) || err || "");
      if (message.indexOf("already exists") >= 0 || message.indexOf("?대? ?덉뒿?덈떎") >= 0) {
        sheet = ss.getSheetByName(name);
      } else {
        throw err;
      }
    }
  }
  if (!sheet) {
    throw new Error("?쒗듃瑜?李얠쓣 ???놁뒿?덈떎: " + name);
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
  var usedPhotoSources = {};
  var skippedCount = 0;

  records.forEach(function (record) {
    var photos = getPhotoSourcesFromRecord_(record);
    if (!photos.length) return;

    if (mode === "inspection") {
      var hasInspectionPhoto =
        !!String(record["?ъ쭊留곹겕"] || "").trim() ||
        !!String(record["?ъ쭊留곹겕紐⑸줉"] || "").trim() ||
        !!String(record["?ъ쭊?뚯씪ID紐⑸줉"] || "").trim();
      if (!hasInspectionPhoto) return;
    } else {
    var hasMovement = isMovementRecord_(record);
    if (mode === "movement" && !hasMovement) return;
    if (mode !== "movement" && hasMovement) return;
    }

    photos.forEach(function (source, index) {
      try {
        var sourceKey = buildPhotoSourceDedupKey_(source);
        if (sourceKey && usedPhotoSources[sourceKey]) {
          return;
        }

        var asset = getPhotoAssetFromSource_(source);
        if (!asset || !asset.blob) {
          skippedCount += 1;
          return;
        }

        var finalName = buildPhotoZipFileName_(record, index + 1, asset.blob, source);
        var dedupeKey = finalName.toLowerCase();
        var duplicateSuffix = 2;
        while (usedNames[dedupeKey]) {
          finalName = appendDuplicateSuffixToFileName_(finalName, duplicateSuffix);
          dedupeKey = finalName.toLowerCase();
          duplicateSuffix += 1;
        }
        usedNames[dedupeKey] = true;
        if (sourceKey) {
          usedPhotoSources[sourceKey] = true;
        }

        blobs.push(asset.blob.setName(finalName));
      } catch (err) {
        skippedCount += 1;
      }
    });
  });

  var fileName =
    mode === "movement"
      ? "?뚯넚_援먰솚_?ъ쭊_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip"
      : mode === "inspection"
      ? "寃?덉궗吏?" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip"
      : "?ъ쭊留뚯엳?붿긽??" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd") + ".zip";

  if (!blobs.length) {
    return {
      fileName: fileName,
      mimeType: "application/zip",
      zipBase64: "",
      downloadUrl: "",
      fileId: "",
      files: [],
      addedCount: 0,
      skippedCount: skippedCount,
    };
  }

  var zipBatches = [];
  var currentBatch = [];
  var currentSize = 0;

  blobs.forEach(function (blob) {
    var blobSize = 0;
    try {
      blobSize = blob.getBytes().length;
    } catch (_) {
      blobSize = 0;
    }

    if (currentBatch.length && currentSize + blobSize > PHOTO_ZIP_MAX_BYTES) {
      zipBatches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(blob);
    currentSize += blobSize;
  });

  if (currentBatch.length) {
    zipBatches.push(currentBatch);
  }

  var zipFiles = zipBatches.map(function (batch, index) {
    return savePhotoZipBatch_(batch, fileName, index + 1, zipBatches.length);
  });

  var firstFile = zipFiles[0] || { fileName: fileName, fileId: "", downloadUrl: "" };
  return {
    fileName: firstFile.fileName || fileName,
    mimeType: "application/zip",
    zipBase64: "",
    downloadUrl: firstFile.downloadUrl || "",
    fileId: firstFile.fileId || "",
    files: zipFiles,
    addedCount: blobs.length,
    skippedCount: skippedCount,
  };
}

function buildPhotoSourceDedupKey_(source) {
  var text = extractImageFormulaUrl_(source);
  var driveId = extractGoogleDriveId_(text);
  if (driveId) {
    return "drive::" + driveId;
  }

  var normalized = String(text || "").trim();
  return normalized ? "url::" + normalized : "";
}

function buildPhotoZipFileName_(record, sequence, blob, source) {
  var productName = sanitizeFileName_(record["?곹뭹紐?] || record["?곹뭹肄붾뱶"] || "?곹뭹");
  var partnerName = sanitizeFileName_(record["?묐젰?щ챸"] || "?묐젰??);
  var extension = getBlobExtension_(blob, source);
  return productName + "_" + partnerName + "_" + sequence + "." + extension;
}

function appendDuplicateSuffixToFileName_(fileName, suffix) {
  var text = String(fileName || "image.jpg");
  var match = text.match(/^(.*?)(\.[a-zA-Z0-9]+)?$/);
  var base = match ? match[1] : text;
  var extension = match && match[2] ? match[2] : "";
  return base + "_" + suffix + extension;
}

function getPhotoSourcesFromRecord_(record) {
  var rawItems = []
    .concat([record["?ъ쭊URL"], record["?ъ쭊留곹겕"]])
    .concat(splitPhotoSourceText_(record["?ъ쭊留곹겕紐⑸줉"]))
    .concat(splitPhotoSourceText_(record["?ъ쭊?뚯씪ID紐⑸줉"]));

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

function verifyCachedJobMeta_(jobsSheet, jobKey, sourceFileName, expectedRowCount) {
  const job = findJobByKey_(jobsSheet, jobKey);
  if (!job) {
    throw new Error("jobs ???寃利??ㅽ뙣: job row瑜?李얠? 紐삵뻽?듬땲??");
  }

  if (String(job.source_file_name || "").trim() !== String(sourceFileName || "").trim()) {
    throw new Error("jobs ???寃利??ㅽ뙣: source_file_name 遺덉씪移?);
  }

  if (Number(job.row_count || 0) !== Number(expectedRowCount || 0)) {
    throw new Error("jobs ???寃利??ㅽ뙣: row_count 遺덉씪移?);
  }
}

function verifyCachedJobRows_(cacheSheet, jobKey, expectedRowCount) {
  if (Number(expectedRowCount || 0) === 0) {
    return;
  }

  if (cacheSheet.getLastRow() < 2) {
    throw new Error("job_cache ???寃利??ㅽ뙣: cache sheet???곗씠?곌? ?놁뒿?덈떎.");
  }

  const values = cacheSheet.getRange(2, 1, cacheSheet.getLastRow() - 1, 4).getValues();
  const matchedRows = values.filter(function (row) {
    return String(row[1] || "").trim() === String(jobKey || "").trim();
  });

  if (matchedRows.length !== Number(expectedRowCount || 0)) {
    throw new Error(
      "job_cache ???寃利??ㅽ뙣: expected=" +
        expectedRowCount +
        ", actual=" +
        matchedRows.length
    );
  }
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
  var text = String(name || "?곹뭹")
    .replace(/[\\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .trim();

  return text || "?곹뭹";
}

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

function buildZipPartFileName_(baseFileName, partIndex, totalParts) {
  if (totalParts <= 1) {
    return baseFileName;
  }
  var dotIndex = String(baseFileName || "").lastIndexOf(".");
  if (dotIndex < 0) {
    return baseFileName + "_part" + padNumber_(partIndex, 2);
  }
  return (
    baseFileName.slice(0, dotIndex) +
    "_part" +
    padNumber_(partIndex, 2) +
    baseFileName.slice(dotIndex)
  );
}

function savePhotoZipBatch_(blobs, baseFileName, partIndex, totalParts) {
  var list = Array.isArray(blobs) ? blobs : [];
  var fileName = buildZipPartFileName_(baseFileName, partIndex, totalParts);
  var zipBlob = Utilities.zip(list, fileName).setName(fileName);
  var savedZip = saveZipToDrive_(zipBlob, fileName);
  return {
    fileName: fileName,
    fileId: savedZip.fileId,
    downloadUrl: savedZip.downloadUrl,
    driveUrl: savedZip.driveUrl,
    itemCount: list.length,
  };
}

function getRecordType_(record) {
  var type = String(record["泥섎━?좏삎"] || "").trim();
  if (type) return type;
  if (parseNumber_(record["?뚯넚?섎웾"]) > 0) return "?뚯넚";
  if (parseNumber_(record["援먰솚?섎웾"]) > 0) return "援먰솚";
  return "湲고?";
}

function isMovementRecord_(record) {
  var type = String(getRecordType_(record) || "").trim().toUpperCase();
  if (["?뚯넚", "援먰솚", "RETURN", "EXCHANGE"].indexOf(type) >= 0) return true;
  return parseNumber_(record["?뚯넚?섎웾"]) > 0 || parseNumber_(record["援먰솚?섎웾"]) > 0;
}

function resetCurrentJobInputData_(payload) {
  var jobKey = String(payload.jobKey || "").trim();
  var password = String(payload.password || "").trim();

  if (!jobKey) {
    throw new Error("珥덇린?뷀븷 ?묒뾽?ㅺ? ?놁뒿?덈떎.");
  }

  if (password !== ADMIN_RESET_PASSWORD) {
    throw new Error("愿由ъ옄 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.");
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

    if (String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() !== jobKey) continue;

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
  var code = normalizeCode_(getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??]));
  var partner = normalizeText_(
    getRowFieldValue_(row, ["?묐젰?щ챸", "?묐젰??, "嫄곕옒泥섎챸(援щℓ議곌굔紐?", "嫄곕옒泥섎챸"])
  );
  if (code || partner) return makeSkuKey_(code, partner);
  return String(getRowFieldValue_(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"]) || "").trim();
}

function buildDashboardSourceRows_(latestRows, reservationRows) {
  var merged = Array.isArray(latestRows) ? latestRows.slice() : [];

  (Array.isArray(reservationRows) ? reservationRows : []).forEach(function (row, index) {
    var productCode = normalizeCode_(
      getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??])
    );
    var partnerName = normalizeText_(
      getRowFieldValue_(row, ["?묐젰?щ챸", "?묐젰??, "嫄곕옒泥섎챸"])
    );
    var productName = String(
      getRowFieldValue_(row, ["?곹뭹紐?, "?곹뭹 紐?, "?덈ぉ紐?, "?덈챸"])
    ).trim();
    var centerName = String(getRowFieldValue_(row, ["?쇳꽣", "?쇳꽣紐?])).trim();
    var qty = parseNumber_(getRowFieldValue_(row, ["諛쒖＜?섎웾", "?낃퀬?섎웾", "?섎웾"]));
    var cost = parseNumber_(getRowFieldValue_(row, ["?곹뭹?먭?", "?낃퀬?먭?", "?먭?"]));

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
      ?곹뭹肄붾뱶: productCode,
      ?곹뭹紐? productName,
      ?묐젰?щ챸: partnerName,
      ?쇳꽣紐? centerName,
      諛쒖＜?섎웾: qty,
      ?곹뭹?먭?: cost,
      ?낃퀬?먭?: cost,
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
    return String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() === currentJobKey;
  });
  var recordRows = loadRecords_().filter(function (row) {
    return String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() === currentJobKey;
  });
  var excludeRows = readObjectsSheet_(SHEET_NAMES.exclude);
  var eventRows = readObjectsSheet_(SHEET_NAMES.event);

  var excludedCodes = {};
  var excludedPairs = {};
  var excludedPartners = {};

  excludeRows.forEach(function (row) {
    var code = normalizeCode_(row["?곹뭹肄붾뱶"] || row["?곹뭹 肄붾뱶"] || row["肄붾뱶"] || row["諛붿퐫??]);
    var partner = normalizeText_(row["?묐젰??] || row["?묐젰?щ챸"] || "");
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
    var code = normalizeCode_(row["?곹뭹肄붾뱶"] || row["?곹뭹 肄붾뱶"] || row["肄붾뱶"] || row["諛붿퐫??]);
    if (code) {
      eventCodeMap[code] = true;
    }
  });

  sourceRows.forEach(function (row) {
    var code = normalizeCode_(row.__productCode || getRowFieldValue_(row, ["?곹뭹肄붾뱶", "?곹뭹 肄붾뱶", "肄붾뱶", "諛붿퐫??]));
    var partner = normalizeText_(row.__partner || getRowFieldValue_(row, ["嫄곕옒泥섎챸(援щℓ議곌굔紐?", "嫄곕옒泥섎챸", "?묐젰??, "?묐젰?щ챸"]) || "");
    var qty = parseNumber_(row.__qty || getRowFieldValue_(row, ["珥?諛쒖＜?섎웾", "諛쒖＜?섎웾", "?낃퀬?섎웾", "?섎웾"]));
    var cost = parseNumber_(row.__incomingCost || getRowFieldValue_(row, ["?곹뭹?먭?", "?낃퀬?먭?", "?먭?"]));
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
    var code = normalizeCode_(row["?곹뭹肄붾뱶"]);
    var partner = normalizeText_(row["?묐젰?щ챸"] || "");
    var excluded = isExcludedByRules_(code, partner, excludedCodes, excludedPairs, excludedPartners);
    if (excluded) return;

    var inspectionQty = parseNumber_(row["寃?덉닔??] || 0);
    var returnQty = parseNumber_(row["?뚯넚?섎웾"] || 0);
    var exchangeQty = parseNumber_(row["援먰솚?섎웾"] || 0);
    inspectionQtyTotal += inspectionQty;
    returnQtyTotal += returnQty;
    exchangeQtyTotal += exchangeQty;

    var skuKey = makeSkuKey_(row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"]) || String(row["?곹뭹紐?] || "").trim();
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
    ["珥??낃퀬湲덉븸", "珥??낃퀬?섎웾", "寃???섎웾", "寃?덈쪧", "?ㅺ??덈쪧", "理쒓렐 媛깆떊"],
    [
      totalInboundAmount,
      totalInboundQty,
      inspectionQtyTotal,
      totalInboundQty > 0 ? inspectionQtyTotal / totalInboundQty : 0,
      targetInboundQty > 0 ? inspectionQtyTotal / targetInboundQty : 0,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
    ],
    ["寃???낃퀬湲덉븸", "?낃퀬 SKU", "寃??SKU", "SKU 而ㅻ쾭由ъ?", "寃?덉엯怨?SKU", "?ㅼ젣 SKU 而ㅻ쾭由ъ?"],
    [
      targetInboundAmount,
      totalSkuCount,
      inspectedSkuCount,
      totalSkuCount > 0 ? inspectedSkuCount / totalSkuCount : 0,
      targetSkuCount,
      targetSkuCount > 0 ? inspectedSkuCount / targetSkuCount : 0,
    ],
    ["?됱궗 SKU", "寃?덉엯怨?SKU", "寃???낃퀬?섎웾", "?뚯넚 ?섎웾", "援먰솚 ?섎웾", "?ъ쭊 湲곕줉 嫄댁닔"],
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

function productImageHeaders_() {
  return [
    "留듯궎",
    "?곹뭹肄붾뱶",
    "?묐젰?щ챸",
    "?곹뭹紐?,
    "?대?吏URL",
    "?뚯씪ID",
    "?뚯씪紐?,
    "?앹꽦?쇱떆",
    "?섏젙?쇱떆",
  ];
}

function getProductImageSheet_(ss) {
  var sheet = getOrCreateSheet_(ss, SHEET_NAMES.productImages);
  ensureHeaderRow_(sheet, productImageHeaders_());
  return sheet;
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
    return String(row["留듯궎"] || "").trim();
  });
}

function saveProductImageMapping_(payload) {
  var productCode = normalizeCode_(payload.productCode || payload["?곹뭹肄붾뱶"] || "");
  var partnerName = normalizeText_(payload.partnerName || payload["?묐젰?щ챸"] || payload["?묐젰??] || "");
  var productName = String(payload.productName || payload["?곹뭹紐?] || "").trim();
  var photo = payload.photo || payload.image || null;

  if (!productName && !productCode) {
    throw new Error("?곹뭹 ?뺣낫媛 ?놁뒿?덈떎.");
  }

  if (!photo || !photo.imageBase64) {
    throw new Error("?깅줉???대?吏 ?뚯씪???놁뒿?덈떎.");
  }

  var mapKey = makeProductImageMapKey_(productCode, partnerName, productName);
  if (!mapKey || mapKey === "name::||") {
    throw new Error("?대?吏 留ㅽ븨 ?ㅻ? 留뚮뱾 ???놁뒿?덈떎.");
  }

  var savedFile = saveProductImageAssetToDrive_(photo, partnerName + "_" + productName, 0);
  var now = new Date().toISOString();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getProductImageSheet_(ss);
  var headers = productImageHeaders_();
  var existingRows = loadProductImageMappings_();
  var target = null;

  for (var i = 0; i < existingRows.length; i += 1) {
    if (String(existingRows[i]["留듯궎"] || "") === mapKey) {
      target = existingRows[i];
      break;
    }
  }

  var rowObject = {
    "留듯궎": mapKey,
    "?곹뭹肄붾뱶": productCode,
    "?묐젰?щ챸": partnerName,
    "?곹뭹紐?: productName,
    "?대?吏URL": savedFile.viewUrl || "",
    "?뚯씪ID": savedFile.fileId || "",
    "?뚯씪紐?: savedFile.fileName || "",
    "?앹꽦?쇱떆": target && target["?앹꽦?쇱떆"] ? target["?앹꽦?쇱떆"] : now,
    "?섏젙?쇱떆": now,
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

function saveProductImageAssetToDrive_(photo, baseName, index) {
  var folderId =
    PropertiesService.getScriptProperties().getProperty("PRODUCT_IMAGE_FOLDER_ID") ||
    PropertiesService.getScriptProperties().getProperty("PHOTO_FOLDER_ID");

  if (!folderId) {
    throw new Error("?대?吏 ?낅줈???ㅽ뙣: PRODUCT_IMAGE_FOLDER_ID ?먮뒗 PHOTO_FOLDER_ID媛 ?ㅼ젙?섏? ?딆븯?듬땲??");
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

function syncReturnSheets_(ss) {
  var centerSheet = getOrCreateSheet_(ss, SHEET_NAMES.returnCenter);
  var summarySheet = getOrCreateSheet_(ss, SHEET_NAMES.returnSummary);
  var latestJob = loadLatestJob_();
  var currentJobKey = latestJob && latestJob.job_key ? String(latestJob.job_key).trim() : "";
  operationalReferenceCache_ = null;
  var referenceMaps = readOperationalReferenceMaps_(ss);
  var records = loadRecords_().filter(function (row) {
    return String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() === currentJobKey;
  });
  var inspectionRows = loadInspectionRows_().filter(function (row) {
    return String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() === currentJobKey;
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
    var key = makeSkuKey_(row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"]);
    if (!key) return;
    var memoValue = String(row["鍮꾧퀬"] || "").trim();
    if (memoValue && !isLikelyPhotoLinkText_(memoValue)) {
      memoMap[key] = mergeTextValue_(memoMap[key], memoValue);
    }

    if (!movementTotalsMap[key]) {
      movementTotalsMap[key] = {
        returnQty: 0,
        exchangeQty: 0,
      };
    }

    movementTotalsMap[key].returnQty += parseNumber_(row["?뚯넚?섎웾"]);
    movementTotalsMap[key].exchangeQty += parseNumber_(row["援먰솚?섎웾"]);

    if (!skuRowMap[key]) {
      skuRowMap[key] = row;
    }
  });

  inspectionRows.forEach(function (row) {
    var key = makeSkuKey_(row["?곹뭹肄붾뱶"], row["?묐젰?щ챸"]);
    if (!key) return;
    inspectionMap[key] = row;
    if (!skuRowMap[key]) {
      skuRowMap[key] = row;
    }
  });

  ensureHeaderRow_(centerSheet, [
    "?좎쭨",
    "?묐젰?щ챸",
    "?곹뭹肄붾뱶",
    "?곹뭹紐?,
    "誘몄텧?섎웾",
    "?섏＜?섎웾",
    "?붿뿬?섎웾",
    "?쇳꽣",
    "?곸꽭",
  ]);

  ensureHeaderRow_(summarySheet, [
    "?遺꾨쪟",
    "?곹뭹肄붾뱶",
    "?뚰듃?덉궗",
    "?곹뭹紐?,
    "?⑥쐞",
    "?낃퀬??,
    "寃?덈웾",
    "寃?덈쪧",
    "援먰솚 ?뚯넚 ?댁슜",
    "遺덈웾瑜?,
    "援먰솚??,
    "?뚯넚??,
    "泥섎━?뺥깭",
    "寃?덈떞??,
  ]);

  clearSheetBody_(centerSheet, 9);
  clearSheetBody_(summarySheet, 14);
  sortRecordSheetForCurrentJob_(ss, currentJobKey, productMetaMap);

  var centerValues = records
    .filter(function (row) {
      return parseNumber_(row["?뚯넚?섎웾"]) > 0;
    })
    .map(function (row) {
      return {
        sortContext: buildOperationalSortContext_(row, productMetaMap, row.__rowNumber || 0),
        values: [
        formatSheetDate_(row["?묒꽦?쇱떆"]),
        row["?묐젰?щ챸"] || "",
        row["?곹뭹肄붾뱶"] || "",
        row["?곹뭹紐?] || "",
        parseNumber_(row["?뚯넚?섎웾"]),
        parseNumber_(row["諛쒖＜?섎웾"]),
        "",
        row["?쇳꽣紐?] || "",
        "寃???뚯넚",
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
    centerSheet.getRange(2, 1, centerValues.length, 9).setValues(centerValues);
  }
  applyOperationalTableBorders_(centerSheet, 9);

  var summaryRows = Object.keys(skuRowMap)
    .map(function (key) {
      var baseRow = skuRowMap[key] || {};
      var inspectionRow = inspectionMap[key] || {};
      var movementTotals = movementTotalsMap[key] || { returnQty: 0, exchangeQty: 0 };
      var inboundQty = parseNumber_(
        inspectionRow["?꾩껜諛쒖＜?섎웾"] ||
        inspectionRow["諛쒖＜?섎웾"] ||
        baseRow["?꾩껜諛쒖＜?섎웾"] ||
        baseRow["諛쒖＜?섎웾"]
      );
      var inspectionQty = parseNumber_(inspectionRow["寃?덉닔??]);
      var exchangeQty = parseNumber_(movementTotals.exchangeQty);
      var returnQty = parseNumber_(movementTotals.returnQty);

      if (exchangeQty <= 0 && returnQty <= 0) {
        return null;
      }

      var defectRate = inspectionQty > 0 ? (exchangeQty + returnQty) / inspectionQty : 0;
      var inspectionRate = inboundQty > 0 ? inspectionQty / inboundQty : 0;
      var memo = memoMap[key] || "";

      return {
        sortContext: buildOperationalSortContext_(
          {
            ?곹뭹肄붾뱶: baseRow["?곹뭹肄붾뱶"] || inspectionRow["?곹뭹肄붾뱶"] || "",
            ?곹뭹紐? baseRow["?곹뭹紐?] || inspectionRow["?곹뭹紐?] || "",
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
            baseRow["?곹뭹肄붾뱶"] || inspectionRow["?곹뭹肄붾뱶"] || "",
            baseRow["?곹뭹紐?] || inspectionRow["?곹뭹紐?] || ""
          ).majorCategory || "誘몃텇瑜?,
          baseRow["?곹뭹肄붾뱶"] || inspectionRow["?곹뭹肄붾뱶"] || "",
          standardizeOperationalPartnerName_(
            baseRow["?묐젰?щ챸"] || inspectionRow["?묐젰?щ챸"] || "",
            referenceMaps
          ),
          baseRow["?곹뭹紐?] || inspectionRow["?곹뭹紐?] || "",
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
    summarySheet.getRange(2, 1, summaryValues.length, 14).setValues(summaryValues);
    summarySheet.getRange(2, 8, summaryValues.length, 1).setNumberFormat("0.0%");
    summarySheet.getRange(2, 10, summaryValues.length, 1).setNumberFormat("0.0%");
    mergeOperationalCategoryColumn_(summarySheet, summaryValues.length);
  }
  applyOperationalTableBorders_(summarySheet, 14);
  applyOperationalTableBorders_(getRecordSheet_(ss), recordHeaders_().length);

  return;
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

    if (String(row["?묒뾽湲곗??쇰삉?봀SV?앸퀎媛?] || "").trim() !== currentJobKey) {
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
  if (defectRate >= 0.07) return "寃쎄퀬議곗튂";
  if (defectRate >= 0.03) return "二쇱쓽議곗튂";
  return "媛쒖꽑?붿껌";
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
  var dateLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM'??dd'??");
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
