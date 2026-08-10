const ui = {
  contextDot: document.querySelector('#contextDot'),
  contextTitle: document.querySelector('#contextTitle'),
  contextUrl: document.querySelector('#contextUrl'),
  refreshButton: document.querySelector('#refreshButton'),
  unsupportedView: document.querySelector('#unsupportedView'),
  controlsView: document.querySelector('#controlsView'),
  openMessengerButton: document.querySelector('#openMessengerButton'),
  connectCard: document.querySelector('#connectCard'),
  connectBadge: document.querySelector('#connectBadge'),
  actionStep: document.querySelector('#actionStep'),
  actionBadge: document.querySelector('#actionBadge'),
  runStep: document.querySelector('#runStep'),
  runBadge: document.querySelector('#runBadge'),
  statusKicker: document.querySelector('#statusKicker'),
  statusMessage: document.querySelector('#statusMessage'),
  statusSpinner: document.querySelector('#statusSpinner'),
  statusReadyIcon: document.querySelector('#statusReadyIcon'),
  stopButton: document.querySelector('#stopButton'),
  accessBadge: document.querySelector('#accessBadge'),
  quotaCard: document.querySelector('#quotaCard'),
  quotaCount: document.querySelector('#quotaCount'),
  quotaFill: document.querySelector('#quotaFill'),
  upgradeButton: document.querySelector('#upgradeButton'),
  speedSelect: document.querySelector('#speedSelect'),
  actionButtons: [...document.querySelectorAll('[data-operation]')],
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmCheckbox: document.querySelector('#confirmCheckbox'),
  confirmDeleteButton: document.querySelector('#confirmDeleteButton'),
  milestoneDialog: document.querySelector('#milestoneDialog'),
  milestoneHeading: document.querySelector('#milestoneHeading'),
  milestoneCopy: document.querySelector('#milestoneCopy'),
  milestoneDismiss: document.querySelector('#milestoneDismiss'),
  milestoneReview: document.querySelector('#milestoneReview'),
  upgradeDialog: document.querySelector('#upgradeDialog'),
  upgradeTitle: document.querySelector('#upgradeTitle'),
  upgradeDescription: document.querySelector('#upgradeDescription'),
  purchaseButton: document.querySelector('#purchaseButton'),
  licenseInput: document.querySelector('#licenseInput'),
  unlockButton: document.querySelector('#unlockButton'),
  licenseMessage: document.querySelector('#licenseMessage'),
  fbReviewEntry: document.querySelector('#fbReviewEntry'),
  fbCompanionOffer: document.querySelector('#fbCompanionOffer'),
  extensionVersion: document.querySelector('#extensionVersion')
};

let activeTab = null;
let page = null;
let activeOperation = null;
let refreshGeneration = 0;
let accessState = { unlimited: false, platform: 'facebook', used: 0, limit: 20, remaining: 20 };
let licensePoll = null;
const MILESTONES = [10, 50, 100, 500, 1000];
const celebratedMilestones = new Set();
const celebrationQueue = [];
let celebrationOpen = false;
const REVIEW_STATE_KEY = 'cms.feedback.reviewClicked';
const LEGACY_REVIEW_STATE_KEY = 'messenger-cleaner-review-opened';
const FACEBOOK_PREFS_KEY = 'cms.facebook.preferences';
const LEGACY_FACEBOOK_PREFS_KEY = 'settings';

function i18nText(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function i18nFacebookLimitText(key) {
  return i18nText(key).replace(/10|العشرة/g, String(accessState.limit || 20));
}

function applyLocaleCatalog() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = i18nText(element.dataset.i18n);
    if (message) element.textContent = message;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const message = i18nText(element.dataset.i18nAria);
    if (message) element.setAttribute('aria-label', message);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const message = i18nText(element.dataset.i18nPlaceholder);
    if (message) element.setAttribute('placeholder', message);
  });
}

function paintStepState(element, mode) {
  element.classList.remove('step-disabled', 'step-active', 'step-done');
  element.classList.add(`step-${mode}`);
}

function operationName(operation) {
  return ({ delete: i18nText('deleteAll'), archive: i18nText('archiveAll'), unarchive: i18nText('restoreAll') })[operation] || i18nText('ready');
}

function enqueueFacebookMilestone(operation) {
  if (operation?.operation !== 'delete' || !operation.operationId) return;
  for (const milestone of MILESTONES) {
    const key = `${operation.operationId}:${milestone}`;
    if ((operation.processed || 0) >= milestone && !celebratedMilestones.has(key)) {
      celebratedMilestones.add(key);
      celebrationQueue.push(milestone);
    }
  }
  presentFacebookMilestone();
}

