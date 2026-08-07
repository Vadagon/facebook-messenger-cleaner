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
  upgradeDialog: document.querySelector('#upgradeDialog'),
  upgradeTitle: document.querySelector('#upgradeTitle'),
  upgradeDescription: document.querySelector('#upgradeDescription'),
  purchaseButton: document.querySelector('#purchaseButton'),
  licenseInput: document.querySelector('#licenseInput'),
  unlockButton: document.querySelector('#unlockButton'),
  licenseMessage: document.querySelector('#licenseMessage'),
  reviewDialog: document.querySelector('#reviewDialog'),
  reviewButton: document.querySelector('#reviewButton'),
  extensionVersion: document.querySelector('#extensionVersion')
};

let activeTab = null;
let page = null;
let activeOperation = null;
let refreshGeneration = 0;
let accessState = { unlimited: false, used: 0, limit: 10, remaining: 10 };
let licensePoll = null;
let reviewPromptedForBatch = false;
let reviewCheckInFlight = false;
const REVIEW_OPENED_KEY = 'messenger-cleaner-review-opened';

function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = t(element.dataset.i18n);
    if (message) element.textContent = message;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(element => {
    const message = t(element.dataset.i18nAria);
    if (message) element.setAttribute('aria-label', message);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const message = t(element.dataset.i18nPlaceholder);
    if (message) element.setAttribute('placeholder', message);
  });
}

function setStep(element, mode) {
  element.classList.remove('step-disabled', 'step-active', 'step-done');
  element.classList.add(`step-${mode}`);
}

function operationName(operation) {
  return ({ delete: t('deleteAll'), archive: t('archiveAll'), unarchive: t('restoreAll') })[operation] || t('ready');
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  ui.speedSelect.value = settings?.speed || 'normal';
}

async function refresh() {
  const generation = ++refreshGeneration;
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_TAB' }).catch(() => null);
  if (generation !== refreshGeneration) return;
  activeTab = response?.tab || null;
  page = null;

  if (activeTab?.supported) {
    try {
      page = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_STATE' });
    } catch {
      page = null;
    }
  }
  if (generation !== refreshGeneration) return;
  render();
}

async function refreshAccess(force = false, licenseKey) {
  const type = force ? 'CHECK_LICENSE' : 'GET_ACCESS_STATE';
  const response = await chrome.runtime.sendMessage({ type, licenseKey }).catch(() => null);
  if (response?.ok && response.access) {
    accessState = response.access;
    renderAccess();
  }
  return accessState;
}

function render() {
  renderAccess();
  const supported = Boolean(activeTab?.supported);
  ui.unsupportedView.hidden = supported;
  ui.controlsView.hidden = !supported;
  ui.contextDot.classList.toggle('online', supported && Boolean(page));
  ui.contextTitle.textContent = supported
    ? (page ? t('connectedToMessenger') : t('loadingMessenger'))
    : t('notOnMessenger');
  ui.contextUrl.textContent = activeTab?.url ? compactUrl(activeTab.url) : t('noActiveTab');

  if (supported && page) {
    setStep(ui.connectCard, 'done');
    ui.connectBadge.className = 'step-badge ok';
    ui.connectBadge.textContent = t('connected');
    setStep(ui.actionStep, 'active');
    ui.actionBadge.className = 'step-badge';
    ui.actionBadge.textContent = page.archived ? t('archivedView') : t('inboxView');
  } else {
    setStep(ui.connectCard, 'active');
    ui.connectBadge.className = 'step-badge waiting';
    ui.connectBadge.textContent = supported ? t('loading') : t('waiting');
    if (ui.actionStep) setStep(ui.actionStep, 'disabled');
    if (ui.runStep) setStep(ui.runStep, 'disabled');
  }

  if (!supported || !page) return;
  const operation = page?.operation || activeOperation;
  activeOperation = operation;
  renderOperation(operation);

  const running = Boolean(operation?.running);
  const archived = Boolean(page?.archived);
  for (const button of ui.actionButtons) {
    const op = button.dataset.operation;
    button.disabled = running || (op === 'archive' && archived) || (op === 'unarchive' && !archived) || !page;
    if (op === 'unarchive') button.title = archived ? '' : t('openArchivedTooltip');
    if (op === 'archive') button.title = archived ? t('archiveUnavailableTooltip') : '';
  }
  if (running) {
    setStep(ui.actionStep, 'done');
    ui.actionBadge.className = 'step-badge ok';
    ui.actionBadge.textContent = operationName(operation.operation);
  }
}

