# 경기버스 백엔드 확장 개발 계획

> **For agentic workers:** 구현 시 `superpowers:executing-plans` 또는 `superpowers:subagent-driven-development`로 아래 작업을 순서대로 진행한다. 현재 PR은 계획만 추가하며 체크되지 않은 항목은 미구현이다.

**Goal:** 기존 서울 앱과 저장된 알림을 보존하면서 경기 정기알림을 지원한다.

**Architecture:** 외부 버스 조회를 제공자별 adapter로 분리하고 정기알림 배치는 제공자·정류소 단위로 조회한다. 레거시 `/regular`는 서울 전용 계약을 유지하고 `/v2/regular`에서 지역을 명시한다. MongoDB를 활용해 PM2 여러 프로세스의 중복 스케줄 실행과 일일 API 예산을 통제한다.

**Tech Stack:** 현재 NestJS 8, TypeScript, Mongoose 8, Axios, Firebase Admin, Jest, mongodb-memory-server, Supertest. 이 단계에서 Redis나 메시지 큐는 추가하지 않는다.

**Spec:** [앱팀 전달 문서](../../../data/gyeonggi/APP_HANDOFF.md), [실제 수집·검증 데이터](../../../data/gyeonggi/README.md). 코드 검토 기준 `40b897e`. 아래 endpoint·환경변수·파일명은 신규 개발 제안이며 배포된 기능이 아니다.

## Global constraints

- 기존 서울 `arsId`, `busRouteId`, `adirection`, Mongo `_id`를 보존한다. 기존 GET 응답의 `busRoutedId` 철자도 유지한다.
- 경기 조회에는 `stationId`, `routeId`, `staOrder`를 사용한다. 표시번호 `mobileNo`와 방향 문구는 식별자가 아니다.
- 제공자 없는 정상 레거시 알림은 서울로 해석한다. 경기 알림을 서울 조회 경로로 보내지 않는다.
- 조회 실패·빈 결과·노선 불일치·FCM 실패는 사용자 알림 자동 삭제 사유가 아니다.
- API 키·FCM 토큰·인증 URL을 로그에 남기지 않는다.
- 서버 기능을 먼저 배포하고 앱 경기 알림 UI를 나중에 활성화한다. 기존 서울 조회·알림 문구 회귀 테스트가 선행 조건이다.
- 이 계획 범위는 정기알림 지원이다. 앱 실시간 조회의 BE 프록시 전환, 데이터 다운로드 API, 새로운 사용자 인증 체계는 별도 작업이다.

## Review focus

1. 구버전 앱이 서버에만 있는 알림을 삭제하는 동기화: Task 2에서 v1 조회/삭제의 서울 범위 제한 검증.
2. `RUN/PASS`인데 ETA 누락, 숫자/문자열 혼재, XML 인증 오류: Task 3의 실제 응답 기반 adapter 테스트.
3. 동일 노선이 같은 정류소 재방문, 제공자 간 ID 충돌: Task 4에서 `(provider, stationId)` 조회와 `(routeId, staOrder)` 매칭 검증.
4. PM2 cluster 중복 실행과 FCM Promise rejection: Task 1·4에서 완료 대기와 Mongo 원자적 실행권 테스트.
5. 마이그레이션 재실행·중도 실패·롤백: Task 2·5에서 `_id` 보존, 재실행 0건, 경기 알림 보존 검증.

## 1. 현재 구조와 수정 이유

