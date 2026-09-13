const $ = (id) => document.getElementById(id);
const btn = $('mainBtn');
const scanCount = $('scanCount');
const candidateCount = $('unfollowCount');
const skipCount = $('skipCount');
const progressFill = $('progressFill');
const statusText = $('statusText');
const list = $('candidateList');
const riskFilter = $('riskFilter');
const scoreFilter = $('scoreFilter');
const scanTab = $('scanTab');
const historyTab = $('historyTab');
const scanPanel = $('scanPanel');
const historyPanel = $('historyPanel');
const historyList = $('historyList');
const addedCount = $('addedCount');
const removedCount = $('removedCount');
const changedCount = $('changedCount');

let running = false;
let accounts = [];
let selected = new Set();
let latestDiff = null;

function updateStats(stats = {}) {
  scanCount.textContent = stats.scanned || 0;
  candidateCount.textContent = stats.candidates || 0;
  skipCount.textContent = stats.skipped || 0;
}

function scoreClass(score) {
  if (score >= 75) return '';
  if (score >= 50) return 'med';
  return 'low';
}

function filteredAccounts() {
  const risk = riskFilter.value;
  const minScore = scoreFilter.value === 'all' ? 0 : Number(scoreFilter.value);
  return accounts.filter(a => (risk === 'all' || a.risk === risk) && a.score >= minScore);
}

