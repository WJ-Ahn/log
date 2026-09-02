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
let selectedCalDate = null; // 캘린더뷰에서 작성창이 열려있는 날짜 (없으면 null)
let calEditingId = null;    // 작성창이 수정 모드일 때 대상 로그의 id (생성 모드면 null)
let calEntryTimeBeforeEdit = ''; // calEntryTime 포커스 시 비우기 전의 원래 값
let logsLoaded = false;     // 드라이브에서 로그 데이터를 아직 못 받아왔으면 false

let activeListCardId = null;   // 리스트뷰에서 현재 아이콘이 노출된 카드의 id
let listCardHideTimer = null;  // 그 카드의 2초 자동 숨김 타이머

/* ==========================================================
   DOM 참조
   ========================================================== */
const el = (id) => document.getElementById(id);

const gate = el('gate');
const app = el('app');
const authBtnGate = el('authBtnGate');
const statusBar = el('statusBar');

const searchInput = el('searchInput');
const refreshBtn = el('refreshBtn');
const menuToggleBtn = el('menuToggleBtn');
const settingsMenu = el('settingsMenu');
const themeToggleBtn = el('themeToggleBtn');

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

const calComposer = el('calComposer');
const calComposerDate = el('calComposerDate');
const calEntryTime = el('calEntryTime');
const calEntryBody = el('calEntryBody');
const calEntryMemo = el('calEntryMemo');
const calSaveBtn = el('calSaveBtn');
const calDeleteBtn = el('calDeleteBtn');

let calState = (() => {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() }; // month: 0~11
})();

/* ==========================================================
   초기화
   ========================================================== */
window.addEventListener('load', () => {
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
  refreshBtn.addEventListener('click', () => {
    loadLogs(true);
    closeSettingsMenu();
  });
  searchInput.addEventListener('input', renderList);
  viewPrevBtn.addEventListener('click', goPrevView);
  viewNextBtn.addEventListener('click', goNextView);
  calPrevBtn.addEventListener('click', () => changeMonth(-1));
  calNextBtn.addEventListener('click', () => changeMonth(1));
  calSaveBtn.addEventListener('click', handleCalSave);
  calDeleteBtn.addEventListener('click', handleCalDelete);
  calEntryTime.addEventListener('focus', handleCalTimeFocus);
  calEntryTime.addEventListener('blur', handleCalTimeBlur);
  menuToggleBtn.addEventListener('click', toggleSettingsMenu);
  themeToggleBtn.addEventListener('click', toggleTheme);
  applySavedTheme();
});

