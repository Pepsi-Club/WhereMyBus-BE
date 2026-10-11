# 경기버스 지원 — iOS 개발팀 전달 문서

작성일: 2026-10-11. 데이터 브랜치: `codex/gyeonggi-app-data`.

이 브랜치는 공식 경기버스 원본 수집, 앱 데이터 생성, 데이터 검증까지 완료한 인계 자료다. iOS와 서버의 경기 기능 구현은 포함하지 않는다. **정류소·경로 지점 40,971개, 노선 3,156개, 노선별 방문 198,210건**을 제공한다. 이 중 `미정차` 2,193개를 검색에서 제외하면 이름 기준 승차 정류소 후보는 38,778개다. 기존 서울 데이터에 단순 병합하기 전에 제공자와 조회 ID를 분리해야 한다.

검토 기준은 iOS [`62d85b4`](https://github.com/Pepsi-Club/WhereMyBus-iOS/tree/62d85b4ab384b61c4827ed9b44a9c7ea786568f2), BE `85088cc`다. 아래 “제안”은 앞으로 구현할 계약이며 현재 서버에 배포된 API가 아니다.

## 1. 전달 파일과 범위

| 파일 | 건수 | 실제 크기 | 앱 사용 |
|---|---:|---:|---|
| [stations.json](snapshots/2026-10-11/stations.json) | 40,971 | 7,034,274 bytes | 정류소·경로 지점 사전; 검색 노출 필터 필요 |
| [routes.json](snapshots/2026-10-11/routes.json) | 3,156 | 503,160 bytes | 노선 메타데이터 |
| [route_stations.json](snapshots/2026-10-11/route_stations.json) | 198,210 | 21,571,471 bytes | 노선별 순번·방향·다음 정류소 |
| [manifest.json](snapshots/2026-10-11/manifest.json) | — | — | 버전·원본 URL·SHA-256·크기 |
| [validation.json](snapshots/2026-10-11/validation.json) | — | — | 품질 집계·제외 ID 목록 |
| [압축 원본](sources/2026-10-11) | 정류소 46,032 | 약 3.6 MiB | 재생성/감사용, 앱 번들 제외 |

수집 시각은 **2026-10-11 20:48 KST**, 세 파일 버전은 모두 `20261011`. 원본 46,032개 중 노선별 방문 파일에서 참조하지 않는 5,061개만 앱 정류소 번들에서 제외했다. 행정구역 필터는 적용하지 않았다. 앱 번들에는 서울 1,992개, 인천 552개와 기타 경유지역도 포함된다. 전체 지역 집계는 `validation.json.appStationRegions` 참조.

시외·공항·예약 노선도 보존했다. “정적 노선에 포함됨”은 “현재 운행 중/도착정보 제공 중”을 보장하지 않는다. 초기 앱 지원 노선 유형을 제한한다면 앱팀에서 별도 정책을 정하고, 원본을 수정하지 말고 표시 단계에서 필터링한다.

### 미정차 지점 표시 정책

`stationName.contains("미정차")`인 2,193개 지점은 검색 결과·주변 승차지점 추천·선택 가능한 지도 마커에서 제외한다. 이름 기반 보수적 필터이며 원본에는 별도의 승차 가능 필드가 없으므로, 나머지 38,778개 모두의 승차 가능성을 보증하지 않는다. 경로 연결·API 매칭에는 미정차 지점을 포함한 원본 ID와 `staOrder`를 그대로 유지한다.

다른 지점에서 미정차 지점을 바로 가리키는 `nextStationId` 연결도 4,592건이다. 예: 노선 `200000006`, 순번 `61`의 지지대교차로 → 효행공원(미정차). `nextStationId`는 다음 **원본 순번 지점**이지 다음 승차 정류소 보장이 아니다. 화면에서 승차 정류소 방면을 보여줄 때는 미정차 지점을 건너뛰어 탐색하고, 후보가 없으면 방면을 생략한다. 이 표시용 탐색으로 API 조회 순번을 재계산하지 않는다.

## 2. JSON 계약

세 앱 JSON은 공통 envelope 사용. `data`의 레코드 타입만 다르다.

```json
{
  "schemaVersion": 1,
  "provider": "gyeonggi",
  "sourceVersions": {
    "station": "20261011",
    "route": "20261011",
    "routeStation": "20261011"
  },
  "data": []
}
```

위 빈 배열은 envelope 설명용. 실제 산출물에는 전체 레코드가 들어 있다. `schemaVersion != 1`은 명시적으로 지원 여부를 판단하고, 세 파일은 같은 스냅샷 세트로 교체한다. `[GBISBundle<Row>]`가 아니라 단일 `GBISBundle<Row>` 객체를 디코딩한다. [실행 가능한 Swift DTO 예제](examples/DecodeBundle.swift) 제공.

### 정류소: stations.json

아래는 실제 레코드다.

```json
{
  "stationId": "200000078",
  "mobileNo": "01109",
  "stationName": "수일중학교",
  "regionName": "수원",
  "isCentralLane": false,
  "longitude": 126.99985,
  "latitude": 37.3070667
}
```

| 필드 | Swift 타입 | 의미/처리 |
|---|---|---|
| stationId | String | GBIS API 조회 ID. `mobileNo`로 대체 금지 |
| mobileNo | String? | 표시·검색용 번호. 앞자리 0 유지, 유일하지 않음 |
| stationName | String | 정류소 이름 |
| regionName | String | 원본 지역명. 제공자 선택 기준으로 사용하지 않음 |
| isCentralLane | Bool? | 원본 Y/N 변환. 미확인 값은 null |
| longitude, latitude | Double? | WGS84 경도·위도. 둘 중 하나 없으면 지도 표시 제외 |

이번 앱 번들에서 `mobileNo=null`은 398개, `00000`은 2,064개. UI에서 둘 다 “번호 없음”으로 처리하고 내부 ID를 대신 사용자에게 노출하지 않는다. 원본 전체에서 중복 표시번호 값은 4,780종이다. 표시번호·이름·좌표만으로 즐겨찾기와 API 요청을 식별하지 않는다.

### 노선: routes.json

```json
{
  "routeId": "200000337",
  "routeName": "9100",
  "routeTypeCd": "11",
  "regionName": "성남,수원,의왕",
  "startStationId": "201000448",
  "endStationId": "204000199",
  "turnSeq": 29
}
```

모든 ID·노선명·유형코드는 `String`, `turnSeq`만 `Int?`. 노선 번호에 `-`, `M`, `(예약)`이 들어갈 수 있다. 기종점 ID는 이름 조회용이며, 정류소에서 현재 버스가 향하는 방향을 일괄 종점으로 판단하지 않는다.

GBIS `routeTypeCd`는 서울의 버스유형 enum과 별개다. 주요 예: `11` 직행좌석, `13` 일반형, `14` 광역급행, `30` 마을. 기존 서울 `.gyeonggi = "8"`에 그대로 넣으면 타입 의미가 바뀐다. 이번 원본에는 웹 명세의 유형 목록에 없는 **`50` 64개**도 있다. 원문 코드 보존 + `.unknown(rawCode)` 등 일반 표시 경로를 둔다. 전체 유형별 건수는 검증 보고서 `routeTypeCounts`에 있다.

### 노선별 방문: route_stations.json

```json
{
  "routeId": "200000337",
  "stationId": "200000078",
  "staOrder": 13,
  "upDown": "상행",
  "nextStationId": "200000146"
}
```

`staOrder: Int`, `upDown: String?`, 나머지 ID는 `String`/`String?`. `(routeId, staOrder)`가 방문 키다. 이번 데이터에서 같은 `(routeId, stationId)`가 여러 순번으로 나타나는 조합은 **3,909개**다. `routeId+stationId`만으로 중복 제거하면 왕복·순환 노선의 방문을 잃는다.

`nextStationId`는 다음 연속 순번의 경로 지점이며 미정차 지점도 포함한다. 종점이나 순번 공백에서는 null이다. `upDown`은 원본 표시값이며 API 식별자가 아니다. 정류소 전체에 단일 `nxtStn`을 부여하지 않았다. 노선 상세/도착 셀에서는 위 미정차 표시 정책을 적용하고, 정류소 카드에서는 방향을 생략하거나 여러 방면을 표시한다. `stationNm1/2`는 **차량이 현재 위치한 정류소 이름**이므로 `nextStationId` 대용으로 쓰지 않는다.

## 3. 제공자와 영속 ID

현재 [BusStopListDTO][ios-station-dto]는 `stop_no`를 `busStopId`로 사용하고 `WMBRegion`은 서울만 지원한다. 경기에서 이 경로를 그대로 쓰면 `01109`로 도착 조회를 보내게 되어 잘못된 요청이 된다.

제안 모델:

```text
StationReference { provider, apiStationId, displayNumber? }
서울: provider=seoul,    apiStationId=기존 arsId,    displayNumber=기존 stop_no
경기: provider=gyeonggi, apiStationId=GBIS stationId, displayNumber=mobileNo

정류소 키: provider + ":" + apiStationId
경기 노선 방문 키: provider + ":" + stationId + ":" + routeId + ":" + staOrder
```

`provider`는 물리적 위치가 아니라 조회 계약을 선택한다. 종로2가사거리의 서울 `arsId=01001`과 GBIS `stationId=100000001`을 자동으로 같은 ID로 바꾸지 않는다. 두 제공자 목록을 모두 보여줄 때는 제공자 배지/필터로 구분한다. 동일 승강장 UI 통합은 별도 교차 매핑이 검증된 뒤 적용한다. 이름·거리만으로 즐겨찾기 레코드를 합치지 않는다.

지도 SDK가 숫자 클러스터 키를 요구한다면 임시 숫자 → `StationReference` 매핑을 둔다. [LeafMarkerUpdater][ios-marker]는 현재 숫자를 문자열로 바꾸고 5자리 패딩하므로, 제공자 포함 키를 복원할 수 있도록 변경해야 한다.

## 4. 실시간 도착 요청 및 파싱

조회 엔드포인트는 [GBIS 목록 명세][gbis-list], [항목 명세][gbis-item] 기준. 실제 HTTPS 호출도 확인했다.

| 목적 | 경로 (`https://apis.data.go.kr/6410000/` 기준) | 파라미터 |
|---|---|---|
| 정류소 전체 도착 | `busarrivalservice/v2/getBusArrivalListv2` | `stationId` |
| 특정 노선 방문 도착 | `busarrivalservice/v2/getBusArrivalItemv2` | `stationId`, `routeId`, `staOrder` |

공통 `serviceKey`, `format=json`. 키 이름은 소문자 `serviceKey`; 서울의 `ServiceKey`·`arsId`·`resultType` 요청 구성을 재사용하지 않는다. 디코딩 키를 query encoder에 한 번 전달한다. 인코딩 키를 받았다면 percent decode 후 한 번 encode. 원문 `+`를 공백으로 바꾸면 안 된다.

응답은 `response.msgHeader.resultCode`가 `0`일 때 성공. 목록은 `response.msgBody.busArrivalList`, 항목은 `response.msgBody.busArrivalItem`. 현재 서울 DTO의 `msgHeader.headerCd`/`msgBody.itemList`와 별도 DTO가 필요하다. 게이트웨이는 `format=json`이어도 인증 실패를 XML/HTTP 403으로 반환할 수 있다. 오류를 “도착 버스 없음”으로 숨기지 않는다.

실제 20:51 KST 검증 결과 ([응답 발췌](evidence/2026-10-11-api-smoke.json)):

| 정류소/요청 | 결과 |
|---|---|
| 수일중학교 `200000078` 목록 | HTTP 200 / code 0 / 15개 |
| 종로2가사거리(중) `100000001` 목록 | HTTP 200 / code 0 / 12개 |
| 국제업무단지(공항청사) `161000026` 목록 | HTTP 200 / code 0 / 4개 |
| `200000078` + `200000337` + `staOrder=13` | HTTP 200 / code 0 / 9100번, 정적 방문과 일치 |

도착 응답에는 정적 노선 파일에 없는 노선도 나온다. 위 서울 응답의 `741`, `N37`, 인천 응답의 `302`, `308`이 해당했다. 앱에서 `routes.json`과 inner join해 버스를 제거하면 안 된다. 동적 `routeName`, `routeTypeCd`, `staOrder`, `routeDestName`으로 표시하고, 정적 다음 정류소는 없으면 생략한다. 스냅샷 갱신 시 새 노선이 추가될 수도 있다.

### 타입과 도착 상태 처리 제안

- 원격 JSON의 `routeName`은 실제로 `9100`(숫자), `"3000(예약)"`(문자열) 모두 등장. ID·노선명은 숫자/문자열을 허용해 도메인에서 문자열로 정규화한다. 위 정적 번들은 항상 문자열이다.
- 시간 필드는 숫자, 빈 문자열, 필드 누락을 모두 처리한다. 빈 문자열을 0초로 바꾸지 않는다.
- `predictTimeSec1/2`는 초, `predictTime1/2`는 분. 유효한 초 값을 우선하고, 없으면 분 × 60을 사용하는 정책을 제안한다. 두 필드가 정확히 60배로 일치하지 않는 실제 응답도 있었다.
- ETA가 유효하면 기존 `.arrivalTime(time:)`에 **초 단위**로 전달한다. `0`초/임박 판단은 명시적으로 처리한다.
- `RUN`/`PASS`는 운행 중, `STOP`은 운행 종료, `WAIT`는 회차지 대기라는 공식 구분을 따른다. `PASS`를 무정차 통과로 해석하지 않는다. 상태와 ETA가 충돌하면 해당 응답을 진단 가능하게 남기고 표시 정책을 정한다.
- ETA가 없고 `RUN`/`PASS`인 사례가 실제 존재한다. 현재 [ArrivalState][ios-arrival-domain]의 `soon/pending/finished/arrivalTime`만으로는 “도착정보 없음”을 정확히 표현하기 어렵다. `.unknown` 또는 명시적인 정보없음 상태를 추가하고 모든 switch를 갱신한다.
- `remainSeatCnt=-1`은 좌석정보 없음. `locationNo`는 남은 정류소 수이며, `staOrder`와 다르다.
- HTTP/인증 오류, 정상 응답의 조회 결과 없음, 운행 종료, ETA만 없는 상태를 구분한다. 조회 누락 한 번으로 즐겨찾기·정기알림을 삭제하지 않는다.

## 5. iOS 수정 지점

| 영역 | 현재 위치 | 필요한 변경 |
|---|---|---|
| 번들 로드 | [DefaultStationListRepository][ios-station-repo] | 서울 번들 유지 + 경기 stations 추가. 단일 실패가 다른 지역 로드를 막지 않게 처리 |
| DTO/지역 도메인 | [BusStopListDTO][ios-station-dto], [BusStopRegion][ios-region] | 경기 별도 DTO, 제공자 포함 정류소 모델. 서울 ID 매핑은 유지 |
| 검색·주변 지도 | `DefaultSearchUseCase`, `DefaultNearMapUseCase`, 지역 switch | 경기 컬렉션 반영, 이름에 미정차가 포함된 지점은 선택 대상에서 제외. 최근 검색 직렬화에도 provider/ID 적용 |
| 지도 선택 | [LeafMarkerUpdater][ios-marker] 및 클러스터 키 생성부 | 5자리 서울 번호 복원 로직 대신 StationReference 조회 |
| 도착 통신 | [BusStopArrivalInfoEndPoint][ios-endpoint], [DefaultBusStopArrivalInfoRepository][ios-arrival-repo] | 제공자별 endpoint/DTO adapter 선택. `String` 하나만 받는 인터페이스 확장 |
| 도착 변환 | [BusStopArrivalInfoDTO][ios-arrival-dto], [ArrivalState][ios-arrival-domain] | 경기 중첩 응답·가변 타입·정보없음·유형 코드 대응 |
| 즐겨찾기 | [FavoritesBusResponse][ios-favorites] 및 도착 결과의 favorite matching | 문자열 단순 연결 키 대신 제공자와 방문 순번이 포함된 키. `toBusStopIds`도 provider 고려 |
| 영속화 | [CoreData Model_v2][ios-coredata] | FavoritesBus/Stop/RegularAlarm에 provider, 경기 staOrder 등 저장; 모델 버전 증가 |
| 정기알림 동기화 | [DefaultRegularAlarmRepository][ios-alarm] | 기존 서버 alarm id 유지. 지역 추가로 서버 알림 삭제/재등록하지 않게 마이그레이션 |
| 위젯/공유 저장 | `Projects/App/Widget` 및 App Group 직렬화 | 새 ID/enum/필드와 이전 저장값 양쪽 처리. 위젯 동작은 별도 실기기 검증 |

정류소 JSON은 약 6.71 MiB, 전체 방문 JSON은 약 20.57 MiB다. 지도 진입 시 메인 스레드에서 세 파일을 전부 decode/index하지 않는다. 정류소는 백그라운드 로드하고, 노선/방문 데이터는 필요 시 로드하거나 앱 빌드 단계에서 SQLite 등으로 변환한다. iOS 실기기 시작 시간·메모리는 이 작업에서 측정하지 않았다.

### 기존 사용자 마이그레이션

1. 기존 CoreData/UserDefaults 레코드에 provider가 없으면 `seoul`로 읽는다. 기존 서울 arsId·즐겨찾기·alarm id를 유지한다.
2. 경기 신규 레코드는 `stationId`와 별도 `mobileNo`, 노선 방문에는 `routeId`와 `staOrder`를 저장한다. 방향 텍스트를 식별자로 쓰지 않는다.
3. 기존 즐겨찾기 identifier를 새 규칙으로 옮길 때 충돌·중복을 점검한다. 캐시와 UI favorite matching도 함께 바꾼다.
4. 최근 검색/위젯 JSON도 이전 버전을 디코딩할 수 있게 한다. 한 레코드의 누락 필드 때문에 전체 목록을 지우지 않는다.
5. 서버와 로컬 알림의 차집합 동기화는 마이그레이션 뒤에도 기존 알림을 보존하는지 테스트한다. 서울 endpoint를 사용하는 레거시 복원 경로에 경기 ID를 넣지 않는다.

## 6. BE 협업과 배포 순서

현재 BE는 NestJS + MongoDB + FCM 기반 정기알림 서비스다. 앱 실시간 도착 조회는 [iOS endpoint][ios-endpoint]에서 서울 API를 직접 호출한다. BE `BusInfoService`와 `RegularAlarmService`는 서울 `arsId`, `busRouteId`, `adirection`, `arrmsg1/2` 계약에 묶여 있다. 지역 분기와 경기 도착 변환은 아직 없다.

**현재 `POST /regular`에 경기 stationId를 arsId로 넣으면 안 된다.** 데이터 번들/실시간 경기 조회를 먼저 배포한다면 경기 정기알림 등록 UI는 비활성화해야 한다. 이후 BE 변경이 함께 준비되면 활성화한다.

BE 후속 구현 제안:

- 알림 요청·저장 모델에 provider와 경기 `stationId/routeId/staOrder` 추가. 레거시 요청은 서울로 해석하고 기존 GET 응답 호환 유지. 현재 응답의 `busRoutedId` 철자도 기존 앱 계약에 포함되어 있으므로 별도 버전 없이 변경하지 않는다.
- 도착 조회를 제공자별 adapter로 분리하고 공통 ETA/운행 상태로 정규화한다. 분당 배치 조회 캐시 키는 `(provider, stationId)`로 분리한다.
- 경기 알림 노선 매칭은 `(routeId, staOrder)` 기준. `adirection` 텍스트로 매칭하지 않는다.
- 현재 노선 매칭 실패를 잘못된 알림으로 삭제하는 흐름을 재검토한다. API 장애·빈 도착 결과를 사용자 알림 삭제로 연결하지 않는다.
- provider/operation별 API 지표, timeout·quota·인증 실패를 구분한다. 경기 키 설정은 현재 서울 설정과 독립적으로 관리한다.

데이터팀 → 앱팀은 이 디렉터리를 전달하면 된다. 앱팀 → BE팀은 위 모델/알림 API 계약을 확정한 뒤 서버 기능과 마이그레이션을 구현한다. 이번 브랜치에서 새 서버 API가 생긴 것은 아니다.

## 7. 인수 검수 기준

- [x] 공식 원본 3개 확보, 버전·해시 기록, 앱 JSON 생성.
- [x] 현재 원본의 중복 기본키/미해결 연결 참조 없음. 좌표 오류·순번 공백·노선 미연결·기종점 참조 누락 0건.
- [x] 수원/서울/인천 정류소 목록 + 9100번 단건 실호출 성공.
- [x] Python 테스트 13개, 오프라인 5개 파일 바이트 동일 재생성, 해시 검증, Swift Foundation 전체 파일 디코딩 성공. 앱 통합 빌드는 포함하지 않음.
- [ ] iOS에 경기 DTO·제공자 분기 통합 후 서울/경기 검색·지도 선택 회귀 테스트.
- [ ] `01109` 표시, `200000078` 조회가 분리되는지 확인.
- [ ] 미정차 2,193개는 검색·주변 추천·지도 선택에서 제외하되 원본 경로 순번은 유지. 다음 방면 표시에도 같은 정책 적용.
- [ ] 같은 노선·정류소의 서로 다른 staOrder를 즐겨찾기와 알림에서 구분.
- [ ] 숫자/문자열 routeName, ETA 빈 문자열·누락, unknown routeType `50`, 정적 파일 밖 동적 노선 처리.
- [ ] 기존 서울 사용자 데이터·최근 검색·정기알림 유지, 서버 알림 삭제/재생성 방지.
- [ ] 경기 알림은 BE 지원 배포 전 등록 불가; 이후 실기기 FCM까지 검증.
- [ ] 앱 시작/지도 메모리·성능, 위젯 공유 데이터 마이그레이션 실기기 검증.

재생성·검증 명령은 [README](README.md). 이 문서의 미체크 항목은 앱/서버 후속 작업이며 데이터 수집 실패를 의미하지 않는다.

[gbis-list]: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrivalStation
[gbis-item]: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrival
[ios-station-dto]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Data/Sources/DTO/BusStopListDTO.swift
[ios-station-repo]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Data/Sources/Repository/DefaultStationListRepository.swift
[ios-region]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Domain/Sources/Entity/Response/BusStopRegion.swift
[ios-marker]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Feature/NearMapFeature/Sources/NMapsClustreing/LeafMarkerUpdater.swift
[ios-endpoint]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/NetworkService/Sources/EndPoint/BusStopArrivalInfoEndPoint.swift
[ios-arrival-repo]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Data/Sources/Repository/DefaultBusStopArrivalInfoRepository.swift
[ios-arrival-dto]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Data/Sources/DTO/BusStopArrivalInfoDTO.swift
[ios-arrival-domain]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Domain/Sources/Entity/Response/BusStopArrivalInfoResponse.swift
[ios-favorites]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Domain/Sources/Entity/Response/FavoritesBusResponse.swift
[ios-coredata]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/App/Resources/Model.xcdatamodeld/Model_v2.xcdatamodel/contents
[ios-alarm]: https://github.com/Pepsi-Club/WhereMyBus-iOS/blob/62d85b4ab384b61c4827ed9b44a9c7ea786568f2/Projects/Data/Sources/Repository/DefaultRegularAlarmRepository.swift
