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
let tokenExpiresAt = null; // 액세스 토큰 만료 시각 (ms, epoch)
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
const entryMemo = el('entryMemo');
const saveBtn = el('saveBtn');
const cancelEditBtn = el('cancelEditBtn');
const editingIndicator = el('editingIndicator');

const searchInput = el('searchInput');
const refreshBtn = el('refreshBtn');
const menuToggleBtn = el('menuToggleBtn');
const settingsMenu = el('settingsMenu');
const themeToggleBtn = el('themeToggleBtn');

const composeView = el('composeView');
const listView = el('listView');
const viewPrevBtn = el('viewPrevBtn');
const viewNextBtn = el('viewNextBtn');
const logList = el('logList');
const emptyState = el('emptyState');

const calendarView = el('calendarView');
const calPrevBtn = el('calPrevBtn');
const calNextBtn = el('calNextBtn');
const calMonthLabel = el('calMonthLabel');
const calendarGrid = el('calendarGrid');
const calendarLogList = el('calendarLogList');
const calendarEmptyState = el('calendarEmptyState');

let calState = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() }; // month: 0~11
})();

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
        resetGateButton();
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in || 3600) * 1000);
      localStorage.setItem('log_signed_in', 'true');
      onSignedIn();
    },
  });

  authBtnGate.addEventListener('click', requestSignIn);
  saveBtn.addEventListener('click', handleSave);
  cancelEditBtn.addEventListener('click', exitEditMode);
  refreshBtn.addEventListener('click', () => {
    loadLogs(true);
    closeSettingsMenu();
  });
  searchInput.addEventListener('input', renderList);
  viewPrevBtn.addEventListener('click', goPrevView);
  viewNextBtn.addEventListener('click', goNextView);
  calPrevBtn.addEventListener('click', () => changeMonth(-1));
  calNextBtn.addEventListener('click', () => changeMonth(1));
  menuToggleBtn.addEventListener('click', toggleSettingsMenu);
  themeToggleBtn.addEventListener('click', toggleTheme);
  applySavedTheme();

  // 이전에 로그인한 적 있으면 조용히 재인증 시도
  attemptAutoSignIn();

  // 앱을 다시 포그라운드로 가져올 때 토큰 유효성 확인
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !app.classList.contains('hidden')) {
      ensureValidToken();
    }
  });
});

function requestSignIn() {
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

async function onSignedIn() {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  viewPrevBtn.classList.remove('hidden');
  viewNextBtn.classList.remove('hidden');
  resetGateButton();
  await loadLogs();
}

function setDefaultDateTime() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  entryDate.value = `${yyyy}-${mm}-${dd}`;
  entryTime.value = now.toTimeString().slice(0, 5);
}

/* ==========================================================
   조용한 재인증 (토큰 만료 대응)
   ========================================================== */
function isTokenValid() {
  // 만료 60초 전부터는 곧 끊길 걸로 보고 미리 갱신 대상으로 취급
  return !!accessToken && !!tokenExpiresAt && Date.now() < tokenExpiresAt - 60000;
}

function silentSignIn() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error('토큰 클라이언트가 초기화되지 않았어요'));
      return;
    }
    const originalCallback = tokenClient.callback;
    tokenClient.callback = (resp) => {
      tokenClient.callback = originalCallback;
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in || 3600) * 1000);
      localStorage.setItem('log_signed_in', 'true');
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function ensureValidToken() {
  if (isTokenValid()) return true;
  try {
    await silentSignIn();
    return true;
  } catch (err) {
    console.error('조용한 재인증 실패:', err);
    return false;
  }
}

function attemptAutoSignIn() {
  if (localStorage.getItem('log_signed_in') !== 'true') return;
  authBtnGate.disabled = true;
  authBtnGate.textContent = '로그인 확인 중...';
  silentSignIn()
    .then(() => {
      onSignedIn();
    })
    .catch(() => {
      resetGateButton();
    });
}

function resetGateButton() {
  authBtnGate.disabled = false;
  authBtnGate.textContent = '구글 계정 연결';
}

function signOutToGate() {
  accessToken = null;
  tokenExpiresAt = null;
  localStorage.removeItem('log_signed_in');
  app.classList.add('hidden');
  viewPrevBtn.classList.add('hidden');
  viewNextBtn.classList.add('hidden');
  gate.classList.remove('hidden');
  resetGateButton();
}

/* ==========================================================
   화면 전환 (작성 ↔ 목록 ↔ 캘린더, 화면별 좌/우 버튼 고정)
   composeView: 좌-캘린더 / 우-리스트
   listView:    좌-작성창 / 우-캘린더
   calendarView:좌-리스트 / 우-작성창
   ========================================================== */
