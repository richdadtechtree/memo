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

// --- 스크롤 중 반복적으로 다시 뜨는 "앱에서 열기" 팝업을, 나타나는 즉시 계속 제거 ---
// 캡처 시점에 한 번만 지우면 그 이후 다시 나타난 팝업은 못 잡기 때문에,
// 페이지가 로드되기 전에 MutationObserver를 심어서 등장하는 족족 지운다.
async function installOverlayBlocker(page) {
  await page.addInitScript(() => {
    const OPEN_APP_KEYWORDS = [
      'Open Threads',
      'Continue with Instagram',
      'Thread on Threads',
      'Download Threads',
      '앱으로 열기',
      '앱에서 열기',
    ];

    function isOverlayNode(el) {
      const text = (el.textContent || '').slice(0, 300);
      if (!OPEN_APP_KEYWORDS.some((keyword) => text.includes(keyword))) return false;
      const position = window.getComputedStyle(el).position;
      return position === 'fixed' || position === 'sticky';
    }

    function sweep() {
      document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => el.remove());
      document.querySelectorAll('div, section, aside').forEach((el) => {
        if (isOverlayNode(el)) el.remove();
      });
    }

    const start = () => {
      sweep();
      new MutationObserver(sweep).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  });
}

// --- "앱에서 열기" 로그인 유도 팝업/오버레이 제거 (보조 수단: 즉시 한 번 더 확인) ---
async function dismissOverlays(page) {
  try {
    await page.keyboard.press('Escape');
  } catch {
    // 무시
  }

  await page
    .evaluate(() => {
      const OPEN_APP_KEYWORDS = [
        'Open Threads',
        'Continue with Instagram',
        'Thread on Threads',
        'Download Threads',
        '앱으로 열기',
        '앱에서 열기',
      ];

      document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => el.remove());

      document.querySelectorAll('div, section, aside').forEach((el) => {
        const text = (el.textContent || '').slice(0, 300);
        if (!OPEN_APP_KEYWORDS.some((keyword) => text.includes(keyword))) return;
        const position = window.getComputedStyle(el).position;
        if (position === 'fixed' || position === 'sticky') {
          el.remove();
        }
      });

      document.body.style.overflow = 'auto';
    })
    .catch(() => {});
}

// --- 댓글 등 지연 로딩되는 콘텐츠를 불러오기 위해 페이지 끝까지 스크롤 ---
async function autoScroll(page, { maxSteps = 15, delay = 500 } = {}) {
  try {
    let previousHeight = 0;
    for (let i = 0; i < maxSteps; i++) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break; // 더 로드될 콘텐츠가 없음
      previousHeight = currentHeight;
      await page.evaluate((h) => window.scrollTo(0, h), currentHeight);
      await page.waitForTimeout(delay);
    }
  } catch {
    // 스크롤 실패해도 지금까지 로드된 내용으로 캡처를 진행한다.
  }
}

// --- SPA의 클라이언트 사이드 리다이렉트로 실행 컨텍스트가 파괴되면 잠깐 대기 후 재시도 ---
async function retryOnNavigation(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!/Execution context was destroyed/.test(err.message || '')) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return await fn();
  }
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
    } catch (err) {
      if (/Execution context was destroyed/.test(err.message || '')) {
        throw err; // 상위에서 재시도하도록 전달
      }
      // 셀렉터가 없으면 다음으로 넘어간다.
    }
  }
  return null;
}

// --- 데스크톱 화면 기준으로 페이지를 캡처해 JPEG 버퍼로 반환 ---
async function captureScreenshot(rawUrl) {
  const url = assertSafeUrl(rawUrl).toString();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    await installOverlayBlocker(page);

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

    // 댓글 등 지연 로딩 콘텐츠를 불러온 뒤, 스크롤 중 다시 뜬 팝업을 한 번 더 제거
    await autoScroll(page);
    await dismissOverlays(page);
    await page.waitForTimeout(300);

    const pageTitle = (await retryOnNavigation(() => page.title())).trim();
    const caption = await retryOnNavigation(() => extractCaption(page));
    const buffer = await retryOnNavigation(() =>
      page.screenshot({ type: 'jpeg', quality: 85, fullPage: true })
    );

    return { buffer, pageTitle, caption };
  } finally {
    await browser.close();
  }
}

module.exports = { captureScreenshot };