| 현재 코드 | 관찰된 동작 | 변경 목적 |
|---|---|---|
| `server/src/bus-info/bus-info.service.ts` | 단일 키·URL, `arsId` 요청, 서울 응답 타입 | 서울/경기 조회 분리, timeout·업무 오류 정규화 |
| `server/src/regular-alarm/regular-alarm.service.ts` | 분마다 대상 선택, `arsId` Map, 노선+방향 매칭 | 제공자별 조회 묶음과 경기 순번 매칭 |
| 같은 service의 `sendNotification` | 결과 미일치 알림을 `wrongData`에 넣고 삭제, FCM 호출 미대기 | 일시적인 데이터 부족으로 사용자 설정 삭제 방지 |
| `regular-alarm.repository.ts` | `deleteMany`의 Promise 미반환/미대기 | 명시적 삭제 결과·실패를 호출자가 관찰 |
| `server/src/fcm/fcm.service.ts` | `messaging().send()` 미대기, 비동기 rejection 누락 | 실제 전송 완료/실패를 배치가 관찰 |
| `server/src/main.ts` | DTO 미등록 필드 거부 | 기존 DTO에 경기 필드를 임의 전송하면 400; v2 계약 필요 |
| `server/src/bus-api-metric/bus-api-metric.dimension.ts` | 서울 분류만 등록 | 경기 호출·오류를 별도 집계 |
| `server/ecosystem.config.js` | `instances: -1`, `exec_mode: cluster` | 여러 프로세스에서 cron이 실행될 가능성에 대비 |
| `server/src/config/logger/logger.middleware.ts` | query 포함 `originalUrl` 기록 | `/regular?deviceToken=...`의 토큰 로그 노출 제거 |

PM2 설정은 저장소에서 확인한 값이며 운영 중 실제 프로세스 수를 확인했다는 뜻은 아니다. 배포 전에 실제 실행 토폴로지를 확인한다.

## 2. API 계약 — v1 유지, v2 추가

### 기존 클라이언트 보호

현재 iOS `DefaultRegularAlarmRepository.syncRegularAlarms`는 서버에만 있는 알림을 삭제한다. 따라서 v1 GET에 경기 알림을 섞어 주면 구버전 앱이 이를 삭제할 수 있다.

| API | 계약 |
|---|---|
| `POST /regular` | 기존 payload/응답 `{id}` 유지. 항상 서울로 저장 |
| `GET /regular?deviceToken=...` | 서울 및 provider 없는 레거시 서울만 반환. 기존 배열·필드 유지 |
| `DELETE /regular?deviceToken=...&alarmId=...` | 토큰 소유권 + 서울 범위 조건. 경기 ID는 기존 오류 응답으로 거절 |
| `POST /v2/regular` | provider 명시, 아래 신규 payload. 성공 `{id}` |
| `GET /v2/regular?deviceToken=...` | 해당 토큰의 서울+경기. `{schemaVersion:2, alarms:[...]}` |
| `DELETE /v2/regular?deviceToken=...&alarmId=...` | 토큰 소유권 확인 후 해당 알림만 삭제; 기능 플래그 off에서도 가능 |
| `GET /v2/regular/capabilities` | `{schemaVersion:2, providers:{seoul:true,gyeonggi:false}}` 형태. 경기 등록 허용 여부 제공 |

v1의 서울 범위 DB 조건은 `$or: [{provider:'seoul'}, {provider:{$exists:false}}]`. 소유권 조건과 반드시 함께 적용한다. 알 수 없는 provider나 손상된 레코드는 서울로 추측하지 않고 별도 집계한다.

경기 등록 예시:

```json
{
  "deviceToken": "TEST_DEVICE_TOKEN",
  "clientAlarmId": "792cb2bb-3b54-4d56-8fc3-a2ded8e90e10",
  "provider": "gyeonggi",
  "stationId": "200000078",
  "routeId": "200000337",
  "staOrder": 13,
  "stationName": "수일중학교",
  "routeName": "9100",
  "time": "0800",
  "day": [1, 2, 3, 4, 5]
}
```

필수 공통 필드: `deviceToken` 비어 있지 않은 문자열, `clientAlarmId` UUID, `provider` enum, `stationId/routeId` 숫자로 구성된 문자열, `time` 유효한 HHmm, `day` 0~6 정수의 중복 없는 비어 있지 않은 배열. 요일 0은 일요일, 시간대는 Asia/Seoul. 암묵적 숫자 변환은 하지 않는다.

경기는 양의 정수 `staOrder` 필수, `adirection` 입력 거부. 서울은 기존 arsId를 `stationId`, busRouteId를 `routeId`로 보내고 `adirection` 문자열 필수, `staOrder` 입력 거부. `stationName/routeName`은 최대 80자 선택 표시값이며 identity 검증에 사용하지 않는다. 미등록 필드 거부를 유지한다.

