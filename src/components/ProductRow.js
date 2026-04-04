import React, { useEffect, useMemo, useRef } from "react";

const palette = {
  border: "#d8e2ef",
  soft: "#f8fbff",
  text: "#15253e",
  muted: "#708095",
  blue: "#2563eb",
  green: "#16a34a",
  greenSoft: "#eefbf1",
  red: "#ef4444",
};

function parseQty(value) {
  const numeric = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

function PhotoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7a2 2 0 0 1 2-2h3l1.2 1.5h7.8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function ProductRow({
  variant = "web",
  product,
  productStateKey,
  selectedCenter,
  inspectionDraft,
  movementDraft,
  inspectionDraftKey,
  movementDraftKey,
  entityKey,
  ProductImage,
  setExpandedProductCode,
  setSelectedCenterByProduct,
  setDrafts,
  saveInspectionQtySimple,
  uploadDraftPhotos,
  saveReturnExchange,
  lockInfo,
  conflictInfo,
}) {
  const inspectionInputRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const photoFiles = Array.isArray(inspectionDraft?.photoFiles) ? inspectionDraft.photoFiles : [];
  const centerOptions = Array.isArray(product.centers) ? product.centers : [];
  const orderQty = parseQty(product.totalQty);
  const returnQty = parseQty(movementDraft?.returnQty);
  const exchangeQty = parseQty(movementDraft?.exchangeQty);
  const inspectionQty = parseQty(inspectionDraft?.inspectionQty);
  const previewItems = useMemo(() => photoFiles.slice(0, 4), [photoFiles]);
  const layoutStyle = variant === "mobile" ? styles.mobileRow : styles.row;

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const hasInspectionChange =
      String(inspectionDraft?.inspectionQty ?? "").trim() !== "" || photoFiles.length > 0;
    const hasMovementChange =
      String(movementDraft?.returnQty ?? "").trim() !== "" ||
      String(movementDraft?.exchangeQty ?? "").trim() !== "";

    if (!hasInspectionChange && !hasMovementChange) {
      return undefined;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      if (hasInspectionChange) {
        saveInspectionQtySimple(product).catch(() => undefined);
      }
      if (hasMovementChange && selectedCenter) {
        saveReturnExchange(product, selectedCenter).catch(() => undefined);
      }
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    inspectionDraft?.inspectionQty,
    movementDraft?.exchangeQty,
    movementDraft?.returnQty,
    photoFiles.length,
    product,
    saveInspectionQtySimple,
    saveReturnExchange,
    selectedCenter,
  ]);

  const setInspectionDraftValue = (field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [inspectionDraftKey]: {
        ...(prev[inspectionDraftKey] || {}),
        [field]: value,
      },
    }));
  };

  const setMovementDraftValue = (field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [movementDraftKey]: {
        ...(prev[movementDraftKey] || {}),
        [field]: value,
      },
    }));
  };

  const handleUpload = (files) => {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    uploadDraftPhotos({
      draftKey: inspectionDraftKey,
      itemKey: entityKey || inspectionDraftKey,
      baseName: product.productName,
      files: nextFiles,
      partnerName: product.partner,
      photoKind: "inspection",
      product,
      centerName: selectedCenter,
    });
  };

  return (
    <>
      <input
        ref={inspectionInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(event) => {
          handleUpload(event.target.files);
          event.target.value = "";
        }}
      />

      <div style={layoutStyle}>
        <button
          type="button"
          onClick={() => setExpandedProductCode((prev) => (prev === productStateKey ? "" : productStateKey))}
          style={styles.productButton}
        >
          <div style={styles.logoFrame}>
            <ProductImage product={product} src={product.imageSrc} alt={product.productName} style={styles.logoImage} />
          </div>
          <div style={styles.leftInfo}>
            <div style={styles.productName}>{product.productName}</div>
            <div style={styles.metaLine}>코드 {product.productCode || "-"} · 협력사 {product.partner || "-"}</div>
            <div style={styles.metaLine}>선택 센터 {selectedCenter || "-"}</div>
            <div style={styles.previewRow}>
              {previewItems.length ? (
                previewItems.map((photo, index) => (
                  <div key={`${photo.fileId || photo.localId || index}`} style={styles.previewThumbWrap}>
                    <img
                      src={photo.previewUrl || photo.viewUrl || photo.driveUrl}
                      alt={photo.fileName || `검품사진 ${index + 1}`}
                      style={styles.previewThumb}
                    />
                  </div>
                ))
              ) : (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={`empty-${index}`} style={styles.previewThumbPlaceholder} />
                ))
              )}
            </div>
          </div>
        </button>

        <div style={styles.orderQtyBox}>
          <div style={styles.fieldLabel}>발주수량</div>
          <div style={styles.orderQtyValue}>{orderQty.toLocaleString("ko-KR")}</div>
          <div style={styles.fieldSubLabel}>수량</div>
        </div>

        <div style={styles.fieldGroup}>
          <Field label="회송수량">
            <input
              type="number"
              min="0"
              value={String(movementDraft?.returnQty ?? "")}
              onChange={(event) => setMovementDraftValue("returnQty", event.target.value)}
              style={{
                ...styles.smallInput,
                ...(returnQty > 0 ? styles.smallInputActive : null),
              }}
            />
          </Field>

          <Field label="교환수량">
            <input
              type="number"
              min="0"
              value={String(movementDraft?.exchangeQty ?? "")}
              onChange={(event) => setMovementDraftValue("exchangeQty", event.target.value)}
              style={{
                ...styles.smallInput,
                ...(exchangeQty > 0 ? styles.smallInputActive : null),
              }}
            />
          </Field>

          <Field label="회송센터" style={{ gridColumn: "1 / span 3" }}>
            <select
              value={selectedCenter}
              onChange={(event) =>
                setSelectedCenterByProduct((prev) => ({
                  ...prev,
                  [productStateKey]: event.target.value,
                }))
              }
              style={styles.selectInput}
            >
              {centerOptions.map((center) => (
                <option key={center.center} value={center.center}>
                  {center.center}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={styles.inspectionBox}>
          <div style={styles.fieldLabel}>검품수량</div>
          <input
            type="number"
            min="0"
            value={String(inspectionDraft?.inspectionQty ?? "")}
            onChange={(event) => setInspectionDraftValue("inspectionQty", event.target.value)}
            style={styles.inspectionInput}
          />
        </div>

        <div style={styles.photoArea}>
          <button type="button" onClick={() => inspectionInputRef.current?.click()} style={styles.photoButton}>
            <PhotoIcon />
            <span>검품사진</span>
          </button>
          <div style={styles.photoCountText}>등록 {photoFiles.length}장</div>
        </div>
      </div>

      {lockInfo && !lockInfo.isMine ? (
        <div style={styles.lockText}>현재 {lockInfo.editorName || "다른 사용자"}가 수정 중입니다.</div>
      ) : null}
      {conflictInfo ? <div style={styles.conflictText}>서버 최신값과 충돌했습니다. 새로고침 후 다시 확인해 주세요.</div> : null}
    </>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ ...styles.fieldWrap, ...style }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  );
}

