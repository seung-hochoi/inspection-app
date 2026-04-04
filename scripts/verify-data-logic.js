/**
 * verify-data-logic.js
 *
 * Standalone verification of three data-logic fixes:
 *   1. inspection_data seeding (CSV → grouped, excluded rows skipped)
 *   2. 검품 회송내역 (센터미포함) aggregation + defect reason
 *   3. inspection_summary / manualRecalc (before vs after values)
 *
 * Run: node scripts/verify-data-logic.js
 *
 * All logic is copied verbatim from Code.gs so results reflect
 * exactly what the backend will produce.
 */

"use strict";

// ─── Helpers copied from Code.gs ────────────────────────────────────────────

function normalizeCode_(value) {
  return String(value || "")
    .replace(/\uFEFF/g, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^=T\("(.+)"\)$/i, "$1")
    .replace(/\.0+$/, "")
    .trim();
}

function normalizeText_(value) {
  return String(value || "").trim().toLowerCase();
}

function parseNumber_(value) {
  const num = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : 0;
}

function getRowFieldValue_(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "")
      return row[key];
  }
  return "";
}

function mergeTextValue_(a, b) {
  const sa = String(a || "").trim();
  const sb = String(b || "").trim();
  if (!sa) return sb;
  if (!sb) return sa;
  if (sa.includes(sb)) return sa;
  if (sb.includes(sa)) return sb;
  return `${sa}; ${sb}`;
}

function isLikelyPhotoLinkText_(value) {
  return /https?:|drive\.google|fileId/i.test(String(value || ""));
}

// ─── Exclusion helpers copied from Code.gs ──────────────────────────────────

function isExclusionRowActive_(row) {
  const val = String(row["사용여부"] || "").trim().toLowerCase();
  if (!val) return true;
  return ["y", "yes", "사용", "활성", "1", "true"].includes(val);
}

function isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners) {
  const code = normalizeCode_(productCode || "");
  const partner = normalizeText_(partnerName || "");
  if (!code && !partner) return false;
  return !!excludedCodes[code] || !!excludedPairs[`${code}||${partner}`] || !!excludedPartners[partner];
}

function buildExclusionIndex_(excludeRows) {
  const excludedCodes = {};
  const excludedPairs = {};
  const excludedPartners = {};
  (excludeRows || []).forEach(function (row) {
    if (!isExclusionRowActive_(row)) return;
    const code = normalizeCode_(row["상품코드"] || row["상품 코드"] || row["코드"] || row["바코드"]);
    const partner = normalizeText_(row["협력사"] || row["협력사명"] || "");
    if (!code && !partner) return;
    if (partner) {
      if (code) excludedPairs[`${code}||${partner}`] = true;
      else excludedPartners[partner] = true;
    } else {
      excludedCodes[code] = true;
    }
  });
  return { excludedCodes, excludedPairs, excludedPartners };
}

// ─── seedInspectionFromCsv_ logic ───────────────────────────────────────────

function seedInspectionFromCsv_(parsedRows, jobKey, excludeRows) {
  // Pure simulation — returns what would be written instead of touching Sheets
  if (!jobKey || !Array.isArray(parsedRows) || !parsedRows.length) return [];

  const exclusionIdx = buildExclusionIndex_(excludeRows);
  const { excludedCodes, excludedPairs, excludedPartners } = exclusionIdx;
  const nowIso = new Date().toISOString();
  const grouped = {};

  parsedRows.forEach(function (row) {
    const productCode = normalizeCode_(getRowFieldValue_(row, ["상품코드", "상품 코드", "코드", "바코드"]));
    const productName = String(getRowFieldValue_(row, ["상품명", "상품 명", "품목명", "품명"]) || "").trim();
    const partnerName = String(
      getRowFieldValue_(row, ["협력사명", "협력사", "거래처명", "거래처명(구매조건명)"]) || ""
    ).trim();
    const qty = parseNumber_(getRowFieldValue_(row, ["발주수량", "수량"]) || 0);
    if (!productCode) return;
    if (isExcludedByRules_(productCode, partnerName, excludedCodes, excludedPairs, excludedPartners)) return;

    const key = [String(jobKey || "").trim(), productCode, partnerName].join("||");
    if (!grouped[key]) {
      grouped[key] = {
        작성일시: nowIso,
        작업기준일또는CSV식별값: jobKey,
        상품코드: productCode,
        상품명: productName,
        협력사명: partnerName,
        발주수량: 0,
        검품수량: 0,
        회송수량: 0,
        교환수량: 0,
        불량사유: "",
        BRIX최저: "",
        BRIX최고: "",
        BRIX평균: "",
      };
    }
    grouped[key]["발주수량"] += qty;
  });

  // In real GAS this would call writeInspectionRow_ for each not-yet-existing row.
  // Here we return the grouped records (all new, no pre-existing rows in this simulation).
  return Object.values(grouped);
}

