// FollowGuard V2 - read-only scanner
// Scans the visible Following list on X and produces review candidates.
// It does NOT click Follow/Unfollow buttons and does not perform account actions.

let scanState = {
  isScanning: false,
  scanned: 0,
  candidates: 0,
  skipped: 0,
  accounts: []
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'SCAN') {
    if (!scanState.isScanning) {
      scanState = {
        isScanning: true,
        scanned: 0,
        candidates: 0,
        skipped: 0,
        accounts: []
      };
      scanFollowing(msg.options || {}).catch(handleScanError);
    }
    sendResponse({ status: 'started' });
    return true;
  }

  if (msg.action === 'STOP_SCAN') {
    scanState.isScanning = false;
    sendUpdate();
    sendResponse({ status: 'stopped' });
    return true;
  }

  if (msg.action === 'GET_STATS') {
    sendResponse({ stats: scanState });
    return true;
  }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sendUpdate(action = 'SCAN_UPDATE') {
  chrome.runtime.sendMessage({
    action,
    stats: {
      scanned: scanState.scanned,
      candidates: scanState.candidates,
      skipped: scanState.skipped,
      isScanning: scanState.isScanning,
      accounts: scanState.accounts
    }
  }).catch(() => {});
}

async function scanFollowing(options) {
  const username = getUsernameFromPage();
  if (!username) {
    finishWithError('نام کاربری پیدا نشد. داخل حساب X باش.');
    return;
  }

  if (!window.location.pathname.endsWith('/following')) {
    window.location.href = `https://x.com/${username}/following`;
    await sleep(2500);
  }

  const maxAccounts = Number(options.maxAccounts || 500);
  const minScore = Number(options.minScore ?? 50);
  const skipVerified = options.skipVerified !== false;
  const skipWithBio = options.skipWithBio === true;

  let idleRounds = 0;

  while (scanState.isScanning && scanState.scanned < maxAccounts) {
    const cards = getFollowingCards();
    let processedThisRound = 0;

    for (const card of cards) {
      if (!scanState.isScanning || scanState.scanned >= maxAccounts) break;
      if (card.dataset.followguardProcessed === 'true') continue;

      card.dataset.followguardProcessed = 'true';
      processedThisRound++;

      const info = extractCardInfo(card);
      scanState.scanned++;

      if (!info.username) {
        scanState.skipped++;
        continue;
      }

      const analysis = analyzeAccount(info, { skipVerified, skipWithBio });
      if (analysis.score >= minScore && !analysis.excluded) {
        scanState.candidates++;
        scanState.accounts.push({ ...info, ...analysis });
      } else {
        scanState.skipped++;
      }

      sendUpdate();
    }

    if (processedThisRound === 0) {
      idleRounds++;
    } else {
      idleRounds = 0;
    }

    if (idleRounds >= 3) break;

    window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 500), behavior: 'smooth' });
    await sleep(1500);
  }

  scanState.isScanning = false;
  sendUpdate('SCAN_DONE');
}

function getFollowingCards() {
  return Array.from(document.querySelectorAll('[data-testid="UserCell"]'))
    .filter(card => card.dataset.followguardProcessed !== 'true');
}

function extractCardInfo(card) {
  const nameEl = card.querySelector('[data-testid="User-Name"]');
  const descriptionEl = card.querySelector('[data-testid="UserDescription"]');
  const links = Array.from(card.querySelectorAll('a[href]'));

  const profileLink = links.find(a => {
    const href = a.getAttribute('href') || '';
    return /^\/[^/]+$/.test(href) && !href.includes('/following');
  });

  const username = profileLink
    ? (profileLink.getAttribute('href') || '').replace(/^\//, '')
    : extractUsernameFromText(card.textContent || '');

  const name = (nameEl?.textContent || '').trim();
  const bio = (descriptionEl?.textContent || '').trim();
  const text = card.textContent || '';

  const isVerified = !!card.querySelector('[data-testid="icon-verified"]') ||
    /verified/i.test(card.getAttribute('aria-label') || '');

  const followers = parseMetric(text, /([\d,.]+)\s*(K|M|B)?\s*Followers/i);
  const following = parseMetric(text, /([\d,.]+)\s*(K|M|B)?\s*Following/i);

  return {
    username: username ? `@${username.split('/')[0]}` : '',
    name,
    bio,
    isVerified,
    followers,
    following,
    profileUrl: username ? `https://x.com/${username.split('/')[0]}` : ''
  };
}

function analyzeAccount(info, options) {
  const reasons = [];
  let score = 0;
  let excluded = false;

  if (info.isVerified && options.skipVerified) {
    excluded = true;
    reasons.push('verified');
  }

  if (info.bio) {
    score += 10;
  } else {
    score += 35;
    reasons.push('no bio');
  }

  if (!info.name) {
    score += 10;
    reasons.push('minimal profile');
  }

  if (Number.isFinite(info.followers)) {
    if (info.followers < 10) {
      score += 25;
      reasons.push('very low followers');
    } else if (info.followers < 50) {
      score += 15;
      reasons.push('low followers');
    }
  }

  if (info.following > 0 && Number.isFinite(info.followers) && info.following > info.followers * 10) {
    score += 10;
    reasons.push('high following/follower ratio');
  }

  if (options.skipWithBio && info.bio) {
    excluded = true;
  }

  score = Math.min(100, score);

  return {
    score,
    reasons,
    excluded,
    risk: score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
  };
}

function parseMetric(text, regex) {
  const match = text.match(regex);
  if (!match) return NaN;
  const value = Number(String(match[1]).replace(/,/g, ''));
  const suffix = (match[2] || '').toUpperCase();
  const multiplier = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return value * multiplier;
}

function extractUsernameFromText(text) {
  const match = text.match(/@([A-Za-z0-9_]{1,15})/);
  return match ? match[1] : '';
}

function getUsernameFromPage() {
  const match = window.location.pathname.match(/^\/([^/]+)/);
  if (match && match[1] && !['home', 'explore', 'notifications', 'messages', 'i', 'search'].includes(match[1])) {
    return match[1];
  }

  const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  if (profileLink) {
    const href = profileLink.getAttribute('href') || '';
    const profileMatch = href.match(/^\/([^/]+)/);
    if (profileMatch) return profileMatch[1];
  }

  return null;
}

function handleScanError(error) {
  scanState.isScanning = false;
  chrome.runtime.sendMessage({
    action: 'ERROR',
    msg: error?.message || 'خطای نامشخص هنگام اسکن رخ داد.'
  }).catch(() => {});
}

function finishWithError(message) {
  scanState.isScanning = false;
  chrome.runtime.sendMessage({ action: 'ERROR', msg: message }).catch(() => {});
}
