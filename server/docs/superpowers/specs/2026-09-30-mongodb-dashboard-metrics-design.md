# MongoDB 기반 버스 API 메트릭 Dashboard 설계

## 1. 목적

서울 버스 도착 정보 API의 실제 HTTP 요청 횟수를 MongoDB에 저장하고, 운영자가 자체 Dashboard에서 일별·월별 호출량과 오류량을 확인한다.

Firebase Analytics, GA4, OCI Monitoring 같은 신규 외부 분석 시스템을 사용하지 않는다. 기존 NestJS 서버, MongoDB, Nginx만 사용한다.

## 2. 성공 기준

- 실제 서울 버스 API 요청 횟수가 1분 단위로 MongoDB에 저장된다.
- 호출이 없는 분에는 MongoDB 문서를 만들거나 갱신하지 않는다.
- `/dashboard/`에서 개발자 인증 코드로 로그인할 수 있다.
- 인증된 브라우저만 Dashboard metric API를 호출할 수 있다.
- 오늘, 이번 달, 선택 기간의 요청량·오류량을 조회할 수 있다.
- Dashboard와 metric 저장 실패가 버스 조회·FCM 알림 흐름을 중단하지 않는다.
- frontend는 외부 CDN이나 외부 API를 사용하지 않는다.

## 3. 범위

### 포함

- 실제 서울 버스 API 요청과 transport 오류 계측
- 메모리 집계 후 1분 단위 MongoDB 저장
- 조회 기간별 MongoDB aggregation
- 개발자 코드 로그인과 서명된 HttpOnly 쿠키
- Nginx static Dashboard와 NestJS API 분리
- vanilla JavaScript, CSS, SVG 기반 Dashboard
- 인증·집계·조회 테스트

### 제외

- 서버 장애를 외부에서 감지하는 uptime monitoring
- 이메일·Slack 자동 알림
- Firebase Analytics, GA4, OCI Monitoring
- 사용자·노선·정류장별 분석
- PM2 프로세스 구조 변경
- 실시간 초 단위 데이터

## 4. 배포 경로

운영 서버 구조:

```text
/home/ubuntu/WhereMyBus-BE/
├── dashboard/
│   ├── index.html
│   ├── dashboard.js
│   └── dashboard.css
└── server/
    └── NestJS backend
```

Nginx 역할:

- `/dashboard/`: `/home/ubuntu/WhereMyBus-BE/dashboard/`의 static 파일 반환
- `/api/dashboard/`: `http://127.0.0.1:3000`의 NestJS API로 proxy

Static 파일과 API를 다른 URL namespace로 분리한다. `/dashboard/api/...`를 사용하지 않는다.

## 5. 전체 흐름

```text
정기 알림 작업
  -> BusInfoService.arriveStation()
  -> 실제 axios.get() 직전 request counter 증가
  -> Axios reject 시 error counter 증가
  -> 매분 완료 버킷을 MongoDB에 upsert

브라우저
  -> GET /dashboard/
  -> Nginx가 static index.html 반환
  -> POST /api/dashboard/auth로 개발자 코드 전송
  -> NestJS가 HttpOnly 서명 쿠키 발급
  -> GET /api/dashboard/metrics?range=30d
  -> NestJS가 MongoDB aggregation 결과 반환
  -> frontend가 summary와 SVG chart 렌더링
```

## 6. 계측 경계

실제 외부 HTTP 요청은 `src/bus-info/bus-info.service.ts`의 `BusInfoService.arriveStation()`에 있다.

```ts
async arriveStation(arsId: string): Promise<ResponseData> {
  this.metricRecorder.recordRequest();

  try {
    return (await axios.get(requestUrl)).data;
  } catch (error) {
    this.metricRecorder.recordError();
    throw error;
  }
}
```

- `recordRequest()`는 `axios.get()` 직전에 한 번 호출한다.
- `recordError()`는 HTTP, timeout, network 오류로 Axios가 reject될 때 호출한다.
- HTTP 200 응답의 서울 버스 API 업무 오류 코드는 Phase 1 error metric에 포함하지 않는다.
- `arriveEachBus()`는 내부적으로 `arriveStation()`을 호출하므로 별도 계측하지 않는다.

## 7. 제안 코드 구조

