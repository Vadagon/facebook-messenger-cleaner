(() => {
  if (globalThis.__cleanMySocialMessengerLoaded) return;
  globalThis.__cleanMySocialMessengerLoaded = true;

  const state = {
    running: false,
    operationId: null,
    operation: null,
    processed: 0,
    stopRequested: false,
    paused: document.hidden,
    status: 'ready',
    message: 'Ready',
    lastUrl: location.href,
    lastArchived: null,
    speed: 'normal'
  };

  const SPEED = { safe: 1.65, normal: 1, fast: 0.72 };
  const BASE_TIMING = {
    menu: 300,
    action: 240,
    confirm: 380,
    between: 220,
    scan: 500
  };

  const WORDS = {
    delete: [
      'delete', 'remove', 'erase', 'trash', 'supprimer', 'eliminar', 'borrar', 'löschen',
      'excluir', 'apagar', 'удалить', 'видалити', 'elimina', 'usuń', 'verwijderen',
      'sil', 'hapus', 'xóa', 'ลบ', '削除', '삭제', '删除', '刪除', 'حذف', 'حذف کردن', 'हटाएं'
    ],
    archive: [
      'archive', 'archiver', 'archivar', 'archivieren', 'arquivar', 'архивировать',
      'архівувати', 'archivia', 'archiwizuj', 'archiveren', 'arşivle', 'arsipkan',
      'lưu trữ', 'เก็บถาวร', 'アーカイブ', '보관', '归档', '封存', 'أرشفة', 'بایگانی', 'संग्रहीत'
    ],
    unarchive: [
      'unarchive', 'move to inbox', 'move back to inbox', 'inbox', 'restore',
      'désarchiver', 'déplacer vers la boîte de réception', 'boîte de réception', 'restaurer', 'desarchivar',
      'restaurar', 'wiederherstellen', 'aus archiv', 'разархивировать', 'восстановить',
      'розархівувати', 'ripristina', 'przywróć', 'dearchiveren', 'geri yükle',
      'pulihkan', 'khôi phục', 'คืนค่า', 'アーカイブ解除', '복원', '取消归档', '取消封存',
      'إلغاء الأرشفة', 'بازیابی', 'पुनर्स्थापित'
    ],
    confirmDelete: [
      'delete', 'delete chat', 'delete conversation', 'supprimer', 'eliminar', 'borrar',
      'löschen', 'excluir', 'удалить', 'видалити', 'elimina', 'usuń', 'verwijderen',
      'sil', 'hapus', 'xóa', 'ลบ', '削除', '삭제', '删除', '刪除', 'حذف', 'हटाएं'
    ]
  };

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const delay = key => Math.round(BASE_TIMING[key] * (SPEED[state.speed] || 1));

  class DailyLimitError extends Error {
    constructor() {
      super('Daily free limit reached. Get unlimited access to keep cleaning.');
      this.name = 'DailyLimitError';
    }
  }

  async function readFacebookEntitlement() {
    const response = await chrome.runtime.sendMessage({ type: 'cms.entitlement.state.read', platform: 'facebook' });
    if (!response?.ok || !response.access) throw new Error(response?.error || 'Could not check access.');
    return response.access;
  }

  async function assertFacebookQuota(operation) {
    if (!['delete', 'archive', 'unarchive'].includes(operation)) return null;
    const access = await readFacebookEntitlement();
    if (!access.unlimited && access.remaining <= 0) throw new DailyLimitError();
    return access;
  }

  async function reserveFacebookUsage(operation) {
    if (!['delete', 'archive', 'unarchive'].includes(operation)) return null;
    const response = await chrome.runtime.sendMessage({ type: 'cms.entitlement.usage.reserve', platform: 'facebook' });
    if (!response?.ok) throw new Error(response?.error || 'Could not reserve daily usage.');
    if (!response.allowed) throw new DailyLimitError();
    return response.reservationId || null;
  }

  async function releaseFacebookUsage(reservationId) {
    if (!reservationId) return;
    await chrome.runtime.sendMessage({ type: 'cms.entitlement.usage.release', reservationId }).catch(() => {});
  }

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function isArchivedPage() {
    const url = location.href.toLowerCase();
    if (url.includes('archived') || url.includes('archive_spam')) return true;

    const selectedArchiveLink = document.querySelector(
      'a[href*="archived" i][aria-current="page"], a[href*="archived" i][aria-selected="true"], ' +
      '[role="tab"][aria-selected="true"][aria-label*="archiv" i]'
    );
    if (selectedArchiveLink) return true;

    const archiveLabels = [
      'archived chats', 'archived threads', 'archived conversations', 'archives',
      'chats archivés', 'conversations archivées', 'chats archivados', 'conversaciones archivadas',
      'archivierte chats', 'chats arquivados', 'arquivadas', 'архивированные чаты',
      'архівовані чати', 'chat archiviate', 'zarchiwizowane czaty', 'gearchiveerde chats',
      'arşivlenmiş sohbetler', 'chat yang diarsipkan', 'đoạn chat đã lưu trữ',
      'แชทที่เก็บถาวร', 'アーカイブ済みのチャット', '보관된 채팅', '已归档的聊天',
      '已封存的聊天室', 'الدردشات المؤرشفة', 'گفتگوهای بایگانی‌شده', 'संग्रहीत चैट'
    ];
    const headings = document.querySelectorAll(
      'h1, h2, [role="heading"], [aria-label="Archived chats"], [aria-label="Archived threads"]'
    );
    return [...headings].some(element => {
      const text = normalizeControlText(element);
      return archiveLabels.some(label => text.includes(label));
    });
  }

  function snapshotMessengerPage() {
    return {
      type: 'cms.facebook.page.state',
      url: location.href,
      title: document.title,
      archived: isArchivedPage(),
      ready: document.readyState !== 'loading',
      operation: snapshotMessengerOperation()
    };
  }

  function snapshotMessengerOperation() {
    return {
      running: state.running,
      operationId: state.operationId,
      operation: state.operation,
      processed: state.processed,
      paused: state.paused,
      status: state.status,
      message: state.message
    };
  }

  function broadcastMessengerPage() {
    state.lastUrl = location.href;
    state.lastArchived = isArchivedPage();
    chrome.runtime.sendMessage(snapshotMessengerPage()).catch(() => {});
  }

  function broadcastMessengerOperation(status, message) {
    state.status = status;
    state.message = message;
    chrome.runtime.sendMessage({ type: 'cms.facebook.operation.state', ...snapshotMessengerOperation() }).catch(() => {});
  }

  function normalizeControlText(element) {
    return [element?.innerText, element?.textContent, element?.getAttribute?.('aria-label'), element?.title]
      .filter(Boolean).join(' ').trim().toLocaleLowerCase();
  }

  function matchesAnyPhrase(text, words) {
    return words.some(word => text.includes(word));
  }

  function collectConversationRows() {
    const selectors = [
      '[data-virtualized-list-anchor]',
      '[data-testid="mwthreadlist-item"]',
      '[data-testid="conversation_row"]',
      '[role="main"] [role="listitem"]',
      '[role="main"] [role="row"]'
    ];
    for (const selector of selectors) {
      const rows = [...document.querySelectorAll(selector)].filter(row => {
        const rect = row.getBoundingClientRect();
        return visible(row) && rect.height >= 35 && rect.height <= 220 && row.querySelector('a[href*="/t/"]');
      });
      if (rows.length) return rows;
    }

    const rows = new Set();
    for (const link of document.querySelectorAll('a[href*="/t/"]')) {
      let candidate = link.closest('[role="listitem"], [role="row"]') || link.parentElement;
      for (let depth = 0; candidate && depth < 5; depth += 1, candidate = candidate.parentElement) {
        const rect = candidate.getBoundingClientRect();
        if (visible(candidate) && rect.height >= 35 && rect.height <= 180 && rect.width > 180) {
          rows.add(candidate);
          break;
        }
      }
    }
    return [...rows];
  }

  function locateConversationScroller() {
    const named = document.querySelectorAll(
      '[aria-label*="Chats" i], [aria-label*="Archived" i], [data-testid="mwthreadlist-items"], [role="main"] [role="list"]'
    );
    for (const element of named) {
      if (element.scrollHeight > element.clientHeight + 50) return element;
    }
    let element = document.querySelector('a[href*="/t/"]');
    while (element && element !== document.body) {
      const overflow = getComputedStyle(element).overflowY;
      if (/auto|scroll|overlay/.test(overflow) && element.scrollHeight > element.clientHeight + 50) return element;
      element = element.parentElement;
    }
    return document.scrollingElement;
  }

  function locateRowMenuTrigger(row) {
    const labelled = row.querySelector(
      '[aria-label*="more" i], [aria-label*="option" i], [aria-label*="menu" i], [aria-haspopup="menu"]'
    );
    if (labelled) return labelled;
    for (const path of row.querySelectorAll('svg path')) {
      const d = path.getAttribute('d') || '';
      if (d.includes('M2.25 10a1.75') || d.includes('1.75 1.75')) {
        const button = path.closest('button, [role="button"]');
        if (button) return button;
      }
    }
    const buttons = [...row.querySelectorAll('button, [role="button"]')].filter(visible);
    return buttons.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0] || null;
  }

  function locateOpenContextMenu() {
    const candidates = document.querySelectorAll(
      '[role="menu"], [role="listbox"], [role="dialog"], [data-testid*="menu" i], [data-testid*="dropdown" i]'
    );
    return [...candidates].find(menu => visible(menu) && menu.querySelector('[role="menuitem"], [role="option"], button')) || null;
  }

  async function openConversationMenu(row) {
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await wait(80);
    const button = locateRowMenuTrigger(row);
    if (button) {
      button.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(35);
        const menu = locateOpenContextMenu();
        if (menu) return menu;
      }
    }
    try {
      const target = row.querySelector('a[href*="/t/"]') || row;
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(35);
        const menu = locateOpenContextMenu();
        if (menu) return menu;
      }
    } catch {}
    return null;
  }

  function locateMenuAction(menu, words) {
    const selectors = [
      '[role="menuitem"]', '[role="option"]', 'button', 'li',
      '[role="button"]', 'a', '[tabindex="0"]'
    ];
    for (const selector of selectors) {
      const item = [...menu.querySelectorAll(selector)]
        .filter(element => visible(element) && matchesAnyPhrase(normalizeControlText(element), words))
        .sort((a, b) => normalizeControlText(a).length - normalizeControlText(b).length)[0];
      if (item) return item;
    }
    return null;
  }

  async function locateScrollableMenuAction(menu, words) {
    let item = locateMenuAction(menu, words);
    if (item) return item;
    if (menu.scrollHeight <= menu.clientHeight) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 2) break;
      menu.scrollBy({ top: 70, behavior: 'instant' });
      await wait(90);
      item = locateMenuAction(menu, words);
      if (item) return item;
    }
    return null;
  }

  function locateDeleteConfirmation() {
    const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')].find(visible);
    if (!dialog) return null;
    const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible);
    return buttons.find(button => matchesAnyPhrase(normalizeControlText(button), WORDS.confirmDelete)) || null;
  }

  async function waitForVisibleMessenger() {
    while (state.paused && !state.stopRequested) await wait(180);
  }

  async function processConversationRow(row, operation) {
    if (state.stopRequested || !row?.isConnected) return false;
    await waitForVisibleMessenger();
    if (state.stopRequested) return false;
    await assertFacebookQuota(operation);

    const menu = await openConversationMenu(row);
    if (!menu) return false;
    await wait(delay('menu'));
    const item = await locateScrollableMenuAction(menu, WORDS[operation]);
    if (!item) {
      document.body.click();
      return false;
    }
    item.scrollIntoView({ behavior: 'instant', block: 'nearest' });

    let reservationId = null;
    if (operation !== 'delete') reservationId = await reserveFacebookUsage(operation);
    item.click();
    await wait(delay('action'));

    if (operation === 'delete') {
      const deadline = Date.now() + 4000;
      let confirm = null;
      while (!confirm && Date.now() < deadline && !state.stopRequested) {
        confirm = locateDeleteConfirmation();
        if (!confirm) await wait(60);
      }
      if (!confirm) {
        document.body.click();
        return false;
      }
      reservationId = await reserveFacebookUsage(operation);
      confirm.click();
      await wait(delay('confirm'));
    } else if (operation === 'unarchive') {
      const originalHref = row.querySelector('a[href*="/t/"]')?.href || '';
      const deadline = Date.now() + 2500;
      while (row.isConnected && Date.now() < deadline && !state.stopRequested) {
        const currentHref = row.querySelector('a[href*="/t/"]')?.href || '';
        if (originalHref && currentHref && currentHref !== originalHref) break;
        await wait(80);
      }
      const currentHref = row.querySelector('a[href*="/t/"]')?.href || '';
      if (row.isConnected && currentHref === originalHref) {
        await releaseFacebookUsage(reservationId);
        return false;
      }
    }
    return true;
  }

  async function executeConversationBatch(operation) {
    state.running = true;
    state.operationId = crypto.randomUUID?.() || `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.operation = operation;
    state.processed = 0;
    state.stopRequested = false;
    broadcastMessengerOperation('running', 'Scanning conversations…');

    let emptyPasses = 0;
    let stalledPasses = 0;
    try {
      while (!state.stopRequested) {
        await waitForVisibleMessenger();
        if (state.stopRequested) break;
        if (operation === 'archive' && isArchivedPage()) throw new Error('Archive is unavailable on Archived chats.');
        if (operation === 'unarchive' && !isArchivedPage()) throw new Error('Open Archived chats before restoring conversations.');

        const rows = collectConversationRows();
        if (!rows.length) {
          locateConversationScroller()?.scrollBy?.({ top: 500, behavior: 'instant' });
          await wait(delay('scan'));
          emptyPasses += 1;
          if (emptyPasses >= 5) break;
          continue;
        }

        emptyPasses = 0;
        let changed = 0;
        const batch = operation === 'unarchive' ? rows.slice(0, 1) : rows;
        for (const row of batch) {
          if (state.stopRequested) break;
          const succeeded = await processConversationRow(row, operation);
          if (succeeded) {
            state.processed += 1;
            changed += 1;
            broadcastMessengerOperation('running', `${presentTenseOperation(operation)} ${state.processed} conversation${state.processed === 1 ? '' : 's'}…`);
          }
          await wait(delay('between'));
        }

        stalledPasses = changed ? 0 : stalledPasses + 1;
        if (stalledPasses >= 4) break;
      }

      const stopped = state.stopRequested;
      broadcastMessengerOperation(stopped ? 'stopped' : 'done',
        `${stopped ? 'Stopped' : 'Finished'} — ${state.processed} conversation${state.processed === 1 ? '' : 's'} ${pastTenseOperation(operation)}.`);
    } catch (error) {
      if (error instanceof DailyLimitError) broadcastMessengerOperation('limit', error.message);
      else broadcastMessengerOperation('error', error?.message || 'The operation could not be completed.');
    } finally {
      state.running = false;
      state.operation = null;
      state.stopRequested = false;
      broadcastMessengerPage();
    }
  }

  function presentTenseOperation(operation) {
    return ({ delete: 'Deleting', archive: 'Archiving', unarchive: 'Restoring' })[operation];
  }

  function pastTenseOperation(operation) {
    return ({ delete: 'deleted', archive: 'archived', unarchive: 'restored' })[operation];
  }

  document.addEventListener('visibilitychange', () => {
    state.paused = document.hidden;
    if (state.running) broadcastMessengerOperation(state.paused ? 'paused' : 'running',
      state.paused ? 'Paused while this tab is in the background.' : `Resuming ${state.operation}…`);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const commandType = ({
      GET_PAGE_STATE: 'cms.facebook.page.read',
      START_OPERATION: 'cms.facebook.operation.start',
      STOP_OPERATION: 'cms.facebook.operation.stop'
    })[message.type] || message.type;
    if (commandType === 'cms.facebook.page.read') {
      sendResponse(snapshotMessengerPage());
      return false;
    }
    if (commandType === 'cms.facebook.operation.start') {
      if (state.running) {
        sendResponse({ ok: false, error: 'An operation is already running in this tab.' });
      } else if (!['delete', 'archive', 'unarchive'].includes(message.operation)) {
        sendResponse({ ok: false, error: 'Unknown operation.' });
      } else {
        state.speed = ['safe', 'normal', 'fast'].includes(message.speed) ? message.speed : 'normal';
        executeConversationBatch(message.operation);
        sendResponse({ ok: true });
      }
      return false;
    }
    if (commandType === 'cms.facebook.operation.stop') {
      state.stopRequested = true;
      state.paused = false;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  let pageCheckQueued = false;
  const observer = new MutationObserver(() => {
    if (pageCheckQueued) return;
    pageCheckQueued = true;
    requestAnimationFrame(() => {
      pageCheckQueued = false;
      const archived = isArchivedPage();
      if (location.href !== state.lastUrl || archived !== state.lastArchived) {
        state.lastUrl = location.href;
        state.lastArchived = archived;
        broadcastMessengerPage();
      }
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', broadcastMessengerPage);
  window.addEventListener('hashchange', broadcastMessengerPage);
  setInterval(() => {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      broadcastMessengerPage();
    }
  }, 500);
  broadcastMessengerPage();
})();