const PREV_VIEW = { compose: 'calendar', list: 'compose', calendar: 'list' };
const NEXT_VIEW = { compose: 'list', list: 'calendar', calendar: 'compose' };
const VIEW_EL = { compose: composeView, list: listView, calendar: calendarView };

function getCurrentViewName() {
  if (!composeView.classList.contains('hidden')) return 'compose';
  if (!listView.classList.contains('hidden')) return 'list';
  return 'calendar';
}

function switchToView(name) {
  composeView.classList.add('hidden');
  listView.classList.add('hidden');
  calendarView.classList.add('hidden');
  VIEW_EL[name].classList.remove('hidden');
  if (name === 'calendar') renderCalendar();
}

function goPrevView() {
  switchToView(PREV_VIEW[getCurrentViewName()]);
}

function goNextView() {
  switchToView(NEXT_VIEW[getCurrentViewName()]);
}

function changeMonth(delta) {
  calState.month += delta;
  if (calState.month < 0) {
    calState.month = 11;
    calState.year -= 1;
  } else if (calState.month > 11) {
    calState.month = 0;
    calState.year += 1;
  }
  renderCalendar();
}

/* ==========================================================
   설정 메뉴 (검색 구역 ↔ 리스트 구역 사이 슬라이드다운)
   ========================================================== */
function toggleSettingsMenu() {
  const open = settingsMenu.classList.toggle('open');
  menuToggleBtn.setAttribute('aria-expanded', String(open));
}

function closeSettingsMenu() {
  settingsMenu.classList.remove('open');
  menuToggleBtn.setAttribute('aria-expanded', 'false');
}

/* ==========================================================
   다크 / 화이트 모드
   ========================================================== */
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('log_theme', isLight ? 'light' : 'dark');
}