function render() {
  const visible = filteredAccounts();
  if (!visible.length) {
    list.innerHTML = '<div class="empty">کاندیدی برای نمایش وجود ندارد.</div>';
    return;
  }

  list.innerHTML = visible.map((a) => {
    const checked = selected.has(a.username) ? 'checked' : '';
    const initial = (a.name || a.username || '?').trim().charAt(0).toUpperCase();
    const reasons = (a.reasons || []).slice(0, 3).join(' • ');
    return `<div class="candidate">
      <div class="c-top">
        <input class="check" type="checkbox" data-user="${escapeHtml(a.username)}" ${checked}>
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="c-main">
          <div class="name">${escapeHtml(a.name || a.username)}</div>
          <div class="handle">@${escapeHtml(a.username)}</div>
          <div class="meta">${formatNum(a.followers)} followers · ${formatNum(a.following)} following · ${a.verified ? '✓ verified' : 'unverified'}</div>
          <div class="reason">${escapeHtml(reasons || 'No strong signals')}</div>
        </div>
        <div class="score ${scoreClass(a.score)}">${a.score}</div>
      </div>
      <div class="actions"><button class="smallbtn open-profile" data-url="${escapeHtml(a.profileUrl || '')}">مشاهده پروفایل</button></div>
    </div>`;
  }).join('');

  list.querySelectorAll('.check').forEach(input => input.addEventListener('change', () => {
    const user = input.dataset.user;
    input.checked ? selected.add(user) : selected.delete(user);
  }));

  list.querySelectorAll('.open-profile').forEach(button => button.addEventListener('click', async () => {
    if (!button.dataset.url) return;
    await chrome.tabs.create({ url: button.dataset.url });
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function formatNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاریخ نامشخص';
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function setRunning(value) {
  running = Boolean(value);
  btn.className = running ? 'mainbtn stop' : 'mainbtn';
  btn.textContent = running ? '⏹ توقف اسکن' : '🔍 شروع اسکن';
  btn.disabled = false;
}

function renderDiffSection(title, items, type) {
  if (!items.length) return '';
  const rows = items.slice(0, 25).map(a => {
    const label = `@${escapeHtml(a.username || 'unknown')}`;
    const score = type === 'changed' ? `Score ${a.score}` : '';
    return `<div class="diff-item"><span class="diff-handle">${label}</span><span class="diff-score ${type}">${score}</span></div>`;
  }).join('');
  return `<div class="section-title">${title} (${items.length})</div>${rows}`;
}

async function renderHistory() {
  const history = await FollowGuardHistory.getHistory();
  if (!history.length) {
    historyList.innerHTML = '<div class="empty">هنوز تاریخچه‌ای ثبت نشده.<br>بعد از اولین اسکن، snapshot اینجا ذخیره می‌شود.</div>';
    addedCount.textContent = '0';
    removedCount.textContent = '0';
    changedCount.textContent = '0';
    return;
  }

  const latest = history[0];
  const diff = accounts.length && latestDiff ? latestDiff : {added:[],removed:[],changed:[]};
  addedCount.textContent = diff.added.length;
  removedCount.textContent = diff.removed.length;
  changedCount.textContent = diff.changed.length;

  historyList.innerHTML = history.map((snapshot, index) => `
    <div class="history-card">
      <div class="history-head">
        <div class="history-date">${formatDate(snapshot.createdAt)}</div>
        <div class="history-id">#${history.length - index}</div>
      </div>
      <div class="history-meta">${formatNum(snapshot.count)} حساب · ${formatNum(snapshot.candidates)} کاندید</div>
    </div>
  `).join('');

  if (accounts.length) {
    historyList.innerHTML += `<div class="section-title">مقایسه با آخرین Snapshot قبلی</div>
      ${renderDiffSection('حساب‌های جدید', diff.added, 'added')}
      ${renderDiffSection('حساب‌های خارج‌شده', diff.removed, 'removed')}
      ${renderDiffSection('امتیازهای تغییرکرده', diff.changed, 'changed')}
      ${!diff.added.length && !diff.removed.length && !diff.changed.length ? '<div class="empty">تغییر قابل توجهی نسبت به Snapshot قبلی پیدا نشد.</div>' : ''}`;
  } else {
    historyList.innerHTML += `<div class="section-title">آخرین Snapshot</div><div class="empty">${escapeHtml(formatDate(latest.createdAt))}<br>برای Compare واقعی، یک اسکن جدید انجام بده.</div>`;
  }
}

function showPanel(panel) {
  const historyMode = panel === 'history';
  scanPanel.classList.toggle('hidden', historyMode);
  historyPanel.classList.toggle('hidden', !historyMode);
  scanTab.classList.toggle('active', !historyMode);
  historyTab.classList.toggle('active', historyMode);
  if (historyMode) renderHistory();
}

function exportCsv() {
  if (!accounts.length) {
    statusText.textContent = 'اول اسکن را انجام بده.';
    return;
  }
  const headers = ['username','name','score','risk','followers','following','verified','bio','profileUrl','reasons'];
  const rows = accounts.map(a => headers.map(h => {
    const value = h === 'reasons' ? (a.reasons || []).join(' | ') : (a[h] ?? '');
    return `"${String(value).replace(/"/g, '""')}"`;
  }).join(','));
  const blob = new Blob(['\ufeff' + headers.join(',') + '\n' + rows.join('\n')], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `followguard-scan-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

$('selectAll').addEventListener('click', () => {
  filteredAccounts().forEach(a => selected.add(a.username));
  render();
});
$('clearAll').addEventListener('click', () => { selected.clear(); render(); });
$('exportBtn').addEventListener('click', exportCsv);
riskFilter.addEventListener('change', render);
scoreFilter.addEventListener('change', render);
scanTab.addEventListener('click', () => showPanel('scan'));
historyTab.addEventListener('click', () => showPanel('history'));
$('refreshHistory').addEventListener('click', renderHistory);
$('clearHistory').addEventListener('click', async () => {
  if (!confirm('کل تاریخچه اسکن‌ها پاک شود؟')) return;
  await FollowGuardHistory.clearHistory();
  latestDiff = null;
  await renderHistory();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SCAN_UPDATE') {
    accounts = Array.isArray(msg.accounts) ? msg.accounts : accounts;
    updateStats(msg.stats);
    progressFill.style.width = Math.min(((msg.stats?.scanned || 0) / 500) * 100, 100) + '%';
    statusText.textContent = `در حال اسکن — ${msg.stats?.scanned || 0} حساب`;
    render();
    setRunning(true);
  }
  if (msg.action === 'SCAN_DONE') {
    accounts = Array.isArray(msg.accounts) ? msg.accounts : accounts;
    updateStats(msg.stats);
    progressFill.style.width = '100%';
    statusText.textContent = `✅ اسکن تمام شد — ${msg.stats?.candidates || 0} کاندید`;
    render();
    setRunning(false);
    if (accounts.length) {
      FollowGuardHistory.compareWithPrevious(accounts).then(diff => {
        latestDiff = diff;
        return FollowGuardHistory.saveScanHistory(accounts);
      }).then(() => renderHistory()).catch(() => {});
    }
  }
  if (msg.action === 'ERROR') {
    setRunning(false);
    statusText.textContent = '❌ ' + msg.msg;
  }
});

btn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id || (!tab.url?.includes('x.com') && !tab.url?.includes('twitter.com'))) {
    statusText.textContent = '❌ لطفاً داخل x.com باش.';
    return;
  }

  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
  } catch (e) {
    statusText.textContent = '❌ دسترسی اسکریپت ممکن نیست. صفحه X را ریفرش کن.';
    return;
  }

  if (running) {
    chrome.tabs.sendMessage(tab.id, {action:'STOP_SCAN'});
    setRunning(false);
    statusText.textContent = '⏸ اسکن متوقف شد';
    return;
  }

  accounts = [];
  selected.clear();
  latestDiff = null;
  render();
  progressFill.style.width = '0%';
  chrome.tabs.sendMessage(tab.id, {action:'SCAN', options:{skipVerified:true,skipWithBio:true,maxAccounts:500}}, (res) => {
    if (chrome.runtime.lastError) {
      statusText.textContent = '❌ اتصال برقرار نشد. صفحه X را ریفرش کن.';
      return;
    }
    setRunning(true);
    statusText.textContent = '🔎 در حال اسکن Following...';
  });
});

(async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id) {
    await renderHistory();
    return;
  }
  chrome.tabs.sendMessage(tab.id, {action:'GET_STATS'}, (res) => {
    if (chrome.runtime.lastError || !res) return;
    accounts = Array.isArray(res.accounts) ? res.accounts : [];
    updateStats(res.stats);
    render();
    setRunning(res.isScanning);
  });
  await renderHistory();
})();