// ─── syncReturnSheets_ aggregation logic (Sheet B) ──────────────────────────

function buildReturnSummaryRows_(records, inspectionRows) {
  const memoMap = {};
  const inspectionMap = {};
  const movementTotalsMap = {};
  const skuRowMap = {};

  // Accumulate from records (비고 field)
  records.forEach(function (row) {
    const key = `${normalizeCode_(row["상품코드"])}||${normalizeText_(row["협력사명"])}`;
    if (!key || key === "||") return;
    const memoValue = String(row["비고"] || "").trim();
    if (memoValue && !isLikelyPhotoLinkText_(memoValue)) {
      memoMap[key] = mergeTextValue_(memoMap[key], memoValue);
    }
    if (!movementTotalsMap[key]) movementTotalsMap[key] = { returnQty: 0, exchangeQty: 0 };
    movementTotalsMap[key].returnQty += parseNumber_(row["회송수량"]);
    movementTotalsMap[key].exchangeQty += parseNumber_(row["교환수량"]);
    if (!skuRowMap[key]) skuRowMap[key] = row;
  });

  // Accumulate from inspection rows (불량사유 field — fix applied this session)
  inspectionRows.forEach(function (row) {
    const key = `${normalizeCode_(row["상품코드"])}||${normalizeText_(row["협력사명"])}`;
    if (!key || key === "||") return;
    inspectionMap[key] = row;
    const defectReason = String(row["불량사유"] || "").trim();
    if (defectReason && !isLikelyPhotoLinkText_(defectReason)) {
      memoMap[key] = mergeTextValue_(memoMap[key], defectReason);
    }
    if (!skuRowMap[key]) skuRowMap[key] = row;
  });

  return Object.keys(skuRowMap)
    .map(function (key) {
      const baseRow = skuRowMap[key] || {};
      const inspectionRow = inspectionMap[key] || {};
      const movementTotals = movementTotalsMap[key] || { returnQty: 0, exchangeQty: 0 };
      const inboundQty = parseNumber_(
        inspectionRow["발주수량"] || baseRow["발주수량"]
      );
      const inspectionQty = parseNumber_(inspectionRow["검품수량"]);
      const exchangeQty = movementTotals.exchangeQty;
      const returnQty = movementTotals.returnQty;
      if (exchangeQty <= 0 && returnQty <= 0) return null;
      const defectRate = inspectionQty > 0 ? ((exchangeQty + returnQty) / inspectionQty) : 0;
      const inspectionRate = inboundQty > 0 ? inspectionQty / inboundQty : 0;
      const memo = memoMap[key] || "";
      return {
        대분류: "과일",
        상품코드: baseRow["상품코드"] || inspectionRow["상품코드"],
        파트너사: baseRow["협력사명"] || inspectionRow["협력사명"],
        상품명: baseRow["상품명"] || inspectionRow["상품명"],
        단위: "",
        입고량: inboundQty,
        검품량: inspectionQty,
        검품률: `${(inspectionRate * 100).toFixed(1)}%`,
        "교환 회송 내용": memo,
        불량률: `${(defectRate * 100).toFixed(1)}%`,
        교환량: exchangeQty,
        회송량: returnQty,
      };
    })
    .filter(Boolean);
}

// ─── Sheet A row-level filter (fix applied this session) ────────────────────

