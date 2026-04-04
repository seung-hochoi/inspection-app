# 데이터 구조 및 postSaveSync_ 정리 v1 (2026-03-31)

## 1. 매핑 시트 기준

현재 기준표 구조
- `소분류명 -> 대분류`
- `협력사 -> 값`
- `센터 -> 값`

현재 런타임 사용 방식
- `소분류명 -> 대분류`: 사용
- `협력사 -> 값`: 사용
- `센터 -> 값`: 구조상 보관, 현재 런타임 직접 사용 안 함

매핑 규칙
- `소분류명`은 CSV 원본의 `소분류명`, `소분류`, `카테고리소`, `소카테고리`, `중분류명`, `중분류` 후보를 읽어 매칭
- `협력사`는 exact match 기반
- exact match가 없으면 원본 값을 유지
- 대분류를 못 찾으면 `미분류`

## 2. 정렬 규칙

우선순위
1. 대분류 우선순위
   - 채소 = 1
   - 과일 = 2
   - 축산 = 3
   - 수산 = 4
   - 기타/미분류 = 9
2. 같은 상품명 최대한 인접
3. 원본 입력 순서 최대 보존

적용 대상
- `return_exchange_records`
- `검품 회송내역 (센터포함)`
- `검품 회송내역 (센터미포함)`

## 3. postSaveSync_ 개요

함수
- `postSaveSync_(payload)`

입력 플래그
- `hasInspection`
- `hasMovement`

동작
1. `hasInspection` 또는 `hasMovement`가 있으면
   - `syncInspectionMovementTotals_(inspectionSheet, recordsSheet)`
   - `updateInspectionDashboard_(ss)`
2. `hasMovement`가 있으면
   - `syncReturnSheets_(ss)`
3. 마지막으로
   - `autoResizeOperationalSheets_(ss)`

## 4. updateInspectionDashboard_ 생성 로직

대상 시트
- `inspection_summary`

대상 범위
- `A1:F6`

생성 항목
- 1차 블록
  - 총 입고금액
  - 총 입고수량
  - 검품 수량
  - 검품률
  - 실검품률
  - 최근 갱신
- 2차 블록
  - 검품 입고금액
  - 입고 SKU
  - 검품 SKU
  - SKU 커버리지
  - 검품입고 SKU
  - 실제 SKU 커버리지
- 3차 블록
  - 행사 SKU
  - 검품입고 SKU
  - 검품 입고수량
  - 회송 수량
  - 교환 수량
  - 사진 기록 건수

데이터 출처
- 현재 작업 CSV row
- 사전예약 row
- inspection_data
- return_exchange_records
- 제외목록
- 행사표

## 5. syncReturnSheets_ 생성 로직

대상 시트
- `검품 회송내역 (센터포함)`
- `검품 회송내역 (센터미포함)`

입력 출처
- `loadLatestJob_().rows`
- `loadRecords_()`
- `loadInspectionRows_()`
- `매핑` 시트

센터포함 요약
- 회송수량이 0보다 큰 `return_exchange_records` 행만 사용
- 날짜/협력사명/상품코드/상품명/미출수량/수주수량/센터 등 표시

센터미포함 요약
- `inspection_data`와 `return_exchange_records`를 SKU 기준으로 합침
- 교환량과 회송량이 모두 0이면 제외
- 대분류는 `소분류명 -> 대분류` 매핑
- 파트너사는 `협력사 -> 값` exact match 축약
- `대분류` 연속 구간 병합

## 6. 현재 안정 버전 기준 요약

현재 안정 기준에서 보장하려는 것
- 원본 row 저장은 빠르고 확실하게
- 후처리는 분리하되 최종적으로 summary와 요약 시트가 따라잡을 수 있게 유지
- 대분류/파트너사 축약/정렬은 `매핑` 시트 기반
