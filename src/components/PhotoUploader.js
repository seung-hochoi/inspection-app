import React from "react";

function PhotoUploader({
  inputId,
  files,
  countText,
  label,
  accept = "image/*",
  multiple = true,
  onFilesSelected,
  onRemove,
  styles,
  DraftPhotoPreviewList,
}) {
  return (
    <>
      <label htmlFor={inputId} style={styles.inspectionPhotoButton}>
        {label}
      </label>
      <span style={styles.inspectionPhotoCount}>{countText}</span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          const nextFiles = Array.from(event.target.files || []);
          onFilesSelected(nextFiles);
          event.target.value = "";
        }}
        style={styles.inspectionPhotoInputHidden}
      />
      <DraftPhotoPreviewList files={files} onRemove={onRemove} styles={styles} />
    </>
  );
}

export default PhotoUploader;
