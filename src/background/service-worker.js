const MESSENGER_URL = 'https://www.facebook.com/messages/';
const PURCHASE_URL = 'https://cleanmysocial.com/facebook-messenger-cleaner';
const REVIEW_EXTENSION_ID = 'imobgpikmofiapbnijmebknbkmkncdkl';
const FRIENDS_REMOVER_EXTENSION_ID = 'fegkbiinmaoipoonnlhekdoefgebmdnj';
// Identify this extension specifically, so the server can tell which tool is
// asking. Asking as 'cleanmysocial' means any purchase unlocks everything.
const LICENSE_API = 'https://cleanmysocial.com/api/license?extension=facebook-messenger-cleaner&key=';
const LICENSE_KEY_STORAGE = 'cms.entitlement.identity';
const DAILY_USAGE_STORAGE = 'cms.entitlement.dailyMeter';
const LICENSE_CACHE_STORAGE = 'cms.entitlement.verificationCache';
const LEGACY_LICENSE_KEY_STORAGE = 'verblike_license_key';
const LEGACY_DAILY_USAGE_STORAGE = 'messenger_cleaner_daily_usage';
const LEGACY_LICENSE_CACHE_STORAGE = 'messenger_cleaner_license_cache';
const FACEBOOK_PREFS_STORAGE = 'cms.facebook.preferences';
const DAILY_LIMIT = 20;
const LICENSE_CACHE_TTL = 5 * 60 * 1000;
let usageQueue = Promise.resolve();
const meteredReservations = new Map();

const LEGACY_COMMANDS = {
  GET_ACTIVE_TAB: 'cms.context.active.read',
  OPEN_MESSENGER: 'cms.navigation.messenger.open',
  GET_ACCESS_STATE: 'cms.entitlement.state.read',
  CHECK_LICENSE: 'cms.entitlement.license.verify',
  RECORD_METERED_ACTION: 'cms.entitlement.usage.reserve',
  OPEN_PURCHASE: 'cms.commerce.checkout.open',
  OPEN_REVIEW: 'cms.feedback.review.open',
  PAGE_STATE: 'cms.facebook.page.state',
  OPERATION_STATE: 'cms.facebook.operation.state'
};

function normalizeCommand(message) {
  const type = LEGACY_COMMANDS[message?.type] || message?.type;
  return type === message?.type ? message : { ...message, type };
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.sidePanel.setOptions({ path: 'src/panel/facebook.html', enabled: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.sidePanel.setOptions({ path: 'src/panel/facebook.html', enabled: true });
  const existing = await chrome.storage.local.get(FACEBOOK_PREFS_STORAGE);
  if (!existing[FACEBOOK_PREFS_STORAGE]) {
    await chrome.storage.local.set({ [FACEBOOK_PREFS_STORAGE]: { speed: 'normal' } });
  }
  await getLicenseKey();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  await chrome.sidePanel.setOptions({ path: 'src/panel/facebook.html', enabled: true }).catch(() => {});
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
  const stored = await chrome.storage.sync.get([LICENSE_KEY_STORAGE, LEGACY_LICENSE_KEY_STORAGE]);
  if (stored[LICENSE_KEY_STORAGE]) return stored[LICENSE_KEY_STORAGE];
  if (stored[LEGACY_LICENSE_KEY_STORAGE]) {
    await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: stored[LEGACY_LICENSE_KEY_STORAGE] });
    await chrome.storage.sync.remove(LEGACY_LICENSE_KEY_STORAGE);
    return stored[LEGACY_LICENSE_KEY_STORAGE];
  }
  const key = createLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: key });
  return key;
}

async function setLicenseKey(key) {
  const cleaned = String(key || '').trim();
  if (!cleaned) return getLicenseKey();
  await chrome.storage.sync.set({ [LICENSE_KEY_STORAGE]: cleaned });
  await chrome.storage.sync.remove(LEGACY_LICENSE_KEY_STORAGE);
  await chrome.storage.local.remove([LICENSE_CACHE_STORAGE, LEGACY_LICENSE_CACHE_STORAGE]);
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
  const stored = await chrome.storage.local.get([DAILY_USAGE_STORAGE, LEGACY_DAILY_USAGE_STORAGE]);
  const usage = stored[DAILY_USAGE_STORAGE] || stored[LEGACY_DAILY_USAGE_STORAGE];
  if (usage?.date === today && Number.isFinite(usage.count)) {
    if (!stored[DAILY_USAGE_STORAGE]) {
      await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: usage });
      await chrome.storage.local.remove(LEGACY_DAILY_USAGE_STORAGE);
    }
    return { date: today, count: Math.max(0, Math.min(DAILY_LIMIT, usage.count)) };
  }
  const fresh = { date: today, count: 0 };
  await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: fresh });
  await chrome.storage.local.remove(LEGACY_DAILY_USAGE_STORAGE);
  return fresh;
}