v2 GET의 각 레코드: `id`, `clientAlarmId`(레거시는 null), `provider`, `stationId`, `routeId`, `staOrder`(서울은 null), `adirection`(경기는 null), `stationName/routeName`(없으면 null), `time`, `day`. deviceToken은 응답에 되돌려 주지 않는다. v1의 `busRoutedId`와 v2의 `routeId`를 별도 DTO로 관리한다.

신규 v2 요청은 `(deviceToken, clientAlarmId)` 부분 unique index로 중복 등록을 막는다. 동일 키·동일 정규화 payload 재전송은 기존 `{id}` 반환, 다른 payload는 409 `ALARM_IDEMPOTENCY_CONFLICT`. 기존 레코드에는 clientAlarmId를 억지로 부여하지 않는다. v2 기본 성공 상태는 201로 통일하고 최초/재전송 모두 동일 id를 보장한다.

경기 등록 플래그 off는 503 `GYEONGGI_ALARMS_DISABLED`. 기존 경기 레코드 GET/DELETE는 계속 허용한다. 정적 데이터에 없는 신규·타지역 연계 노선도 도착 API에서 나올 수 있으므로, 스냅샷 미등재만으로 등록을 거부하지 않는다. 형식은 검증하되 노선 연결 미확인은 진단 대상으로 남긴다.

## 3. 저장 모델과 마이그레이션

추가 필드: `schemaVersion:2`, `provider`, `stationId`, `routeId`, `staOrder?`, `clientAlarmId?`, `stationName?`, `routeName?`. 기존 `arsId/busRouteId/adirection`은 서울 호환 필드로 보존한다. 경기 문서에는 `arsId`를 만들지 않는다.

읽기 호환 함수 `normalizeAlarm(document)`는 provider 없는 기존 문서를 `seoul`, `stationId=arsId`, `routeId=busRouteId`로 반환한다. 신규 v1/v2 서울 쓰기는 신규 필드와 기존 필드를 함께 기록한다. 경기 쓰기는 신규 필드만 기록한다. 이 호환 계층을 배포한 뒤 backfill한다.

마이그레이션 도구 `server/scripts/migrate-regular-alarm-provider.ts`:

1. 기본 모드는 dry-run. 전체/서울 누락/손상/provider별 건수와 변경될 `_id`를 출력하되 토큰은 출력하지 않는다.
2. apply는 provider가 없고 기존 arsId/busRouteId/time/day가 유효한 레코드만 배치 갱신한다. 빈 provider/null 등 비정상 값은 자동 변환하지 않는다.
3. `_id`, 기존 필드, 시각, 요일, deviceToken은 불변. insert/delete 없이 `$set`만 사용한다. 실행 중 이미 변환된 행은 갱신 조건에서 제외한다.
4. 손상된 행은 원본을 남기고 보고한다. cron에서는 해당 행만 건너뛰고 집계한다.
5. 완료 후 재실행 변경 대상 0건, 기존 `_id` 집합과 사용자별 알림 개수 동일성 확인. 백업은 운영 저장소 정책에 따라 취득하고 저장소에 커밋하지 않는다.

실제 collection 이름은 Mongoose 모델에서 조회한다. 추측한 이름으로 운영 DB 명령을 실행하지 않는다. 인덱스 후보는 `time/day`, `deviceToken`, `(deviceToken, clientAlarmId)`이며 기존 인덱스·중복·explain 결과를 확인한 뒤 생성한다. 마지막 인덱스는 clientAlarmId가 문자열인 행만 포함한다.

## 4. 외부 조회 계약과 상태 정규화

기존 `BusInfoService.arriveStation`은 호환 wrapper로 유지하고, 신규 `ArrivalProviderService.fetchStation(reference)`에서 adapter를 선택한다. 내부 인터페이스 기준:

