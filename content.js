// Content script - runs on x.com / twitter.com

let isRunning = false;
let stats = { scanned: 0, unfollowed: 0, skipped: 0 };

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START') {
    if (!isRunning) {
      isRunning = true;
      stats = { scanned: 0, unfollowed: 0, skipped: 0 };
      startUnfollowing(msg.options);
    }
    sendResponse({ status: 'started' });
  }
  if (msg.action === 'STOP') {
    isRunning = false;
    sendResponse({ status: 'stopped' });
  }
  if (msg.action === 'GET_STATS') {
    sendResponse({ stats, isRunning });
  }
  return true;
});

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendUpdate() {
  chrome.runtime.sendMessage({ action: 'UPDATE', stats, isRunning }).catch(() => {});
}

async function startUnfollowing(options) {
  const { minDaysInactive, skipVerified, skipWithBio, delayMs } = options;

  // Navigate to following page
  const username = getUsernameFromPage();
  if (!username) {
    chrome.runtime.sendMessage({ action: 'ERROR', msg: 'نام کاربری پیدا نشد. مطمئن شو توی توییتر/ایکس لاگین هستی.' }).catch(() => {});
    isRunning = false;
    return;
  }

  const followingUrl = `https://x.com/${username}/following`;
  if (!window.location.href.includes('/following')) {
    window.location.href = followingUrl;
    return;
  }

  await sleep(2000);

  while (isRunning) {
    const cards = getFollowingCards();
    if (cards.length === 0) {
      await sleep(1000);
      scrollDown();
      await sleep(2000);
      const newCards = getFollowingCards();
      if (newCards.length === 0) {
        // Done
        isRunning = false;
        chrome.runtime.sendMessage({ action: 'DONE', stats }).catch(() => {});
        return;
      }
      continue;
    }

    for (const card of cards) {
      if (!isRunning) break;

      try {
        const info = extractCardInfo(card);
        stats.scanned++;

        const shouldUnfollow = evaluateAccount(info, { minDaysInactive, skipVerified, skipWithBio });

        if (shouldUnfollow) {
          const unfollowed = await unfollowAccount(card);
          if (unfollowed) {
            stats.unfollowed++;
          } else {
            stats.skipped++;
          }
          await sleep(delayMs + Math.random() * 500);
        } else {
          stats.skipped++;
        }

        sendUpdate();
        card.dataset.processed = 'true';
      } catch (e) {
        card.dataset.processed = 'true';
        stats.skipped++;
      }
    }

    scrollDown();
    await sleep(2000);
  }
}

function getUsernameFromPage() {
  // Try from URL
  const match = window.location.pathname.match(/^\/([^/]+)/);
  if (match && match[1] && !['home', 'explore', 'notifications', 'messages', 'i'].includes(match[1])) {
    return match[1];
  }
  // Try from nav link
  const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  if (profileLink) {
    const m = profileLink.href.match(/\/([^/]+)$/);
    if (m) return m[1];
  }
  return null;
}

function getFollowingCards() {
  const all = document.querySelectorAll('[data-testid="UserCell"]:not([data-processed="true"])');
  return Array.from(all);
}

function extractCardInfo(card) {
  const nameEl = card.querySelector('[data-testid="User-Name"]');
  const name = nameEl ? nameEl.textContent : '';

  const bioEl = card.querySelector('[data-testid="UserDescription"]');
  const bio = bioEl ? bioEl.textContent.trim() : '';

  const verifiedEl = card.querySelector('[data-testid="icon-verified"]');
  const isVerified = !!verifiedEl;

  return { name, bio, isVerified };
}

function evaluateAccount(info, options) {
  const { skipVerified, skipWithBio } = options;

  if (skipVerified && info.isVerified) return false;
  if (skipWithBio && info.bio && info.bio.length > 0) return false;

  // Mark as inactive if no bio (simple heuristic)
  const hasNoBio = !info.bio || info.bio.length === 0;
  return hasNoBio;
}

async function unfollowAccount(card) {
  // Find the Following/Unfollow button
  const btn = card.querySelector('[data-testid$="-unfollow"]') ||
               card.querySelector('[role="button"][aria-label*="Following"]');

  if (!btn) return false;

  btn.click();
  await sleep(500);

  // Confirm dialog if appears
  const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
  if (confirmBtn) {
    confirmBtn.click();
    await sleep(300);
  }

  return true;
}

function scrollDown() {
  window.scrollBy(0, window.innerHeight * 0.8);
}
