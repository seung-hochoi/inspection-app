import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const STORAGE_KEY = "inspection_return_manager_v3";
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzjNbgChh6679nD9_x3Nzk8sctS9Fj9HcdmuKr7J3e79uxmEhUiSqW-KpMAt8tr7fypVw/exec";

/*
  제외목록 mock 데이터
  규칙
  1. productCode만 있으면 해당 상품 전체 제외
  2. productCode + supplierName 있으면 해당 협력사만 제외
  3. enabled === true 만 적용
*/
const EXCLUSION_RULES = [
  { productCode: "9999999999999", supplierName: "", enabled: true },
  { productCode: "8888888888888", supplierName: "테스트협력사", enabled: true },
  { productCode: "7777777777777", supplierName: "", enabled: false },
];

/*
  행사표 mock 데이터
  상품코드 기준으로 행사 여부만 표시
*/
const EVENT_PRODUCT_CODES = new Set([
  "1111111111111",
  "2222222222222",
  "3333333333333",
]);

function App() {
  const [rawRows, setRawRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [search, setSearch] = useState("");
  const [processType, setProcessType] = useState("return");
  const [selectedProductCode, setSelectedProductCode] = useState("");
  const [selectedCenter, setSelectedCenter] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [processQty, setProcessQty] = useState("");
  const [reason, setReason] = useState("");
  const [memo, setMemo] = useState("");
  const [savedItems, setSavedItems] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (Array.isArray(saved.rawRows)) setRawRows(saved.rawRows);
      if (typeof saved.fileName === "string") setFileName(saved.fileName);
      if (Array.isArray(saved.savedItems)) setSavedItems(saved.savedItems);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        rawRows,
        fileName,
        savedItems,
      })
    );
  }, [rawRows, fileName, savedItems]);

  const todayDate = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const nowDateTime = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  };

  const cleanCode = (value) => {
    if (value == null) return "";
    let text = String(value).replace(/\uFEFF/g, "").trim();

    const tMatch = text.match(/^=T\("(.+)"\)$/i);
    if (tMatch) text = tMatch[1];

    text = text.replace(/^"+|"+$/g, "").trim();
    return text;
  };

  const normalizeKey = (value) =>
    String(value || "")
      .replace(/\uFEFF/g, "")
      .trim();

  const normalizeText = (value) =>
    String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const parseQty = (value) => {
    const n = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  };

  const getValue = (row, candidates) => {
    for (const key of candidates) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
        return row[key];
      }
    }
    return "";
  };

  const exclusionMatcher = useMemo(() => {
    const enabledRules = EXCLUSION_RULES.filter((rule) => rule.enabled);

    return (productCode, supplierName) => {
      return enabledRules.some((rule) => {
        const sameCode = cleanCode(rule.productCode) === cleanCode(productCode);
        if (!sameCode) return false;

        if (!rule.supplierName) return true;
        return normalizeText(rule.supplierName) === normalizeText(supplierName);
      });
    };
  }, []);

  const normalizedRows = useMemo(() => {
    return rawRows
      .map((sourceRow, index) => {
        const row = {};
        Object.keys(sourceRow || {}).forEach((key) => {
          row[normalizeKey(key)] = sourceRow[key];
        });

        const productCode = cleanCode(
          getValue(row, ["상품코드", "상품 코드", "코드", "바코드"])
        );

        const productName = String(
          getValue(row, ["상품명", "상품 명", "품목명", "품명"])
        ).trim();

        const centerName = String(
          getValue(row, ["센터명", "센터"])
        ).trim();

        const supplierName = String(
          getValue(row, ["거래처명(구매조건명)", "거래처명", "구매조건명", "협력사"])
        ).trim();

        const orderQty = parseQty(
          getValue(row, ["총 발주수량", "발주수량", "총발주수량", "주문수량", "수량"])
        );

        const category = String(
          getValue(row, ["소분류명", "소분류"])
        ).trim();

        return {
          id: `${productCode}-${centerName}-${supplierName}-${index}`,
          productCode,
          productName,
          centerName,
          supplierName,
          orderQty,
          category,
          isEvent: EVENT_PRODUCT_CODES.has(productCode),
        };
      })
      .filter((row) => row.productCode && row.productName)
      .filter((row) => !exclusionMatcher(row.productCode, row.supplierName));
  }, [rawRows, exclusionMatcher]);

  const productMap = useMemo(() => {
    const map = new Map();

    normalizedRows.forEach((row) => {
      if (!map.has(row.productCode)) {
        map.set(row.productCode, {
          productCode: row.productCode,
          productName: row.productName,
          category: row.category,
          isEvent: row.isEvent,
          totalOrderQty: 0,
          centers: new Map(),
          suppliers: new Map(),
        });
      }

      const product = map.get(row.productCode);
      product.totalOrderQty += row.orderQty;
      if (!product.productName && row.productName) product.productName = row.productName;
      if (!product.category && row.category) product.category = row.category;
      if (row.isEvent) product.isEvent = true;

      if (row.centerName) {
        if (!product.centers.has(row.centerName)) {
          product.centers.set(row.centerName, {
            centerName: row.centerName,
            orderQty: 0,
            suppliers: new Map(),
          });
        }

        const center = product.centers.get(row.centerName);
        center.orderQty += row.orderQty;

        if (row.supplierName) {
          if (!center.suppliers.has(row.supplierName)) {
            center.suppliers.set(row.supplierName, {
              supplierName: row.supplierName,
              orderQty: 0,
            });
          }
          center.suppliers.get(row.supplierName).orderQty += row.orderQty;
        }
      }

      if (row.supplierName) {
        if (!product.suppliers.has(row.supplierName)) {
          product.suppliers.set(row.supplierName, {
            supplierName: row.supplierName,
            orderQty: 0,
          });
        }
        product.suppliers.get(row.supplierName).orderQty += row.orderQty;
      }
    });

    return map;
  }, [normalizedRows]);

  const products = useMemo(() => {
    return Array.from(productMap.values())
      .map((product) => ({
        ...product,
        centersArray: Array.from(product.centers.values()).sort(
          (a, b) => b.orderQty - a.orderQty || a.centerName.localeCompare(b.centerName, "ko")
        ),
        suppliersArray: Array.from(product.suppliers.values()).sort(
          (a, b) => b.orderQty - a.orderQty || a.supplierName.localeCompare(b.supplierName, "ko")
        ),
      }))
      .sort(
        (a, b) =>
          b.totalOrderQty - a.totalOrderQty ||
          a.productName.localeCompare(b.productName, "ko")
      );
  }, [productMap]);

  const filteredProducts = useMemo(() => {
    const keyword = normalizeText(search);
    if (!keyword) return products;

    return products.filter((product) =>
      normalizeText(product.productName).includes(keyword)
    );
  }, [products, search]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductCode) return null;
    return products.find((item) => item.productCode === selectedProductCode) || null;
  }, [products, selectedProductCode]);

  const centerOptions = useMemo(() => {
    if (!selectedProduct) return [];
    return selectedProduct.centersArray.map((center) => ({
      value: center.centerName,
      label: `${center.centerName} (${center.orderQty})`,
      orderQty: center.orderQty,
      suppliersArray: Array.from(center.suppliers.values()).sort(
        (a, b) => b.orderQty - a.orderQty || a.supplierName.localeCompare(b.supplierName, "ko")
      ),
    }));
  }, [selectedProduct]);

  const selectedCenterInfo = useMemo(() => {
    if (!selectedProduct || !selectedCenter) return null;
    return centerOptions.find((item) => item.value === selectedCenter) || null;
  }, [selectedProduct, selectedCenter, centerOptions]);

  const supplierOptions = useMemo(() => {
    if (!selectedProduct) return [];

    if (processType === "return") {
      if (!selectedCenterInfo) return [];
      return selectedCenterInfo.suppliersArray.map((supplier) => ({
        value: supplier.supplierName,
        label: `${supplier.supplierName} (${supplier.orderQty})`,
        orderQty: supplier.orderQty,
      }));
    }

    return selectedProduct.suppliersArray.map((supplier) => ({
      value: supplier.supplierName,
      label: `${supplier.supplierName} (${supplier.orderQty})`,
      orderQty: supplier.orderQty,
    }));
  }, [selectedProduct, selectedCenterInfo, processType]);

  const currentOrderQty = useMemo(() => {
    if (processType === "return") {
      return selectedCenterInfo?.orderQty || 0;
    }

    const matchedSupplier = supplierOptions.find((item) => item.value === selectedSupplier);
    return matchedSupplier?.orderQty || 0;
  }, [processType, selectedCenterInfo, supplierOptions, selectedSupplier]);

  useEffect(() => {
    if (!filteredProducts.length) {
      setSelectedProductCode("");
      return;
    }

    const exists = filteredProducts.some((item) => item.productCode === selectedProductCode);
    if (!exists) {
      setSelectedProductCode(filteredProducts[0].productCode);
    }
  }, [filteredProducts, selectedProductCode]);

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedCenter("");
      setSelectedSupplier("");
      return;
    }

    if (processType === "return") {
      const centerExists = centerOptions.some((item) => item.value === selectedCenter);
      const nextCenter = centerExists ? selectedCenter : centerOptions[0]?.value || "";
      if (nextCenter !== selectedCenter) {
        setSelectedCenter(nextCenter);
      }
    } else if (selectedCenter !== "") {
      setSelectedCenter("");
    }
  }, [selectedProduct, processType, centerOptions, selectedCenter]);

  useEffect(() => {
    const supplierExists = supplierOptions.some((item) => item.value === selectedSupplier);
    if (!supplierExists) {
      setSelectedSupplier(supplierOptions[0]?.value || "");
    }
  }, [supplierOptions, selectedSupplier]);

  useEffect(() => {
    if (processType === "return" && reason.trim() === "업체 교환") {
      setReason("검품 회송");
    }
    if (processType === "exchange" && reason.trim() === "검품 회송") {
      setReason("업체 교환");
    }
  }, [processType, reason]);

  const resetInputFields = () => {
    setProcessQty("");
    setReason(processType === "return" ? "검품 회송" : "업체 교환");
    setMemo("");
  };

  const handleUploadCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setInfo("");

    try {
      const text = await file.text();

      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.errors?.length) {
            setError("CSV 파싱 중 일부 오류가 있었다");
          }

          setRawRows(Array.isArray(result.data) ? result.data : []);
          setFileName(file.name);
          setProcessQty("");
          setMemo("");
          setReason(processType === "return" ? "검품 회송" : "업체 교환");
          setInfo("CSV 업로드 완료");
        },
        error: () => {
          setError("CSV 읽기 실패");
        },
      });
    } catch {
      setError("CSV 업로드 실패");
    }

    e.target.value = "";
  };

  const sendToGoogleSheet = async (payload) => {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    return response;
  };

  const handleSave = async () => {
    setError("");
    setInfo("");

    if (!selectedProduct) {
      setError("상품을 먼저 선택해라");
      return;
    }

    if (processType === "return" && !selectedCenter) {
      setError("회송은 센터 선택이 필수다");
      return;
    }

    if (!selectedSupplier) {
      setError("협력사를 선택해라");
      return;
    }

    const qty = parseQty(processQty);
    if (qty <= 0) {
      setError("처리수량은 1 이상이어야 한다");
      return;
    }

    const finalReason =
      reason.trim() || (processType === "return" ? "검품 회송" : "업체 교환");

    const createdAt = nowDateTime();

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      date: todayDate,
      type: processType,
      processTypeLabel: processType === "return" ? "회송" : "교환",
      supplierName: selectedSupplier,
      productCode: selectedProduct.productCode,
      productName: selectedProduct.productName,
      centerName: processType === "return" ? selectedCenter : "",
      orderQty: currentOrderQty,
      processQty: qty,
      reason: finalReason,
      memo: memo.trim(),
      photoUrl: "",
      isSynced: false,
    };

    const payload = {
      createdAt: item.createdAt,
      processType: item.processTypeLabel,
      productCode: item.productCode,
      productName: item.productName,
      centerName: item.centerName,
      supplierName: item.supplierName,
      processQty: item.processQty,
      reason: item.reason,
      memo: item.memo,
      photoUrl: item.photoUrl,
    };

    setIsSaving(true);

    try {
      await sendToGoogleSheet(payload);

      const syncedItem = {
        ...item,
        isSynced: true,
      };

      setSavedItems((prev) => [syncedItem, ...prev]);
      setProcessQty("");
      setMemo("");
      setReason(processType === "return" ? "검품 회송" : "업체 교환");
      setInfo("저장 완료, Main 시트 전송 시도됨");
    } catch (err) {
      const offlineItem = {
        ...item,
        isSynced: false,
      };

      setSavedItems((prev) => [offlineItem, ...prev]);
      setError("구글시트 전송 실패, 기기에는 저장됨");
    } finally {
      setIsSaving(false);
    }
  };

  const retrySync = async (itemId) => {
    const target = savedItems.find((item) => item.id === itemId);
    if (!target) return;

    setError("");
    setInfo("");

    const payload = {
      createdAt: target.createdAt,
      processType: target.processTypeLabel,
      productCode: target.productCode,
      productName: target.productName,
      centerName: target.centerName,
      supplierName: target.supplierName,
      processQty: target.processQty,
      reason: target.reason,
      memo: target.memo,
      photoUrl: target.photoUrl || "",
    };

    try {
      await sendToGoogleSheet(payload);

      setSavedItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, isSynced: true } : item
        )
      );
      setInfo("재전송 완료");
    } catch {
      setError("재전송 실패");
    }
  };

  const handleDeleteSavedItem = (id) => {
    setSavedItems((prev) => prev.filter((item) => item.id !== id));
  };

  const summary = useMemo(() => {
    const returnCount = savedItems.filter((item) => item.type === "return").length;
    const exchangeCount = savedItems.filter((item) => item.type === "exchange").length;
    const returnQty = savedItems
      .filter((item) => item.type === "return")
      .reduce((sum, item) => sum + item.processQty, 0);
    const exchangeQty = savedItems
      .filter((item) => item.type === "exchange")
      .reduce((sum, item) => sum + item.processQty, 0);
    const unsyncedCount = savedItems.filter((item) => !item.isSynced).length;

    return {
      products: products.length,
      rows: normalizedRows.length,
      saved: savedItems.length,
      returnCount,
      exchangeCount,
      returnQty,
      exchangeQty,
      unsyncedCount,
    };
  }, [products.length, normalizedRows.length, savedItems]);

  const exportExcel = () => {
    const returnRows = savedItems
      .filter((item) => item.type === "return")
      .map((item) => ({
        날짜: item.date,
        협력사명: item.supplierName,
        상품코드: item.productCode,
        상품명: item.productName,
        미출수량: item.processQty,
        수주수량: item.orderQty,
        센터: item.centerName,
        상세: "검품 회송",
        처리사유: item.reason,
        메모: item.memo,
        동기화여부: item.isSynced ? "완료" : "미완료",
      }));

    const exchangeRows = savedItems
      .filter((item) => item.type === "exchange")
      .map((item) => ({
        날짜: item.date,
        협력사명: item.supplierName,
        상품코드: item.productCode,
        상품명: item.productName,
        교환수량: item.processQty,
        상세: "업체 교환",
        처리사유: item.reason,
        메모: item.memo,
        동기화여부: item.isSynced ? "완료" : "미완료",
      }));

    const wb = XLSX.utils.book_new();

    const returnSheet = XLSX.utils.json_to_sheet(
      returnRows.length ? returnRows : [{ 안내: "회송 데이터 없음" }]
    );
    const exchangeSheet = XLSX.utils.json_to_sheet(
      exchangeRows.length ? exchangeRows : [{ 안내: "교환 데이터 없음" }]
    );

    XLSX.utils.book_append_sheet(wb, returnSheet, "회송양식");
    XLSX.utils.book_append_sheet(wb, exchangeSheet, "교환양식");

    XLSX.writeFile(wb, `검품_회송관리_${todayDate}.xlsx`);
  };

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <h1 style={styles.title}>검품 / 회송 관리</h1>
            <div style={styles.subTitle}>CSV 기반, Main 시트 저장 연동</div>
          </div>
        </header>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>1, CSV 업로드</div>
          <input type="file" accept=".csv" onChange={handleUploadCsv} style={styles.fileInput} />
          <div style={styles.fileName}>{fileName || "업로드된 파일 없음"}</div>
          {info ? <div style={styles.info}>{info}</div> : null}
          {error ? <div style={styles.error}>{error}</div> : null}
        </section>

        <section style={styles.summaryGrid}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>상품 수</div>
            <div style={styles.summaryValue}>{summary.products}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>원본 행 수</div>
            <div style={styles.summaryValue}>{summary.rows}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>저장 건수</div>
            <div style={styles.summaryValue}>{summary.saved}</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>미동기화</div>
            <div style={styles.summaryValue}>{summary.unsyncedCount}</div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>2, 상품 검색</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 검색"
            style={styles.input}
          />

          <div style={styles.resultCount}>검색 결과 {filteredProducts.length}건</div>

          <div style={styles.productList}>
            {filteredProducts.length === 0 ? (
              <div style={styles.empty}>검색 결과 없음</div>
            ) : (
              filteredProducts.map((product) => {
                const active = selectedProductCode === product.productCode;

                return (
                  <button
                    key={product.productCode}
                    type="button"
                    onClick={() => {
                      setSelectedProductCode(product.productCode);
                      setInfo("");
                      setError("");
                      setReason(processType === "return" ? "검품 회송" : "업체 교환");
                    }}
                    style={{
                      ...styles.productButton,
                      ...(active ? styles.productButtonActive : {}),
                    }}
                  >
                    <div style={styles.productTopRow}>
                      <div style={styles.productName}>{product.productName}</div>
                      {product.isEvent ? <span style={styles.eventBadge}>행사</span> : null}
                    </div>
                    <div style={styles.productMeta}>코드 {product.productCode}</div>
                    <div style={styles.productMeta}>총 발주 {product.totalOrderQty}</div>
                    <div style={styles.productMeta}>소분류 {product.category || "-"}</div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>3, 처리 입력</div>

          {!selectedProduct ? (
            <div style={styles.empty}>상품을 먼저 선택해라</div>
          ) : (
            <>
              <div style={styles.infoBox}>
                <div><strong>상품명</strong> {selectedProduct.productName}</div>
                <div><strong>상품코드</strong> {selectedProduct.productCode}</div>
                <div><strong>소분류</strong> {selectedProduct.category || "-"}</div>
                <div>
                  <strong>행사여부</strong> {selectedProduct.isEvent ? "행사" : "-"}
                </div>
              </div>

              <div style={styles.toggleRow}>
                <button
                  type="button"
                  onClick={() => {
                    setProcessType("return");
                    setReason("검품 회송");
                  }}
                  style={{
                    ...styles.typeButton,
                    ...(processType === "return" ? styles.typeButtonActive : {}),
                  }}
                >
                  회송
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProcessType("exchange");
                    setReason("업체 교환");
                  }}
                  style={{
                    ...styles.typeButton,
                    ...(processType === "exchange" ? styles.typeButtonActive : {}),
                  }}
                >
                  교환
                </button>
              </div>

              {processType === "return" ? (
                <>
                  <label style={styles.label}>센터 선택</label>
                  <select
                    value={selectedCenter}
                    onChange={(e) => setSelectedCenter(e.target.value)}
                    style={styles.select}
                  >
                    {centerOptions.length === 0 ? (
                      <option value="">센터 없음</option>
                    ) : (
                      centerOptions.map((center) => (
                        <option key={center.value} value={center.value}>
                          {center.label}
                        </option>
                      ))
                    )}
                  </select>

                  <div style={styles.infoLine}>
                    수주수량, <strong>{currentOrderQty}</strong>
                  </div>
                </>
              ) : (
                <div style={styles.infoLine}>교환은 센터 선택 필요 없음</div>
              )}

              <label style={styles.label}>협력사 선택</label>
              <select
                value={selectedSupplier}
                onChange={(e) => setSelectedSupplier(e.target.value)}
                style={styles.select}
              >
                {supplierOptions.length === 0 ? (
                  <option value="">협력사 없음</option>
                ) : (
                  supplierOptions.map((supplier) => (
                    <option key={supplier.value} value={supplier.value}>
                      {supplier.label}
                    </option>
                  ))
                )}
              </select>

              <label style={styles.label}>처리수량</label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={processQty}
                onChange={(e) => setProcessQty(e.target.value)}
                placeholder="처리수량 입력"
                style={styles.input}
              />

              <label style={styles.label}>처리사유</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={processType === "return" ? "검품 회송" : "업체 교환"}
                style={styles.input}
              />

              <label style={styles.label}>메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="메모 입력"
                style={styles.textarea}
              />

              <div style={styles.buttonRow}>
                <button
                  type="button"
                  onClick={handleSave}
                  style={styles.primaryButton}
                  disabled={isSaving}
                >
                  {isSaving ? "저장 중..." : "저장"}
                </button>
                <button type="button" onClick={resetInputFields} style={styles.secondaryButton}>
                  입력 초기화
                </button>
              </div>
            </>
          )}
        </section>

        <section style={styles.card}>
          <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>4, 저장 내역</div>
            <button type="button" onClick={exportExcel} style={styles.primaryButton}>
              엑셀 출력
            </button>
          </div>

          {savedItems.length === 0 ? (
            <div style={styles.empty}>저장된 내역 없음</div>
          ) : (
            <div style={styles.savedList}>
              {savedItems.map((item) => (
                <div key={item.id} style={styles.savedCard}>
                  <div style={styles.savedTopRow}>
                    <div style={styles.badgeRow}>
                      <div style={styles.badge}>
                        {item.type === "return" ? "회송" : "교환"}
                      </div>
                      <div
                        style={{
                          ...styles.syncBadge,
                          ...(item.isSynced ? styles.syncBadgeDone : styles.syncBadgePending),
                        }}
                      >
                        {item.isSynced ? "시트반영" : "미반영"}
                      </div>
                    </div>

                    <div style={styles.savedActionRow}>
                      {!item.isSynced ? (
                        <button
                          type="button"
                          onClick={() => retrySync(item.id)}
                          style={styles.retryButton}
                        >
                          재전송
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => handleDeleteSavedItem(item.id)}
                        style={styles.deleteButton}
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  <div style={styles.savedText}><strong>등록일시</strong> {item.createdAt}</div>
                  <div style={styles.savedText}><strong>협력사</strong> {item.supplierName}</div>
                  <div style={styles.savedText}><strong>상품코드</strong> {item.productCode}</div>
                  <div style={styles.savedText}><strong>상품명</strong> {item.productName}</div>
                  <div style={styles.savedText}><strong>센터명</strong> {item.centerName || "-"}</div>
                  <div style={styles.savedText}><strong>수주수량</strong> {item.orderQty}</div>
                  <div style={styles.savedText}><strong>처리수량</strong> {item.processQty}</div>
                  <div style={styles.savedText}><strong>처리사유</strong> {item.reason}</div>
                  <div style={styles.savedText}><strong>메모</strong> {item.memo || "-"}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>5, 제외목록 / 행사표 적용 상태</div>
          <div style={styles.helperText}>
            현재는 코드 내부 mock 데이터 기반, 나중에 구글시트 직접 연동 가능
          </div>

          <div style={styles.ruleList}>
            <div style={styles.ruleTitle}>제외목록</div>
            {EXCLUSION_RULES.map((rule, index) => (
              <div key={`${rule.productCode}-${rule.supplierName}-${index}`} style={styles.ruleItem}>
                <div><strong>상품코드</strong> {rule.productCode}</div>
                <div><strong>협력사</strong> {rule.supplierName || "전체 제외"}</div>
                <div><strong>사용여부</strong> {String(rule.enabled)}</div>
              </div>
            ))}
          </div>

          <div style={{ ...styles.ruleList, marginTop: "14px" }}>
            <div style={styles.ruleTitle}>행사표</div>
            {[...EVENT_PRODUCT_CODES].map((code) => (
              <div key={code} style={styles.ruleItem}>
                <div><strong>상품코드</strong> {code}</div>
                <div><strong>표시</strong> 행사</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100vh",
    background: "#f3f4f6",
    padding: "12px",
    boxSizing: "border-box",
  },
  container: {
    maxWidth: "760px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  header: {
    padding: "4px 2px",
  },
  title: {
    margin: 0,
    fontSize: "28px",
    fontWeight: 800,
    color: "#111827",
  },
  subTitle: {
    marginTop: "6px",
    color: "#6b7280",
    fontSize: "14px",
  },
  card: {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "14px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 800,
    marginBottom: "10px",
    color: "#111827",
  },
  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
    flexWrap: "wrap",
  },
  fileInput: {
    width: "100%",
    fontSize: "14px",
  },
  fileName: {
    marginTop: "8px",
    fontSize: "13px",
    color: "#4b5563",
    wordBreak: "break-all",
  },
  info: {
    marginTop: "10px",
    background: "#ecfdf5",
    color: "#065f46",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "14px",
  },
  error: {
    marginTop: "10px",
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: "10px",
    padding: "10px",
    fontSize: "14px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
  },
  summaryCard: {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "14px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  },
  summaryLabel: {
    fontSize: "12px",
    color: "#6b7280",
  },
  summaryValue: {
    marginTop: "6px",
    fontSize: "22px",
    fontWeight: 800,
    color: "#111827",
  },
  input: {
    width: "100%",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: "16px",
  },
  textarea: {
    width: "100%",
    minHeight: "96px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: "16px",
    resize: "vertical",
  },
  select: {
    width: "100%",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #d1d5db",
    boxSizing: "border-box",
    fontSize: "16px",
    background: "#ffffff",
  },
  label: {
    display: "block",
    marginTop: "12px",
    marginBottom: "6px",
    fontWeight: 700,
    fontSize: "14px",
    color: "#374151",
  },
  resultCount: {
    marginTop: "10px",
    marginBottom: "10px",
    fontSize: "13px",
    color: "#6b7280",
  },
  productList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxHeight: "360px",
    overflowY: "auto",
  },
  productButton: {
    textAlign: "left",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    cursor: "pointer",
  },
  productButtonActive: {
    border: "1px solid #111827",
    background: "#e5e7eb",
  },
  productTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    marginBottom: "4px",
  },
  productName: {
    fontWeight: 800,
    color: "#111827",
  },
  eventBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 8px",
    borderRadius: "999px",
    background: "#f59e0b",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  productMeta: {
    fontSize: "13px",
    color: "#4b5563",
  },
  infoBox: {
    background: "#f9fafb",
    borderRadius: "12px",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "14px",
  },
  toggleRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginTop: "12px",
  },
  typeButton: {
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    fontWeight: 800,
    cursor: "pointer",
  },
  typeButtonActive: {
    background: "#111827",
    color: "#ffffff",
    border: "1px solid #111827",
  },
  infoLine: {
    marginTop: "10px",
    fontSize: "14px",
    color: "#374151",
  },
  buttonRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    marginTop: "14px",
  },
  primaryButton: {
    border: "none",
    borderRadius: "12px",
    padding: "12px 14px",
    background: "#111827",
    color: "#ffffff",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid #d1d5db",
    borderRadius: "12px",
    padding: "12px 14px",
    background: "#ffffff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
  },
  savedList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  savedCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "14px",
    padding: "12px",
    background: "#fafafa",
  },
  savedTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "8px",
    marginBottom: "8px",
  },
  badgeRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "56px",
    padding: "6px 10px",
    borderRadius: "999px",
    background: "#111827",
    color: "#ffffff",
    fontSize: "12px",
    fontWeight: 800,
  },
  syncBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 800,
  },
  syncBadgeDone: {
    background: "#dcfce7",
    color: "#166534",
  },
  syncBadgePending: {
    background: "#fef3c7",
    color: "#92400e",
  },
  savedActionRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  retryButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 10px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },
  deleteButton: {
    border: "none",
    borderRadius: "10px",
    padding: "8px 10px",
    background: "#ef4444",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },
  savedText: {
    fontSize: "14px",
    color: "#374151",
    marginTop: "4px",
    wordBreak: "break-word",
  },
  empty: {
    padding: "16px",
    borderRadius: "12px",
    background: "#f9fafb",
    color: "#6b7280",
    fontSize: "14px",
    textAlign: "center",
  },
  helperText: {
    fontSize: "13px",
    color: "#6b7280",
    marginBottom: "10px",
  },
  ruleList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  ruleTitle: {
    fontSize: "14px",
    fontWeight: 800,
    color: "#111827",
  },
  ruleItem: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "10px",
    background: "#fafafa",
    fontSize: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
};

export default App;