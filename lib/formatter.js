const { marked } = require('marked');

marked.setOptions({ breaks: true, gfm: true });

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- 1. 텍스트 유형 감지 ---
function detectType(text) {
  const chatMatches = text.match(/^(Human|Assistant):/gm) || [];
  if (chatMatches.length >= 2) {
    return 'claude-chat';
  }

  const markdownPatterns = [
    /^#{1,6}\s+.+/m, // 헤더
    /\*\*[^*]+\*\*/, // 볼드
    /```[\s\S]*?```/, // 코드블록
    /^[-*+]\s+.+/m, // 리스트
    /^\d+\.\s+.+/m, // 번호 리스트
    /^>\s+.+/m, // 인용
    /\[[^\]]+\]\([^)]+\)/, // 링크
  ];
  if (markdownPatterns.some((re) => re.test(text))) {
    return 'markdown';
  }

  return 'plain';
}

// --- 2. 클로드 대화 렌더링 (화자별 말풍선) ---
function renderClaudeChat(text) {
  const parts = text.split(/^(Human|Assistant):/gm);
  const turns = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'Human' || parts[i] === 'Assistant') {
      const content = (parts[i + 1] || '').trim();
      if (content) {
        turns.push({ speaker: parts[i], content });
      }
      i++;
    }
  }

  const html = turns
    .map(({ speaker, content }) => {
      const bodyHtml = marked.parse(content);
      const roleClass = speaker === 'Human' ? 'human' : 'assistant';
      return `<div class="chat-turn ${roleClass}"><div class="chat-speaker">${speaker}</div><div class="chat-body">${bodyHtml}</div></div>`;
    })
    .join('\n');

  return `<div class="chat-thread">${html}</div>`;
}

// --- 3. 일반 텍스트 렌더링 (단락 구분) ---
function renderPlain(text) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// --- 4. 제목 자동 생성 ---
function generateTitle(text, type) {
  if (type === 'markdown') {
    const headerMatch = text.match(/^#{1,6}\s+(.+)$/m);
    if (headerMatch) {
      return headerMatch[1].trim().slice(0, 50);
    }
  }

  const firstLine = text.split('\n').find((line) => line.trim().length > 0) || '';
  const cleaned = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(Human|Assistant):\s?/, '')
    .trim();

  return cleaned.slice(0, 30) || '제목 없음';
}

// --- 미리보기 텍스트 생성 ---
function generatePreview(text) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(Human|Assistant):\s?/gm, '')
    .replace(/[*_>`#]/g, '')
    .replace(/^-\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.slice(0, 100);
}

// --- 전체 포맷팅 진입점 ---
function formatText(text) {
  const type = detectType(text);
  let html;

  if (type === 'claude-chat') {
    html = renderClaudeChat(text);
  } else if (type === 'markdown') {
    html = marked.parse(text);
  } else {
    html = renderPlain(text);
  }

  return {
    type,
    html,
    title: generateTitle(text, type),
    preview: generatePreview(text),
  };
}

module.exports = { formatText };
