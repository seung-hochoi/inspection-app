import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, BrowserCodeReader } from '@zxing/browser';
import { C, radius, font, shadow } from './styles';

/**
 * BarcodeScanner — full-screen camera overlay for barcode scanning.
 * Props: onScan(code:string), onClose()
 */
export default function BarcodeScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const trackRef = useRef(null);
  const [status, setStatus] = useState('카메라 초기화 중...');
  const [error, setError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stop = useCallback(() => {
    try { controlsRef.current?.stop(); } catch (_) {}
    try { trackRef.current?.stop(); } catch (_) {}
    controlsRef.current = null;
    trackRef.current = null;
  }, []);

  useEffect(() => {
    let active = true;

    const start = async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        const devices = await BrowserCodeReader.listVideoInputDevices();
        const backCam =
          devices.find((d) => /back|rear|environment/i.test(d.label || '')) || devices[0];

        const onResult = (result, err, controls) => {
          if (!active) return;
          if (controls && !controlsRef.current) {
            controlsRef.current = controls;
            const stream = videoRef.current?.srcObject;
            const track = stream?.getVideoTracks?.()[0] || null;
            trackRef.current = track;
            const caps = track?.getCapabilities?.() || {};
            if ('torch' in caps) setTorchSupported(true);
            setStatus('바코드를 화면 안에 맞춰주세요');
          }
          if (result) {
            const code = String(
              typeof result.getText === 'function' ? result.getText() : result.text || result
            ).replace(/\s+/g, '').trim();
            if (code) {
              try { navigator?.vibrate?.(60); } catch (_) {}
              onScan(code);
            }
          }
        };

        if (backCam?.deviceId) {
          await reader.decodeFromVideoDevice(backCam.deviceId, videoRef.current, onResult);
        } else {
          await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
            videoRef.current,
            onResult
          );
        }
      } catch (err) {
        if (active) setError(err.message || '카메라를 사용할 수 없습니다.');
      }
    };

    start();
    return () => { active = false; stop(); };
  }, [onScan, stop]);

  const toggleTorch = async () => {
    try {
      const next = !torchOn;
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (_) { setTorchSupported(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000', display: 'flex', flexDirection: 'column',
    }}>
      {/* Video */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video
          ref={videoRef}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          muted
          playsInline
        />
        {/* Guide overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '72%', maxWidth: 320, aspectRatio: '3/2',
            border: '2px solid rgba(255,255,255,0.9)',
            borderRadius: radius.md,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          }} />
        </div>
        {/* Corner marks */}
        <div style={{
          position: 'absolute', bottom: 20, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.85)',
          fontSize: 13, fontFamily: font.base,
        }}>
          {error || status}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        background: '#111', padding: '12px 16px',
        display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center',
      }}>
        {torchSupported && (
          <button onClick={toggleTorch} style={{
            background: torchOn ? '#fbbf24' : '#374151',
            color: torchOn ? '#000' : '#fff',
            border: 'none', borderRadius: radius.md,
            padding: '10px 20px', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: font.base,
          }}>
            {torchOn ? '🔦 끄기' : '🔦 켜기'}
          </button>
        )}
        <button onClick={onClose} style={{
          background: C.red, color: '#fff', border: 'none',
          borderRadius: radius.md, padding: '10px 28px',
          fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: font.base,
        }}>
          닫기
        </button>
      </div>
    </div>
  );
}