```ts
type Provider = 'seoul' | 'gyeonggi';
type StationReference = { provider: Provider; stationId: string };
type VehicleArrival = {
  state: 'eta' | 'waiting' | 'finished' | 'unknown';
  etaSeconds: number | null;
  stopsAway: number | null;
};
type ArrivalRecord = {
  provider: Provider;
  stationId: string;
  routeId: string;
  staOrder: number | null;
  adirection: string | null;
  routeName: string;
  first: VehicleArrival;
  second: VehicleArrival;
  legacyNotification: { subTitle: string; message: string } | null;
};
type ArrivalFetchResult =
  | { kind: 'success'; records: ArrivalRecord[] }
  | { kind: 'empty'; records: [] }
  | { kind: 'failure'; reason: 'auth' | 'quota' | 'timeout' | 'transport' | 'upstream' | 'invalid-response' };
```

서울 adapter는 기존 `MessageUtil.getMessageContent(Item)` 결과를 `legacyNotification`에 담아 알림 문구와 막차 처리를 보존한다. 경기 adapter는 `legacyNotification=null`, 명시적인 상태 필드로 새 메시지를 만든다. 서울 문자 파서를 경기 응답에 적용하지 않는다.

경기 정기알림의 기본 조회는 `getBusArrivalListv2(stationId)`다. 한 정류소의 여러 노선 알림을 한 번에 처리한다. 단건 `getBusArrivalItemv2`는 smoke test용이며 일상 배치에서 누락마다 추가 호출하지 않는다. HTTPS 고정 endpoint, `serviceKey` 1회 인코딩, `format=json`, Axios timeout 5초를 초기 설정으로 사용한다.

파싱/상태 규칙:

- `response.msgHeader.resultCode=0`만 정상, `4`는 정상 빈 결과로 분리. HTTP 성공이어도 나머지 업무 코드와 잘못된 body는 failure. XML 인증 오류는 제한된 오류코드만 추출하고 원문/URL은 로그에 넣지 않는다.
- 숫자/문자열 ID와 routeName을 문자열로 정규화. ID 누락·유효하지 않은 순번은 해당 행을 제외하고 진단한다. 알림 대상 행이 없으면 조회 누락으로 처리하고 저장 데이터는 보존한다.
- 양의 `predictTimeSec` 우선, 없으면 양의 `predictTime` × 60. 0은 그 자체만으로 임박으로 해석하지 않고 `locationNo=0`이며 RUN/PASS인 경우에만 0초 ETA로 채택한다. 음수·빈 문자열·누락은 값 없음.
- STOP/WAIT는 각각 finished/waiting. 양의 ETA와 STOP/WAIT가 충돌하면 unknown + 진단 집계. RUN/PASS는 ETA가 있어야 eta, 없으면 unknown. 알 수 없는 flag는 unknown.
- 첫째/둘째 차량 독립 처리. 첫째가 정상인데 둘째 ETA가 없다는 이유로 막차를 추정하지 않는다. 경기 막차는 이 단계에서 표시하지 않는다.
- routeName은 동적 응답 우선, 없으면 저장된 표시명, 둘 다 없으면 “버스”. 정류소 이름은 저장된 표시명, 없으면 “선택한 정류소”. `stationNm1/2`를 승차 정류소 이름으로 쓰지 않는다.
- 원본 업무코드/필드 이상은 민감정보 없는 구조화 로그로 기록한다. HTTP error 객체를 통째로 출력하지 않는다.

경기 알림 메시지 예: ETA 573초 → “버스가 10분 후 도착합니다.”(분은 올림), 60초 이하 → “버스가 곧 도착합니다.”, WAIT → “버스가 회차지에서 출발 대기 중입니다.”, STOP → “버스 운행이 종료되었습니다.”, unknown/빈 결과 → “현재 도착정보가 없습니다.”. 공급자 조회 실패는 정상 도착정보처럼 표시하지 않고 “도착정보를 불러오지 못했습니다.”를 해당 예약 실행에서 최대 한 번 발송한다. 문구는 신규 경기 메시지 테스트로 고정한다.

## 5. 배치 실행·쿼터·관측

