import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Image, X, Upload } from 'lucide-react';
import { C, radius, font, shadow, cardStyle } from './styles';
import { fileToBase64, normalizeProductCode } from '../utils';
import { uploadPhotos } from '../api';

/**
 * PhotoUploader — modal for capturing / uploading product photos.
 *
 * Props:
 *   jobKey     string
 *   product    { productCode, productName, partnerName }
 *   existingFileIds  string[] — already-saved Drive file IDs
 *   onDone(newFileIds: string[])  — called with merged file IDs after upload
 *   onClose()
 */
export default function PhotoUploader({ jobKey, product, existingFileIds = [], onDone, onClose }) {
  const [selectedFiles, setSelectedFiles] = useState([]); // File objects
  const [previews, setPreviews] = useState([]);            // blob URLs
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const handleFiles = (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const newPreviews = list.map((f) => URL.createObjectURL(f));
    setSelectedFiles((prev) => [...prev, ...list]);
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeFile = (index) => {
    URL.revokeObjectURL(previews[index]);
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!selectedFiles.length) { onDone(existingFileIds); onClose(); return; }
    try {
      setUploading(true);
      setError('');
      const photos = [];
      for (const file of selectedFiles) {
        const encoded = await fileToBase64(file);
        if (encoded) photos.push({
          name: encoded.fileName,
          type: encoded.mimeType,
          data: encoded.imageBase64,
        });
      }
      const result = await uploadPhotos({
        itemKey: `${jobKey}||${normalizeProductCode(product.productCode) || ''}||${product.partnerName || ''}`,
        productName: product.productName || '',
        '상품코드': normalizeProductCode(product.productCode) || '',
        '협력사명': product.partnerName || '',
        photos,
      });
      const photosArr = Array.isArray(result.data?.photos) ? result.data.photos
        : Array.isArray(result.data) ? result.data : [];
      const newIds = photosArr.map((item) => String(item.fileId || '').trim()).filter(Boolean);
      const merged = [...new Set([...existingFileIds, ...newIds])];
      previews.forEach((u) => URL.revokeObjectURL(u));
      onDone(merged);
      onClose();
    } catch (err) {
      const raw = err.message || '';
      const friendly = raw.includes('지원하지 않는 action')
        ? '사진 업로드가 서버에서 지원되지 않습니다. 상품코드를 확인하거나 나중에 다시 시도하세요.'
        : raw.includes('Failed to fetch') || raw.includes('NetworkError')
          ? '네트워크 오류가 발생했습니다. 인터넷 연결을 확인하고 다시 시도하세요.'
          : raw || '업로드 실패';
      setError(friendly);
    } finally {
      setUploading(false);
    }
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          <button onClick={onClose} className="action-btn" style={{
            background: C.bgAlt, border: `1px solid ${C.border}`,
            borderRadius: radius.sm, width: 34, height: 34,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: C.muted,
          }}>
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

        {/* New photo previews */}
        <AnimatePresence>
          {previews.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {previews.map((url, i) => (
                <motion.div
                  key={url}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  style={{ position: 'relative' }}
                >
                  <img src={url} alt={`새 사진 ${i + 1}`}
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: radius.sm, border: `2px solid ${C.primaryMid}` }} />
                  <button onClick={() => removeFile(i)} style={{
                    position: 'absolute', top: -6, right: -6,
                    width: 20, height: 20, borderRadius: '50%',
                    background: C.red, color: '#fff', border: '2px solid #fff',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}>
                    <X size={10} strokeWidth={3} />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {error && (
          <p style={{ color: C.red, fontSize: 13, marginBottom: 12, padding: '8px 12px', background: C.redLight, borderRadius: radius.sm }}>
            {error}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input ref={cameraInputRef} type="file" accept="image/*,.heic,.heif" capture="environment"
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
          <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif" multiple
            style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />

          <button onClick={() => cameraInputRef.current?.click()} className="action-btn" style={{
            flex: 1, height: 48, background: C.primaryLight, color: C.primary,
            border: `1.5px solid ${C.primaryMid}`, borderRadius: radius.md,
            fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: font.base,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <Camera size={16} strokeWidth={2} />
            카메라 촬영
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="action-btn" style={{
            flex: 1, height: 48, background: C.bgAlt, color: C.textSec,
            border: `1.5px solid ${C.border}`, borderRadius: radius.md,
            fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: font.base,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}>
            <Image size={16} strokeWidth={2} />
            갤러리 선택
          </button>
        </div>

        {selectedFiles.length > 0 && (
          <button onClick={handleUpload} disabled={uploading} className="action-btn" style={{
            marginTop: 10, width: '100%', height: 50,
            background: uploading ? C.muted2 : C.green,
            color: '#fff', border: 'none', borderRadius: radius.md,
            fontSize: 15, fontWeight: 700, cursor: uploading ? 'default' : 'pointer',
            fontFamily: font.base,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Upload size={16} strokeWidth={2} />
            {uploading ? '업로드 중...' : `${selectedFiles.length}장 업로드`}
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