async function checkLicense({ force = false, key: suppliedKey } = {}) {
  const key = suppliedKey ? await setLicenseKey(suppliedKey) : await getLicenseKey();
  const stored = await chrome.storage.local.get([LICENSE_CACHE_STORAGE, LEGACY_LICENSE_CACHE_STORAGE]);
  const cache = stored[LICENSE_CACHE_STORAGE] || stored[LEGACY_LICENSE_CACHE_STORAGE];
  if (!stored[LICENSE_CACHE_STORAGE] && cache) {
    await chrome.storage.local.set({ [LICENSE_CACHE_STORAGE]: cache });
    await chrome.storage.local.remove(LEGACY_LICENSE_CACHE_STORAGE);
  }
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
    platform: 'facebook',
    licenseKey: license.key,
    used: usage.count,
    limit: DAILY_LIMIT,
    remaining: license.active ? null : Math.max(0, DAILY_LIMIT - usage.count),
    date: usage.date,
    licenseError: license.error || ''
  };
}

function broadcastAccessState(state) {
  chrome.runtime.sendMessage({ type: 'cms.entitlement.state.changed', access: { ...state, platform: 'facebook' } }).catch(() => {});
}

function reserveUsageSlot() {
  const task = usageQueue.then(async () => {
    const access = await getAccessState();
    if (access.unlimited) return { allowed: true, access, reservationId: null };
    if (access.used >= DAILY_LIMIT) return { allowed: false, access };

    const nextUsage = { date: localDateKey(), count: access.used + 1 };
    await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: nextUsage });
    const reservationId = crypto.randomUUID?.() || `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    meteredReservations.set(reservationId, { date: nextUsage.date });
    const nextAccess = {
      ...access,
      used: nextUsage.count,
      remaining: Math.max(0, DAILY_LIMIT - nextUsage.count),
      date: nextUsage.date
    };
    broadcastAccessState(nextAccess);
    return { allowed: true, access: nextAccess, reservationId };
  });
  usageQueue = task.catch(() => {});
  return task;
}

function releaseUsageSlot(reservationId) {
  if (!reservationId) return Promise.resolve({ released: false });
  const task = usageQueue.then(async () => {
    const reservation = meteredReservations.get(reservationId);
    if (!reservation) return { released: false };
    meteredReservations.delete(reservationId);
    const usage = await getDailyUsage();
    if (usage.date !== reservation.date) return { released: false };
    await chrome.storage.local.set({ [DAILY_USAGE_STORAGE]: { ...usage, count: Math.max(0, usage.count - 1) } });
    const access = await getAccessState();
    broadcastAccessState(access);
    return { released: true, access };
  });
  usageQueue = task.catch(() => {});
  return task;
}

function publishTabState(tab, reason) {
  if (!tab?.id) return;
  chrome.runtime.sendMessage({
    type: 'cms.context.active.changed',
    reason,
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      active: tab.active,
      title: tab.title || '',
      url: tab.url || '',
      status: tab.status || '',
      platform: 'facebook',
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
  const command = normalizeCommand(message);
  if (command.type === 'cms.context.active.read') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => sendResponse({
        tab: tab ? {
          id: tab.id,
          windowId: tab.windowId,
          active: tab.active,
          title: tab.title || '',
          url: tab.url || '',
          status: tab.status || '',
          platform: 'facebook',
          supported: isMessengerUrl(tab.url)
        } : null
      }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (command.type === 'cms.navigation.messenger.open') {
    chrome.tabs.create({ url: MESSENGER_URL })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.entitlement.state.read') {
    getAccessState()
      .then(access => sendResponse({ ok: true, access }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.entitlement.license.verify') {
    getAccessState({ force: true, key: command.licenseKey })
      .then(access => {
        broadcastAccessState(access);
        sendResponse({ ok: true, access });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.entitlement.usage.reserve') {
    reserveUsageSlot()
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.entitlement.usage.release') {
    releaseUsageSlot(command.reservationId)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.commerce.checkout.open') {
    getLicenseKey().then(key => {
      const url = new URL(PURCHASE_URL);
      url.searchParams.set('lk', key);
      return chrome.tabs.create({ url: url.toString() });
    }).then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.feedback.review.open') {
    chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${REVIEW_EXTENSION_ID}/reviews` })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (command.type === 'cms.companion.open') {
    chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${FRIENDS_REMOVER_EXTENSION_ID}` })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if ((command.type === 'cms.facebook.page.state' || command.type === 'cms.facebook.operation.state') && sender.tab?.id) {
    const payload = { ...command, tabId: sender.tab.id };
    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  return false;
});
