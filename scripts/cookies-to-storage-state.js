#!/usr/bin/env node
// 브라우저 확장(Cookie-Editor 등)으로 내보낸 threads.com 쿠키 JSON을
// Playwright storageState 형식으로 변환한다.
//
// 사용법:
//   1. 평소 쓰는 브라우저에서 threads.com에 로그인된 상태로 접속
//   2. Cookie-Editor 확장으로 threads.com 쿠키를 내보내기 (Export → JSON 복사)
//   3. 그 내용을 auth/threads-cookies-raw.json 파일로 저장 (auth 폴더는 직접 생성)
//   4. node scripts/cookies-to-storage-state.js 실행
//   5. pm2 restart myreader 로 재시작하면 로그인 세션으로 캡처된다.
const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'auth', 'threads-cookies-raw.json');
const outputPath = path.join(__dirname, '..', 'auth', 'threads-storage-state.json');

if (!fs.existsSync(inputPath)) {
  console.error(`입력 파일이 없습니다: ${inputPath}`);
  console.error('브라우저에서 내보낸 threads.com 쿠키 JSON을 이 경로에 저장한 뒤 다시 실행해주세요.');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
if (!Array.isArray(raw)) {
  console.error('쿠키 JSON 형식이 배열이 아닙니다. 브라우저 확장의 "Export as JSON" 결과를 그대로 저장했는지 확인해주세요.');
  process.exit(1);
}

const SAME_SITE_MAP = {
  no_restriction: 'None',
  unspecified: 'Lax',
  lax: 'Lax',
  strict: 'Strict',
  none: 'None',
};

const cookies = raw
  .filter((c) => c && c.name && c.domain)
  .map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires:
      typeof c.expirationDate === 'number'
        ? Math.floor(c.expirationDate)
        : typeof c.expires === 'number' && c.expires > 0
        ? Math.floor(c.expires)
        : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: SAME_SITE_MAP[String(c.sameSite || '').toLowerCase()] || 'Lax',
  }));

if (cookies.length === 0) {
  console.error('변환된 쿠키가 0개입니다. 파일 내용을 확인해주세요.');
  process.exit(1);
}

fs.writeFileSync(outputPath, JSON.stringify({ cookies, origins: [] }, null, 2));
console.log(`저장 완료: ${outputPath} (쿠키 ${cookies.length}개)`);