function presentFacebookMilestone() {
  if (celebrationOpen || !celebrationQueue.length) return;
  const milestone = celebrationQueue.shift();
  celebrationOpen = true;
  ui.milestoneHeading.textContent = i18nText('milestoneTitle');
  ui.milestoneCopy.textContent = i18nText('fbMilestoneMessage', [String(milestone)]);
  ui.milestoneDialog.showModal();
}

async function hydrateFacebookPreferences() {
  const stored = await chrome.storage.local.get([FACEBOOK_PREFS_KEY, LEGACY_FACEBOOK_PREFS_KEY]);
  const preferences = stored[FACEBOOK_PREFS_KEY] || stored[LEGACY_FACEBOOK_PREFS_KEY] || {};
  ui.speedSelect.value = preferences.speed || 'normal';
  if (!stored[FACEBOOK_PREFS_KEY] && stored[LEGACY_FACEBOOK_PREFS_KEY]) {
    await chrome.storage.local.set({ [FACEBOOK_PREFS_KEY]: preferences });
    await chrome.storage.local.remove(LEGACY_FACEBOOK_PREFS_KEY);
  }
}

async function dispatchMessengerCommand(payload, legacyType) {
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, payload);
    if (response !== undefined) return response;
  } catch (_) {}
  if (!legacyType) return null;
  return chrome.tabs.sendMessage(activeTab.id, { ...payload, type: legacyType }).catch(() => null);
}

async function synchronizeFacebookPanel() {
  const generation = ++refreshGeneration;
  const response = await chrome.runtime.sendMessage({ type: 'cms.context.active.read' }).catch(() => null);
  if (generation !== refreshGeneration) return;
  activeTab = response?.tab || null;
  page = null;

  if (activeTab?.supported) {
    page = await dispatchMessengerCommand({ type: 'cms.facebook.page.read' }, 'GET_PAGE_STATE');
  }
  if (generation !== refreshGeneration) return;
  paintFacebookPanel();
}

async function synchronizeFacebookEntitlement(force = false, licenseKey) {
  const type = force ? 'cms.entitlement.license.verify' : 'cms.entitlement.state.read';
  const response = await chrome.runtime.sendMessage({ type, licenseKey, platform: 'facebook' }).catch(() => null);
  if (response?.ok && response.access) {
    accessState = response.access;
    paintFacebookMeter();
  }
  return accessState;
}

function paintFacebookPanel() {
  paintFacebookMeter();
  const supported = Boolean(activeTab?.supported);
  ui.unsupportedView.hidden = supported;
  ui.controlsView.hidden = !supported;
  ui.contextDot.classList.toggle('online', supported && Boolean(page));
  ui.contextTitle.textContent = supported
    ? (page ? i18nText('connectedToMessenger') : i18nText('loadingMessenger'))
    : i18nText('notOnMessenger');
  ui.contextUrl.textContent = activeTab?.url ? shortenTabAddress(activeTab.url) : i18nText('noActiveTab');

  if (supported && page) {
    paintStepState(ui.connectCard, 'done');
    ui.connectBadge.className = 'step-badge ok';
    ui.connectBadge.textContent = i18nText('connected');
    paintStepState(ui.actionStep, 'active');
    ui.actionBadge.className = 'step-badge';
    ui.actionBadge.textContent = page.archived ? i18nText('archivedView') : i18nText('inboxView');
  } else {
    paintStepState(ui.connectCard, 'active');
    ui.connectBadge.className = 'step-badge waiting';
    ui.connectBadge.textContent = supported ? i18nText('loading') : i18nText('waiting');
    if (ui.actionStep) paintStepState(ui.actionStep, 'disabled');
    if (ui.runStep) paintStepState(ui.runStep, 'disabled');
  }

  if (!supported || !page) return;
  const operation = page?.operation || activeOperation;
  activeOperation = operation;
  paintOperationState(operation);

  const running = Boolean(operation?.running);
  const archived = Boolean(page?.archived);
  for (const button of ui.actionButtons) {
    const op = button.dataset.operation;
    button.disabled = running || (op === 'archive' && archived) || (op === 'unarchive' && !archived) || !page;
    if (op === 'unarchive') button.title = archived ? '' : i18nText('openArchivedTooltip');
    if (op === 'archive') button.title = archived ? i18nText('archiveUnavailableTooltip') : '';
  }
  if (running) {
    paintStepState(ui.actionStep, 'done');
    ui.actionBadge.className = 'step-badge ok';
    ui.actionBadge.textContent = operationName(operation.operation);
  }
}