function requestSignIn() {
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

async function onSignedIn() {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
  viewPrevBtn.classList.remove('hidden');
  viewNextBtn.classList.remove('hidden');
  renderCalendar(); // 로그 데이터 도착 전에도 날짜 숫자는 바로 보이도록
  await loadLogs();
}

/* ==========================================================
   화면 전환 (리스트 ↔ 캘린더, 화면별 좌/우 버튼 고정)
   ========================================================== */
const VIEW_EL = { list: listView, calendar: calendarView };

function getCurrentViewName() {
  return listView.classList.contains('hidden') ? 'calendar' : 'list';
}

function switchToView(name) {
  if (name !== 'calendar') closeCalComposer();
  if (name !== 'list') closeListCardActions();
  listView.classList.add('hidden');
  calendarView.classList.add('hidden');
  VIEW_EL[name].classList.remove('hidden');
  if (name === 'calendar') renderCalendar();
}

function toggleView() {
  switchToView(getCurrentViewName() === 'list' ? 'calendar' : 'list');
}

function goPrevView() {
  toggleView();
}

function goNextView() {
  toggleView();
}

function changeMonth(delta) {
  closeCalComposer();
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
   상태 메시지 (화면 정중앙에 표시)
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
    logsLoaded = true;
    renderList();
    renderCalendar();
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
   삭제 공용 로직 (리스트뷰 / 캘린더뷰 공용)
   ========================================================== */
// 확인창 없이 실제 삭제 + 저장만 수행. 성공적으로 지워졌으면 true 반환.
async function removeLogById(id) {
  const before = logs.length;
  logs = logs.filter((l) => l.id !== id);
  if (logs.length === before) return false;
  await persistLogs();
  return true;
}

// 리스트뷰 카드의 삭제 아이콘에서 호출
async function deleteLog(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  try {
    const removed = await removeLogById(id);
    if (!removed) return;
    showStatus('삭제했어요');
    renderList();
    renderCalendar();
  } catch (err) {
    console.error(err);
    showStatus('삭제 중 문제가 발생했어요', true);
  }
}

/* ==========================================================
   캘린더뷰 인라인 작성 / 수정
   — 날짜 셀 클릭: 빈 작성창(등록 모드)
   — 하단 로그리스트 항목 클릭: 값이 채워진 작성창(수정 모드), 삭제 버튼 노출
   ========================================================== */
function formatCalComposerDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}. ${m}. ${d}.`;
}

// "1200", "930", "12:00" 등 다양한 형태의 입력을 "HH:MM" 로 변환한다.
// 자릿수 1~2개는 시(時)로만, 3자리는 시 1자리 + 분 2자리, 4자리는 시 2자리 + 분 2자리로 해석한다.
// 24시간/60분 범위를 벗어나거나 해석 불가능하면 null 을 반환한다.
function parseTimeInput(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = parseInt(colonMatch[2], 10);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return null;

  let h, m;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else if (digits.length === 3) {
    h = parseInt(digits.slice(0, 1), 10);
    m = parseInt(digits.slice(1), 10);
  } else if (digits.length === 4) {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2), 10);
  } else {
    return null;
  }

  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 클릭(포커스) 시 기존 시간을 지워 바로 새 값을 입력할 수 있게 한다.
function handleCalTimeFocus() {
  calEntryTimeBeforeEdit = calEntryTime.value;
  calEntryTime.value = '';
  calEntryTime.classList.remove('invalid');
}

// 포커스 아웃 시 입력값을 HH:MM 형태로 변환한다.
// 아무것도 입력하지 않고 빠져나가면 포커스 전 원래 시간으로 복원하고,
// 형식이 안 맞는 값을 입력했다면 invalid 표시만 하고 값은 그대로 둔다 (등록 시점에 다시 한번 막힌다).
function handleCalTimeBlur() {
  if (!calEntryTime.value.trim()) {
    calEntryTime.value = calEntryTimeBeforeEdit;
    calEntryTime.classList.remove('invalid');
    return;
  }
  const parsed = parseTimeInput(calEntryTime.value);
  if (parsed) {
    calEntryTime.value = parsed;
    calEntryTime.classList.remove('invalid');
  } else {
    calEntryTime.classList.add('invalid');
  }
}

// 선택된 날짜 셀에만 selected 클래스를 입힌다 (전체 재렌더링 없이 하이라이트만 갱신)
function updateSelectedHighlight() {
  calendarGrid.querySelectorAll('.calendar-cell.selected').forEach((c) => {
    c.classList.remove('selected');
  });
  if (selectedCalDate) {
    const cell = calendarGrid.querySelector(`.calendar-cell[data-date="${selectedCalDate}"]`);
    if (cell) cell.classList.add('selected');
  }
}

// 날짜 셀 클릭 → 빈 작성창 (등록 모드)
function openCalComposer(dateStr) {
  calEditingId = null;
  selectedCalDate = dateStr;
  calComposerDate.textContent = formatCalComposerDate(dateStr);
  calEntryTime.value = new Date().toTimeString().slice(0, 5);
  calEntryTime.classList.remove('invalid');
  calEntryBody.value = '';
  calEntryMemo.value = '';
  calSaveBtn.textContent = '등록';
  calDeleteBtn.classList.add('hidden');
  calComposer.classList.add('open');
  updateSelectedHighlight();
}

// 하단 로그리스트 항목 클릭 → 값이 채워진 작성창 (수정 모드)
function openCalComposerForEdit(logId) {
  const log = logs.find((l) => l.id === logId);
  if (!log) return;

  // 열려있던 메모 아코디언은 닫는다
  calendarLogList.querySelectorAll('.log-memo.open').forEach((m) => m.classList.remove('open'));
  calendarLogList.querySelectorAll('.icon-btn.memo-active').forEach((btn) => btn.classList.remove('memo-active'));

  calEditingId = logId;
  selectedCalDate = log.date;
  calComposerDate.textContent = formatCalComposerDate(log.date);
  calEntryTime.value = log.time;
  calEntryTime.classList.remove('invalid');
  calEntryBody.value = log.body;
  calEntryMemo.value = log.memo || '';
  calSaveBtn.textContent = '수정 완료';
  calDeleteBtn.classList.remove('hidden');
  calComposer.classList.add('open');
  updateSelectedHighlight();
}

function closeCalComposer() {
  if (!selectedCalDate) return;
  selectedCalDate = null;
  calEditingId = null;
  calComposer.classList.remove('open');
  calEntryBody.value = '';
  calEntryMemo.value = '';
  calEntryTime.classList.remove('invalid');
  calSaveBtn.textContent = '등록';
  calDeleteBtn.classList.add('hidden');
  updateSelectedHighlight();
}

async function handleCalSave() {
  const body = calEntryBody.value.trim();
  const memo = calEntryMemo.value.trim();
  if (!body) {
    showStatus('본문을 입력해주세요', true);
    return;
  }

  const parsedTime = parseTimeInput(calEntryTime.value);
  if (!parsedTime) {
    showStatus('시간 형식이 올바르지 않아요', true);
    calEntryTime.classList.add('invalid');
    return;
  }
  calEntryTime.value = parsedTime;
  calEntryTime.classList.remove('invalid');

  if (!selectedCalDate) return;

  const editingId = calEditingId;
  calSaveBtn.disabled = true;
  calDeleteBtn.disabled = true;
  try {
    if (editingId) {
      const target = logs.find((l) => l.id === editingId);
      if (!target) throw new Error('대상을 찾을 수 없어요');
      target.date = selectedCalDate;
      target.time = parsedTime;
      target.body = body;
      target.memo = memo;
    } else {
      logs.unshift({
        id: crypto.randomUUID(),
        date: selectedCalDate,
        time: parsedTime,
        body,
        memo,
      });
    }
    await persistLogs();
    showStatus(editingId ? '수정했어요' : '기록했어요');
    closeCalComposer();
    renderCalendar();
    renderList();
  } catch (err) {
    console.error(err);
    showStatus('저장 중 문제가 발생했어요', true);
  } finally {
    calSaveBtn.disabled = false;
    calDeleteBtn.disabled = false;
  }
}

// 작성창이 수정 모드일 때 삭제 버튼에서 호출
async function handleCalDelete() {
  if (!calEditingId) return;
  if (!confirm('이 기록을 삭제할까요?')) return;

  const id = calEditingId;
  calSaveBtn.disabled = true;
  calDeleteBtn.disabled = true;
  try {
    const removed = await removeLogById(id);
    if (!removed) return;
    showStatus('삭제했어요');
    closeCalComposer();
    renderList();
    renderCalendar();
  } catch (err) {
    console.error(err);
    showStatus('삭제 중 문제가 발생했어요', true);
  } finally {
    calSaveBtn.disabled = false;
    calDeleteBtn.disabled = false;
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
   메모 아코디언 (캘린더뷰 전용 — id 기반, 리스트뷰 안에서는 한 번에 하나만 열린다)
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
   리스트뷰 카드 인터랙션
   — 카드 클릭 시 아이콘(메모/수정/삭제) 노출, 추가 액션 없으면 2초 뒤 자동 숨김
   — 메모 또는 인라인 수정창이 열려있는 동안은 타이머 미적용
   — 한 번에 하나의 카드만 활성화
   ========================================================== */
function getListCard(id) {
  return logList.querySelector(`.log-entry[data-id="${id}"]`);
}

function scheduleListCardHide(id) {
  clearTimeout(listCardHideTimer);
  listCardHideTimer = setTimeout(() => {
    const card = getListCard(id);
    if (!card) return;
    const memoOpen = card.querySelector('.log-memo')?.classList.contains('open');
    const editOpen = card.querySelector('.log-edit')?.classList.contains('open');
    if (memoOpen || editOpen) return;
    closeListCardActions();
  }, 2000);
}

function closeListCardActions() {
  clearTimeout(listCardHideTimer);
  if (!activeListCardId) return;
  const card = getListCard(activeListCardId);
  if (card) {
    card.classList.remove('actions-visible');
    card.querySelector('.log-memo')?.classList.remove('open');
    card.querySelector('.log-edit')?.classList.remove('open');
    card.querySelector('.icon-btn.memo-active')?.classList.remove('memo-active');
  }
  activeListCardId = null;
}

function openListCardActions(id) {
  if (activeListCardId && activeListCardId !== id) {
    closeListCardActions();
  }
  activeListCardId = id;
  const card = getListCard(id);
  if (card) card.classList.add('actions-visible');
  scheduleListCardHide(id);
}

function toggleListCardActions(id) {
  if (activeListCardId === id) {
    closeListCardActions();
  } else {
    openListCardActions(id);
  }
}

function toggleListMemo(id) {
  const card = getListCard(id);
  if (!card) return;
  const memoEl = card.querySelector('.log-memo');
  if (!memoEl) return;
  const btn = card.querySelector('button[data-action="memo"]');
  const isOpen = memoEl.classList.contains('open');

  if (isOpen) {
    memoEl.classList.remove('open');
    btn?.classList.remove('memo-active');
    if (activeListCardId === id) scheduleListCardHide(id);
  } else {
    memoEl.classList.add('open');
    btn?.classList.add('memo-active');
    clearTimeout(listCardHideTimer); // 메모 열려있는 동안 타이머 정지
  }
}

function toggleListEdit(id) {
  const card = getListCard(id);
  if (!card) return;
  const editEl = card.querySelector('.log-edit');
  if (!editEl) return;
  const isOpen = editEl.classList.contains('open');

  if (isOpen) {
    editEl.classList.remove('open');
    if (activeListCardId === id) scheduleListCardHide(id);
  } else {
    // 메모가 열려있으면 닫는다
    const memoEl = card.querySelector('.log-memo');
    if (memoEl?.classList.contains('open')) {
      memoEl.classList.remove('open');
      card.querySelector('.icon-btn.memo-active')?.classList.remove('memo-active');
    }
    // 기존 값 채우기
    const log = logs.find((l) => l.id === id);
    if (log) {
      editEl.querySelector('.edit-date').value = log.date;
      editEl.querySelector('.edit-time').value = log.time;
      editEl.querySelector('.edit-body').value = log.body;
      editEl.querySelector('.edit-memo').value = log.memo || '';
    }
    editEl.classList.add('open');
    clearTimeout(listCardHideTimer); // 수정창 열려있는 동안 타이머 정지
  }
}

async function handleInlineEditSave(id) {
  const card = getListCard(id);
  if (!card) return;
  const editEl = card.querySelector('.log-edit');
  const date = editEl.querySelector('.edit-date').value;
  const time = editEl.querySelector('.edit-time').value;
  const body = editEl.querySelector('.edit-body').value.trim();
  const memo = editEl.querySelector('.edit-memo').value.trim();

  if (!date || !time || !body) {
    showStatus('날짜/시간/본문을 입력해주세요', true);
    return;
  }

  const saveBtnEl = editEl.querySelector('button[data-action="save-edit"]');
  saveBtnEl.disabled = true;
  try {
    const target = logs.find((l) => l.id === id);
    target.date = date;
    target.time = time;
    target.body = body;
    target.memo = memo;
    await persistLogs();
    showStatus('수정했어요');
    closeListCardActions();
    renderList();
    renderCalendar();
  } catch (err) {
    console.error(err);
    showStatus('저장 중 문제가 발생했어요', true);
    saveBtnEl.disabled = false;
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
    cell.className = 'calendar-cell'
      + (dateStr === todayStr ? ' today' : '')
      + (dateStr === selectedCalDate ? ' selected' : '');
    cell.dataset.date = dateStr;
    cell.innerHTML = `
      <span>${d}</span>
      ${datesWithLogs.has(dateStr) ? '<span class="calendar-dot"></span>' : ''}
    `;
    calendarGrid.appendChild(cell);
  }

  renderCalendarLogList(monthPrefix);
}

function renderCalendarLogList(monthPrefix) {
  calendarLogList.innerHTML = '';

  if (!logsLoaded) {
    // 아직 드라이브에서 데이터를 못 받아온 상태 — '기록 없음' 문구를 잘못 보여주지 않도록 비워둔다
    calendarEmptyState.classList.add('hidden');
    return;
  }

  const monthLogs = logs
    .filter((l) => l.date.startsWith(monthPrefix))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  calendarEmptyState.classList.toggle('hidden', monthLogs.length > 0);

  monthLogs.forEach((l) => {
    const day = parseInt(l.date.slice(-2), 10);
    const hasMemo = !!(l.memo && l.memo.trim());
    const memoElId = `cal-memo-${l.id}`;

    const item = document.createElement('div');
    item.className = 'calendar-log-item';
    item.dataset.id = l.id;
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
  clearTimeout(listCardHideTimer);
  activeListCardId = null;

  const query = searchInput.value.trim().toLowerCase();

  const sorted = [...logs].sort((a, b) =>
    `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`)
  );

  const filtered = sorted.filter((l) => {
    if (!query) return true;
    const inDate = l.date.includes(query);
    const inBody = l.body.toLowerCase().includes(query);
    const inMemo = (l.memo || '').toLowerCase().includes(query);
    return inDate || inBody || inMemo;
  });

  logList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((l) => {
    const hasMemo = !!(l.memo && l.memo.trim());

    const item = document.createElement('div');
    item.className = 'log-entry';
    item.dataset.id = l.id;
    item.innerHTML = `
      <div class="log-entry-head">
        <span class="log-timestamp">${l.date} ${l.time}</span>
        <span class="log-entry-actions">
          ${hasMemo ? `
            <button class="icon-btn" data-action="memo" data-id="${l.id}" title="메모 보기">
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
        <div class="log-memo">
          <div class="log-memo-inner">${linkifyHtml(l.memo)}</div>
        </div>
      ` : ''}
      <div class="log-edit">
        <div class="log-edit-inner">
          <div class="log-edit-row">
            <input type="date" class="mono-input edit-date">
            <input type="time" class="mono-input edit-time">
          </div>
          <textarea class="edit-body" rows="3"></textarea>
          <textarea class="memo-textarea edit-memo" rows="2"></textarea>
          <div class="log-edit-actions">
            <button class="btn-ghost small" data-action="cancel-edit" data-id="${l.id}">취소</button>
            <button class="btn-primary small" data-action="save-edit" data-id="${l.id}">수정 완료</button>
          </div>
        </div>
      </div>
    `;
    logList.appendChild(item);
  });
}

logList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === 'edit' || action === 'cancel-edit') toggleListEdit(id);
    else if (action === 'delete') deleteLog(id);
    else if (action === 'memo') toggleListMemo(id);
    else if (action === 'save-edit') handleInlineEditSave(id);
    return;
  }
  const card = e.target.closest('.log-entry');
  if (card) toggleListCardActions(card.dataset.id);
});

calendarLogList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    if (btn.dataset.action === 'memo') {
      toggleMemoAccordion(calendarLogList, btn.dataset.memoTarget);
    }
    return;
  }
  const item = e.target.closest('.calendar-log-item');
  if (!item || !item.dataset.id) return;
  if (calEditingId === item.dataset.id) {
    closeCalComposer();
  } else {
    openCalComposerForEdit(item.dataset.id);
  }
});

calendarGrid.addEventListener('click', (e) => {
  const cell = e.target.closest('.calendar-cell:not(.empty)');
  if (!cell || !cell.dataset.date) return;
  const dateStr = cell.dataset.date;
  if (dateStr === selectedCalDate) {
    closeCalComposer();
  } else {
    openCalComposer(dateStr);
  }
});
