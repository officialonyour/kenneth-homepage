# 케네쓰음원정산관리 — Cloudflare Pages 설정

이 패치는 기존 `kenneth-homepage`의 루트 `index.html`, `style.css`, `script.js`를 수정하지 않습니다.
추가되는 화면은 `/settlement/`, API는 `/api/settlement/*` 입니다.

## 1. D1 생성
Cloudflare Dashboard → Workers & Pages → D1 → Create database

권장 DB 이름: `kenneth-music-settlement`

생성 후 SQL Console에서 `migrations/001_kenneth_settlement.sql` 전체를 실행합니다.

또는 Wrangler 로그인 상태라면:

```powershell
npx wrangler d1 execute kenneth-music-settlement --remote --file .\migrations\001_kenneth_settlement.sql
```

## 2. kenneth-homepage Pages 프로젝트에 D1 연결
Cloudflare Dashboard → Workers & Pages → `kenneth-homepage` → Settings → Bindings → Add → D1 database

- Variable name: `SETTLEMENT_DB`
- D1 database: `kenneth-music-settlement`

Production과 Preview에 필요하면 각각 연결합니다.

## 3. 로그인 Secret 등록
Cloudflare Dashboard → `kenneth-homepage` → Settings → Variables and Secrets → Add

다음 두 값을 **Encrypt/Secret** 으로 등록합니다.

- `ADMIN_PASSWORD`: 정산관리 로그인 비밀번호
- `SESSION_SECRET`: 충분히 긴 무작위 문자열(최소 32자 권장)

두 값은 Git에 커밋하지 않습니다.

## 4. 재배포
Bindings/Secrets 변경 뒤 Pages 프로젝트를 Redeploy 합니다.

## 5. 접속
`https://kenneth-homepage.pages.dev/settlement/`

로그인 후 `정산서 가져오기`에서 기존 `음원_정산_통합관리_시스템_3개유통사.xlsx`를 업로드합니다.

### 추정 카운트
- 실제 `카운트` > 0: 실제값
- `보정카운트` > 0: 추정값으로 우선 사용
- 둘 다 없는 행: 같은 음원/유통사/플랫폼 → 같은 음원/유통사 → 같은 유통사/플랫폼 → 같은 유통사 → 전체 순서로 1카운트당 수익 중앙값을 사용해 추정
- 추정값은 `actual_count`와 섞지 않고 `estimated_count`에 별도 저장

## 보안
정산 데이터는 정적 HTML/JS에 포함하지 않습니다. D1 API는 로그인 세션 쿠키가 없으면 401을 반환합니다.