1. cron 시간 선택은 Asia/Seoul로 명시한다. 서버 OS 시간대가 UTC여도 기존 HHmm/요일 의도를 유지한다.
2. Mongo `RegularAlarmRun`에 `_id=regular:<UTC 분 시작 ISO>`를 insert해 실행권을 얻는다. 중복 키는 다른 worker가 처리 중/처리 완료이므로 종료. DB 오류면 외부 조회·FCM 없이 해당 회차 실패로 기록한다.
3. 실행권 레코드는 TTL 48시간, 상태/대상수/성공수/실패수 기록. 동일 분의 자동 재취득·재실행은 하지 않는다. 실행 중 프로세스가 죽으면 일부 알림이 누락될 수 있으므로 정체된 run을 경보한다. 외부 FCM과 DB 사이의 정확히 한 번 전송을 보장한다고 표현하지 않는다.
4. 대상 알림을 정규화하고 `(provider, stationId)`로 그룹화. 같은 숫자 ID라도 제공자가 다르면 분리한다. 경기 매칭은 routeId+staOrder, 서울은 기존 routeId+adirection 규칙 유지.
5. 그룹 조회는 동시성 5, 한 회차 작업 기한 50초를 초기 정책으로 둔다. 기한 뒤 새 조회·전송을 시작하지 않고 이미 시작한 작업은 await한다. 각 그룹 failure는 다른 그룹을 중단하지 않는다.
6. 동일 회차 내 정류소 결과만 재사용한다. 이전 분의 ETA를 최신값처럼 재사용하지 않는다.
7. 인증·쿼터·결과없음·잘못된 응답은 재시도하지 않는다. timeout/네트워크/HTTP 5xx는 남은 회차 기한과 예산이 있을 때 1회만 재시도한다. 논리 조회가 아니라 실제 HTTP 시도마다 비용·metric을 기록한다.
8. FCM Promise를 await하고 실패를 분류한다. 결과가 불확실한 timeout은 중복 발송 위험 때문에 같은 회차에 자동 재전송하지 않는다. invalid token도 이 변경에서는 알림 문서 삭제로 연결하지 않고 진단한다.

쿼터는 개발키 기본 수치를 코드에 고정하지 않는다. `GBIS_DAILY_REQUEST_BUDGET`은 현재 승인량에서 앱 직접조회·smoke test·재시도 여유분을 제외해 설정한다. 같은 서비스키를 앱과 서버가 공유하면 서버 카운터만으로 총 할당량을 보장할 수 없다. 운영 전 트래픽 증설/키 운영 정책과 앱 직접조회 예산을 함께 확인한다.

Mongo `ProviderRequestBudget`의 `(provider, KST 날짜)`별 카운터를 조건부 원자 갱신해 HTTP 요청 전에 예산을 예약한다. 갱신 실패/한도 소진이면 호출하지 않는다. retry도 한 건 차감한다. 예산 미설정 상태에서는 경기 등록/dispatch 플래그를 켜지 못하게 한다.

신규 설정 제안: `GBIS_SERVICE_KEY`, `GBIS_HTTP_TIMEOUT_MS=5000`, `GBIS_DAILY_REQUEST_BUDGET`, `GYEONGGI_ALARM_CREATE_ENABLED=false`, `GYEONGGI_ALARM_DISPATCH_ENABLED=false`. create와 dispatch를 별도로 제어하며 capability는 create 플래그와 유효한 설정을 반영한다. dispatch를 끄더라도 경기 GET/DELETE는 유지하고 서울은 계속 처리한다.

기존 metric의 식별자는 `seoul-bus/bus-arrival`. 새 분류는 `gyeonggi-bus/bus-arrival`이며 앱/도메인 provider `gyeonggi`와 명시적으로 매핑한다. HTTP 200 업무 오류도 errorCount에 포함, 빈 결과는 오류 아님. 배치 run 성공/실패·unknown/매칭누락·예산차단·FCM 실패는 구조화 로그로 집계한다. 기존 metrics 스키마를 임의 확장하지 않는다.

## 6. 작업 단위와 테스트

각 Task는 별도 구현 커밋/PR로 나눌 수 있다. 현재 PR #66에는 계획만 포함한다. 테스트는 구현 전에 실패를 확인하고, 아래 검증이 통과한 뒤 다음 Task로 진행한다. 운영키를 사용하는 테스트는 CI에 넣지 않는다.

