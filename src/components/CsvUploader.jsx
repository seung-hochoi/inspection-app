import React, { useRef, useState } from 'react';
import Papa from 'papaparse';
import { C, radius, font } from './styles';
import { decodeCsvFile, buildNormalizedRows } from '../utils';
import { cacheCsv } from '../api';

/**
 * CsvUploader — Upload a product CSV to the backend via cacheCsv action.
 *
 * Props:
 *   onJobLoaded({ jobKey, rows }) — called after successful upload
 *   onToast(msg, type)
 */
export default function CsvUploader({ onJobLoaded, onToast }) {
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const { text } = await decodeCsvFile(file);
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const rows = buildNormalizedRows(parsed.data);
      if (!rows.length) throw new Error('CSV 행이 없습니다.');

      // derive jobKey from filename + last-modified
      const modStamp = file.lastModified || Date.now();
      const jobKey   = `${file.name}__${modStamp}`;

      // base64 encode CSV for backend
      const enc = new TextEncoder();
      const bytes = enc.encode(text);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const base64 = btoa(bin);

      await cacheCsv({
        job_key: jobKey,
        source_file_name: file.name,
        source_file_modified: String(modStamp),
        parsed_rows_base64: base64,
      });

      onToast && onToast(`CSV 로드 완료 — ${rows.length}개 상품`, 'success');
      onJobLoaded && onJobLoaded({ jobKey, rows });
    } catch (err) {
      onToast && onToast(err.message || 'CSV 처리 실패', 'error');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div style={{ padding: '8px 0' }}>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        style={{
          height: 40, padding: '0 16px',
          background: loading ? C.muted2 : C.bgAlt,
          color: loading ? '#fff' : C.textSec,
          border: `1px solid ${C.border}`, borderRadius: radius.md,
          fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
          fontFamily: font.base, whiteSpace: 'nowrap',
        }}
      >
        {loading ? 'CSV 처리 중...' : '📂 CSV 업로드'}
      </button>
    </div>
  );
}