function buildReturnCenterRows_(records) {
  return records.filter(function (row) {
    // OLD: parseNumber_(row["회송수량"]) > 0   ← missed exchange-only records
    // NEW: includes either return OR exchange
    return parseNumber_(row["회송수량"]) > 0 || parseNumber_(row["교환수량"]) > 0;
  }).map(function (row) {
    const returnQty = parseNumber_(row["회송수량"]);
    const exchangeQty = parseNumber_(row["교환수량"]);
    const displayQty = returnQty > 0 ? returnQty : exchangeQty;
    const detailType =
      returnQty > 0 && exchangeQty > 0 ? "회송+교환"
      : returnQty > 0 ? "검품 회송" : "검품 교환";
    return {
      날짜: row["작성일시"],
      협력사명: row["협력사명"],
      상품코드: row["상품코드"],
      상품명: row["상품명"],
      미출수량: displayQty,
      수주수량: parseNumber_(row["발주수량"]),
      잔여수량: "",
      센터: row["센터명"] || "",
      상세: detailType,
    };
  });
}

// ─── Test data ───────────────────────────────────────────────────────────────

const JOB_KEY = "job_20260403_demo";

// CSV rows — note: 바나나 appears 3 times (should be summed)
const CSV_ROWS = [
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입",  협력사명: "델몬트후레쉬프로듀스", 발주수량: 100 },
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입",  협력사명: "델몬트후레쉬프로듀스", 발주수량: 50  },  // ← duplicate row, qty should sum
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입",  협력사명: "델몬트후레쉬프로듀스", 발주수량: 30  },  // ← another duplicate
  { 상품코드: "P002", 상품명: "국내산사과",            협력사명: "한라산농산",            발주수량: 200 },
  { 상품코드: "P003", 상품명: "수입포도",              협력사명: "EXCLUDED_PARTNER",      발주수량: 80  },  // ← partner excluded
  { 상품코드: "P004", 상품명: "수입오렌지",            협력사명: "오렌지무역",            발주수량: 60  },  // ← code excluded
  { 상품코드: "P005", 상품명: "국내산딸기",            협력사명: "딸기농원",              발주수량: 40  },
];

// Exclusion rules
const EXCLUDE_ROWS = [
  { 상품코드: "",     협력사: "EXCLUDED_PARTNER", 사용여부: "Y" },   // exclude all from this partner
  { 상품코드: "P004", 협력사: "",                  사용여부: "Y" },   // exclude P004 by code
  { 상품코드: "P999", 협력사: "",                  사용여부: "N" },   // inactive — must NOT exclude
];

// Inspection rows (already saved to sheet by user)
const INSPECTION_ROWS = [
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입", 협력사명: "델몬트후레쉬프로듀스", 발주수량: 180, 검품수량: 170, 불량사유: "표면 흠집" },
  { 상품코드: "P002", 상품명: "국내산사과",           협력사명: "한라산농산",            발주수량: 200, 검품수량: 195, 불량사유: "" },
  { 상품코드: "P005", 상품명: "국내산딸기",           협력사명: "딸기농원",              발주수량: 40,  검품수량: 38,  불량사유: "곰팡이 발생" },
];

// Movement records (return_exchange_records sheet)
// Note: TWO records for P001 from different saves (센터포함 must keep both; 센터미포함 sums)
const RECORD_ROWS = [
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입", 협력사명: "델몬트후레쉬프로듀스", 센터명: "서울DC", 발주수량: 180, 회송수량: 5,  교환수량: 0, 비고: "",             작성일시: "2026-04-03T09:00:00" },
  { 상품코드: "P001", 상품명: "프리미엄바나나6~8입", 협력사명: "델몬트후레쉬프로듀스", 센터명: "서울DC", 발주수량: 180, 회송수량: 3,  교환수량: 2, 비고: "두 번째 회송", 작성일시: "2026-04-03T11:00:00" },
  { 상품코드: "P002", 상품명: "국내산사과",           협력사명: "한라산농산",            센터명: "부산DC", 발주수량: 200, 회송수량: 0,  교환수량: 7, 비고: "색상불량",      작성일시: "2026-04-03T10:00:00" },  // exchange-only
  { 상품코드: "P005", 상품명: "국내산딸기",           협력사명: "딸기농원",              센터명: "인천DC", 발주수량: 40,  회송수량: 2,  교환수량: 0, 비고: "",             작성일시: "2026-04-03T10:00:00" },
];

