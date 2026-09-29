# WhereMyBus 백엔드 가이드

## 프로젝트 목적

**버스어디(WhereMyBus)** 서비스용 NestJS 백엔드다. 정기 버스 도착 알림을 저장하고, 매분 서울 버스 도착 정보를 조회한 뒤 메시지를 가공해 Firebase Cloud Messaging(FCM)으로 알림을 보낸다.

## 실행 환경과 기술 스택

- Node.js / TypeScript / NestJS 8
- Mongoose 기반 MongoDB
- `@nestjs/schedule` 기반 크론 작업
- Axios 기반 서울 버스 도착 정보 API 연동
- Firebase Admin SDK 기반 푸시 알림
- Jest, Supertest, `mongodb-memory-server` 기반 테스트
- Winston 기반 시간별 로그 파일 순환 저장

애플리케이션 진입점은 `src/main.ts`다. 전역 DTO 검증과 Winston 로거를 설정하고 `PORT`에 지정된 포트로 서버를 실행한다. 기본 포트는 `3000`이다.

## 소스 구조

```text
src/
├── main.ts                         # 부트스트랩, 검증, 로거, 포트 설정
├── app.module.ts                   # 루트 의존성 구성과 환경설정 로드
├── app.controller.ts               # 루트 및 최소 앱 버전 API
├── app.service.ts
├── bus-info/
│   ├── bus-info.module.ts
│   ├── bus-info.service.ts         # 서울 버스 API 클라이언트
│   ├── arrival-info.type.ts        # 외부 API 응답 타입
│   └── bus-info.service.spec.ts
├── regular-alarm/
│   ├── regular-alarm.module.ts
│   ├── regular-alarm.controller.ts # 정기 알림 HTTP API
│   ├── regular-alarm.service.ts    # 알림 유스케이스와 매분 실행되는 크론 작업
│   ├── regular-alarm.repository.ts # Mongoose 쿼리
│   ├── regular-alarm.schema.ts     # MongoDB 문서 구조
│   ├── MessageUtil.ts              # 도착 정보 파싱과 알림 문구 생성
│   └── dto/                        # 요청 검증과 응답 변환
├── fcm/
│   ├── fcm.module.ts
│   └── fcm.service.ts              # Firebase Admin 알림 발송
├── config/
│   ├── mongoose.config.ts          # MONGO 기반 MongoDB 연결
│   ├── firbase.config.ts           # 현재 사용하지 않는 기존 Firebase 프로바이더
│   └── logger/                     # HTTP 미들웨어와 Winston 어댑터
└── common/message.ts               # 공통 한국어 메시지

test/                               # Jest E2E 테스트
ecosystem.config.js                 # PM2 클러스터 설정
```

## 모듈별 역할

### `RegularAlarmModule`

주요 도메인 모듈이다. 정기 알림 등록, 삭제, 조회, 스케줄링, 알림 발송 흐름을 담당한다.

- 컨트롤러는 `POST /regular`, `GET /regular`, `DELETE /regular`를 제공한다.
- 서비스의 `regularAlarm()`은 매분 실행된다.
- 저장소는 Mongoose 접근 계층이다.
- 스키마는 `deviceToken`, `time`, `day`, `busRouteId`, `arsId`, `adirection`을 저장한다.
- `MessageUtil`은 서울 버스 API의 도착 문자열을 사용자용 한국어 알림 문구로 변환한다.

### `BusInfoModule`

서울 버스 외부 API 어댑터다. `arriveStation(arsId)`는 정류장에 도착하는 전체 버스 정보를 조회한다. `arriveEachBus(arsId, busRouteId)`는 해당 응답에서 특정 노선을 선택한다.

### `FcmModule`

푸시 알림 어댑터다. 애플리케이션 기본 사용자 인증 정보로 Firebase를 초기화하고 일반 알림 또는 APNs 부제목 알림을 전송한다.

### 루트 및 설정 모듈

`AppModule`은 환경설정 로드, Mongoose 연결, 도메인 모듈 조합, 전역 요청 로깅을 담당한다. `WinstonLogger`는 일반 로그와 오류 로그를 `logs/`에 저장하며 운영 환경이 아니면 콘솔 로그도 출력한다.

## 주요 알림 처리 흐름