function renderOperation(operation) {
  const terminal = ['done', 'stopped', 'error', 'limit'].includes(operation?.status);
  const busy = Boolean(operation?.running && !terminal);
  const meteredOperationRunning = busy && ['delete', 'archive'].includes(operation?.operation);
  ui.statusSpinner.hidden = !busy;
  ui.statusReadyIcon.hidden = busy;
  ui.stopButton.hidden = !busy;
  ui.speedSelect.disabled = busy;
  ui.quotaCard.classList.toggle('active', busy && ['delete', 'archive'].includes(operation?.operation));
  ui.quotaCard.hidden = accessState.unlimited || !meteredOperationRunning;

  if (!operation || operation.status === 'ready') {
    setStep(ui.runStep, 'disabled');
    ui.runBadge.className = 'step-badge waiting';
    ui.runBadge.textContent = t('waiting');
    ui.statusKicker.textContent = t('ready');
    ui.statusMessage.textContent = t('chooseAction');
    return;
  }
  if (operation.status === 'done') {
    setStep(ui.runStep, 'done');
    ui.runBadge.className = 'step-badge ok';
    ui.runBadge.textContent = t('complete');
  } else {
    setStep(ui.runStep, 'active');
    ui.runBadge.className = operation.status === 'running' ? 'step-badge' : 'step-badge waiting';
    ui.runBadge.textContent = ({
      running: t('working'), paused: t('paused'), stopped: t('stopped'),
      error: t('error'), limit: t('freePlanLimit')
    })[operation.status] || t('working');
  }
  ui.statusKicker.textContent = ({
    running: t('working'), paused: t('paused'), done: t('complete'),
    stopped: t('stopped'), error: t('error'), limit: t('freePlanLimit')
  })[operation.status] || t('status');
  ui.statusMessage.textContent = operation.message || t('working');
  if (operation.status === 'limit') openUpgrade(true);
  if (operation.status === 'done') maybeAskForReview(operation);
}

async function maybeAskForReview(operation) {
  if (reviewCheckInFlight || reviewPromptedForBatch || operation.processed < 1) return;
  reviewCheckInFlight = true;
  try {
    const stored = await chrome.storage.local.get(REVIEW_OPENED_KEY);
    if (stored[REVIEW_OPENED_KEY]) return;
    reviewPromptedForBatch = true;
    setTimeout(() => {
      if (!ui.upgradeDialog.open && !ui.reviewDialog.open) ui.reviewDialog.showModal();
    }, 450);
  } finally {
    reviewCheckInFlight = false;
  }
}

function renderAccess() {
  const limit = accessState.limit || 10;
  const used = Math.min(limit, Math.max(0, accessState.used || 0));
  ui.accessBadge.textContent = accessState.unlimited ? t('unlimitedBadge') : t('getUnlimited');
  ui.accessBadge.classList.toggle('unlimited', accessState.unlimited);
  ui.accessBadge.disabled = accessState.unlimited;
  const operation = page?.operation || activeOperation;
  const meteredOperationRunning = Boolean(
    operation?.running && ['delete', 'archive'].includes(operation?.operation)
  );
  ui.quotaCard.hidden = accessState.unlimited || !meteredOperationRunning;
  ui.quotaCount.textContent = `${used}/${limit}`;
  ui.quotaFill.style.width = `${Math.min(100, (used / limit) * 100)}%`;
  ui.quotaCard.classList.toggle('limit', used >= limit);
}

function openUpgrade(limitReached = false) {
  if (accessState.unlimited) return;
  ui.upgradeTitle.textContent = limitReached ? t('dailyLimitTitle') : t('upgradeTitle');
  ui.upgradeDescription.textContent = limitReached ? t('dailyLimitDescription') : t('upgradeDescription');
  ui.licenseMessage.textContent = '';
  ui.licenseMessage.className = 'license-message';
  if (!ui.upgradeDialog.open) ui.upgradeDialog.showModal();
}

