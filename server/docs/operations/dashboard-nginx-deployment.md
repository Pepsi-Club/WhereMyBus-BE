# 자체 Dashboard Nginx 배포 가이드

> 이 저장소 변경은 Dashboard 코드와 설정 예시만 제공한다. OCI instance의 환경변수, PM2, Nginx 설정은 자동으로 변경되지 않으며 아래 순서로 운영 서버에 직접 적용해야 한다.

## 1. 운영 경로

```text
/home/ubuntu/WhereMyBus-BE/
├── dashboard/
│   ├── index.html
│   ├── dashboard.js
│   └── dashboard.css
└── server/
    ├── dist/
    ├── ecosystem.config.js
    └── ...
```

URL 매핑:

| URL                | 처리 주체 | 대상                     |
| ------------------ | --------- | ------------------------ |
| `/dashboard`       | Nginx     | `/dashboard/`로 redirect |
| `/dashboard/`      | Nginx     | static `index.html`      |
| `/dashboard/*`     | Nginx     | static asset             |
| `/api/dashboard/*` | NestJS    | `127.0.0.1:3000` proxy   |

## 2. Dashboard 파일 확인

```bash
cd /home/ubuntu/WhereMyBus-BE
find dashboard -maxdepth 1 -type f -print
```

필수 파일:

```text
dashboard/index.html
dashboard/dashboard.js
dashboard/dashboard.css
```

Nginx worker가 경로를 traverse하고 파일을 읽을 수 있어야 한다.

```bash
namei -l /home/ubuntu/WhereMyBus-BE/dashboard/index.html
sudo -u www-data test -r /home/ubuntu/WhereMyBus-BE/dashboard/index.html
```

두 번째 명령의 exit code가 `0`이어야 한다. 권한이 없으면 전체 home directory를 무조건 공개하지 말고 `www-data`에 필요한 traverse/read 권한만 ACL 또는 group으로 부여한다.

## 3. Nginx 설정

기존 HTTPS `server` block 안에 추가한다.

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

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
    proxy_send_timeout 15s;
}
```

중요:

- `root /home/ubuntu/WhereMyBus-BE;` 사용 시 `/dashboard/dashboard.js`가 `/home/ubuntu/WhereMyBus-BE/dashboard/dashboard.js`로 매핑된다.
- `proxy_pass http://127.0.0.1:3000;` 뒤에 `/`를 붙이지 않는다.
- trailing slash가 없으면 원래 `/api/dashboard/...` URI가 NestJS로 전달된다.
- static location과 API location의 namespace가 달라 서로 가로채지 않는다.

### Chart.js CDN과 CSP

Dashboard는 다음 고정 버전의 Chart.js UMD 파일을 앱 script보다 먼저 `defer`로 로드한다.

- URL: `https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js`
- SRI: `sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ`
- 외부 script에는 `crossorigin="anonymous"`를 유지한다.

새 CSP를 설정할 때 HTTPS `server` block에 다음 예시를 적용할 수 있다.

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

이미 CSP가 있으면 기존 `script-src`에 `https://cdn.jsdelivr.net`을 병합한다. 별도의 CSP header를 추가하면 두 정책을 모두 만족해야 하므로 기존 정책이 계속 CDN을 차단할 수 있다. `add_header`가 있는 하위 location은 상위 header를 상속하지 않을 수 있으므로 캐시 설정을 포함해 `nginx -T`와 실제 HTML 응답 header를 확인한다.

CDN 버전을 변경할 때 다운로드한 파일의 SHA-384를 계산하고 HTML의 SRI와 대조한다.

```bash
curl --fail --silent --show-error https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```

계산 결과에 `sha384-`를 붙였을 때 위 SRI와 정확히 같아야 한다. 브라우저 개발자 도구의 Network에서도 script가 성공적으로 로드되는지 확인한다. CSP 차단 시 console에 `Refused to load the script`와 `script-src` 관련 오류가, SRI 불일치 시 `integrity` digest 오류가, CDN 접속 실패 시 script network 오류가 나타난다.

라이브러리가 로드되지 않아도 요약 카드는 갱신되고 차트 영역에는 `차트를 표시하지 못했습니다. 새로고침해 주세요.`가 표시된다. CDN/CSP 문제를 해결하고 페이지를 다시 로드한다. 라이브러리가 이미 복구된 페이지에서는 Dashboard의 새로고침 버튼으로 차트를 다시 생성할 수 있다.

## 4. HTTP 차단과 HTTPS

