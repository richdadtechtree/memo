require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { readItems, writeItems } = require('./lib/store');
const { formatText } = require('./lib/formatter');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD;

if (!PASSWORD) {
  console.error('PASSWORD가 .env에 설정되어 있지 않습니다.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 세션 토큰 (메모리 저장, 서버 재시작 시 초기화) ---
const validTokens = new Set();

function getTokenFromRequest(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  next();
}

// --- 30일 지난 항목 자동 삭제 (서버 시작 시) ---
function cleanupOldItems() {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const items = readItems();
  const filtered = items.filter(
    (item) => now - new Date(item.createdAt).getTime() < THIRTY_DAYS_MS
  );
  if (filtered.length !== items.length) {
    writeItems(filtered);
    console.log(`오래된 항목 ${items.length - filtered.length}개 삭제됨`);
  }
}

// --- API: 비밀번호 인증 ---
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password !== PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 틀렸습니다.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  validTokens.add(token);
  res.json({ token });
});

// --- 이하 API는 인증 필요 ---
app.use('/api', requireAuth);

// --- API: 텍스트 저장 ---
app.post('/api/submit', (req, res) => {
  const { input, title } = req.body || {};
  if (!input || !input.trim()) {
    return res.status(400).json({ error: 'input이 비어있습니다.' });
  }

  const formatted = formatText(input);
  const items = readItems();
  const newItem = {
    id: crypto.randomUUID(),
    title: title && title.trim() ? title.trim() : formatted.title,
    content: input,
    formattedHtml: formatted.html,
    type: formatted.type,
    preview: formatted.preview,
    createdAt: new Date().toISOString(),
  };

  items.unshift(newItem);
  writeItems(items);

  res.json({
    id: newItem.id,
    title: newItem.title,
    preview: newItem.preview,
    createdAt: newItem.createdAt,
  });
});

// --- API: 목록 조회 ---
app.get('/api/items', (req, res) => {
  const { search } = req.query;
  let items = readItems();

  if (search && search.trim()) {
    const keyword = search.trim().toLowerCase();
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(keyword) ||
        item.content.toLowerCase().includes(keyword)
    );
  }

  const list = items
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ id, title, preview, createdAt }) => ({ id, title, preview, createdAt }));

  res.json(list);
});

// --- API: 개별 조회 ---
app.get('/api/items/:id', (req, res) => {
  const items = readItems();
  const item = items.find((i) => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
  }
  res.json(item);
});

// --- API: 삭제 ---
app.delete('/api/items/:id', (req, res) => {
  const items = readItems();
  const filtered = items.filter((i) => i.id !== req.params.id);
  if (filtered.length === items.length) {
    return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
  }
  writeItems(filtered);
  res.json({ ok: true });
});

cleanupOldItems();

app.listen(PORT, () => {
  console.log(`MyReader 서버 실행 중: http://localhost:${PORT}`);
});
