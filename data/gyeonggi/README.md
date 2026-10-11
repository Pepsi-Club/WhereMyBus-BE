# 경기버스 앱 데이터

2026-10-11 GBIS 공식 기반정보 수집 결과. 앱팀 전달 문서는 [APP_HANDOFF.md](APP_HANDOFF.md).

| 산출물 | 건수 | 용도 |
|---|---:|---|
| [stations.json](snapshots/2026-10-11/stations.json) | 40,971 | 정류소·경로 지점 사전; 검색 노출 필터 필요 |
| [routes.json](snapshots/2026-10-11/routes.json) | 3,156 | 노선 이름·유형·기종점 |
| [route_stations.json](snapshots/2026-10-11/route_stations.json) | 198,210 | 노선별 방문 순번·다음 정류소 |
| [manifest.json](snapshots/2026-10-11/manifest.json) | — | 원본 URL·버전·수집 시각·SHA-256·파일 크기 |
| [validation.json](snapshots/2026-10-11/validation.json) | — | 좌표·참조·중복·누락·지역별 집계 |
| [sources/2026-10-11](sources/2026-10-11) | 정류소 46,032 / 노선 3,156 / 연결 198,210 | 원본 3종 gzip + 메타데이터 |

원본 정류소 중 노선 연결이 없는 5,061개는 앱 번들에서 제외했다. 서울·인천 등 경기 노선의 타지역 경유지는 보존했다. `provider=gyeonggi`는 조회할 데이터 제공자를 뜻하며 행정구역이 아니다. 운행 여부·도착시간은 정적 파일로 판단하지 않는다.

**40,971개 중 이름에 `미정차`가 포함된 지점은 2,193개다.** 앱 검색·지도 선택에서는 `stationName.contains("미정차")`인 지점을 제외한다. 남은 38,778개는 이름 기준 승차 정류소 후보이며 실제 승차 가능 여부를 모두 검증한 수치는 아니다. 미정차 지점도 경로 사전에는 유지하고 `staOrder`를 다시 매기지 않는다.

기존 서울 JSON을 그대로 교체하는 파일이 아니다. 경기 전용 DTO와 제공자별 ID 처리가 필요하다. `mobileNo`는 표시·검색용, 도착 조회는 `stationId`를 사용한다.

## 재생성 — 키와 네트워크 불필요

저장소 루트에서 Python 3.10 이상으로 실행한다. 외부 패키지 설치 불필요.

```sh
python3 -m unittest discover -s data/gyeonggi -p 'test_*.py' -v
python3 data/gyeonggi/collect.py build \
  --cache data/gyeonggi/sources/2026-10-11 \
  --output /tmp/wmb-gyeonggi-rebuild-20261011
diff -qr data/gyeonggi/snapshots/2026-10-11 /tmp/wmb-gyeonggi-rebuild-20261011
```

출력 경로는 존재하지 않아야 한다. 같은 원본·도구로 JSON/manifest/검증 보고서까지 바이트 단위로 동일하게 생성한다. 해시는 압축을 푼 원본 바이트 기준이다. 입력 파일이 변조되면 출력 전에 중단한다.

## 새 버전 수집