인증 cookie가 `Secure`이므로 Dashboard는 HTTPS에서만 정상 동작한다.

HTTP server block은 기존처럼 HTTPS로 redirect한다.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <DOMAIN>;

    return 301 https://$host$request_uri;
}
```

## 5. Backend 직접 접근 차단

권장:

- NestJS listen address: `127.0.0.1`
- 외부 공개 포트: 80, 443만
- OCI Security List 또는 NSG에서 3000 ingress 미허용
- host firewall에서도 3000 외부 ingress 차단

Nginx만 backend에 접근해야 `X-Forwarded-For`를 신뢰할 수 있다. NestJS에서 proxy trust를 설정할 때 임의 외부 proxy 전체가 아니라 loopback proxy만 신뢰한다.

## 6. 애플리케이션 환경변수

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

요건:

- `HOST=127.0.0.1`로 NestJS가 Nginx loopback 요청만 받게 설정
- access code 최소 12자, session secret 최소 32자
- access code와 session secret은 서로 다른 값
- `.env`와 PM2 환경설정 파일 권한 제한
- Git 커밋 금지
- shell history에 실제 secret 노출 주의
- 변경 후 PM2 reload 필요

## 7. Backend build와 PM2 적용

운영 서버에서 새 커밋을 받은 뒤 실행한다.

```bash
cd /home/ubuntu/WhereMyBus-BE/server
npm ci
npm run build
pm2 reload 0 --update-env
pm2 ls
```

확인 항목:

- PM2 ID `0` 상태가 `online`
- application log에 MongoDB 연결 또는 provider 초기화 오류 없음
- `ss -lntp`에서 NestJS가 `127.0.0.1:<PORT>`에만 bind
- 외부에서 `<PUBLIC_IP>:3000` 접근 불가

## 8. Nginx 적용 전 검증

```bash
sudo nginx -t
```

성공한 경우에만 reload한다.

```bash
sudo systemctl reload nginx
```

Nginx reload는 기존 연결을 유지하면서 설정을 교체한다. `nginx -t` 실패 시 reload하지 않는다.

## 9. Static 응답 검증

```bash
curl -I https://<DOMAIN>/dashboard
curl -I https://<DOMAIN>/dashboard/
curl -I https://<DOMAIN>/dashboard/dashboard.js
```

기대 결과:

- `/dashboard`: `/dashboard/` redirect
- `/dashboard/`: HTML `200`
- JavaScript/CSS: `200`과 올바른 Content-Type

403이면 directory traverse/read 권한을 확인한다. 404이면 `root`와 실제 파일 경로를 확인한다.

## 10. API proxy 검증

```bash
curl -i https://<DOMAIN>/api/dashboard/session
curl -i 'https://<DOMAIN>/api/dashboard/metrics?range=24h'
```

로그인 전 기대 결과: `401 Unauthorized`.

Nginx access log와 NestJS HTTP log에서 경로가 `/api/dashboard/...`로 유지되는지 확인한다.

Backend에 `/session`이나 `/metrics`만 전달되면 `proxy_pass` trailing slash 설정을 확인한다.

## 11. 인증 검증

실제 코드를 command history에 남기지 않도록 브라우저에서 우선 검증한다.

확인 항목:

- 잘못된 코드 로그인 실패
- 올바른 코드 로그인 성공
- browser storage에 코드 없음
- cookie에 `HttpOnly`, `Secure`, `SameSite=Strict`
- 새 browser session에서 인증 요구
- logout 후 metric API가 401 반환
- 실패 5회 초과 시 429 반환

## 12. Dashboard 데이터 검증

### 분류별 저장 계약과 인덱스

MongoDB `WhereMyBus.bus_api_metrics`의 최종 문서는 다음 형태다. `bucketStart`는 UTC 1분 시작 시각이며 `expiresAt`은 보존 기간에 따른 삭제 시각이다.

```javascript
{
  _id: ObjectId("<MongoDB 생성 ID>"),
  bucketStart: ISODate("2026-10-05T00:00:00.000Z"),
  instanceId: "<프로세스별 ID>",
  provider: "seoul-bus",
  operation: "bus-arrival",
  requestCount: 10,
  errorCount: 1,
  expiresAt: ISODate("2027-11-09T00:00:00.000Z")
}
```

초기 분류는 `provider=seoul-bus`(서울 버스), `operation=bus-arrival`(버스 도착 정보)다. 이 분류에 속하는 버스 API 호출과 실패를 기록하며 요청이 없는 분에는 문서를 만들지 않는다. 요일은 문서에 저장하지 않고 조회 시 `Asia/Seoul` 기준으로 계산한다.

`_id_` 기본 인덱스 외에 다음 네 인덱스를 유지한다.

| 이름                               | 키                                                             | 옵션                    |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------- |
| `bucket_instance_dimension_unique` | `{ bucketStart: 1, instanceId: 1, provider: 1, operation: 1 }` | `unique: true`          |
| `metric_dimension_bucket_start`    | `{ provider: 1, operation: 1, bucketStart: 1 }`                | 없음                    |
| `metric_expiry_ttl`                | `{ expiresAt: 1 }`                                             | `expireAfterSeconds: 0` |
| `metric_bucket_start`              | `{ bucketStart: 1 }`                                           | 없음                    |

이전 메트릭 스키마는 운영에 배포된 적이 없으므로 운영 데이터 마이그레이션은 필요하지 않다. 개발용 로컬 DB에 이전 형태의 문서나 인덱스가 남아 있으면 해당 메트릭 컬렉션만 초기화한 뒤 애플리케이션을 다시 시작해 새 인덱스를 생성한다.

아래 명령은 **로컬 개발 DB의 메트릭 문서와 인덱스를 모두 삭제한다. 원격 호스트나 운영 DB에서는 실행하지 않는다.** 먼저 로컬 개발 애플리케이션을 종료하고 대상이 `127.0.0.1:27017/WhereMyBus`인지 확인한다. URI를 운영 환경변수로 대체하지 않는다. 다른 컬렉션은 삭제하지 않는다.

```bash
mongosh 'mongodb://127.0.0.1:27017/WhereMyBus' --eval 'db.getCollection("bus_api_metrics").drop()'
```

배포 후 승인된 운영 DB 연결에서 다음 읽기 전용 명령을 실행한다. `getIndexes()`의 키, 이름, unique 및 TTL 옵션을 위 표와 대조한다. 기본 `_id_`를 포함하면 총 다섯 개다.

```javascript
db.getSiblingDB('WhereMyBus').bus_api_metrics.getIndexes();
db.getSiblingDB('WhereMyBus').bus_api_metrics.findOne();
```

### 인증된 조회와 요일 필터

로그인된 브라우저의 개발자 도구에서 다음 same-origin 요청을 확인한다. `/api/dashboard/metric-dimensions`도 인증이 필요하며 로그인 전에는 401이다. 코드나 cookie 값을 명령에 복사하지 않는다.

```javascript
fetch('/api/dashboard/metric-dimensions', { credentials: 'same-origin' })
  .then((response) => response.json())
  .then(console.log);
