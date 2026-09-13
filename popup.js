const btn = document.getElementById('mainBtn');
const scanCount = document.getElementById('scanCount');
const unfollowCount = document.getElementById('unfollowCount');
const skipCount = document.getElementById('skipCount');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const statusText = document.getElementById('statusText');
const delaySlider = document.getElementById('delaySlider');
const delayVal = document.getElementById('delayVal');
const riskBox = document.getElementById('riskBox');
const riskToggle = document.getElementById('riskToggle');
const riskAck = document.getElementById('riskAck');

let running = false;

riskToggle?.addEventListener('click', () => riskBox?.classList.toggle('open'));

chrome.storage.local.get(['riskAcknowledged'], (res) => {
  if (riskAck) riskAck.checked = Boolean(res.riskAcknowledged);
  if (!res.riskAcknowledged) riskBox?.classList.add('open');
  updateButtonGate();
});

riskAck?.addEventListener('change', () => {
  chrome.storage.local.set({ riskAcknowledged: riskAck.checked });
  updateButtonGate();
});

function updateButtonGate() {
  if (!btn) return;
  btn.disabled = running ? false : !riskAck?.checked;
  btn.textContent = running ? '⏹ توقف اسکن' : (riskAck?.checked ? '🔍 شروع اسکن' : 'ابتدا ریسک‌ها رو تایید کن');
}

delaySlider?.addEventListener('input', () => {
  if (delayVal) delayVal.textContent = delaySlider.value;
});

function updateStats(stats = {}) {
  if (scanCount) scanCount.textContent = stats.scanned || 0;
  if (unfollowCount) unfollowCount.textContent = stats.candidates || 0;
  if (skipCount) skipCount.textContent = stats.skipped || 0;

  const total = Math.max(stats.scanned || 0, 1);
  if (progressFill) progressFill.style.width = Math.min(((stats.scanned || 0) / total) * 100, 100) + '%';
  if (statusText) statusText.textContent = `اسکن شد: ${stats.scanned || 0} | کاندید: ${stats.candidates || 0}`;
}

function setRunning(value) {
  running = Boolean(value);
  if (btn) {
    btn.className = running ? 'btn btn-stop' : 'btn btn-start';
    updateButtonGate();
  }
  progressWrap?.classList.toggle('visible', running);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SCAN_UPDATE') {
    updateStats(msg.stats);
    setRunning(true);
  }

  if (msg.action === 'SCAN_DONE') {
    updateStats(msg.stats);
    setRunning(false);
    if (statusText) statusText.textContent = `✅ اسکن تمام شد — ${msg.stats.candidates || 0} کاندید پیدا شد.`;
    if (progressFill) progressFill.style.width = '100%';
  }

  if (msg.action === 'ERROR') {
    setRunning(false);
    if (statusText) statusText.textContent = '❌ ' + msg.msg;
    progressWrap?.classList.add('visible');
  }
});

btn?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || (!tab.url?.includes('x.com') && !tab.url?.includes('twitter.com'))) {
    if (statusText) statusText.textContent = '❌ لطفاً داخل x.com باش.';
    progressWrap?.classList.add('visible');
    return;
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    if (statusText) statusText.textContent = '❌ دسترسی اسکریپت به صفحه ممکن نیست. صفحه را ریفرش کن.';
    return;
  }

  if (!running) {
    const options = {
      skipVerified: Boolean(document.getElementById('skipVerified')?.checked),
      skipWithBio: Boolean(document.getElementById('skipWithBio')?.checked),
      maxAccounts: 500
    };

    chrome.tabs.sendMessage(tab.id, { action: 'SCAN', options }, (res) => {
      if (chrome.runtime.lastError) {
        if (statusText) statusText.textContent = '❌ اتصال برقرار نشد. صفحه X را ریفرش کن.';
        progressWrap?.classList.add('visible');
        return;
      }
      setRunning(true);
      if (statusText) statusText.textContent = '🔎 در حال اسکن Following...';
    });
  } else {
    chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCAN' });
    setRunning(false);
    if (statusText) statusText.textContent = '⏸ اسکن متوقف شد';
  }
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  chrome.tabs.sendMessage(tab.id, { action: 'GET_STATS' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    updateStats(res.stats);
    setRunning(res.isScanning);
  });
})();