### Task 1 — 알림 보존과 비동기 처리 선행 수정

수정: `server/src/regular-alarm/regular-alarm.service.ts`, `regular-alarm.repository.ts`, `server/src/fcm/fcm.service.ts`, `server/src/config/logger/logger.middleware.ts`.

테스트: 기존 `regular-alarm.service.spec.ts` 확장, 신규 `server/src/fcm/fcm.service.spec.ts`, `server/src/config/logger/logger.middleware.spec.ts`.

- [ ] 조회 실패·미일치에서 DB 삭제 0회, 다른 정류소 정상 알림 발송을 검사하는 실패 테스트 작성.
- [ ] `await messaging().send(payload)`를 return하여 provider rejection이 상위 호출자까지 전달되는지 검사. 내부 catch는 재throw 또는 명시적 failure 반환; 성공처럼 resolve하지 않는다.
- [ ] `forEach(async ...)` 대신 완료를 대기하는 처리로 변경. 현재 `deleteAllById`가 남아 있으면 return/await 보장.
- [ ] HTTP 로그는 URL pathname과 필요한 비민감 필드만 남긴다. query의 deviceToken/API 키가 출력되지 않는지 검사.
- [ ] 기존 서울 MessageUtil 테스트와 regular-alarm suite 통과 후 `fix: preserve alarms on transient arrival failures` 커밋.

핵심 assertion 예시(FCM은 mock Promise reject, DB는 테스트 저장소):

```ts
await service.sendNotification([alarmA, alarmB]);
expect(repository.deleteAllById).not.toHaveBeenCalled();
expect(fcm.sendWithSubTitle).toHaveBeenCalledWith(
  alarmB.deviceToken, expect.any(String), expect.any(String),
);
```

### Task 2 — v2 계약·저장 모델·레거시 격리

수정: `server/src/regular-alarm/regular-alarm.{schema,repository,service,controller,module}.ts`, 기존 request/response DTO.

신규: `server/src/regular-alarm/regular-alarm-v2.controller.ts`, `dto/request/enroll-v2.request.dto.ts`, `dto/response/regular-alarm-v2.response.dto.ts`, `alarm-identity.ts`, `server/scripts/migrate-regular-alarm-provider.ts`.

테스트: 신규 `regular-alarm-v2.controller.spec.ts`, `alarm-identity.spec.ts`, `regular-alarm-migration.spec.ts`(앞 경로 기준). `normalizeAlarm`을 순수 함수로 분리해 script와 runtime이 같은 매핑을 사용한다.

- [ ] v1 GET이 경기 레코드를 반환하지 않고 v1 DELETE도 경기 ID를 삭제하지 못하는 실패 테스트 작성.
- [ ] 위 API 표/payload를 DTO·controller·repository로 구현. 동일 clientAlarmId 재전송 및 다른 payload의 409를 Mongo unique index까지 포함해 검증.
- [ ] 레거시 읽기 fallback과 서울 dual write, 경기 전용 필드 저장 구현. feature flag는 기본 off.
- [ ] 마이그레이션 dry-run/apply/재실행 테스트. 별도 insert/delete 없음, 원래 `_id`·일정·토큰 동일성 검증.
- [ ] v1 JSON 필드 snapshot, 유효하지 않은 day/time/staOrder/혼합 provider 필드 400 확인 후 `feat: add versioned regional alarm contracts` 커밋.

매핑 assertion 예시:

```ts
expect(normalizeAlarm({
  _id: 'legacy-id', arsId: '01109', busRouteId: '123', adirection: '기존방향',
  deviceToken: 'test-token', time: '0800', day: [1],
})).toMatchObject({
  id: 'legacy-id', provider: 'seoul', stationId: '01109', routeId: '123',
});
```

### Task 3 — 경기 adapter와 제공자별 metric

신규: `server/src/bus-info/arrival-provider.service.ts`, `arrival-provider.types.ts`, `providers/seoul-arrival.adapter.ts`, `providers/gyeonggi-arrival.adapter.ts`, `providers/gyeonggi-arrival.parser.ts`.

