# Apps Script 롤백 가이드 v1 (2026-03-31)

## 현재 상태

현재 로컬 백업 기준 메인 Apps Script 파일
- `C:\inspection-app\Code.stable_v1_2026-03-31.gs`

백업 번들 기준 파일
- `AppsScript_전체백업_v1_2026-03-31.gs`

## 롤백 절차

1. Apps Script 편집기 열기
2. 현재 `Code.gs` 전체 내용 백업
3. `AppsScript_전체백업_v1_2026-03-31.gs` 내용을 `Code.gs`에 덮어쓰기
4. 저장
5. Apps Script에서 새 버전 생성
6. 웹앱 재배포

## 배포 후 권장 확인

1. `postSaveSync_({ hasInspection: true, hasMovement: true })`를 1회 수동 실행
2. 아래 시트가 다시 생성/정렬/요약되는지 확인
   - `inspection_summary`
   - `검품 회송내역 (센터포함)`
   - `검품 회송내역 (센터미포함)`

## 실제 Apps Script 버전 생성 관련 메모

이 로컬 작업공간에는 Apps Script 원격 프로젝트와 직접 연결된 `clasp` 설정이 없어서,
여기서 원격 Apps Script 버전을 직접 생성하지는 못했습니다.

대신 롤백 가능한 안정 스냅샷으로 아래를 준비했습니다.
- 로컬 단일 백업 파일
- 구조/헤더 스냅샷 문서
- summary/postSaveSync_ 로직 문서

실제 버전 생성은 Apps Script 편집기에서 아래 이름으로 권장합니다.
- `검품시스템 안정버전 v1 (2026-03-31)`