```text
src/
├── bus-info/
│   ├── bus-info.module.ts
│   ├── bus-info.service.ts
│   └── bus-info.service.spec.ts
└── bus-api-metric/
    ├── bus-api-metric.module.ts
    ├── bus-api-metric.schema.ts
    ├── bus-api-metric.repository.ts
    ├── bus-api-metric.service.ts
    ├── bus-api-metric.controller.ts
    ├── dashboard-auth.service.ts
    ├── dashboard-auth.guard.ts
    └── *.spec.ts

/home/ubuntu/WhereMyBus-BE/dashboard/
├── index.html
├── dashboard.js
└── dashboard.css
```

역할:

- Controller: 인증·조회 HTTP 입출력만 처리
- Service: 집계, 기간 선택, 인증 정책 담당
- Repository: MongoDB upsert와 aggregation 담당
- Schema: 1분 bucket 문서와 index 정의
- Guard: Dashboard API cookie 검증
- Frontend: 같은 origin의 Dashboard API만 호출

## 8. MongoDB 문서

```ts
{
  bucketStart: Date,
  instanceId: string,
  requestCount: number,
  errorCount: number,
  expiresAt: Date,
}
```

Index:

```text
unique: { bucketStart: 1, instanceId: 1 }
TTL:    { expiresAt: 1 }, expireAfterSeconds: 0
query:  { bucketStart: 1 }
```

정책:

- `bucketStart`는 UTC 분 시작 시각
- `instanceId`는 `<NODE_APP_INSTANCE 또는 standalone>:<PID>:<process UUID>`
- 같은 PM2 worker가 같은 분에 재시작해도 process UUID가 달라 이전 count를 덮어쓰지 않음
- 기본 보존 기간 400일
- 요청 0건이면 문서 생성 안 함
- 서버의 일별·월별 aggregation은 `Asia/Seoul` 기준

## 9. 1분 집계와 저장

```ts
interface MinuteBucket {
  bucketStart: Date;
  requestCount: number;
  errorCount: number;
}
```

처리 순서:

1. 요청마다 현재 메모리 버킷 counter 증가
2. 분 경계에서 완료 버킷의 현재 누적값을 snapshot
3. request count가 0이거나 마지막 저장값과 같으면 저장 생략
4. `(bucketStart, instanceId)` 기준 `$set + upsert`
5. write 중 추가된 지연 오류는 메모리 누적값에 남겨 다음 flush에서 다시 snapshot
6. write 실패 시 제한된 pending queue에 보관 후 다음 flush에서 재시도

`$set`을 사용하는 이유는 같은 process가 같은 버킷을 재시도할 때 `$inc` 중복을 막기 위해서다. process lifetime마다 고유한 `instanceId` 문서를 만들고 조회 시 합산하므로 PM2 worker 확장과 같은 분 재시작 모두 서로 덮어쓰지 않는다.

권장 pending 정책:

- 최대 60개 완료 버킷
- 오래된 버킷부터 순차 flush
- queue 초과 시 오류 로그 후 가장 오래된 항목 제거
- metric write 오류는 버스 API 결과에 전파하지 않음

비정상 프로세스 종료 시 현재 1분 버킷은 유실될 수 있다. Nest shutdown hook에서 마지막 버킷을 flush해 정상 종료 유실을 줄인다.

## 10. Dashboard 인증

### 환경변수

```text
HOST=127.0.0.1
DASHBOARD_ENABLED=true
DASHBOARD_ACCESS_CODE=<충분히 긴 개발자 코드>
DASHBOARD_SESSION_SECRET=<별도 무작위 서명 키>
DASHBOARD_SESSION_TTL_SECONDS=28800
DASHBOARD_LOGIN_MAX_ATTEMPTS=5
DASHBOARD_LOGIN_WINDOW_SECONDS=900
BUS_API_METRIC_RETENTION_DAYS=400
```

`DASHBOARD_ACCESS_CODE`와 `DASHBOARD_SESSION_SECRET`는 서로 다른 값이어야 한다. 저장소와 static frontend에 포함하지 않는다.

- access code는 최소 12자
- session secret은 최소 32자
- 운영 backend host는 `127.0.0.1`; Nginx만 loopback으로 접근

### 인증 흐름

