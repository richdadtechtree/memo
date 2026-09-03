const API = '/api';
const TOKEN_KEY = 'myreader_token';

let token = localStorage.getItem(TOKEN_KEY);
let currentReaderId = null;
let searchTimer = null;

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);

const logoutBtn = $('#logout-btn');

const viewLogin = $('#view-login');
const passwordInput = $('#password-input');
const loginBtn = $('#login-btn');
const loginError = $('#login-error');

const viewList = $('#view-list');
const textInput = $('#text-input');
const saveBtn = $('#save-btn');
const captureUrlInput = $('#capture-url-input');
const captureBtn = $('#capture-btn');
const captureStatus = $('#capture-status');
const searchInput = $('#search-input');
const itemList = $('#item-list');

const viewReader = $('#view-reader');
const backBtn = $('#back-btn');
const readerTitle = $('#reader-title');
const readerContent = $('#reader-content');
const readerDeleteBtn = $('#reader-delete-btn');
const fontDecreaseBtn = $('#font-decrease');
const fontIncreaseBtn = $('#font-increase');
const fontSizeLabel = $('#font-size-label');

// --- 화면 전환 ---
function showView(name) {
  viewLogin.hidden = name !== 'login';
  viewList.hidden = name !== 'list';
  viewReader.hidden = name !== 'reader';
  logoutBtn.hidden = name === 'login';
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

// --- 읽기 화면 글자 크기 조절 ---
const FONT_SIZE_KEY = 'myreader_font_size';
const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 22;
let fontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10) || 16;

function applyFontSize() {
  readerContent.style.setProperty('--reader-font-size', `${fontSize}px`);
  fontSizeLabel.textContent = `${fontSize}px`;
  fontDecreaseBtn.disabled = fontSize <= FONT_SIZE_MIN;
  fontIncreaseBtn.disabled = fontSize >= FONT_SIZE_MAX;
}

function changeFontSize(delta) {
  fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize + delta));
  localStorage.setItem(FONT_SIZE_KEY, fontSize);
  applyFontSize();
}

fontDecreaseBtn.addEventListener('click', () => changeFontSize(-1));
fontIncreaseBtn.addEventListener('click', () => changeFontSize(1));

// --- 코드 하이라이팅 다크모드 대응 ---
function syncHljsTheme() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.getElementById('hljs-light-theme').disabled = isDark;
  document.getElementById('hljs-dark-theme').disabled = !isDark;
}

syncHljsTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncHljsTheme);

function handleUnauthorized() {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  showView('login');
}

// --- 인증 ---
async function login() {
  const password = passwordInput.value;
  if (!password) return;

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      loginError.textContent = '비밀번호가 틀렸습니다.';
      loginError.hidden = false;
      return;
    }

    const data = await res.json();
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    passwordInput.value = '';
    loginError.hidden = true;
    showView('list');
    loadItems();
  } catch {
    loginError.textContent = '서버에 연결할 수 없습니다.';
    loginError.hidden = false;
  }
}

function logout() {
  handleUnauthorized();
}

// --- 목록 ---
function formatDate(iso) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

async function loadItems(search = '') {
  const url = search ? `${API}/items?search=${encodeURIComponent(search)}` : `${API}/items`;
  const res = await fetch(url, { headers: authHeaders() });

  if (res.status === 401) return handleUnauthorized();

  const items = await res.json();
  renderList(items);
}

function renderList(items) {
  itemList.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-msg';
    empty.textContent = '저장된 글이 없습니다.';
    itemList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.id = item.id;

    const main = document.createElement('div');
    main.className = 'item-main';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.type === 'screenshot' ? `🔗 ${item.title}` : item.title;

    const date = document.createElement('div');
    date.className = 'item-date';
    date.textContent = formatDate(item.createdAt);

    main.appendChild(title);
    main.appendChild(date);

    const delBtn = document.createElement('button');
    delBtn.className = 'item-delete';
    delBtn.textContent = '🗑️';
    delBtn.dataset.id = item.id;

    li.appendChild(main);
    li.appendChild(delBtn);
    itemList.appendChild(li);
  }
}

itemList.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.item-delete');
  if (delBtn) {
    deleteItem(delBtn.dataset.id);
    return;
  }

  const card = e.target.closest('.item-card');
  if (card) {
    openItem(card.dataset.id);
  }
});

async function deleteItem(id) {
  if (!confirm('삭제하시겠습니까?')) return;

  const res = await fetch(`${API}/items/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (res.status === 401) return handleUnauthorized();

  loadItems(searchInput.value);
}

// --- 저장 ---
async function saveText() {
  const input = textInput.value;
  if (!input.trim()) return;

  saveBtn.disabled = true;
  try {
    const res = await fetch(`${API}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ input }),
    });

    if (res.status === 401) return handleUnauthorized();

    textInput.value = '';
    await loadItems(searchInput.value);
  } finally {
    saveBtn.disabled = false;
  }
}

// --- URL 캡처 ---
async function captureUrl() {
  const url = captureUrlInput.value.trim();
  if (!url) return;

  captureBtn.disabled = true;
  captureUrlInput.disabled = true;
  captureStatus.hidden = false;
  captureStatus.classList.remove('error');
  captureStatus.textContent = '캡처 중... (몇 초 걸릴 수 있어요)';

  try {
    const res = await fetch(`${API}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url }),
    });

    if (res.status === 401) return handleUnauthorized();

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '캡처에 실패했습니다.');
    }

    captureUrlInput.value = '';
    captureStatus.hidden = true;
    await loadItems(searchInput.value);
  } catch (err) {
    captureStatus.textContent = err.message;
    captureStatus.classList.add('error');
  } finally {
    captureBtn.disabled = false;
    captureUrlInput.disabled = false;
  }
}

captureBtn.addEventListener('click', captureUrl);
captureUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') captureUrl();
});

// --- 읽기 뷰 ---
async function openItem(id) {
  const res = await fetch(`${API}/items/${id}`, { headers: authHeaders() });
  if (res.status === 401) return handleUnauthorized();
  if (!res.ok) return;

  const item = await res.json();
  currentReaderId = item.id;

  readerTitle.textContent = item.title;
  readerContent.innerHTML = DOMPurify.sanitize(item.formattedHtml);
  applyFontSize();

  addCopyButtons();
  if (window.hljs) {
    readerContent.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  }

  showView('reader');
}

function addCopyButtons() {
  readerContent.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '📋';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent : pre.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✅';
        setTimeout(() => (btn.textContent = '📋'), 1500);
      });
    });

    pre.appendChild(btn);
  });
}

backBtn.addEventListener('click', () => {
  currentReaderId = null;
  showView('list');
});

readerDeleteBtn.addEventListener('click', async () => {
  if (!currentReaderId) return;
  if (!confirm('삭제하시겠습니까?')) return;

  const res = await fetch(`${API}/items/${currentReaderId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });

  if (res.status === 401) return handleUnauthorized();

  currentReaderId = null;
  showView('list');
  loadItems(searchInput.value);
});

// --- 검색 ---
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadItems(searchInput.value), 300);
});

// --- 이벤트 바인딩 ---
loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
saveBtn.addEventListener('click', saveText);
logoutBtn.addEventListener('click', logout);

// --- 초기화 ---
async function init() {
  if (!token) {
    showView('login');
    return;
  }

  const res = await fetch(`${API}/items`, { headers: authHeaders() });
  if (res.status === 401) {
    handleUnauthorized();
    return;
  }

  showView('list');
  loadItems();
}

init();
