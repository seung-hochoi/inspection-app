// ─── Photo ZIP download orchestration (client side) ──────────────────────────
//
// Responsibilities:
//   collectPhotoList   – build a normalized photo entry list from client-side data
//   buildAndDownloadPhotoZips – call the backend, handle chunked ZIP response,
//                               trigger browser downloads, report progress

import { downloadPhotoZip } from '../api';

const CHUNK_DELAY_MS = 400; // gap between triggering each ZIP part download

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a flat normalized list of photo entries from inspection rows.
 * Used for progress estimation / display before the backend responds.
 *
 * @param {object[]} inspectionRows   – rows returned from loadBootstrap
 * @param {'inspection'|'movement'|'sugar'|'weight'} mode
 * @returns {{ productCode, productName, partnerName, photoType, fileId, sequence }[]}
 */
export function collectPhotoList(inspectionRows = [], mode = 'inspection') {
  const entries = [];
  inspectionRows.forEach((row) => {
    const productCode = String(row['상품코드'] || '').trim();
    const productName = String(row['상품명']   || '').trim();
    const partnerName = String(row['협력사명'] || '').trim();

    const rawIds = String(row['사진파일ID목록'] || '');
    const fileIds = rawIds.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);

    fileIds.forEach((fileId, i) => {
      entries.push({
        productCode,
        productName,
        partnerName,
        photoType: mode === 'inspection' ? 'inspection' : 'defect',
        fileId,
        sequence: i + 1,
      });
    });
  });
  return entries;
}

/**
 * Request ZIP generation from the backend, then trigger download for every
 * part returned (supports multi-chunk ZIPs split at 20 MB).
 *
 * @param {'inspection'|'movement'|'sugar'|'weight'} mode
 * @param {{ onProgress?: (state: ProgressState) => void }} options
 * @returns {Promise<{ count: number, parts: number }>}
 *
 * ProgressState: { stage: 'generating'|'downloading'|'done', percent: number, text: string }
 */
export async function buildAndDownloadPhotoZips(mode, { onProgress } = {}) {
  _progress(onProgress, 'generating', 10, 'ZIP 생성 중...');

  const result = await downloadPhotoZip({ mode });

  _progress(onProgress, 'downloading', 80, '다운로드 준비 중...');

  const zipFiles =
    Array.isArray(result.zipFiles) && result.zipFiles.length > 0
      ? result.zipFiles
      : null;

  if (!zipFiles && !result.downloadUrl && !result.zipBase64) {
    _progress(onProgress, 'done', 100, '');
    return { count: 0, parts: 0 };
  }

  // ── Multi-part chunked ZIPs ──────────────────────────────────────────────
  if (zipFiles) {
    const total = zipFiles.length;
    for (let i = 0; i < total; i++) {
      const file = zipFiles[i];
      _progress(
        onProgress,
        'downloading',
        80 + Math.round(((i + 1) / total) * 20),
        total > 1 ? `다운로드 중 ${i + 1}/${total}...` : '다운로드 중...',
      );
      if (file.downloadUrl) {
        _triggerLinkDownload(file.downloadUrl, file.fileName);
      }
      if (i < total - 1) await _sleep(CHUNK_DELAY_MS);
    }
    _progress(onProgress, 'done', 100, '');
    return {
      count: zipFiles.reduce((s, f) => s + (f.addedCount || 0), 0),
      parts: total,
    };
  }

  // ── Single-file response (legacy / fallback) ──────────────────────────────
  if (result.downloadUrl) {
    _triggerLinkDownload(result.downloadUrl, result.fileName || 'photos.zip');
  } else if (result.zipBase64) {
    _triggerBase64Download(result.zipBase64, result.fileName || 'photos.zip');
  }

  _progress(onProgress, 'done', 100, '');
  return { count: result.addedCount || 0, parts: 1 };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _triggerLinkDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename || 'photos.zip';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _triggerBase64Download(b64, filename) {
  const byteChars = atob(b64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  _triggerLinkDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function _progress(cb, stage, percent, text) {
  if (typeof cb === 'function') cb({ stage, percent, text });
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