1. frontend가 개발자 코드를 `POST /api/dashboard/auth`로 전송
2. 서버가 일정 시간 비교 방식으로 코드 검증
3. 성공 시 8시간 유효 서명 session cookie 발급
4. Guard가 session signature와 만료 시각 검증
5. logout 시 cookie 만료

Cookie 속성:

```text
HttpOnly
Secure
SameSite=Strict
Path=/api/dashboard
Max-Age=28800
```

인증 코드는 browser storage에 저장하지 않는다. session payload에는 비밀값을 넣지 않는다.

### brute-force 방어

- Nginx가 전달한 실제 client IP 기준
- 15분 동안 실패 5회 허용
- 초과 시 `429 Too Many Requests`
- 성공 시 해당 IP 실패 횟수 초기화
- 실패 응답은 코드 오류와 설정 오류를 구분하지 않음

현재 단일 프로세스이므로 인메모리 limiter로 시작한다. 다중 instance 전환 시 MongoDB 또는 공용 rate limiter로 옮긴다.

## 11. Dashboard API

```text
POST /api/dashboard/auth
GET  /api/dashboard/session
GET  /api/dashboard/metrics?range=24h
GET  /api/dashboard/metrics?range=7d
GET  /api/dashboard/metrics?range=30d
GET  /api/dashboard/metrics?range=90d
POST /api/dashboard/logout
```

`range`는 `24h`, `7d`, `30d`, `90d` allowlist만 허용한다.

응답 예시:

```json
{
  "range": "30d",
  "timezone": "Asia/Seoul",
  "summary": {
    "todayRequests": 123,
    "monthRequests": 2450,
    "rangeRequests": 2450,
    "rangeErrors": 7,
    "errorRate": 0.0029,
    "lastCollectedAt": "2026-09-30T12:30:00.000Z"
  },
  "series": [
    {
      "start": "2026-09-01T00:00:00+09:00",
      "requestCount": 81,
      "errorCount": 0
    }
  ]
}
```

집계 해상도:

- `24h`: 시간 단위
- `7d`: 시간 또는 일 단위
- `30d`, `90d`: 일 단위

서버가 집계를 완료해 숫자만 반환한다. frontend는 MongoDB 구조를 알지 못한다.

## 12. Static Dashboard

`/home/ubuntu/WhereMyBus-BE/dashboard/`에 다음 파일을 둔다.

- `index.html`: 로그인 폼, summary 카드, 기간 selector, chart 영역
- `dashboard.js`: session 확인, API 호출, SVG chart 렌더링, logout
- `dashboard.css`: responsive layout

frontend 원칙:

- 외부 CDN·font·analytics 사용 안 함
- vanilla JavaScript만 사용
- API base path는 `/api/dashboard`
- `fetch` 실패와 session 만료를 사용자에게 표시
- server 숫자만 text node로 렌더링
- 인증 코드를 저장하거나 로그로 출력하지 않음

Static 소스가 공개돼도 metric API는 Guard가 보호한다. Dashboard shell에는 비밀값과 운영 데이터가 없다.

## 13. Nginx 경계