[경기도_기반정보 관리](https://www.data.go.kr/data/15080658/openapi.do) 활용신청이 필요하다. 2026-10-11 확인 시 개발계정 신청 가능 트래픽은 100으로 안내되어 있다. 메타데이터 API 1회 + API가 반환한 공개 파일 URL 3회를 사용한다. 정류소별 수만 회 API 호출은 하지 않는다.

```sh
python3 data/gyeonggi/collect.py fetch \
  --cache data/gyeonggi/sources/YYYY-MM-DD
# 터미널의 비표시 프롬프트에 서비스 키 입력
python3 data/gyeonggi/collect.py build \
  --cache data/gyeonggi/sources/YYYY-MM-DD \
  --output data/gyeonggi/snapshots/YYYY-MM-DD
```

`YYYY-MM-DD`를 실제 수집일로 바꾼다. 자동화 시 비밀 저장소에서 `GBIS_SERVICE_KEY` 환경변수를 주입한다. 명령줄 인자에 키를 넣지 않는다. 인코딩 키와 디코딩 키 둘 다 입력 가능하며 한 번만 URL 인코딩한다. 키·인증 URL·원문 오류 응답은 저장하지 않는다.

API 메타데이터는 HTTPS로 요청한다. 이번 메타데이터가 반환한 파일 주소는 `http://openapi.gbis.go.kr/ws/download?...`이며 인증키 없이 다운로드했다. 원본 URL과 수집 시 해시를 기록한다. 이 해시는 이후 파일의 동일성 검사용이며 원본 서버의 전자서명을 뜻하지 않는다. 알 수 없는 다운로드 호스트와 리다이렉트는 자동으로 따라가지 않는다.

인증 실패 시 기존 산출물을 덮어쓰거나 빈 데이터로 성공 처리하지 않는다. HTTP 403 / reason 30이면 해당 서비스 활용신청·키·승인 반영 상태를 확인한다. 이 수집에서는 최초 인증 실패 후 20:48 KST 재시도에 성공했다. 성공 원인을 승인 반영으로 단정하지 않는다.

## 변환 규칙

- 공식 V7.0.1 참고문서와 실제 원본 모두 `^` 레코드, `|` 필드, 첫 레코드 헤더 형식. UTF-8 우선, CP949 보조. 헤더·필드 개수가 달라지면 중단한다.
- ID와 이름은 문자열. 표시번호의 앞자리 0 보존. 빈 표시번호는 `null`; `00000`은 원문 그대로 보존하므로 UI에서는 번호 없음으로 표시한다.
- 정류소·노선 ID 중복, `(routeId, staOrder)` 중복, 연결의 정류소/노선 참조 누락은 실패.
- 좌표 이상은 양쪽 좌표를 `null`로 보존하고 보고한다. 지도에서 제외해야 한다. 이번 원본에는 해당 사례 0건.
- 순번이 연속일 때만 `nextStationId` 생성. 종점·순번 공백에는 `null`; 종점에서 기점으로 임의 연결하지 않는다.
- 원본 정류소 중 적어도 하나의 노선 방문에 참조된 정류소만 앱 번들에 포함한다. 시외·공항·예약 노선도 임의 제외하지 않는다.
- 원본의 시간표·업체·전화번호는 압축 원본에 보존한다. 앱 JSON은 정류소·노선 식별과 방향에 필요한 필드만 포함한다.

단일 정류소의 고정 `nxtStn`은 만들지 않았다. `(routeId, staOrder)`의 `nextStationId`는 다음 원본 순번의 지점이며 미정차 지점일 수도 있다. 이를 그대로 “다음 정차 정류소”로 표시하지 않는다. 승차 방향을 표시할 때는 미정차 지점을 건너뛰어 탐색하되 API 순번은 보존한다.

## 검증 자료

- [실제 도착 API 응답 발췌](evidence/2026-10-11-api-smoke.json): 수원·서울·인천 3개 정류소 목록과 9100번 단건 조회. 차량 식별 필드는 제외했다.
- [Swift 디코딩 예제](examples/DecodeBundle.swift): Foundation만 사용. 앱 통합/Xcode 빌드 검증은 별도다.

```sh
swift -module-cache-path /tmp/wmb-swift-module-cache \
  data/gyeonggi/examples/DecodeBundle.swift \
  data/gyeonggi/snapshots/2026-10-11
```

공식 출처: [GBIS 기반정보 명세](https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBaseInfo), [공공데이터포털 기반정보 및 V7.0.1 참고문서](https://www.data.go.kr/data/15080658/openapi.do), [도착정보 목록 명세](https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrivalStation), [도착정보 항목 명세](https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrival). 포털 기반정보 페이지는 이용허락범위 제한 없음으로 안내한다.
