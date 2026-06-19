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

// Risk panel expand/collapse
riskToggle.addEventListener('click', () => {
  riskBox.classList.toggle('open');
});

// Restore previous acknowledgment (per-browser, not per-account)
chrome.storage.local.get(['riskAcknowledged'], (res) => {
  if (res.riskAcknowledged) {
    riskAck.checked = true;
    updateButtonGate();
  } else {
    riskBox.classList.add('open'); // force visible until acknowledged
  }
});

riskAck.addEventListener('change', () => {
  chrome.storage.local.set({ riskAcknowledged: riskAck.checked });
  updateButtonGate();
});

function updateButtonGate() {
  if (riskAck.checked) {
    btn.disabled = false;
    if (!running) btn.textContent = '▶ شروع';
  } else {
    btn.disabled = true;
    btn.textContent = 'ابتدا ریسک‌ها رو تایید کن';
  }
}

delaySlider.addEventListener('input', () => {
  delayVal.textContent = delaySlider.value;
});

function updateStats(stats) {
  scanCount.textContent = stats.scanned || 0;
  unfollowCount.textContent = stats.unfollowed || 0;
  skipCount.textContent = stats.skipped || 0;
  progressFill.style.width = Math.min((stats.unfollowed / Math.max(stats.scanned, 1)) * 100 * 2, 100) + '%';
  statusText.textContent = `اسکن شد: ${stats.scanned} | آنفالو: ${stats.unfollowed}`;
}

function setRunning(val) {
  running = val;
  btn.className = val ? 'btn btn-stop' : 'btn btn-start';
  btn.disabled = val ? false : !riskAck.checked;
  btn.textContent = val ? '⏹ توقف' : (riskAck.checked ? '▶ شروع' : 'ابتدا ریسک‌ها رو تایید کن');
  progressWrap.classList.toggle('visible', val);
}

// Listen for updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'UPDATE') {
    updateStats(msg.stats);
  }
  if (msg.action === 'DONE') {
    updateStats(msg.stats);
    setRunning(false);
    statusText.textContent = `✅ تموم شد! ${msg.stats.unfollowed} نفر آنفالو شدن.`;
    progressFill.style.width = '100%';
    progressFill.style.animation = 'none';
  }
  if (msg.action === 'ERROR') {
    setRunning(false);
    statusText.textContent = '❌ ' + msg.msg;
    progressWrap.classList.add('visible');
  }
});

btn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || (!tab.url.includes('x.com') && !tab.url.includes('twitter.com'))) {
    statusText.textContent = '❌ لطفاً توی x.com باش';
    progressWrap.classList.add('visible');
    return;
  }

  if (!running) {
    const options = {
      skipVerified: document.getElementById('skipVerified').checked,
      skipWithBio: document.getElementById('skipWithBio').checked,
      delayMs: parseInt(delaySlider.value) * 1000,
    };

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch(e) {}

    chrome.tabs.sendMessage(tab.id, { action: 'START', options }, (res) => {
      if (chrome.runtime.lastError) {
        statusText.textContent = '❌ خطا در اتصال. صفحه رو ریفرش کن.';
        progressWrap.classList.add('visible');
        return;
      }
      setRunning(true);
    });
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, { action: 'STOP' });
    setRunning(false);
    statusText.textContent = '⏸ متوقف شد';
  }
});

// On popup open, get current state
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: 'GET_STATS' }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    updateStats(res.stats);
    setRunning(res.isRunning);
  });
})();
