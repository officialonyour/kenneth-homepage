이휘근 SIGNAL 홈페이지 설치 안내
================================

[구성]
- 모바일 전용 프로듀서 홈페이지
- 음원 이력 및 플랫폼별 링크
- SoundCloud / BeatStars / Spotify / Apple Music / YouTube / Instagram
- 오뉴월 홈페이지 연동
- 최신 YouTube 뮤직비디오 표시
- /admin/ 관리자 메뉴
- D1 데이터 저장
- R2 앨범 자켓 업로드
- 앨범 링크의 Open Graph 이미지 자동 가져오기 + 직접 업로드 병행

1. GitHub 폴더에 파일 넣기
--------------------------
이 ZIP의 파일과 폴더를 kenneth-homepage 저장소 최상단에 넣습니다.

필수 구조:
index.html
style.css
script.js
admin/
assets/
functions/
schema.sql
_routes.json

GitHub Desktop:
Commit to main → Push origin

2. Cloudflare D1 만들기
----------------------
Cloudflare → Storage & Databases → D1 → Create database
데이터베이스 이름 추천: hweegeun-site-db

생성 후 D1의 Console에서 schema.sql 전체 내용을 실행합니다.
또는 Wrangler 사용 시:
npx wrangler d1 execute hweegeun-site-db --remote --file=./schema.sql

3. Cloudflare R2 만들기
----------------------
Cloudflare → Storage & Databases → R2 → Create bucket
버킷 이름 추천: hweegeun-site-media

R2 버킷을 공개로 열 필요는 없습니다.
홈페이지의 /api/media/... 함수가 R2 파일을 읽어 제공합니다.

4. Pages에 바인딩 연결
----------------------
Workers & Pages → kenneth-homepage → Settings → Bindings

D1 database binding 추가
- Variable name: DB
- Database: hweegeun-site-db

R2 bucket binding 추가
- Variable name: MEDIA
- Bucket: hweegeun-site-media

Production과 Preview에 모두 설정하는 것을 권장합니다.

5. 관리자 비밀번호와 세션 비밀값 설정
------------------------------------
Workers & Pages → kenneth-homepage → Settings → Variables and secrets

Secret 추가:
- ADMIN_PASSWORD = 사용자가 지정한 관리자 비밀번호
- SESSION_SECRET = 임의의 길고 복잡한 문자열 32자 이상

예시 SESSION_SECRET:
직접 새로 생성한 40자 이상의 무작위 문자열을 사용하세요.
ADMIN_PASSWORD를 index.html이나 admin.js에 직접 적지 마세요.

6. Cloudflare Pages 빌드 설정
----------------------------
Framework preset: None
Build command: 비워두기
Build output directory: .
Root directory: 비워두기

7. 재배포
---------
GitHub에 Push하면 자동 배포됩니다.
바인딩을 추가한 뒤에는 Deployments에서 Retry deployment를 실행해도 됩니다.

8. 관리자 접속
-------------
https://kenneth-homepage.pages.dev/admin/

비밀번호: Cloudflare의 ADMIN_PASSWORD Secret에 설정한 값

관리자 메뉴에서 가능한 작업:
- 이름, 소개, 색상 수정
- Spotify / Apple Music / YouTube / Instagram / Melon 링크
- SoundCloud / BeatStars 링크
- 오뉴월 홈페이지 링크
- 음원 추가 / 수정 / 삭제
- 음원 대표 링크에서 앨범 제목과 자켓 자동 가져오기
- 앨범 자켓을 R2에 직접 업로드
- 최신 대표 음원 설정
- YouTube 뮤직비디오 추가 / 수정 / 삭제

9. 앨범 링크 자동 자켓 주의사항
-------------------------------
사이트가 og:image 메타정보를 제공하면 자동으로 가져옵니다.
일부 음원 사이트는 봇 접근을 차단하거나 자켓 주소를 제공하지 않을 수 있습니다.
그때는 관리자 메뉴에서 자켓을 직접 업로드하면 됩니다.

10. 초기 상태
-------------
D1 연결 전에도 기본 음원 4개는 정적 데이터로 표시됩니다.
D1과 schema.sql 설정이 끝나면 관리자 메뉴에서 저장한 데이터가 우선 적용됩니다.
