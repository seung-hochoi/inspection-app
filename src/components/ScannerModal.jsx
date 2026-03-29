import React from "react";

function ScannerModal({
  isOpen,
  closeScanner,
  scannerReady,
  scannerStatus,
  scannerVideoRef,
  scannerError,
  torchSupported,
  toggleTorch,
  torchOn,
  FlashlightIcon,
  styles,
  focusSearchInput,
}) {
  if (!isOpen) return null;

  return (
    <div style={styles.scannerOverlay} onClick={closeScanner}>
      <div style={styles.scannerModal} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={closeScanner} style={styles.scannerCloseBtn}>
          ×
        </button>

        <div style={styles.scannerTopText}>{scannerReady ? scannerStatus : "바코드 인식 중..."}</div>

        <div style={styles.scannerViewport}>
          <video ref={scannerVideoRef} style={styles.scannerVideo} muted playsInline />
          <div style={styles.scannerGuideBox} />
        </div>

        <div style={styles.scannerHelperText}>바코드를 화면 중앙에 맞춰주세요.</div>

        {scannerError ? <div style={styles.errorBox}>{scannerError}</div> : null}

        <div style={styles.scannerActions}>
          {torchSupported ? (
            <button
              type="button"
              onClick={toggleTorch}
              style={{ ...styles.secondaryButton, width: 52, minWidth: 52, padding: 0 }}
              aria-label={torchOn ? "플래시 끄기" : "플래시 켜기"}
            >
              <FlashlightIcon size={20} active={torchOn} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              closeScanner();
              focusSearchInput();
            }}
            style={styles.primaryButton}
          >
            직접 입력
          </button>
        </div>
      </div>
    </div>
  );
}

export default ScannerModal;
