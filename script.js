/* ==========================================================
   설정값 — 본인 값으로 이미 채워져 있습니다.
   ========================================================== */
const CLIENT_ID = '494695145169-h7me8b67fpee03k1hv6fp47qft9a8tca.apps.googleusercontent.com';
const FOLDER_ID = '1HeNJ82jOBew9jeIh54z5bhsosv-MjTC3';
const SCOPES = 'https://www.googleapis.com/auth/drive';
const LOG_FILENAME = 'logs.json';

/* ==========================================================
   상태
   ========================================================== */
let accessToken = null;
let tokenClient = null;
let fileId = null;      // logs.json 의 구글 드라이브 파일 ID
let logs = [];          // 메모리 상의 로그 배열
let editingId = null;   // 현재 수정 중인 항목 id (없으면 null)

/* ==========================================================
   DOM 참조
   ========================================================== */
const el = (id) => document.getElementById(id);

const gate = el('gate');
const app = el('app');
const authBtnGate = el('authBtnGate');
const statusBar = el('statusBar');

const entryDate = el('entryDate');
const entryTime = el('entryTime');
const entryBody = el('entryBody');
const saveBtn = el('saveBtn');
const cancelEditBtn = el('cancelEditBtn');
const editingIndicator = el('editingIndicator');

const searchInput = el('searchInput');
const refreshBtn = el('refreshBtn');

const composeView = el('composeView');
const listView = el('listView');
const viewToggleBtn = el('viewToggleBtn');
const logList = el('logList');
const emptyState = el('emptyState');

/* ==========================================================
   초기화
   ========================================================== */
window.addEventListener('load', () => {
  setDefaultDateTime();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        showStatus('로그인에 실패했어요: ' + resp.error, true);
        return;
      }
      accessToken = resp.access_token;
      onSignedIn();
    },
  });

  authBtnGate.addEventListener('click', requestSignIn);
  saveBtn.addEventListener('click', handleSave);
  cancelEditBtn.addEventListener('click', exitEditMode);
  refreshBtn.addEventListener('click', () => loadLogs(true));
  searchInput.addEventListener('input', renderList);
  viewToggleBtn.addEventListener('click', toggleView);
});

function requestSignIn() {
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

async function onSignedIn() {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  viewToggleBtn.classList.remove('hidden');
  await loadLogs();
}

function setDefaultDateTime() {
  const now = new Date();
  entryDate.value = now.toISOString().slice(0, 10);
  entryTime.value = now.toTimeString().slice(0, 5);
}

function toggleView() {
  const goingToList = composeView.classList.contains('hidden') === false;
  composeView.classList.toggle('hidden', goingToList);
  listView.classList.toggle('hidden', !goingToList);
}

/* ==========================================================
   상태 메시지
   ========================================================== */
let statusTimer = null;
function showStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.classList.remove('hidden');
  statusBar.classList.toggle('error', isError);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusBar.classList.add('hidden'), 2600);
}

/* ==========================================================
   구글 드라이브 연동
   ========================================================== */
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function authHeaders() {
  return { Authorization: `Bearer ${accessToken}` };
}

// logs.json 파일을 폴더 안에서 찾고, 없으면 새로 만든다.
async function ensureLogFile() {
  const q = encodeURIComponent(
    `name='${LOG_FILENAME}' and '${FOLDER_ID}' in parents and trashed=false`
  );
  const res = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id,name)`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('파일 검색 실패');
  const data = await res.json();

  if (data.files && data.files.length > 0) {
    fileId = data.files[0].id;
    return;
  }

  // 없으면 새로 생성
  const metadata = {
    name: LOG_FILENAME,
    parents: [FOLDER_ID],
    mimeType: 'application/json',
  };
  const boundary = 'log_app_boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `[]\r\n` +
    `--${boundary}--`;

  const createRes = await fetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!createRes.ok) throw new Error('파일 생성 실패');
  const created = await createRes.json();
  fileId = created.id;
}

async function loadLogs(manual = false) {
  try {
    if (manual) showStatus('불러오는 중...');
    await ensureLogFile();
    const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error('불러오기 실패');
    const text = await res.text();
    logs = text.trim() ? JSON.parse(text) : [];
    renderList();
    if (manual) showStatus('불러왔어요');
  } catch (err) {
    console.error(err);
    showStatus('불러오기 중 문제가 발생했어요', true);
  }
}

async function persistLogs() {
  const res = await fetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(logs, null, 2),
  });
  if (!res.ok) throw new Error('저장 실패');
}

/* ==========================================================
   작성 / 수정 / 삭제
   ========================================================== */
async function handleSave() {
  const body = entryBody.value.trim();
  if (!body) {
    showStatus('본문을 입력해주세요', true);
    return;
  }

  saveBtn.disabled = true;
  try {
    if (editingId) {
      const target = logs.find((l) => l.id === editingId);
      target.date = entryDate.value;
      target.time = entryTime.value;
      target.body = body;
    } else {
      logs.unshift({
        id: crypto.randomUUID(),
        date: entryDate.value,
        time: entryTime.value,
        body,
      });
    }
    await persistLogs();
    showStatus(editingId ? '수정했어요' : '기록했어요');
    exitEditMode();
    renderList();
  } catch (err) {
    console.error(err);
    showStatus('저장 중 문제가 발생했어요', true);
  } finally {
    saveBtn.disabled = false;
  }
}

function enterEditMode(id) {
  const target = logs.find((l) => l.id === id);
  if (!target) return;
  editingId = id;
  entryDate.value = target.date;
  entryTime.value = target.time;
  entryBody.value = target.body;
  editingIndicator.classList.remove('hidden');
  cancelEditBtn.classList.remove('hidden');
  saveBtn.textContent = '수정 완료';
  composeView.classList.remove('hidden');
  listView.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitEditMode() {
  editingId = null;
  entryBody.value = '';
  setDefaultDateTime();
  editingIndicator.classList.add('hidden');
  cancelEditBtn.classList.add('hidden');
  saveBtn.textContent = '등록';
}

async function deleteLog(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  const before = logs.length;
  logs = logs.filter((l) => l.id !== id);
  if (logs.length === before) return;
  try {
    await persistLogs();
    showStatus('삭제했어요');
    renderList();
  } catch (err) {
    console.error(err);
    showStatus('삭제 중 문제가 발생했어요', true);
  }
}

/* ==========================================================
   렌더링
   ========================================================== */
function renderList() {
  const query = searchInput.value.trim().toLowerCase();

  const sorted = [...logs].sort((a, b) =>
    `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)
  );

  const filtered = sorted.filter((l) => {
    return !query || l.body.toLowerCase().includes(query);
  });

  logList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((l) => {
    const item = document.createElement('div');
    item.className = 'log-entry';
    item.innerHTML = `
      <div class="log-entry-head">
        <span class="log-timestamp">${l.date} ${l.time}</span>
        <span class="log-entry-actions">
          <button class="icon-btn" data-action="edit" data-id="${l.id}" title="수정">✎</button>
          <button class="icon-btn danger" data-action="delete" data-id="${l.id}" title="삭제">🗑</button>
        </span>
      </div>
      <div class="log-body">${escapeHtml(l.body)}</div>
    `;
    logList.appendChild(item);
  });
}

logList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'edit') enterEditMode(id);
  if (btn.dataset.action === 'delete') deleteLog(id);
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
