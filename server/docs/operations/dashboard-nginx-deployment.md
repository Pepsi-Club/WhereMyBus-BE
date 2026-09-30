# 자체 Dashboard Nginx 배포 가이드

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

| URL | 처리 주체 | 대상 |
| --- | --- | --- |
| `/dashboard` | Nginx | `/dashboard/`로 redirect |
| `/dashboard/` | Nginx | static `index.html` |
| `/dashboard/*` | Nginx | static asset |
| `/api/dashboard/*` | NestJS | `127.0.0.1:3000` proxy |

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
DASHBOARD_ENABLED=true
DASHBOARD_ACCESS_CODE=<충분히 긴 개발자 코드>
DASHBOARD_SESSION_SECRET=<별도 무작위 서명 키>
DASHBOARD_SESSION_TTL_SECONDS=28800
DASHBOARD_LOGIN_MAX_ATTEMPTS=5
DASHBOARD_LOGIN_WINDOW_SECONDS=900
BUS_API_METRIC_RETENTION_DAYS=400
```

요건:

- access code와 session secret은 서로 다른 값
- `.env`와 PM2 환경설정 파일 권한 제한
- Git 커밋 금지
- shell history에 실제 secret 노출 주의
- 변경 후 PM2 reload 필요

## 7. 적용 전 검증

```bash
sudo nginx -t
```

성공한 경우에만 reload한다.

```bash
sudo systemctl reload nginx
```

Nginx reload는 기존 연결을 유지하면서 설정을 교체한다. `nginx -t` 실패 시 reload하지 않는다.

## 8. Static 응답 검증

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

## 9. API proxy 검증

```bash
curl -i https://<DOMAIN>/api/dashboard/session
curl -i 'https://<DOMAIN>/api/dashboard/metrics?range=24h'
```

로그인 전 기대 결과: `401 Unauthorized`.

Nginx access log와 NestJS HTTP log에서 경로가 `/api/dashboard/...`로 유지되는지 확인한다.

Backend에 `/session`이나 `/metrics`만 전달되면 `proxy_pass` trailing slash 설정을 확인한다.

## 10. 인증 검증

실제 코드를 command history에 남기지 않도록 브라우저에서 우선 검증한다.

확인 항목:

- 잘못된 코드 로그인 실패
- 올바른 코드 로그인 성공
- browser storage에 코드 없음
- cookie에 `HttpOnly`, `Secure`, `SameSite=Strict`
- 새 browser session에서 인증 요구
- logout 후 metric API가 401 반환
- 실패 5회 초과 시 429 반환

## 11. Dashboard 데이터 검증

1. 버스 API 호출이 없는 분 확인
2. MongoDB에 해당 분 metric 문서가 생기지 않았는지 확인
3. 테스트 버스 API 요청 발생
4. 다음 flush 후 1분 bucket 문서 확인
5. Dashboard의 오늘·이번 달·선택 기간 합계 확인
6. 오류 요청 후 error count 확인
7. UTC 경계와 `Asia/Seoul` 일자 집계 확인

## 12. 캐시 정책

`index.html`은 새 배포를 바로 반영하도록 짧은 캐시 또는 no-cache를 권장한다. fingerprint 없는 JS/CSS도 초기에는 no-cache로 단순 운영한다.

```nginx
location = /dashboard/index.html {
    root /home/ubuntu/WhereMyBus-BE;
    add_header Cache-Control "no-cache";
}
```

별도 exact location을 사용할 경우 `/dashboard/`의 fallback과 충돌하지 않는지 `nginx -T`로 최종 설정을 확인한다.

## 13. 보안 체크리스트

- [ ] Dashboard는 HTTPS만 사용
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

## 14. 장애 확인

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

## 15. 롤백

1. `DASHBOARD_ENABLED=false`로 변경
2. PM2 reload
3. Nginx에서 `/dashboard`와 `/api/dashboard` location 제거
4. `sudo nginx -t`
5. 성공 시 Nginx reload
6. Dashboard static 파일은 별도 백업 후 제거
7. metric 수집도 중단하려면 metric module 설정을 비활성화

MongoDB metric 문서는 보존 기간까지 유지한다. 즉시 삭제는 별도 승인 후 수행한다.
