const { chromium } = require('playwright');

// --- 내부/사설 네트워크 접근 차단 (SSRF 방지) ---
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // fc00::/7 (unique local)
  /^\[?fe80:/i, // link-local
];

function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('올바른 URL이 아닙니다.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('http(s) 주소만 캡처할 수 있습니다.');
  }

  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname))) {
    throw new Error('내부/사설 네트워크 주소는 캡처할 수 없습니다.');
  }

  return parsed;
}

// --- "앱에서 열기" 로그인 유도 팝업/오버레이 제거 ---
async function dismissOverlays(page) {
  try {
    await page.keyboard.press('Escape');
  } catch {
    // 무시
  }

  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => el.remove());
    document.body.style.overflow = 'auto';
  }).catch(() => {});
}

// --- 게시물 본문 텍스트 추출 (og:description은 <title>과 달리 줄바꿈이 보존되는 경우가 많다) ---
async function extractCaption(page) {
  const selectors = ['meta[property="og:description"]', 'meta[name="description"]'];
  for (const selector of selectors) {
    try {
      const content = await page.$eval(selector, (el) => el.content);
      if (content && content.trim()) {
        return content.trim();
      }
    } catch {
      // 셀렉터가 없으면 다음으로 넘어간다.
    }
  }
  return null;
}

// --- 모바일 화면 기준으로 페이지를 캡처해 JPEG 버퍼로 반환 ---
async function captureScreenshot(rawUrl) {
  const url = assertSafeUrl(rawUrl).toString();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 480, height: 900 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    } catch {
      // 로딩이 느린 페이지도 일단 현재 상태로 캡처를 시도한다.
    }
    // 지연 렌더링(이미지/스크립트) 대기
    await page.waitForTimeout(1500);

    // "앱으로 열기" 등 로그인 유도 오버레이 제거 (스레드 등 SNS 사이트에서 흔함)
    await dismissOverlays(page);
    await page.waitForTimeout(300);

    const pageTitle = (await page.title()).trim();
    const caption = await extractCaption(page);
    const buffer = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: true });

    return { buffer, pageTitle, caption };
  } finally {
    await browser.close();
  }
}

module.exports = { captureScreenshot };
