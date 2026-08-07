const MESSENGER_URL = 'https://www.facebook.com/messages/';
const PURCHASE_URL = 'https://cleanmysocial.verblike.com/';
const REVIEW_URL = 'https://chromewebstore.google.com/detail/imobgpikmofiapbnijmebknbkmkncdkl/reviews';
// Identify this extension specifically, so the server can tell which tool is
// asking. Asking as 'cleanmysocial' means any purchase unlocks everything.
const LICENSE_API = 'https://cleanmysocial.verblike.com/api/license?extension=facebook-messenger-cleaner&key=';
const LICENSE_KEY_STORAGE = 'verblike_license_key';
const DAILY_USAGE_STORAGE = 'messenger_cleaner_daily_usage';
const LICENSE_CACHE_STORAGE = 'messenger_cleaner_license_cache';
const DAILY_LIMIT = 10;
const LICENSE_CACHE_TTL = 5 * 60 * 1000;
let usageQueue = Promise.resolve();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: { speed: 'normal' } });
  }
  await getLicenseKey();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {});
});

// Chrome 142+ reports side-panel closes. Clear any tab-specific instances
// retained from an older extension build so none reappear after switching tabs.
let closingAllPanels = false;
if (chrome.sidePanel.onClosed && chrome.sidePanel.close) {
  chrome.sidePanel.onClosed.addListener(async ({ windowId }) => {
    if (closingAllPanels) return;
    closingAllPanels = true;
    try {
      await chrome.sidePanel.close({ windowId }).catch(() => {});
      const tabs = await chrome.tabs.query({ windowId });
      await Promise.all(tabs.map(tab => chrome.sidePanel.close({ tabId: tab.id }).catch(() => {})));
    } finally {
      closingAllPanels = false;
    }
  });
}

function isMessengerUrl(url = '') {
  try {
    const parsed = new URL(url);
    const allowedHost = [
      'www.facebook.com',
      'web.facebook.com',
      'm.facebook.com',
      'www.messenger.com'
    ].includes(parsed.hostname);
    return allowedHost && (parsed.hostname === 'www.messenger.com' || parsed.pathname.startsWith('/messages'));
  } catch {
    return false;
  }
}

function createLicenseKey() {
  return crypto.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getLicenseKey() {
  const stored = await chrome.storage.sync.get(LICENSE_KEY_STORAGE);
  if (stored[LICENSE_KEY_STORAGE]) return stored[LICENSE_KEY_STORAGE];
  const key = createLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: key });
  return key;
}

async function setLicenseKey(key) {
  const cleaned = String(key || '').trim();
  if (!cleaned) return getLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: cleaned });
  await chrome.storage.local.remove(LICENSE_CACHE_STORAGE);
  return cleaned;
}

function localDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getDailyUsage() {
  const today = localDateKey();
  const stored = await chrome.storage.local.get(DAILY_USAGE_STORAGE);
  const usage = stored[DAILY_USAGE_STORAGE];
  if (usage?.date === today && Number.isFinite(usage.count)) {
    return { date: today, count: Math.max(0, Math.min(DAILY_LIMIT, usage.count)) };
  }
  const fresh = { date: today, count: 0 };
  await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: fresh });
  return fresh;
}

async function checkLicense({ force = false, key: suppliedKey } = {}) {
  const key = suppliedKey ? await setLicenseKey(suppliedKey) : await getLicenseKey();
  const stored = await chrome.storage.local.get(LICENSE_CACHE_STORAGE);
  const cache = stored[LICENSE_CACHE_STORAGE];
  if (!force && cache?.key === key && Date.now() - cache.checkedAt < LICENSE_CACHE_TTL) {
    return { active: Boolean(cache.active), key };
  }

  try {
    const response = await fetch(`${LICENSE_API}${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`License server returned ${response.status}`);
    const body = await response.json();
    const active = Boolean(body?.result || body?.active);
    await chrome.storage.local.set({
      [LICENSE_CACHE_STORAGE]: { key, active, checkedAt: Date.now() }
    });
    return { active, key };
  } catch (error) {
    return { active: Boolean(cache?.key === key && cache.active), key, error: error.message };
  }
}

async function getAccessState(options = {}) {
  const [license, usage] = await Promise.all([checkLicense(options), getDailyUsage()]);
  return {
    unlimited: license.active,
    licenseKey: license.key,
    used: usage.count,
    limit: DAILY_LIMIT,
    remaining: license.active ? null : Math.max(0, DAILY_LIMIT - usage.count),
    date: usage.date,
    licenseError: license.error || ''
  };
}

function broadcastAccessState(state) {
  chrome.runtime.sendMessage({ type: 'ACCESS_STATE_CHANGED', access: state }).catch(() => {});
}

function recordMeteredAction() {
  const task = usageQueue.then(async () => {
    const access = await getAccessState();
    if (access.unlimited) return { allowed: true, access };
    if (access.used >= DAILY_LIMIT) return { allowed: false, access };

    const nextUsage = { date: localDateKey(), count: access.used + 1 };
    await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: nextUsage });
    const nextAccess = {
      ...access,
      used: nextUsage.count,
      remaining: Math.max(0, DAILY_LIMIT - nextUsage.count),
      date: nextUsage.date
    };
    broadcastAccessState(nextAccess);
    return { allowed: true, access: nextAccess };
  });
  usageQueue = task.catch(() => {});
  return task;
}

function publishTabState(tab, reason) {
  if (!tab?.id) return;
  chrome.runtime.sendMessage({
    type: 'ACTIVE_TAB_CHANGED',
    reason,
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || '',
      supported: isMessengerUrl(tab.url)
    }
  }).catch(() => {});
}

async function publishActiveTab(windowId, reason) {
  const query = { active: true };
  if (Number.isInteger(windowId)) query.windowId = windowId;
  else query.lastFocusedWindow = true;
  const [tab] = await chrome.tabs.query(query);
  publishTabState(tab, reason);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then(tab => publishTabState(tab, 'activated')).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status || changeInfo.title) {
    publishTabState(tab, changeInfo.url ? 'navigated' : 'updated');
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) publishActiveTab(windowId, 'window-focused');
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  chrome.tabs.get(details.tabId).then(tab => {
    if (tab.active) publishTabState(tab, 'history-state');
  }).catch(() => {});
});

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  chrome.tabs.get(details.tabId).then(tab => {
    if (tab.active) publishTabState(tab, 'committed');
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => sendResponse({
        tab: tab ? {
          id: tab.id,
          windowId: tab.windowId,
          active: tab.active,
          title: tab.title || '',
          url: tab.url || '',
          status: tab.status || '',
          supported: isMessengerUrl(tab.url)
        } : null
      }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === 'OPEN_MESSENGER') {
    chrome.tabs.create({ url: MESSENGER_URL })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_ACCESS_STATE') {
    getAccessState()
      .then(access => sendResponse({ ok: true, access }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHECK_LICENSE') {
    getAccessState({ force: true, key: message.licenseKey })
      .then(access => {
        broadcastAccessState(access);
        sendResponse({ ok: true, access });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'RECORD_METERED_ACTION') {
    recordMeteredAction()
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'OPEN_PURCHASE') {
    getLicenseKey().then(key => {
      const url = new URL(PURCHASE_URL);
      url.searchParams.set('lk', key);
      return chrome.tabs.create({ url: url.toString() });
    }).then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'OPEN_REVIEW') {
    chrome.tabs.create({ url: REVIEW_URL })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if ((message.type === 'PAGE_STATE' || message.type === 'OPERATION_STATE') && sender.tab?.id) {
    const payload = { ...message, tabId: sender.tab.id };
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  return false;
});
