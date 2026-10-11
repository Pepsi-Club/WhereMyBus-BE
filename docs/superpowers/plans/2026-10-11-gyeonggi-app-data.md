# Gyeonggi app data implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan in the current branch. Steps use checkbox syntax for tracking.

**Goal:** 공식 경기버스 기반정보를 재현 가능한 앱 데이터로 수집하고 iOS 개발팀 전달 문서를 작성한다.

**Architecture:** GBIS 기반정보 API가 공개하는 정류소·노선·노선별 정류소 원본을 내려받는다. Python 표준 라이브러리로 검증·변환하고, 원본 버전과 해시를 함께 기록한다. 기존 서울 데이터와 서버 동작은 변경하지 않는다.

**Tech Stack:** Python 3.10+, unittest, JSON, Markdown.

**Spec:** 사용자 요청: 기존 `data`처럼 앱에 들어갈 경기 데이터를 먼저 수집한 뒤 앱팀 전달 문서까지 새 브랜치에서 진행. 범위는 데이터·수집 도구·문서이며 앱/서버 지역 확장 구현은 제외한다.

## Global constraints

- Branch: `codex/gyeonggi-app-data`.
- 키는 환경변수 또는 비표시 입력으로만 받고 저장·출력하지 않는다.
- `stationId`와 표시번호 `mobileNo`를 분리한다. 모든 ID는 문자열로 유지한다.
- GBIS 범위의 서울·인천 경유 정류소도 보존한다.
- 동일 노선의 동일 정류소 재방문은 `staOrder`로 구별한다.
- 수집 미완료를 완성된 앱 번들로 표시하지 않는다.

## Review focus

- 인증 오류가 빈 데이터 성공으로 처리되지 않아야 한다.
- 표시번호 누락, 앞자리 0, 중복 번호를 허용하되 식별자로 쓰지 않는다.
- 반복 방문과 분기에서 단일 방향 문자열을 임의 생성하지 않는다.
- 원본 스키마·참조 무결성 오류는 출력 교체 전에 발견한다.
- 실제 원본을 받기 전 구분자·인코딩·전체 건수를 추정하지 않는다.

## Task 1: Source acquisition and conversion

Files: `data/gyeonggi/collect.py`, `data/gyeonggi/test_collect.py`, `data/gyeonggi/README.md`.

- [x] 새 브랜치 생성, 기존 JSON/iOS DTO/공식 명세 확인.
- [x] 정규화·중복·좌표·인증 실패 테스트를 먼저 작성하고 실패 확인.
- [x] 공식 원본 형식을 확인하고 다운로드 및 오프라인 변환 CLI 작성.
- [x] API 수집, JSON 생성, 건수·해시·무결성 검증, 오프라인 재생성 비교.

## Task 2: App handoff

Files: `data/gyeonggi/APP_HANDOFF.md`, dataset/manifest/report, `data/README.md`.

- [x] 실제 응답·생성 데이터 예제로 필드 매핑과 지역별 요청 규칙 문서화.
- [x] iOS DTO/검색/지도/즐겨찾기/CoreData/알림 변경 지점과 검수 기준 작성.
- [x] 테스트·비밀정보 검사·전체 변경 리뷰 완료.

## Execution notes

- 2026-10-11: 최초 기반정보 API는 HTTP 403, reason 30. 20:48 KST 재시도 성공, 버전 20261011 원본 3종 확보. 인증 차단 해소.
- Ruling: 기존 깨끗한 작업 디렉터리의 새 브랜치 사용. 사용자가 요구한 분리를 충족하며 별도 worktree는 만들지 않는다.
- 원본 46,032개 중 노선 연결이 없는 5,061개만 앱 사전에서 제외. 나머지 40,971개와 노선 3,156개, 방문 198,210건 생성. 원본은 gzip으로 함께 보존.
- 검증: Python 테스트 13개 통과, 압축 원본으로 5개 산출물 바이트 동일 재생성, SHA-256·참조 무결성 검증, Swift Foundation 디코딩 성공, 실제 도착 API 4회 성공.
- 2026-10-12 최종 리뷰: 미정차 지점 2,193개와 관련 다음 순번 연결 4,592건 발견. 원본 순번 보존, 앱 검색/지도 선택 제외, 방면 표시 정책을 문서에 명시. Critical 발견 없음.
- 2026-10-12 보완 재검토: 지적 해소 확인, 미해결 Critical/Important 없음. 최종 테스트 13개·오프라인 동일성·해시·문서 내부 링크·자격증명 스캔·Swift 디코딩 재검증 통과.