const styles = {
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(300px, 1.2fr) 112px minmax(360px, 1fr) 110px 132px",
    gap: 14,
    alignItems: "center",
    padding: "14px 16px",
    border: `1px solid ${palette.border}`,
    borderRadius: 22,
    background: "#fff",
  },
  mobileRow: {
    display: "grid",
    gap: 12,
    padding: 14,
    border: `1px solid ${palette.border}`,
    borderRadius: 20,
    background: "#fff",
  },
  productButton: {
    border: "none",
    background: "transparent",
    padding: 0,
    display: "grid",
    gridTemplateColumns: "56px minmax(0, 1fr)",
    gap: 12,
    alignItems: "start",
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
  },
  logoFrame: {
    width: 48,
    height: 48,
    borderRadius: 14,
    border: `1px solid ${palette.border}`,
    background: palette.soft,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  logoImage: {
    width: 48,
    height: 48,
    objectFit: "contain",
    flexShrink: 0,
    display: "block",
  },
  leftInfo: {
    minWidth: 0,
    display: "grid",
    gap: 4,
  },
  productName: {
    fontSize: 17,
    fontWeight: 800,
    color: palette.text,
    lineHeight: 1.3,
    wordBreak: "keep-all",
  },
  metaLine: {
    fontSize: 13,
    color: palette.muted,
    lineHeight: 1.45,
  },
  previewRow: {
    display: "flex",
    gap: 6,
    marginTop: 2,
    flexWrap: "wrap",
  },
  previewThumbWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: "hidden",
    border: `1px solid ${palette.border}`,
    background: palette.soft,
  },
  previewThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  previewThumbPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 10,
    border: `1px solid ${palette.border}`,
    background: palette.soft,
  },
  orderQtyBox: {
    minHeight: 86,
    borderRadius: 18,
    border: `1px solid ${palette.border}`,
    background: "#f9fbff",
    display: "grid",
    placeItems: "center",
    padding: "10px 8px",
    textAlign: "center",
  },
  orderQtyValue: {
    fontSize: 20,
    fontWeight: 900,
    color: palette.text,
  },
  fieldSubLabel: {
    fontSize: 12,
    color: palette.muted,
    fontWeight: 700,
  },
  fieldGroup: {
    display: "grid",
    gridTemplateColumns: "88px 88px minmax(150px, 1fr)",
    gap: 10,
    alignItems: "end",
  },
  fieldWrap: {
    display: "grid",
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: palette.muted,
  },
  smallInput: {
    width: "100%",
    height: 40,
    borderRadius: 12,
    border: `1px solid ${palette.border}`,
    padding: "0 12px",
    fontSize: 18,
    fontWeight: 800,
    color: palette.text,
    boxSizing: "border-box",
    outline: "none",
    background: "#fff",
  },
  smallInputActive: {
    border: "1px solid #a7dfb3",
    background: palette.greenSoft,
    color: palette.green,
  },
  selectInput: {
    width: "100%",
    height: 40,
    borderRadius: 12,
    border: `1px solid ${palette.border}`,
    padding: "0 12px",
    fontSize: 14,
    color: palette.text,
    outline: "none",
    background: "#fff",
    boxSizing: "border-box",
  },
  inspectionBox: {
    display: "grid",
    gap: 6,
    alignItems: "end",
  },
  inspectionInput: {
    width: "100%",
    height: 40,
    borderRadius: 12,
    border: "1px solid #a7dfb3",
    background: palette.greenSoft,
    padding: "0 12px",
    fontSize: 22,
    fontWeight: 900,
    color: palette.green,
    boxSizing: "border-box",
    outline: "none",
  },
  photoArea: {
    display: "grid",
    justifyItems: "center",
    gap: 6,
  },
  photoButton: {
    minWidth: 112,
    height: 42,
    borderRadius: 14,
    border: "1px solid #9ec4ff",
    background: "#fff",
    color: palette.blue,
    fontSize: 14,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    cursor: "pointer",
  },
  photoCountText: {
    fontSize: 12,
    color: palette.muted,
  },
  lockText: {
    marginTop: 8,
    fontSize: 12,
    color: "#d97706",
    fontWeight: 700,
  },
  conflictText: {
    marginTop: 8,
    fontSize: 12,
    color: palette.red,
    fontWeight: 700,
  },
};

export default React.memo(ProductRow);
