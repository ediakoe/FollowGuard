const HISTORY_KEY = 'followguardHistory';
const MAX_HISTORY = 20;

async function getHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
}

async function saveScanHistory(accounts) {
  const history = await getHistory();
  const snapshot = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    count: accounts.length,
    candidates: accounts.filter(a => a.score >= 50).length,
    accounts
  };
  history.unshift(snapshot);
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_HISTORY) });
  return snapshot;
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

async function compareWithPrevious(accounts) {
  const history = await getHistory();
  if (!history.length) return { added: accounts, removed: [], changed: [] };
  const previous = new Map((history[0].accounts || []).map(a => [a.username, a]));
  const current = new Map(accounts.map(a => [a.username, a]));
  const added = accounts.filter(a => !previous.has(a.username));
  const removed = (history[0].accounts || []).filter(a => !current.has(a.username));
  const changed = accounts.filter(a => previous.has(a.username) && previous.get(a.username).score !== a.score);
  return { added, removed, changed };
}

globalThis.FollowGuardHistory = { getHistory, saveScanHistory, clearHistory, compareWithPrevious };