function paintOperationState(operation) {
  const terminal = ['done', 'stopped', 'error', 'limit'].includes(operation?.status);
  const busy = Boolean(operation?.running && !terminal);
  const meteredOperationRunning = busy && ['delete', 'archive', 'unarchive'].includes(operation?.operation);
  ui.statusSpinner.hidden = !busy;
  ui.statusReadyIcon.hidden = busy;
  ui.stopButton.hidden = !busy;
  ui.speedSelect.disabled = busy;
  ui.quotaCard.classList.toggle('active', busy && ['delete', 'archive', 'unarchive'].includes(operation?.operation));
  ui.quotaCard.hidden = accessState.unlimited || !meteredOperationRunning;

  if (!operation || operation.status === 'ready') {
    paintStepState(ui.runStep, 'disabled');
    ui.runBadge.className = 'step-badge waiting';
    ui.runBadge.textContent = i18nText('waiting');
    ui.statusKicker.textContent = i18nText('ready');
    ui.statusMessage.textContent = i18nText('chooseAction');
    return;
  }
  if (operation.status === 'done') {
    paintStepState(ui.runStep, 'done');
    ui.runBadge.className = 'step-badge ok';
    ui.runBadge.textContent = i18nText('complete');
  } else {
    paintStepState(ui.runStep, 'active');
    ui.runBadge.className = operation.status === 'running' ? 'step-badge' : 'step-badge waiting';
    ui.runBadge.textContent = ({
      running: i18nText('working'), paused: i18nText('paused'), stopped: i18nText('stopped'),
      error: i18nText('error'), limit: i18nText('freePlanLimit')
    })[operation.status] || i18nText('working');
  }
  ui.statusKicker.textContent = ({
    running: i18nText('working'), paused: i18nText('paused'), done: i18nText('complete'),
    stopped: i18nText('stopped'), error: i18nText('error'), limit: i18nText('freePlanLimit')
  })[operation.status] || i18nText('status');
  ui.statusMessage.textContent = operation.message || i18nText('working');
  if (operation.status === 'limit') presentFacebookUpgrade(true);
  enqueueFacebookMilestone(operation);
}

async function paintFacebookCompanionOffer() {
  const stored = await chrome.storage.local.get([REVIEW_STATE_KEY, LEGACY_REVIEW_STATE_KEY]);
  const opened = Boolean(stored[REVIEW_STATE_KEY] || stored[LEGACY_REVIEW_STATE_KEY]);
  if (!stored[REVIEW_STATE_KEY] && opened) {
    await chrome.storage.local.set({ [REVIEW_STATE_KEY]: true });
    await chrome.storage.local.remove(LEGACY_REVIEW_STATE_KEY);
  }
  ui.fbReviewEntry.hidden = opened;
  ui.fbCompanionOffer.hidden = !opened;
}

async function openFacebookReview() {
  await chrome.storage.local.set({ [REVIEW_STATE_KEY]: true });
  await chrome.storage.local.remove(LEGACY_REVIEW_STATE_KEY);
  await paintFacebookCompanionOffer();
  await chrome.runtime.sendMessage({ type: 'cms.feedback.review.open', platform: 'facebook' });
}

function paintFacebookMeter() {
  const limit = accessState.limit || 20;
  const used = Math.min(limit, Math.max(0, accessState.used || 0));
  ui.accessBadge.textContent = accessState.unlimited ? i18nText('unlimitedBadge') : i18nText('getUnlimited');
  ui.accessBadge.classList.toggle('unlimited', accessState.unlimited);
  ui.accessBadge.disabled = accessState.unlimited;
  const operation = page?.operation || activeOperation;
  const meteredOperationRunning = Boolean(
    operation?.running && ['delete', 'archive', 'unarchive'].includes(operation?.operation)
  );
  ui.quotaCard.hidden = accessState.unlimited || !meteredOperationRunning;
  ui.quotaCount.textContent = `${used}/${limit}`;
  ui.quotaFill.style.width = `${Math.min(100, (used / limit) * 100)}%`;
  ui.quotaCard.classList.toggle('limit', used >= limit);
}

function presentFacebookUpgrade(limitReached = false) {
  if (accessState.unlimited) return;
  ui.upgradeTitle.textContent = limitReached ? i18nFacebookLimitText('dailyLimitTitle') : i18nText('upgradeTitle');
  ui.upgradeDescription.textContent = limitReached ? i18nText('fbDailyLimitDescription') : i18nText('upgradeDescription');
  ui.licenseMessage.textContent = '';
  ui.licenseMessage.className = 'license-message';
  if (!ui.upgradeDialog.open) ui.upgradeDialog.showModal();
}