```nginx
location = /dashboard {
    return 301 /dashboard/;
}

location ^~ /dashboard/ {
    root /home/ubuntu/WhereMyBus-BE;
    try_files $uri $uri/ /dashboard/index.html;
}

location ^~ /api/dashboard/ {
    proxy_pass http://127.0.0.1:3000;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`proxy_pass`에 trailing slash를 붙이지 않아 NestJS가 `/api/dashboard/...` 경로를 그대로 받게 한다.

NestJS는 loopback proxy만 신뢰하고 외부에서 직접 접근할 수 없도록 `127.0.0.1`에 bind한다. 운영 환경에서 이미 다른 방식으로 listen 중이면 OCI Security List와 host firewall로 3000 포트 외부 접근을 차단한다.

## 14. 장애 격리

- metric recorder 메서드는 throw하지 않음
- MongoDB metric write 오류는 로그로 남기고 버스 조회 흐름 유지
- Dashboard query 오류는 Dashboard API에만 `5xx` 반환
- Dashboard frontend 오류가 cron과 FCM에 영향 없음
- 현재 버킷 또는 pending queue 오류가 기존 regular alarm 저장소를 변경하지 않음
- 로그에 access code, session secret, cookie, device token, `SERVICE_KEY` 미포함

## 15. PM2 고려사항

현재 운영 서버는 1코어이며 `pm2 ls`에 ID `0` 하나만 존재한다. 현재 크론 중복 문제는 없다.

향후 worker를 늘리면:

- worker process generation별 `instanceId` 문서를 저장해 metric overwrite 방지
- 모든 worker에서 `@Cron`이 실행되는 문제는 별도로 단일 scheduler 또는 분산 락으로 해결
- 로그인 rate limiter는 공용 저장소로 이동

이번 범위에서는 PM2 설정을 변경하지 않는다.

## 16. 테스트 전략

### 계측

- 실제 요청 직전 request count 1 증가
- Axios 성공 시 error count 증가 없음
- Axios 실패 시 error count 1 증가 후 원래 오류 유지
- `arriveEachBus()` 경로 이중 집계 없음

### 저장

- 같은 분의 요청을 한 문서로 집계
- 요청 0건이면 repository 미호출
- `$set + upsert` 재시도 시 중복 없음
- write 실패가 버스 조회에 전파되지 않음
- shutdown 시 잔여 버킷 flush
- flush 중 발생한 지연 오류를 다음 flush에서 누적 저장
- 진행 중인 flush와 shutdown이 겹치면 기존 flush 완료 후 현재 버킷까지 저장
- 같은 worker가 같은 분에 재시작해도 process generation별 count 합계 유지
- retention 날짜와 index 검증

### 인증

- 올바른 코드로 cookie 발급
- 잘못된 코드 거부
- 만료·변조 cookie 거부
- cookie 속성 검증
- 실패 횟수 초과 시 429
- 로그에 코드·cookie 미포함

### 조회

- 미인증 요청 401
- 허용 range별 aggregation 결과
- 허용하지 않은 range 400
- 빈 기간은 0 summary와 빈 series
- UTC 저장값이 `Asia/Seoul` 날짜로 집계됨
- 여러 instance 문서 합산

## 17. 구현 순서

1. metric schema와 repository 테스트 작성
2. 1분 메모리 집계·sparse 저장·retry 테스트 작성
3. recorder를 `BusInfoService`에 연결
4. Dashboard auth service와 Guard 테스트 작성
5. Dashboard controller와 range DTO 구현
6. MongoDB aggregation query와 테스트 작성
7. static Dashboard 구현
8. Nginx location과 파일 권한 설정
9. build, unit test, E2E test 수행
10. 운영에서 인증·집계·기간 변경·logout 검증

## 18. 보안 검증 기준

- Dashboard API는 인증 없이 데이터를 반환하지 않는다.
- access code가 HTML, JavaScript, 응답, 로그에 나타나지 않는다.
- session cookie는 JavaScript에서 읽을 수 없다.
- session secret과 access code는 별도 값이다.
- login brute-force 제한이 동작한다.
- backend 3000 포트는 인터넷에서 직접 접근할 수 없다.
- query range와 응답 크기가 제한된다.

## 19. 트레이드오프

장점:

- 기존 MongoDB와 서버만 사용
- cloud vendor 종속 없음
- 월 누적값과 장기 보존을 직접 제어
- 화면과 집계 방식 자유로움

제약:

- Dashboard UI와 인증을 직접 유지
- 서버·MongoDB 장애 시 Dashboard도 중단
- 외부 uptime 감시와 자동 알림 없음
- 비정상 종료 시 현재 1분 metric 유실 가능

호출량 확인이 핵심인 현재 요구에는 이 제약을 수용한다.

## 20. 구현 상태

2026-09-30 기준 feature branch 구현 범위:

- `src/bus-api-metric/`: minute bucket 저장, sparse flush, retry queue, 조회 aggregation, session 인증, Guard, Dashboard API
- `src/bus-info/bus-info.service.ts`: 실제 Axios 요청 경계 계측
- `dashboard/`: 외부 의존 없는 static Dashboard
- `src/main.ts`: loopback 기본 bind, loopback proxy trust, shutdown hook
- unit/E2E: 저장·계측·인증·timezone·API·frontend helper·bootstrap 검증

운영 미적용 범위:

- OCI instance에 실제 환경변수 입력
- PM2 reload
- Nginx location 추가와 reload
- 운영 HTTPS에서 cookie, sparse write, 기간별 합계 확인

적용 절차는 `docs/operations/dashboard-nginx-deployment.md`를 따른다.