fetch(
  '/api/dashboard/metrics?range=7d&providers=seoul-bus&operations=bus-arrival',
  { credentials: 'same-origin' },
)
  .then((response) => response.json())
  .then(console.log);
```

카탈로그 응답은 `providers: [{ key: "seoul-bus", label: "서울 버스", operations: [{ key: "bus-arrival", label: "버스 도착 정보" }] }]`를 포함한다. `providers`와 `operations`는 허용된 키의 CSV이며 생략하면 전체 분류를 선택한다. 빈 값, 미등록 키, 반복 query parameter는 400이다. 기간은 `24h`, `7d`, `30d`, `90d`만 허용한다.

metrics 응답의 `filters`에는 해석된 `providers`와 `operations` 배열이 있고, 각 `series` 항목은 `start`(`+09:00`), `weekday`(월요일 1부터 일요일 7), `requestCount`, `errorCount`를 포함한다. `timezone`은 `Asia/Seoul`이다. 오늘/이번 달 요청은 전체 API 합계이며 선택 기간 요청/오류/오류율과 마지막 수집 시각은 선택한 분류 기준이다.

`weekdays` query는 지원하지 않으며 요청하면 400이다. 요일 선택 및 전체/평일/주말 preset은 이미 받은 `series[].weekday`를 브라우저에서 필터링한다. 선택 기간 카드와 차트만 바뀌고 네트워크 요청은 발생하지 않는다. 제공기관/호출 API 선택은 필터 적용 버튼을 누를 때 한 번 조회한다. 초기화는 화면의 선택 상태를 전체로 되돌리며 분류 재조회는 필터 적용 시 수행한다.

배포 후 Network 탭에서 카탈로그와 모든 기간 조회가 200인지, 분류 query 및 응답이 일치하는지, 월/수 선택이나 preset 조작에 metrics 요청이 추가되지 않는지 확인한다. 데이터가 없는 요일 조합은 선택 기간 요청/오류가 0이고 차트에 빈 데이터 안내가 표시되어야 한다. 오늘/이번 달 카드는 전체 합계를 유지한다.

1. 버스 API 호출이 없는 분 확인
2. MongoDB에 해당 분 metric 문서가 생기지 않았는지 확인
3. 테스트 버스 API 요청 발생
4. 다음 flush 후 1분 bucket 문서 확인
5. Dashboard의 오늘·이번 달·선택 기간 합계 확인
6. 오류 요청 후 error count 확인
7. UTC 경계와 `Asia/Seoul` 일자 집계 확인

## 13. 캐시 정책

`index.html`은 새 배포를 바로 반영하도록 짧은 캐시 또는 no-cache를 권장한다. fingerprint 없는 JS/CSS도 초기에는 no-cache로 단순 운영한다.

```nginx
location = /dashboard/index.html {
    root /home/ubuntu/WhereMyBus-BE;
    add_header Cache-Control "no-cache";
}
```

별도 exact location을 사용할 경우 `/dashboard/`의 fallback과 충돌하지 않는지 `nginx -T`로 최종 설정을 확인한다.

## 14. 보안 체크리스트

- [ ] Dashboard는 HTTPS만 사용
- [ ] `HOST=127.0.0.1` 적용
- [ ] access code가 static 파일에 없음
- [ ] access code와 session secret이 다름
- [ ] backend 3000 포트 외부 차단
- [ ] `/api/dashboard/*` 전체에 인증 정책 적용
- [ ] login endpoint rate limit 적용
- [ ] Nginx가 client IP header를 덮어씀
- [ ] NestJS가 loopback proxy만 신뢰
- [ ] metric range allowlist 적용
- [ ] MongoDB query에 최대 기간·응답 크기 제한
- [ ] 로그에 code, cookie, token, service key 없음
- [ ] Nginx worker는 dashboard 파일 읽기 권한만 가짐

## 15. 장애 확인

### Dashboard가 404

- 실제 경로 `/home/ubuntu/WhereMyBus-BE/dashboard/index.html` 확인
- Nginx `root` 확인
- 다른 `location`이 요청을 먼저 처리하는지 `sudo nginx -T`로 확인

### Dashboard가 403

- `/home/ubuntu`, `WhereMyBus-BE`, `dashboard` traverse 권한 확인
- `www-data`의 파일 read 권한 확인
- AppArmor/SELinux 정책 확인

### API가 static HTML 반환

- frontend가 `/dashboard/api/...`를 호출하지 않는지 확인
- API base URL을 `/api/dashboard`로 수정
- `/api/dashboard/` proxy location 확인

### API가 404

- NestJS controller prefix가 `/api/dashboard`인지 확인
- `proxy_pass` trailing slash 제거
- NestJS가 127.0.0.1:3000에서 실행 중인지 확인

### 로그인 후에도 401

- HTTPS 사용 여부 확인
- browser cookie의 Path가 `/api/dashboard`인지 확인
- system clock 확인
- session secret이 worker마다 동일한지 확인
- Nginx가 `X-Forwarded-Proto https`를 전달하는지 확인

## 16. 롤백

1. `DASHBOARD_ENABLED=false`로 변경
2. PM2 reload
3. Nginx에서 `/dashboard`와 `/api/dashboard` location 제거
4. `sudo nginx -t`
5. 성공 시 Nginx reload
6. Dashboard static 파일은 별도 백업 후 제거
7. `DASHBOARD_ENABLED=false`는 Dashboard 인증·조회 endpoint만 비활성화하며 bus API metric 수집은 계속된다. 현재 metric 수집을 끄는 환경변수나 module 설정은 없다.
8. metric 수집도 중단해야 한다면 metric 도입 전 검증된 배포 revision으로 애플리케이션을 되돌린 뒤 기존 배포 절차로 build 및 PM2 reload를 수행한다. 배포 revision을 유지해야 한다면 별도 코드 변경으로 `BusInfoService`의 metric 의존성·constructor 주입·기록 호출과 `BusInfoModule`의 `BusApiMetricModule` import를 제거하고 관련 테스트 및 build 검증 후 배포한다.

MongoDB metric 문서는 보존 기간까지 유지한다. 즉시 삭제는 별도 승인 후 수행한다.
