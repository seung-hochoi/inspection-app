import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Image, X, RotateCcw, Loader2 } from 'lucide-react';
import { C, radius, font, shadow, cardStyle } from './styles';
import { fileToBase64, normalizeProductCode } from '../utils';
import { uploadPhotos } from '../api';

/**
 * PhotoUploader — sheet for capturing / uploading product photos.
 *
 * Props:
 *   jobKey     string
 *   product    { productCode, productName, partnerName }
 *   existingFileIds  string[] — already-saved Drive file IDs
 *   onDone(newFileIds: string[])  — called with merged file IDs after upload
 *   onClose()
 *
 * Flow:
 *   1. User selects / captures a photo → local blob URL preview shown IMMEDIATELY
 *   2. Upload starts automatically — no "upload" button required
 *   3. On success → onDone(merged Drive IDs) + onClose()
 *   4. On error → preview kept visible + error message + retry button
 */
export default function PhotoUploader({ jobKey, product, existingFileIds = [], onDone, onClose }) {
  const [localUrls, setLocalUrls] = useState([]);   // blob URL previews shown before upload
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // Keep the pending File objects in a ref so the retry callback always sees the latest batch
  const pendingFilesRef = useRef([]);
  const fileInputRef    = useRef(null);
  const cameraInputRef  = useRef(null);
  // Track blob URLs that must be revoked — persisted in a ref so cleanup always sees them
  const blobUrlsRef = useRef([]);

  // Revoke all tracked blob URLs on unmount (prevents memory leaks on close-without-success)
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
      blobUrlsRef.current = [];
    };
  }, []);

  // Core upload routine — accepts explicit file list and their matching blob URLs
  const doUpload = useCallback(async (files, urls) => {
    console.log('[PhotoUploader] doUpload called, files:', files.length);
    if (!files.length) { console.log('[PhotoUploader] doUpload: no files, returning early'); return; }
    setError('');
    setUploading(true);
    try {
      const photos = [];
      for (const file of files) {
        console.log('[PhotoUploader] encoding file:', file.name, file.type, file.size);
        const encoded = await fileToBase64(file);
        console.log('[PhotoUploader] encoded result:', encoded ? 'ok' : 'null', encoded?.imageBase64?.length);
        // Use field names matching what Code.gs savePhotosToDrive_ expects:
        // photo.imageBase64, photo.fileName, photo.mimeType
        if (encoded) photos.push({
          fileName: encoded.fileName,
          mimeType: encoded.mimeType,
          imageBase64: encoded.imageBase64,
        });
      }
      console.log('[PhotoUploader] photos array built, count:', photos.length);
      const payload = {
        itemKey: `${jobKey}||${normalizeProductCode(product.productCode) || ''}||${product.partnerName || ''}`,
        productName: product.productName || '',
        '상품코드': normalizeProductCode(product.productCode) || '',
        '협력사명': product.partnerName || '',
        photos,
      };
      console.log('[PhotoUploader] calling uploadPhotos, itemKey:', payload.itemKey, 'photos:', photos.length);
      const result = await uploadPhotos(payload);
      console.log('[PhotoUploader] uploadPhotos result:', result?.ok, result?.data?.photos?.length);
      const photosArr = Array.isArray(result.data?.photos) ? result.data.photos
        : Array.isArray(result.data) ? result.data : [];
      const newIds = photosArr.map((item) => String(item.fileId || '').trim()).filter(Boolean);
      console.log('[PhotoUploader] newIds:', newIds);
      const merged = [...new Set([...existingFileIds, ...newIds])];
      // Revoke blob URLs now that Drive IDs are in hand — also clear tracking ref
      urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
      blobUrlsRef.current = blobUrlsRef.current.filter((u) => !urls.includes(u));
      console.log('[PhotoUploader] calling onDone with merged IDs:', merged.length);
      onDone(merged);
      onClose();
    } catch (err) {
      console.error('[PhotoUploader] upload error:', err);
      const raw = err.message || '';
      setError(
        raw.includes('지원하지 않는 action')
          ? '사진 업로드가 서버에서 지원되지 않습니다. 상품코드를 확인하거나 나중에 다시 시도하세요.'
          : raw.includes('Failed to fetch') || raw.includes('NetworkError')
            ? '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하고 다시 시도하세요.'
            : raw || '업로드 실패',
      );
    } finally {
      setUploading(false);
    }
  }, [jobKey, product, existingFileIds, onDone, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called when the user picks files — creates blob previews immediately then auto-uploads
  const handleFiles = useCallback((files) => {
    console.log('[PhotoUploader] handleFiles called, files:', files?.length);
    const list = Array.from(files || []);
    if (!list.length) { console.log('[PhotoUploader] handleFiles: empty list, returning'); return; }
    // Revoke any previously displayed blob URLs before replacing them
    blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    const urls = list.map((f) => URL.createObjectURL(f));
    blobUrlsRef.current = urls;
    // Replace any previous pending batch (each picker interaction is one upload batch)
    pendingFilesRef.current = list;
    setLocalUrls(urls);
    setError('');
    console.log('[PhotoUploader] calling doUpload');
    doUpload(list, urls);
  }, [doUpload]);

  const handleRetry = useCallback(() => {
    doUpload(pendingFilesRef.current, localUrls);
  }, [doUpload, localUrls]);

  // Only allow backdrop close when not uploading
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && !uploading) onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(15,23,42,0.6)', display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={handleBackdropClick}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        style={{
          ...cardStyle,
          width: '100%', maxWidth: 520,
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
          borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          padding: 20,
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>사진 업로드</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: C.muted }}>
              {product.productName} · {product.partnerName}
            </p>
          </div>
          <button
            onClick={uploading ? undefined : onClose}
            disabled={uploading}
            className="action-btn"
            style={{
              background: C.bgAlt, border: `1px solid ${C.border}`,
              borderRadius: radius.sm, width: 34, height: 34,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: uploading ? 'default' : 'pointer',
              color: uploading ? C.muted2 : C.muted,
              opacity: uploading ? 0.4 : 1,
            }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Already-saved photos */}
        {existingFileIds.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              기존 저장 사진 ({existingFileIds.length}장)
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {existingFileIds.map((id) => (
                <img
                  key={id}
                  src={`https://drive.google.com/thumbnail?id=${id}&sz=w200`}
                  alt="저장된 사진"
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: radius.sm, border: `1px solid ${C.border}` }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Immediate local previews — shown as soon as files are selected, before upload completes */}
        <AnimatePresence>
          {localUrls.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 11.5, color: C.muted, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {uploading ? '업로드 중...' : error ? '업로드 실패 — 미리보기' : '선택된 사진'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {localUrls.map((url, i) => (
                  <motion.div
                    key={url}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.15 }}
                    style={{ position: 'relative', flexShrink: 0 }}
                  >
                    <img
                      src={url}
                      alt={`선택 사진 ${i + 1}`}
                      style={{
                        width: 80, height: 80, objectFit: 'cover',
                        borderRadius: radius.sm,
                        border: `2px solid ${error ? C.red : uploading ? C.primaryMid : C.green}`,
                        opacity: uploading ? 0.7 : 1,
                        transition: 'opacity 0.2s, border-color 0.2s',
                      }}
                    />
                    {/* Loading overlay while uploading */}
                    {uploading && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(255,255,255,0.45)',
                        borderRadius: radius.sm,
                      }}>
                        <Loader2 size={22} strokeWidth={2.5} style={{ color: C.primary, animation: 'spin 0.8s linear infinite' }} />
                      </div>
                    )}
                    {/* Error overlay */}
                    {error && !uploading && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(239,68,68,0.15)',
                        borderRadius: radius.sm,
                      }}>
                        <X size={20} strokeWidth={3} style={{ color: C.red }} />
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* Error message + retry */}
        {error && (
          <div style={{
            marginBottom: 12, padding: '10px 12px',
            background: C.redLight, borderRadius: radius.sm,
            border: `1px solid ${C.redMid || '#fca5a5'}`,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <p style={{ color: C.red, fontSize: 13, margin: 0, flex: 1 }}>{error}</p>
            {pendingFilesRef.current.length > 0 && (
              <button
                onClick={handleRetry}
                className="action-btn"
                style={{
                  flexShrink: 0, height: 30, padding: '0 10px',
                  background: C.red, color: '#fff', border: 'none',
                  borderRadius: radius.sm, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: font.base,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <RotateCcw size={12} strokeWidth={2.5} />
                다시 시도
              </button>
            )}
          </div>
        )}

        {/* Uploading status bar */}
        {uploading && (
          <div style={{
            marginBottom: 12, padding: '10px 12px',
            background: C.primaryLight, borderRadius: radius.sm,
            border: `1px solid ${C.primaryMid}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Loader2 size={14} strokeWidth={2.5} style={{ color: C.primary, flexShrink: 0, animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: C.primary, fontSize: 13, fontWeight: 600, margin: 0 }}>
              사진 업로드 중입니다. 잠시 기다려 주세요...
            </p>
          </div>
        )}

        {/* File picker buttons — disabled while uploading */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input ref={cameraInputRef} type="file" accept="image/*,.heic,.heif" capture="environment"
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
          <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />

          <button
            onClick={() => !uploading && cameraInputRef.current?.click()}
            disabled={uploading}
            className="action-btn"
            style={{
              flex: 1, height: 48,
              background: uploading ? C.bgAlt : C.primaryLight,
              color: uploading ? C.muted2 : C.primary,
              border: `1.5px solid ${uploading ? C.border : C.primaryMid}`,
              borderRadius: radius.md, fontSize: 13.5, fontWeight: 600,
              cursor: uploading ? 'default' : 'pointer', fontFamily: font.base,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              opacity: uploading ? 0.5 : 1, transition: 'opacity 0.2s',
            }}
          >
            <Camera size={16} strokeWidth={2} />
            카메라 촬영
          </button>
          <button
            onClick={() => !uploading && fileInputRef.current?.click()}
            disabled={uploading}
            className="action-btn"
            style={{
              flex: 1, height: 48,
              background: C.bgAlt, color: uploading ? C.muted2 : C.textSec,
              border: `1.5px solid ${C.border}`,
              borderRadius: radius.md, fontSize: 13.5, fontWeight: 600,
              cursor: uploading ? 'default' : 'pointer', fontFamily: font.base,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              opacity: uploading ? 0.5 : 1, transition: 'opacity 0.2s',
            }}
          >
            <Image size={16} strokeWidth={2} />
            갤러리 선택
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