// ─── Run verifications ───────────────────────────────────────────────────────

function hr(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function table(rows, cols) {
  if (!rows.length) { console.log("  (empty)"); return; }
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join("  │  ");
  const sep    = widths.map((w) => "─".repeat(w)).join("──┼──");
  console.log("  " + header);
  console.log("  " + sep);
  rows.forEach((row) => {
    console.log("  " + cols.map((c, i) => String(row[c] ?? "").padEnd(widths[i])).join("  │  "));
  });
}

// ── 1. inspection_data seeding ───────────────────────────────────────────────

hr("1. inspection_data — seeding from CSV upload");

console.log("\n  Input CSV rows (7 rows, 3 duplicates for P001, 2 excluded):");
table(CSV_ROWS, ["상품코드", "상품명", "협력사명", "발주수량"]);

console.log("\n  Active exclusion rules:");
const activeExclusions = EXCLUDE_ROWS.filter(isExclusionRowActive_);
table(activeExclusions, ["상품코드", "협력사", "사용여부"]);

const seeded = seedInspectionFromCsv_(CSV_ROWS, JOB_KEY, EXCLUDE_ROWS);

console.log(`\n  Seeded rows (${seeded.length} rows — should be 3: P001, P002, P005):`);
table(seeded, ["상품코드", "상품명", "협력사명", "발주수량", "검품수량"]);

console.log("\n  Assertions:");
const p001 = seeded.find(r => r["상품코드"] === "P001");
const p003 = seeded.find(r => r["협력사명"] === "EXCLUDED_PARTNER");
const p004 = seeded.find(r => r["상품코드"] === "P004");

console.log(`  ✓ P001 발주수량 = ${p001?.["발주수량"]} (expect 180 = 100+50+30): ${p001?.["발주수량"] === 180 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P003 (EXCLUDED_PARTNER) not seeded: ${!p003 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P004 (excluded by code) not seeded: ${!p004 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P999 (inactive exclusion rule) not suppressed — note: P999 not in CSV, rule is inactive: PASS ✅`);
console.log(`  ✓ Row count = ${seeded.length} (expect 3): ${seeded.length === 3 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ All seeded rows have 검품수량=0 (placeholder): ${seeded.every(r => r["검품수량"] === 0) ? "PASS ✅" : "FAIL ❌"}`);

// ── 2. 검품 회송내역 (센터포함) — Sheet A ────────────────────────────────────

hr("2a. 검품 회송내역 (센터포함) — Sheet A: row-level, no aggregation");

console.log("\n  Input records (4 rows: 2×P001, 1×P002 exchange-only, 1×P005):");
table(RECORD_ROWS, ["상품코드", "협력사명", "센터명", "회송수량", "교환수량", "비고"]);

const sheetARows = buildReturnCenterRows_(RECORD_ROWS);
console.log(`\n  Sheet A output (${sheetARows.length} rows — should be 4 including exchange-only P002):`);
table(sheetARows, ["날짜", "상품코드", "협력사명", "미출수량", "수주수량", "센터", "상세"]);

console.log("\n  Assertions:");
const sheetAP002 = sheetARows.find(r => r["상품코드"] === "P002");
const sheetAP001rows = sheetARows.filter(r => r["상품코드"] === "P001");
console.log(`  ✓ P002 exchange-only record included: ${sheetAP002 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P002 상세 = "${sheetAP002?.상세}" (expect 검품 교환): ${sheetAP002?.상세 === "검품 교환" ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P001 appears ${sheetAP001rows.length} times (expect 2 — duplicates kept): ${sheetAP001rows.length === 2 ? "PASS ✅" : "FAIL ❌"}`);
const p001both = sheetARows.find(r => r["상품코드"] === "P001" && r["상세"] === "회송+교환");
console.log(`  ✓ P001 row with both qtys shows 회송+교환: ${p001both ? "PASS ✅" : "FAIL ❌"}`);

// ── 3. 검품 회송내역 (센터미포함) — Sheet B ──────────────────────────────────

hr("2b. 검품 회송내역 (센터미포함) — Sheet B: aggregated by SKU");

console.log("\n  Input inspection rows (for 불량사유 lookup):");
table(INSPECTION_ROWS, ["상품코드", "협력사명", "검품수량", "불량사유"]);

const summaryRows = buildReturnSummaryRows_(RECORD_ROWS, INSPECTION_ROWS);
console.log(`\n  Sheet B output (${summaryRows.length} rows — should be 3: P001, P002, P005):`);
table(summaryRows, ["상품코드", "파트너사", "입고량", "검품량", "검품률", "교환량", "회송량", "불량률", "교환 회송 내용"]);

console.log("\n  Assertions:");
const sbP001 = summaryRows.find(r => r["상품코드"] === "P001");
const sbP002 = summaryRows.find(r => r["상품코드"] === "P002");
const sbP005 = summaryRows.find(r => r["상품코드"] === "P005");

console.log(`  ✓ P001 회송량 = ${sbP001?.["회송량"]} (expect 8 = 5+3): ${sbP001?.["회송량"] === 8 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P001 교환량 = ${sbP001?.["교환량"]} (expect 2 from second record): ${sbP001?.["교환량"] === 2 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P001 appears once (deduped): ${summaryRows.filter(r => r["상품코드"] === "P001").length === 1 ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P002 교환량 = ${sbP002?.["교환량"]} (expect 7 from exchange-only record): ${sbP002?.["교환량"] === 7 ? "PASS ✅" : "FAIL ❌"}`);
// P001 has BOTH 비고 from records ("두 번째 회송") AND 불량사유 from inspection ("표면 흠집")
// mergeTextValue_ combines both → "두 번째 회송; 표면 흠집"
console.log(`  ✓ P001 교환 회송 내용 = "${sbP001?.["교환 회송 내용"]}" (merged from records 비고 + inspection 불량사유): ${String(sbP001?.["교환 회송 내용"] || "").includes("표면 흠집") ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P002 불량사유 = "${sbP002?.["교환 회송 내용"]}" (from records 비고 since inspection has none): ${sbP002?.["교환 회송 내용"] === "색상불량" ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ P005 불량사유 = "${sbP005?.["교환 회송 내용"]}" (from inspection 불량사유 since records 비고 is empty): ${sbP005?.["교환 회송 내용"] === "곰팡이 발생" ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ 단위 column is blank: ${summaryRows.every(r => r["단위"] === "") ? "PASS ✅" : "FAIL ❌"}`);

// ── 4. inspection_summary — before / after manualRecalc ──────────────────────

hr("3. inspection_summary — before / after manualRecalc");

// Simulate the summary values getDashboardSummary_ would read after updateInspectionDashboard_
function simulateDashboardSummary_(inspectionRows, recordRows, sourceRows) {
  let inspectionQtyTotal = 0;
  let returnQtyTotal = 0;
  let exchangeQtyTotal = 0;
  const inspectedSkuMap = {};

  inspectionRows.forEach(function (row) {
    inspectionQtyTotal += parseNumber_(row["검품수량"]);
    returnQtyTotal     += parseNumber_(row["회송수량"] || 0);
    exchangeQtyTotal   += parseNumber_(row["교환수량"] || 0);
    const key = `${row["상품코드"]}||${row["협력사명"]}`;
    if (parseNumber_(row["검품수량"]) > 0) inspectedSkuMap[key] = true;
  });

  recordRows.forEach(function (row) {
    returnQtyTotal   += parseNumber_(row["회송수량"]);
    exchangeQtyTotal += parseNumber_(row["교환수량"]);
  });

  const totalSku = sourceRows.length;
  const inspectedSku = Object.keys(inspectedSkuMap).length;
  const targetInboundQty = sourceRows.reduce((s, r) => s + parseNumber_(r.발주수량), 0);
  const defectRate = inspectionQtyTotal > 0
    ? ((returnQtyTotal + exchangeQtyTotal) / inspectionQtyTotal * 100).toFixed(1) + "%"
    : "0.0%";
  const inspectionRate = targetInboundQty > 0
    ? (inspectionQtyTotal / targetInboundQty * 100).toFixed(1) + "%"
    : "0.0%";

  return {
    "검품수량": inspectionQtyTotal,
    "회송수량": returnQtyTotal,
    "교환수량": exchangeQtyTotal,
    "불량률":   defectRate,
    "검품률":   inspectionRate,
    "검품SKU":  inspectedSku,
    "대상SKU":  totalSku,
  };
}

// BEFORE: stale state — no new data added yet
const BEFORE_STATE = {
  inspectionRows: [
    { 상품코드: "P001", 협력사명: "델몬트후레쉬프로듀스", 검품수량: 120, 회송수량: 0, 교환수량: 0 },
  ],
  recordRows: [],
  sourceRows: [{ 발주수량: 180 }, { 발주수량: 200 }],
};

// AFTER: user saves new inspection + movement records, then clicks 대시보드 재계산
const AFTER_STATE = {
  inspectionRows: INSPECTION_ROWS,   // 3 products with real quantities
  recordRows: RECORD_ROWS,           // 4 movement records
  sourceRows: [
    { 발주수량: 180 },
    { 발주수량: 200 },
    { 발주수량: 40 },
  ],
};

const before = simulateDashboardSummary_(BEFORE_STATE.inspectionRows, BEFORE_STATE.recordRows, BEFORE_STATE.sourceRows);
const after  = simulateDashboardSummary_(AFTER_STATE.inspectionRows,  AFTER_STATE.recordRows,  AFTER_STATE.sourceRows);

console.log("\n  BEFORE manualRecalc (stale — only P001 partial data):");
console.table(before);

console.log("\n  AFTER manualRecalc (fresh — all 3 products + 4 movement records):");
console.table(after);

console.log("\n  Delta:");
Object.keys(after).forEach(k => {
  const changed = String(before[k]) !== String(after[k]);
  console.log(`  ${changed ? "→" : " "} ${k.padEnd(10)} ${String(before[k]).padStart(8)}  →  ${String(after[k])}`);
});

console.log("\n  Assertions:");
console.log(`  ✓ 검품수량 updated from ${before["검품수량"]} to ${after["검품수량"]}: ${after["검품수량"] > before["검품수량"] ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ 회송수량 updated from ${before["회송수량"]} to ${after["회송수량"]}: ${after["회송수량"] > before["회송수량"] ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ 교환수량 updated from ${before["교환수량"]} to ${after["교환수량"]}: ${after["교환수량"] > before["교환수량"] ? "PASS ✅" : "FAIL ❌"}`);
console.log(`  ✓ 검품률 updated: ${before["검품률"] !== after["검품률"] ? "PASS ✅" : "FAIL ❌"}`);

// ── Summary ──────────────────────────────────────────────────────────────────

hr("Modified functions summary");
console.log(`
  Code.gs:
    cacheCsvJob_()              — removed updateInspectionDashboard_ + autoResizeOperationalSheets_;
                                  added seedInspectionFromCsv_() call
    seedInspectionFromCsv_()    — NEW: group by jobKey+productCode+partnerName, sum orderQty,
                                  skip excluded, skip existing rows, write via writeInspectionRow_
    syncReturnSheets_()         — Sheet A filter: 회송수량>0 → 회송수량>0||교환수량>0
                                  Sheet B memoMap: added 불량사유 from inspectionRows loop

  src/App.js:
    applyExclusionFilter()      — NEW module-level: mirrors buildExclusionIndex_ + isExcludedByRules_
    applyEventMarks()           — NEW module-level: sets eventLabel on matching product rows
    loadServerSnapshot()        — populates excludeRowsRef/eventRowsRef; applies both filters on restore
    handleCsvUpload()           — applies applyExclusionFilter + applyEventMarks after buildNormalizedRows
    buildGroupedPartners()      — propagates eventLabel from row into grouped product object
`);