```text
매분 실행
  -> RegularAlarmService.regularAlarm()
  -> 현재 지역 시간의 HHmm 및 요일과 일치하는 알림 조회
  -> 고유 arsId마다 버스 도착 정보 한 번씩 조회
  -> busRouteId와 선택적 adirection 조건으로 버스 선택
  -> MessageUtil에서 첫차·다음 차·막차 상태를 알림 문구로 변환
  -> FcmService에서 푸시 알림 발송
  -> 유효하지 않은 정류장·노선 조합의 알림 삭제
```

시간은 서버 지역 시간을 사용한다. 요일은 JavaScript `Date#getDay()` 규칙을 따른다. 일요일은 `0`, 토요일은 `6`이다.

## HTTP API

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| `GET` | `/` | `Hello World!` 반환 |
| `GET` | `/minVer` | 최소 지원 앱 버전 반환 |
| `POST` | `/regular` | 정기 알림 저장 후 ID 반환 |
| `GET` | `/regular?deviceToken=...` | 기기에 등록된 알림 목록 조회 |
| `DELETE` | `/regular?deviceToken=...&alarmId=...` | 기기 토큰과 ID가 일치하는 알림 삭제 |

`POST /regular` 요청 본문:

```json
{
  "deviceToken": "...",
  "time": "0828",
  "day": [1, 2, 3],
  "busRouteId": "121900016",
  "arsId": "22285",
  "adirection": "종점 이름"
}
```

전역 `ValidationPipe`는 `forbidNonWhitelisted`를 활성화하지만 `whitelist`는 명시적으로 활성화하지 않는다. `time`은 현재 네 글자 길이만 검증하며 숫자 형식이나 실제 `HHmm` 범위는 검증하지 않는다.

## 환경설정

`NODE_ENV=dev`이면 `.env.dev`를 불러온다. 테스트를 포함한 나머지 값에서는 `AppModule`이 `.env.prod`를 불러온다.

필요한 설정값:

- `PORT`: HTTP 포트, 기본값 `3000`
- `MONGO`: MongoDB 연결 URI
- `SERVICE_KEY`: 서울 버스 API 서비스 키
- `BUS_INFO_API`: 서울 버스 도착 정보 API URL
- Google 애플리케이션 기본 사용자 인증 정보: `FcmService` 실행에 필요

환경변수 파일, Firebase 인증 JSON, 빌드 결과물, 로그, 커버리지 결과는 Git에서 제외된다. 비밀값을 커밋하지 않는다.

## 주요 명령어

```bash
npm install
npm run start:dev
npm run build
npm test
npm run test:e2e
npm run lint
npm run format
```

주의사항:

- 단위 테스트는 소스 옆의 `*.spec.ts`, E2E 테스트는 `test/`에 있다.
- `BusInfoService` 테스트는 실제 외부 API를 호출하므로 개발 환경설정이 필요하다.
- `RegularAlarmService` 테스트는 인메모리 MongoDB를 시작하고 Firebase Admin을 초기화하므로 로컬 인증 정보와 실행 환경의 영향을 받을 수 있다.
- `lint`와 `format` 명령은 파일을 직접 수정한다.

## 변경 위치 안내

- 알림 API 추가·변경: 컨트롤러 → DTO → 서비스 → 저장소/스키마 → 테스트
- 저장 알림 필드 변경: 스키마, 요청 DTO, 응답 DTO, 저장소 쿼리, 서비스 테스트
- 버스 도착 API 계약 변경: `arrival-info.type.ts`, `bus-info.service.ts`
- 알림 문구 또는 파싱 변경: `MessageUtil.ts`, `common/message.ts`, `MessageUtil.spec.ts`
- 알림 전송 방식 변경: `fcm.service.ts`; 정기 알림 서비스가 사용하는 경계는 유지
- 실행 환경설정 변경: `app.module.ts` 또는 `config/` 아래 관련 클래스

컨트롤러는 얇게 유지한다. 비즈니스 흐름은 서비스, 데이터베이스 쿼리는 저장소, 외부 연동은 각 모듈 서비스에 둔다. 변경 코드 옆에 범위가 명확한 테스트를 추가한다. 제품 동작 변경이 목적이 아니라면 사용자에게 노출되는 한국어 문구를 유지한다.
