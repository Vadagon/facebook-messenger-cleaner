(() => {
  if (globalThis.__cleanMySocialMessengerLoaded) return;
  globalThis.__cleanMySocialMessengerLoaded = true;

  const state = {
    running: false,
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

  async function getAccessState() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCESS_STATE' });
    if (!response?.ok || !response.access) throw new Error(response?.error || 'Could not check access.');
    return response.access;
  }

  async function ensureMeteredAccess(operation) {
    if (!['delete', 'archive'].includes(operation)) return null;
    const access = await getAccessState();
    if (!access.unlimited && access.remaining <= 0) throw new DailyLimitError();
    return access;
  }

  async function recordMeteredAction(operation) {
    if (!['delete', 'archive'].includes(operation)) return null;
    const response = await chrome.runtime.sendMessage({ type: 'RECORD_METERED_ACTION' });
    if (!response?.ok) throw new Error(response?.error || 'Could not update daily usage.');
    if (!response.allowed) throw new DailyLimitError();
    return response.access;
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
      const text = normalizedText(element);
      return archiveLabels.some(label => text.includes(label));
    });
  }

  function pageState() {
    return {
      type: 'PAGE_STATE',
      url: location.href,
      title: document.title,
      archived: isArchivedPage(),
      ready: document.readyState !== 'loading',
      operation: operationSnapshot()
    };
  }

  function operationSnapshot() {
    return {
      running: state.running,
      operation: state.operation,
      processed: state.processed,
      paused: state.paused,
      status: state.status,
      message: state.message
    };
  }

  function publishPageState() {
    state.lastUrl = location.href;
    state.lastArchived = isArchivedPage();
    chrome.runtime.sendMessage(pageState()).catch(() => {});
  }

  function publishOperation(status, message) {
    state.status = status;
    state.message = message;
    chrome.runtime.sendMessage({ type: 'OPERATION_STATE', ...operationSnapshot() }).catch(() => {});
  }

  function normalizedText(element) {
    return [element?.innerText, element?.textContent, element?.getAttribute?.('aria-label'), element?.title]
      .filter(Boolean).join(' ').trim().toLocaleLowerCase();
  }

  function containsWord(text, words) {
    return words.some(word => text.includes(word));
  }

  function getRows() {
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

  function getScrollContainer() {
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

  function findMenuButton(row) {
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

  function findOpenMenu() {
    const candidates = document.querySelectorAll(
      '[role="menu"], [role="listbox"], [role="dialog"], [data-testid*="menu" i], [data-testid*="dropdown" i]'
    );
    return [...candidates].find(menu => visible(menu) && menu.querySelector('[role="menuitem"], [role="option"], button')) || null;
  }

  async function openMenu(row) {
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await wait(80);
    const button = findMenuButton(row);
    if (button) {
      button.click();
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await wait(35);
        const menu = findOpenMenu();
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
        const menu = findOpenMenu();
        if (menu) return menu;
      }
    } catch {}
    return null;
  }

  function findAction(menu, words) {
    const selectors = [
      '[role="menuitem"]', '[role="option"]', 'button', 'li',
      '[role="button"]', 'a', '[tabindex="0"]'
    ];
    for (const selector of selectors) {
      const item = [...menu.querySelectorAll(selector)]
        .filter(element => visible(element) && containsWord(normalizedText(element), words))
        .sort((a, b) => normalizedText(a).length - normalizedText(b).length)[0];
      if (item) return item;
    }
    return null;
  }

  async function findActionScrolling(menu, words) {
    let item = findAction(menu, words);
    if (item) return item;
    if (menu.scrollHeight <= menu.clientHeight) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 2) break;
      menu.scrollBy({ top: 70, behavior: 'instant' });
      await wait(90);
      item = findAction(menu, words);
      if (item) return item;
    }
    return null;
  }

  function findConfirmButton() {
    const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')].find(visible);
    if (!dialog) return null;
    const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible);
    return buttons.find(button => containsWord(normalizedText(button), WORDS.confirmDelete)) || null;
  }

  async function waitWhilePaused() {
    while (state.paused && !state.stopRequested) await wait(180);
  }

  async function actOnRow(row, operation) {
    if (state.stopRequested || !row?.isConnected) return false;
    await waitWhilePaused();
    if (state.stopRequested) return false;
    await ensureMeteredAccess(operation);

    const menu = await openMenu(row);
    if (!menu) return false;
    await wait(delay('menu'));
    const item = await findActionScrolling(menu, WORDS[operation]);
    if (!item) {
      document.body.click();
      return false;
    }
    item.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    item.click();
    await wait(delay('action'));

    if (operation === 'delete') {
      const deadline = Date.now() + 4000;
      let confirm = null;
      while (!confirm && Date.now() < deadline && !state.stopRequested) {
        confirm = findConfirmButton();
        if (!confirm) await wait(60);
      }
      if (!confirm) {
        document.body.click();
        return false;
      }
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
      if (row.isConnected && currentHref === originalHref) return false;
    }
    await recordMeteredAction(operation);
    return true;
  }

  async function run(operation) {
    state.running = true;
    state.operation = operation;
    state.processed = 0;
    state.stopRequested = false;
    publishOperation('running', 'Scanning conversations…');

    let emptyPasses = 0;
    let stalledPasses = 0;
    try {
      while (!state.stopRequested) {
        await waitWhilePaused();
        if (state.stopRequested) break;
        if (operation === 'archive' && isArchivedPage()) throw new Error('Archive is unavailable on Archived chats.');
        if (operation === 'unarchive' && !isArchivedPage()) throw new Error('Open Archived chats before restoring conversations.');

        const rows = getRows();
        if (!rows.length) {
          getScrollContainer()?.scrollBy?.({ top: 500, behavior: 'instant' });
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
          const succeeded = await actOnRow(row, operation);
          if (succeeded) {
            state.processed += 1;
            changed += 1;
            publishOperation('running', `${operationLabel(operation)} ${state.processed} conversation${state.processed === 1 ? '' : 's'}…`);
          }
          await wait(delay('between'));
        }

        stalledPasses = changed ? 0 : stalledPasses + 1;
        if (stalledPasses >= 4) break;
      }

      const stopped = state.stopRequested;
      publishOperation(stopped ? 'stopped' : 'done',
        `${stopped ? 'Stopped' : 'Finished'} — ${state.processed} conversation${state.processed === 1 ? '' : 's'} ${pastLabel(operation)}.`);
    } catch (error) {
      if (error instanceof DailyLimitError) publishOperation('limit', error.message);
      else publishOperation('error', error?.message || 'The operation could not be completed.');
    } finally {
      state.running = false;
      state.operation = null;
      state.stopRequested = false;
      publishPageState();
    }
  }

  function operationLabel(operation) {
    return ({ delete: 'Deleting', archive: 'Archiving', unarchive: 'Restoring' })[operation];
  }

  function pastLabel(operation) {
    return ({ delete: 'deleted', archive: 'archived', unarchive: 'restored' })[operation];
  }

  document.addEventListener('visibilitychange', () => {
    state.paused = document.hidden;
    if (state.running) publishOperation(state.paused ? 'paused' : 'running',
      state.paused ? 'Paused while this tab is in the background.' : `Resuming ${state.operation}…`);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_STATE') {
      sendResponse(pageState());
      return false;
    }
    if (message.type === 'START_OPERATION') {
      if (state.running) {
        sendResponse({ ok: false, error: 'An operation is already running in this tab.' });
      } else if (!['delete', 'archive', 'unarchive'].includes(message.operation)) {
        sendResponse({ ok: false, error: 'Unknown operation.' });
      } else {
        state.speed = ['safe', 'normal', 'fast'].includes(message.speed) ? message.speed : 'normal';
        run(message.operation);
        sendResponse({ ok: true });
      }
      return false;
    }
    if (message.type === 'STOP_OPERATION') {
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
        publishPageState();
      }
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', publishPageState);
  window.addEventListener('hashchange', publishPageState);
  setInterval(() => {
    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      publishPageState();
    }
  }, 500);
  publishPageState();
})();
