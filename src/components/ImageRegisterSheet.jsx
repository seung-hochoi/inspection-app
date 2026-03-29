import React from "react";

function ImageRegisterSheet({
  showImageRegister,
  uploadingImageKey,
  setShowImageRegister,
  styles,
  imageRegisterSearch,
  setImageRegisterSearch,
  imageRegistryProducts,
  openImageRegisterPicker,
}) {
  if (!showImageRegister) return null;

  return (
    <div style={styles.sheetOverlay} onClick={() => !uploadingImageKey && setShowImageRegister(false)}>
      <div style={styles.bottomSheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHandle} />
        <div style={styles.sheetHeader}>
          <h2 style={styles.sheetTitle}>상품 이미지 등록</h2>
          <button
            type="button"
            onClick={() => !uploadingImageKey && setShowImageRegister(false)}
            style={styles.sheetClose}
          >
            닫기
          </button>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>상품 검색</label>
          <input
            type="text"
            value={imageRegisterSearch}
            onChange={(e) => setImageRegisterSearch(e.target.value)}
            style={styles.input}
            placeholder="상품명 / 상품코드 / 협력사 검색"
          />
        </div>

        <div style={styles.imageRegisterList}>
          {imageRegistryProducts.length === 0 ? (
            <div style={styles.emptyBox}>등록할 상품이 없습니다.</div>
          ) : (
            imageRegistryProducts.map((product) => (
              <div key={product.imageKey} style={styles.imageRegisterCard}>
                <div style={styles.imageRegisterInfo}>
                  <div style={styles.imageRegisterName}>{product.productName || "상품명 없음"}</div>
                  <div style={styles.metaText}>코드 {product.productCode || "-"}</div>
                  <div style={styles.metaText}>협력사 {product.partner || "-"}</div>
                </div>
                {product.imageSrc ? (
                  <div style={{ ...styles.cardThumbFrame, width: 64, height: 64 }}>
                    <img src={product.imageSrc} alt={product.productName} style={styles.cardThumbImage} />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => openImageRegisterPicker(product)}
                  disabled={uploadingImageKey === product.imageKey}
                  style={styles.secondaryButton}
                >
                  {uploadingImageKey === product.imageKey
                    ? "저장 중..."
                    : product.imageSrc
                    ? "이미지 교체"
                    : "이미지 등록"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ImageRegisterSheet;