function applySavedTheme() {
  const saved = localStorage.getItem('log_theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
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
    const ok = await ensureValidToken();
    if (!ok) {
      showStatus('로그인이 만료됐어요. 다시 연결해주세요', true);
      signOutToGate();
      return;
    }
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
  const memo = entryMemo.value.trim();
  if (!body) {
    showStatus('본문을 입력해주세요', true);
    return;
  }

  saveBtn.disabled = true;
  try {
    const ok = await ensureValidToken();
    if (!ok) {
      showStatus('로그인이 만료됐어요. 다시 연결해주세요', true);
      signOutToGate();
      return;
    }

    if (editingId) {
      const target = logs.find((l) => l.id === editingId);
      target.date = entryDate.value;
      target.time = entryTime.value;
      target.body = body;
      target.memo = memo;
    } else {
      logs.unshift({
        id: crypto.randomUUID(),
        date: entryDate.value,
        time: entryTime.value,
        body,
        memo,
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
  entryMemo.value = target.memo || '';
  editingIndicator.classList.remove('hidden');
  cancelEditBtn.classList.remove('hidden');
  saveBtn.textContent = '수정 완료';
  switchToView('compose');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitEditMode() {
  editingId = null;
  entryBody.value = '';
  entryMemo.value = '';
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
    const ok = await ensureValidToken();
    if (!ok) {
      showStatus('로그인이 만료됐어요. 다시 연결해주세요', true);
      signOutToGate();
      return;
    }
    await persistLogs();
    showStatus('삭제했어요');
    renderList();
  } catch (err) {
    console.error(err);
    showStatus('삭제 중 문제가 발생했어요', true);
  }
}

/* ==========================================================
   텍스트 처리 (이스케이프 + 링크 인식)
   ========================================================== */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 텍스트 안의 http://, https://, www. 로 시작하는 링크를 모두 찾아
// 각각 클릭 가능한 <a> 태그로 바꾼다. 나머지 텍스트는 이스케이프 처리된다.
function linkifyHtml(str) {
  if (!str) return '';
  const urlRegex = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(str)) !== null) {
    result += escapeHtml(str.slice(lastIndex, match.index));

    let url = match[0];
    // 문장 부호가 링크 끝에 딸려오는 경우 분리 (예: "...주소.txt)." → 마지막 ). 제외)
    let trailing = '';
    const trailingMatch = url.match(/[),.!?;:'"]+$/);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      url = url.slice(0, -trailing.length);
    }

    if (url) {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      result += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      result += escapeHtml(trailing);
    } else {
      result += escapeHtml(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(str.slice(lastIndex));
  return result;
}

/* ==========================================================
   메모 아코디언 (리스트 뷰 / 캘린더 뷰 공용)
   같은 리스트 안에서는 한 번에 하나만 열린다.
   ========================================================== */
function toggleMemoAccordion(containerEl, memoElId) {
  const memoEl = document.getElementById(memoElId);
  if (!memoEl) return;
  const isOpen = memoEl.classList.contains('open');

  containerEl.querySelectorAll('.log-memo.open').forEach((openEl) => {
    openEl.classList.remove('open');
  });
  containerEl.querySelectorAll('.icon-btn.memo-active').forEach((btn) => {
    btn.classList.remove('memo-active');
  });

  if (!isOpen) {
    memoEl.classList.add('open');
    const btn = containerEl.querySelector(`button[data-memo-target="${memoElId}"]`);
    if (btn) btn.classList.add('memo-active');
  }
}

/* ==========================================================
   렌더링
   ========================================================== */
function renderCalendar() {
  const { year, month } = calState;
  calMonthLabel.textContent = `${year}. ${String(month + 1).padStart(2, '0')}`;

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0(일) ~ 6(토)
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  const datesWithLogs = new Set(
    logs.filter((l) => l.date.startsWith(monthPrefix)).map((l) => l.date)
  );
  const todayStr = new Date().toISOString().slice(0, 10);

  calendarGrid.innerHTML = '';

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-cell empty';
    calendarGrid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'calendar-cell' + (dateStr === todayStr ? ' today' : '');
    cell.innerHTML = `
      <span>${d}</span>
      ${datesWithLogs.has(dateStr) ? '<span class="calendar-dot"></span>' : ''}
    `;
    calendarGrid.appendChild(cell);
  }

  renderCalendarLogList(monthPrefix);
}

function renderCalendarLogList(monthPrefix) {
  const monthLogs = logs
    .filter((l) => l.date.startsWith(monthPrefix))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  calendarLogList.innerHTML = '';
  calendarEmptyState.classList.toggle('hidden', monthLogs.length > 0);

  monthLogs.forEach((l) => {
    const day = parseInt(l.date.slice(-2), 10);
    const hasMemo = !!(l.memo && l.memo.trim());
    const memoElId = `cal-memo-${l.id}`;

    const item = document.createElement('div');
    item.className = 'calendar-log-item';
    item.innerHTML = `
      <span class="calendar-log-day">${day}.</span>
      <div class="calendar-log-content">
        <div class="calendar-log-row">
          <span class="calendar-log-text">${escapeHtml(l.body)}</span>
          ${hasMemo ? `
            <button class="icon-btn" data-action="memo" data-memo-target="${memoElId}" title="메모 보기">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v12H8l-4 4V4z"></path>
              </svg>
            </button>
          ` : ''}
        </div>
        ${hasMemo ? `
          <div class="log-memo" id="${memoElId}">
            <div class="log-memo-inner">${linkifyHtml(l.memo)}</div>
          </div>
        ` : ''}
      </div>
    `;
    calendarLogList.appendChild(item);
  });
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();

  const sorted = [...logs].sort((a, b) =>
    `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)
  );

  const filtered = sorted.filter((l) => {
    if (!query) return true;
    const inBody = l.body.toLowerCase().includes(query);
    const inMemo = (l.memo || '').toLowerCase().includes(query);
    return inBody || inMemo;
  });

  logList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((l) => {
    const hasMemo = !!(l.memo && l.memo.trim());
    const memoElId = `memo-${l.id}`;

    const item = document.createElement('div');
    item.className = 'log-entry';
    item.innerHTML = `
      <div class="log-entry-head">
        <span class="log-timestamp">${l.date} ${l.time}</span>
        <span class="log-entry-actions">
          ${hasMemo ? `
            <button class="icon-btn" data-action="memo" data-memo-target="${memoElId}" title="메모 보기">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16v12H8l-4 4V4z"></path>
              </svg>
            </button>
          ` : ''}
          <button class="icon-btn" data-action="edit" data-id="${l.id}" title="수정">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
          </button>
          <button class="icon-btn danger" data-action="delete" data-id="${l.id}" title="삭제">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"></path>
            </svg>
          </button>
        </span>
      </div>
      <div class="log-body">${escapeHtml(l.body)}</div>
      ${hasMemo ? `
        <div class="log-memo" id="${memoElId}">
          <div class="log-memo-inner">${linkifyHtml(l.memo)}</div>
        </div>
      ` : ''}
    `;
    logList.appendChild(item);
  });
}

logList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'edit') enterEditMode(btn.dataset.id);
  if (action === 'delete') deleteLog(btn.dataset.id);
  if (action === 'memo') toggleMemoAccordion(logList, btn.dataset.memoTarget);
});

calendarLogList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'memo') {
    toggleMemoAccordion(calendarLogList, btn.dataset.memoTarget);
  }
});