function monitorFacebookLicense() {
  if (licensePoll) return;
  licensePoll = setInterval(async () => {
    const access = await synchronizeFacebookEntitlement(true);
    if (access.unlimited) {
      clearInterval(licensePoll);
      licensePoll = null;
      ui.licenseMessage.textContent = i18nText('licenseActivated');
      ui.licenseMessage.className = 'license-message success';
      setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
    }
  }, 4000);
}

function shortenTabAddress(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function launchFacebookOperation(operation) {
  if (!activeTab?.supported || !page) return;
  if (['delete', 'archive', 'unarchive'].includes(operation)) {
    const access = await synchronizeFacebookEntitlement();
    if (!access.unlimited && access.remaining <= 0) {
      presentFacebookUpgrade(true);
      return;
    }
  }
  if (operation === 'delete') {
    ui.confirmCheckbox.checked = false;
    ui.confirmDeleteButton.disabled = true;
    ui.confirmDialog.showModal();
    const result = await new Promise(resolve => {
      ui.confirmDialog.addEventListener('close', () => resolve(ui.confirmDialog.returnValue), { once: true });
    });
    if (result !== 'confirm') return;
  }

  const response = await dispatchMessengerCommand({
    type: 'cms.facebook.operation.start',
    operation,
    speed: ui.speedSelect.value
  }, 'START_OPERATION') || { ok: false, error: i18nText('startFailed') };

  if (!response?.ok) {
    activeOperation = { status: 'error', message: response?.error || i18nText('startFailed'), running: false };
    paintOperationState(activeOperation);
    return;
  }
  activeOperation = { running: true, operation, processed: 0, status: 'running', message: i18nText('starting') };
  paintFacebookPanel();
}

ui.actionButtons.forEach(button => button.addEventListener('click', () => launchFacebookOperation(button.dataset.operation)));
ui.openMessengerButton.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cms.navigation.messenger.open' }));
ui.refreshButton.addEventListener('click', synchronizeFacebookPanel);
ui.accessBadge.addEventListener('click', () => presentFacebookUpgrade(false));
ui.upgradeButton.addEventListener('click', () => presentFacebookUpgrade(false));
ui.purchaseButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'cms.commerce.checkout.open' });
  monitorFacebookLicense();
});
ui.fbReviewEntry.addEventListener('click', openFacebookReview);
ui.milestoneDialog.addEventListener('close', async () => {
  const leaveReview = ui.milestoneDialog.returnValue === 'review';
  celebrationOpen = false;
  if (leaveReview) await openFacebookReview();
  presentFacebookMilestone();
});
ui.fbCompanionOffer.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cms.companion.open', platform: 'facebook' }));
ui.unlockButton.addEventListener('click', async () => {
  const key = ui.licenseInput.value.trim();
  if (!key) return;
  ui.unlockButton.disabled = true;
  ui.licenseMessage.textContent = i18nText('checkingLicense');
  ui.licenseMessage.className = 'license-message';
  const access = await synchronizeFacebookEntitlement(true, key);
  ui.unlockButton.disabled = false;
  if (access.unlimited) {
    ui.licenseMessage.textContent = i18nText('licenseActivated');
    ui.licenseMessage.className = 'license-message success';
    setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
  } else {
    ui.licenseMessage.textContent = i18nText('licenseInvalid');
    ui.licenseMessage.className = 'license-message error';
  }
});
ui.stopButton.addEventListener('click', async () => {
  if (!activeTab?.id) return;
  await dispatchMessengerCommand({ type: 'cms.facebook.operation.stop' }, 'STOP_OPERATION');
});
ui.confirmCheckbox.addEventListener('change', () => {
  ui.confirmDeleteButton.disabled = !ui.confirmCheckbox.checked;
});
ui.speedSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ [FACEBOOK_PREFS_KEY]: { speed: ui.speedSelect.value } });
});

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'cms.context.active.changed') {
    if (!message.tab?.active) return;
    synchronizeFacebookPanel();
    return;
  }
  if (message.type === 'cms.facebook.page.state' && message.tabId === activeTab?.id) {
    page = message;
    activeOperation = message.operation;
    paintFacebookPanel();
    return;
  }
  if (message.type === 'cms.facebook.operation.state' && message.tabId === activeTab?.id) {
    activeOperation = message;
    if (page) page.operation = message;
    paintFacebookPanel();
    return;
  }
  if (message.type === 'cms.entitlement.state.changed' && message.access?.platform === 'facebook') {
    accessState = message.access;
    paintFacebookMeter();
    if (!accessState.unlimited && accessState.used >= accessState.limit) presentFacebookUpgrade(true);
  }
});

applyLocaleCatalog();
ui.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
paintFacebookCompanionOffer();
hydrateFacebookPreferences();
synchronizeFacebookEntitlement();
synchronizeFacebookPanel();
