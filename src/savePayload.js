// ─── Shared save payload builders ────────────────────────────────────────────
//
// Single source of truth for all write payloads sent to saveBatch.
// Inspection saves, movement saves, and any future write types all build their
// payloads here so field names, clientId, and operationId are always consistent.

import { v4 as uuidv4 } from 'uuid';
import { normalizeProductCode, getClientId } from './utils';

/**
 * Fingerprint of the draft fields that map to server row state.
 * Identical fingerprint → nothing changed since last save → skip the request.
 */
export function buildDraftFingerprint(d) {
  return [
    d.inspQty      || '',
    d.defectReason || '',
    d.brixMin      || '',
    d.brixMax      || '',
    d.brixAvg      || '',
    (d.inspPhotoIds   || []).join(','),
    (d.defectPhotoIds || []).join(','),
    (d.weightPhotoIds || []).join(','),
    (d.brixPhotoIds   || []).join(','),
  ].join('|');
}

/**
 * Build a saveBatch inspection-type row payload.
 *
 * Includes:
 *   clientId     — stable browser/session ID (allows same-user re-saves; conflict guard)
 *   operationId  — unique per request (useful for server-side dedup in future)
 *   expectedVersion / expectedUpdatedAt — optimistic concurrency tokens
 */
export function buildInspPayload(row, jobKey, draft) {
  const cleanCode = normalizeProductCode(row['상품코드']) || '';

  // Merge all photo categories into one ordered, deduplicated list
  const inspIds   = (draft.inspPhotoIds   || draft.photoFileIds    || []).filter(Boolean);
  const defectIds = (draft.defectPhotoIds ||
    [...(draft.returnPhotoIds || []), ...(draft.exchangePhotoIds || [])]).filter(Boolean);
  const weightIds = (draft.weightPhotoIds || []).filter(Boolean);
  const brixIds   = (draft.brixPhotoIds   || []).filter(Boolean);
  const allPhotoIds = [...new Set([...inspIds, ...defectIds, ...weightIds, ...brixIds])];

  const payload = {
    type: 'inspection',
    '작업기준일또는CSV식별값': jobKey,
    '상품코드':  cleanCode,
    '상품명':    row['상품명']   || '',
    '협력사명':  row['협력사명'] || '',
    '발주수량':  String(row['발주수량'] || 0),
    '검품수량':  String(parseInt(draft.inspQty, 10) || 0),
    '불량사유':  draft.defectReason || '',
    '사진파일ID목록': allPhotoIds.join('\n'),
    // Per-category arrays — consumed by Code.gs to store type-specific photo IDs
    // in photo_assets so they survive page reload on any device.
    inspPhotoIds:   inspIds,
    defectPhotoIds: defectIds,
    weightPhotoIds: weightIds,
    brixPhotoIds:   brixIds,
    'BRIX최저': draft.brixMin || '',
    'BRIX최고': draft.brixMax || '',
    'BRIX평균': draft.brixAvg || '',
    clientId:   getClientId(),
    operationId: uuidv4(),
  };

  // Optimistic concurrency tokens — omitted when not yet known (first save)
  if (draft.serverVersion)   payload.expectedVersion   = draft.serverVersion;
  if (draft.serverUpdatedAt) payload.expectedUpdatedAt = draft.serverUpdatedAt;

  return payload;
}

/**
 * Build a saveBatch movement (회송/교환) row payload.
 *
 * @param {object} row          — the CSV product row (for names, partner, quantities)
 * @param {string} jobKey       — current job identifier
 * @param {object} options
 *   type        'RETURN' | 'EXCHANGE'
 *   centerName  string   — center for return; ignored for exchange
 *   qty         number
 *   note        string   — optional memo
 *   centerList  {name, qty}[] — per-center quantities for 수주수량 lookup
 */
export function buildMovPayload(row, jobKey, { type, centerName, qty, note, centerList = [] }) {
  const centerQty = String(
    centerList.find((c) => c.name === centerName)?.qty ?? 0,
  );
  return {
    type: 'movement',
    movementType: type,
    '작업기준일또는CSV식별값': jobKey,
    '상품코드':  normalizeProductCode(row['상품코드']) || row['상품코드'] || '',
    '상품명':    row['상품명']   || '',
    '협력사명':  row['협력사명'] || '',
    '센터명':    type === 'RETURN' ? (centerName || '') : '',
    '처리유형':  type === 'RETURN' ? '회송' : '교환',
    '회송수량':  type === 'RETURN'   ? String(qty) : '0',
    '교환수량':  type === 'EXCHANGE' ? String(qty) : '0',
    '발주수량':  String(row['발주수량'] || 0),
    '전체발주수량': String(row['전체발주수량'] || row['발주수량'] || 0),
    '수주수량':  centerQty,
    '비고':      note || '',
    clientId:   getClientId(),
    operationId: uuidv4(),
  };
}