function startLicensePolling() {
  if (licensePoll) return;
  licensePoll = setInterval(async () => {
    const access = await refreshAccess(true);
    if (access.unlimited) {
      clearInterval(licensePoll);
      licensePoll = null;
      ui.licenseMessage.textContent = t('licenseActivated');
      ui.licenseMessage.className = 'license-message success';
      setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
    }
  }, 4000);
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function startOperation(operation) {
  if (!activeTab?.supported || !page) return;
  if (['delete', 'archive'].includes(operation)) {
    const access = await refreshAccess();
    if (!access.unlimited && access.remaining <= 0) {
      openUpgrade(true);
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

  reviewPromptedForBatch = false;

  const response = await chrome.tabs.sendMessage(activeTab.id, {
    type: 'START_OPERATION',
    operation,
    speed: ui.speedSelect.value
  }).catch(error => ({ ok: false, error: error.message }));

  if (!response?.ok) {
    activeOperation = { status: 'error', message: response?.error || t('startFailed'), running: false };
    renderOperation(activeOperation);
    return;
  }
  activeOperation = { running: true, operation, processed: 0, status: 'running', message: t('starting') };
  render();
}

ui.actionButtons.forEach(button => button.addEventListener('click', () => startOperation(button.dataset.operation)));
ui.openMessengerButton.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_MESSENGER' }));
ui.refreshButton.addEventListener('click', refresh);
ui.accessBadge.addEventListener('click', () => openUpgrade(false));
ui.upgradeButton.addEventListener('click', () => openUpgrade(false));
ui.purchaseButton.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_PURCHASE' });
  startLicensePolling();
});
ui.reviewButton.addEventListener('click', async () => {
  await chrome.storage.local.set({ [REVIEW_OPENED_KEY]: true });
  await chrome.runtime.sendMessage({ type: 'OPEN_REVIEW' });
  ui.reviewDialog.close();
});
ui.unlockButton.addEventListener('click', async () => {
  const key = ui.licenseInput.value.trim();
  if (!key) return;
  ui.unlockButton.disabled = true;
  ui.licenseMessage.textContent = t('checkingLicense');
  ui.licenseMessage.className = 'license-message';
  const access = await refreshAccess(true, key);
  ui.unlockButton.disabled = false;
  if (access.unlimited) {
    ui.licenseMessage.textContent = t('licenseActivated');
    ui.licenseMessage.className = 'license-message success';
    setTimeout(() => ui.upgradeDialog.open && ui.upgradeDialog.close(), 700);
  } else {
    ui.licenseMessage.textContent = t('licenseInvalid');
    ui.licenseMessage.className = 'license-message error';
  }
});
ui.stopButton.addEventListener('click', async () => {
  if (!activeTab?.id) return;
  await chrome.tabs.sendMessage(activeTab.id, { type: 'STOP_OPERATION' }).catch(() => {});
});
ui.confirmCheckbox.addEventListener('change', () => {
  ui.confirmDeleteButton.disabled = !ui.confirmCheckbox.checked;
});
ui.speedSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ settings: { speed: ui.speedSelect.value } });
});

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'ACTIVE_TAB_CHANGED') {
    if (message.tab?.active) refresh();
    return;
  }
  if (message.type === 'PAGE_STATE' && message.tabId === activeTab?.id) {
    page = message;
    activeOperation = message.operation;
    render();
    return;
  }
  if (message.type === 'OPERATION_STATE' && message.tabId === activeTab?.id) {
    activeOperation = message;
    if (page) page.operation = message;
    render();
    return;
  }
  if (message.type === 'ACCESS_STATE_CHANGED' && message.access) {
    accessState = message.access;
    renderAccess();
    if (!accessState.unlimited && accessState.used >= accessState.limit) openUpgrade(true);
  }
});

localize();
ui.extensionVersion.textContent = `v${chrome.runtime.getManifest().version}`;
loadSettings();
refreshAccess();
refresh();