수정: `bus-info.service.ts`, `bus-info.module.ts`, `server/src/bus-api-metric/bus-api-metric.dimension.ts`. 테스트: 신규 `providers/gyeonggi-arrival.parser.spec.ts`, `providers/gyeonggi-arrival.adapter.spec.ts`, `arrival-provider.service.spec.ts`; 기존 bus-info/dashboard metric 테스트 확장.

- [ ] `data/gyeonggi/evidence/2026-10-11-api-smoke.json`의 실제 발췌 응답을 테스트 fixture로 사용. 예측시간 누락, routeName 숫자/문자열, XML 오류, STOP/ETA 충돌 테스트 먼저 작성.
- [ ] `parseGyeonggiResponse(body: unknown, stationId: string): ArrivalFetchResult`와 위 타입을 구현. 잘못된 한 행은 다른 정상 행까지 제거하지 않는다.
- [ ] 서울 adapter는 기존 DTO/MessageUtil 결과를 유지. 경기 정상 결과·업무 오류·timeout 모두 metric 완료 callback이 정확히 한 번 실행되는지 검증.
- [ ] endpoint 키 인코딩은 가짜 키 `test+A/B==`와 인코딩 형태가 동일 요청으로 정규화되는지 검사. 실제 키/URL을 fixture에 넣지 않는다.
- [ ] dashboard provider 필터에 경기 노출 확인 후 `feat: normalize Gyeonggi bus arrivals` 커밋.

실제 빈 ETA row 기반 expectation:

```ts
// fixture는 실제 3000(예약) 응답 행을 포함한 전체 response envelope.
const result = parseGyeonggiResponse(fixture, '200000078');
expect(result.kind).toBe('success');
if (result.kind === 'success') {
  expect(result.records.find(row => row.routeId === '200000283')?.first)
    .toMatchObject({ state: 'unknown', etaSeconds: null });
}
```

### Task 4 — 지역별 dispatch·중복 실행·예산 통제

신규: `server/src/regular-alarm/regular-alarm-run.{schema,repository}.ts`, `gyeonggi-message.ts`, `server/src/bus-info/provider-request-budget.{schema,repository}.ts`. 수정: regular-alarm service/module, bus-info module/adapter. 테스트: `regular-alarm-run.repository.spec.ts`, `gyeonggi-message.spec.ts`, `provider-request-budget.repository.spec.ts`, 기존 service suite.

- [ ] 같은 KST 분에 두 worker가 경쟁하면 Mongo 실행권 획득이 1개뿐인 integration test 작성. 50초 기한과 다음 분은 fake clock으로 검증.
- [ ] 제공자별 station Map, 경기 routeId+staOrder 매칭 구현. 같은 route/station의 서로 다른 순번이 섞이지 않는지 검증.
- [ ] 동시성 5·50초 기한·5초 timeout·조건부 retry 1회 적용. fake transport에서 최대 in-flight와 실제 호출 횟수를 확인.
- [ ] daily budget 남은 값이 1인 상태에서 여러 예약 경쟁 시 HTTP 1회만 시작하도록 원자적 카운터 검증. 자정 KST 전환, quota/auth 무재시도 검사.
- [ ] FCM 실패/미정차 데이터/unknown/타지역 동적 노선에서도 알림 문서가 보존되는지 검사. 날짜·시간은 외부 주입 가능하게 분리.
- [ ] tests 통과 후 `feat: dispatch regional alarms with bounded API usage` 커밋.

실행권은 unique `_id` insert를 사용하며 단순 조회 후 insert 패턴으로 구현하지 않는다:

```ts
// repository.claimMinute(key, ownerId): Promise<boolean>
// duplicate-key만 false. 그 외 DB 오류는 throw하여 발송 없이 실패 처리.
const claims = await Promise.all([
  repository.claimMinute('regular:2026-10-12T00:00:00.000Z', 'worker-a'),
  repository.claimMinute('regular:2026-10-12T00:00:00.000Z', 'worker-b'),
]);
expect(claims.filter(Boolean)).toHaveLength(1);
```

### Task 5 — 앱 계약 검수·배포·복구 훈련

신규: `server/test/regular-alarm-v2.e2e-spec.ts`(기존 `server/test/jest-e2e.json` 사용). 수정: `data/gyeonggi/APP_HANDOFF.md`, `.github/workflows/ci.yml`.

- [ ] Supertest + mongodb-memory-server에서 v1/v2 HTTP contract와 capability를 검증. Firebase/외부 API만 mock, 실제 ValidationPipe와 DB 조건은 사용.
- [ ] v1 클라이언트의 서버-only 삭제 시도를 재현해 경기 데이터가 살아 있는지 검사. v2는 기존 서울 id 그대로 읽고 삭제 가능해야 함.
- [ ] create/dispatch off 조합에서 등록 차단·GET/DELETE 유지·서울 발송 유지 확인. source config/실제 비밀정보 없이 실행되는 테스트 구조 확보.
- [ ] 현재 CI는 build만 활성화되어 있으므로 `npm test -- --runInBand`, `npm run test:e2e -- --runInBand`도 실행하도록 추가.
- [ ] 아래 배포 단계와 앱팀 검수 완료 후 `test: verify regional alarm rollout compatibility` 커밋.

HTTP 보호 expectation 예시(v1 정상 fixture와 경기 fixture를 같은 test token에 저장):

```ts
const legacy = await request(app.getHttpServer())
  .get('/regular').query({ deviceToken: 'test-token' }).expect(200);
expect(legacy.body.map(row => row.id)).not.toContain(gyeonggiAlarmId);
await request(app.getHttpServer()).delete('/regular')
  .query({ deviceToken: 'test-token', alarmId: gyeonggiAlarmId }).expect(400);
// 이후 v2 GET으로 해당 id가 여전히 존재함을 확인한다.
```

## 7. 검증 명령과 배포 순서

구현 PR마다 `server` 디렉터리에서 해당 `--runTestsByPath` suite를 먼저 실행하고, 통합 시 아래 명령을 모두 통과해야 한다. 현재 계획 문서 추가만으로 신규 테스트가 존재하거나 통과한 것은 아니다.

```sh
cd server
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

배포 순서:

1. **호환 배포:** Task 1~4를 경기 create/dispatch off로 배포. 모든 프로세스가 provider 격리 버전인지 확인한다. `_id` 보존 dry-run 검토 후 backfill apply; 구버전 서버 프로세스가 경기 알림을 서울로 처리할 여지가 없어야 한다.
2. **관찰:** 서울 알림 수·오류율·문구·중복 발송·기존 앱 sync 회귀 확인. 공유키 전체 호출량과 운영 승인량 확인 후 서버 예산 설정.
3. **제한 검증:** staging에서 경기 create/dispatch on, 테스트 디바이스로 수원/서울 경유/인천 경유 정류소·반복 방문·ETA 없음·재시도 실패 검증. 동시 worker 두 개로 중복 실행 방지 확인.
4. **운영 활성화:** 서버 경기 dispatch 준비 후 create 활성화, capability 확인. 신규 iOS가 v2 sync/영속 모델 마이그레이션을 완료한 버전에서만 경기 알림 UI를 연다.
5. **복구:** 문제가 생기면 경기 create off → dispatch off. 기존 경기 문서는 삭제하지 않고 GET/DELETE 유지. 서울 기능과 구버전 앱은 계속 작동한다.

코드 롤백은 Task 2의 제공자 격리·읽기 호환이 있는 버전까지만 한다. 경기 문서가 생긴 뒤 이 기능이 없는 구버전으로 되돌리면 서울 cron이 잘못 처리하거나 삭제할 수 있다. DB 필드 제거·일괄 역마이그레이션은 정상 롤백 절차에 포함하지 않는다.

완료 기준: 서울 구버전 계약 유지, 경기 식별자·순번 정확, 일시 실패에도 알림 보존, PM2 경쟁 실행 제어, 예산 제한 준수, 앱/FCM 실기기 검증, 경기만 비활성화하는 복구 훈련까지 통과.
