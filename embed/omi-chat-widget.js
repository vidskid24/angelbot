/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 * OMIBOT_WIDGET_VERSION=22
 *
 * Hosted by the API at GET /omi-chat-widget.js when deployed.
 * Legacy URL /angel-chat-widget.js serves the same file.
 */

(function () {
  const API = window.OMIBOT_API_BASE || window.ANGELBOT_API_BASE || '';
  if (!API) {
    console.error('Omi Bot: set window.OMIBOT_API_BASE to your API origin (no trailing slash)');
    return;
  }

  const API_BASE = API.replace(/\/$/, '');
  const STORAGE_KEY = 'omibot_access_token';
  const STORAGE_KEY_LEGACY = 'angelbot_access_token';
  const THREAD_KEY = 'omibot_thread_id';
  const THREAD_KEY_LEGACY = 'angelbot_thread_id';
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const GREETING_WORDS = [
    'Hello',
    'Hi',
    'Hey',
    'Welcome',
    'Greetings',
    'Good day',
    'Well hello',
  ];

  const WELCOME_PROMPTS = [
    "What's present for you right now?",
    'Share what is on your heart, or simply begin wherever you are.',
    'Where would you like to begin today?',
    'What are you noticing in your body or in your field?',
    'Bring whatever is here — there is nothing to figure out.',
    'What reflection or question is alive for you?',
    'Take a breath. What wants your attention?',
    'How are you arriving in your space today?',
    'What would feel supportive to explore together?',
    'What thread are you sitting with today?',
    'What would you like to be witnessed in today?',
    'Is there a feeling, pattern, or moment you would like to unpack?',
  ];

  function getOmiUser() {
    return window.OMIBOT_USER || window.ANGELBOT_USER || {};
  }

  function getOmiRootId() {
    return window.OMIBOT_ROOT_ID || window.ANGELBOT_ROOT_ID;
  }

  function getOmiSessionId() {
    return window.OMIBOT_SESSION_ID || window.ANGELBOT_SESSION_ID;
  }

  function findChatRoot(rootId) {
    const preferred = rootId || getOmiRootId() || 'omibot-chat-root';
    return (
      document.getElementById(preferred) ||
      document.getElementById('omibot-chat-root') ||
      document.getElementById('angelbot-chat-root')
    );
  }

  function isValidThreadId(id) {
    return Boolean(id && UUID_RE.test(String(id)));
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function pickWelcomePrompt() {
    return pickRandom(WELCOME_PROMPTS);
  }

  function pickGreetingWord() {
    return pickRandom(GREETING_WORDS);
  }

  function formatWelcomeLine() {
    return pickGreetingWord() + ', ' + getDisplayName();
  }

  function isLiquidPlaceholder(value) {
    const s = String(value || '').trim();
    return !s || s.includes('{{') || s.includes('}}');
  }

  function getDisplayName() {
    const user = getOmiUser();
    const first = String(user.first_name || '').trim();
    if (!isLiquidPlaceholder(first)) return first;
    return 'friend';
  }

  function getToken() {
    let tok = sessionStorage.getItem(STORAGE_KEY);
    if (!tok) {
      tok = sessionStorage.getItem(STORAGE_KEY_LEGACY);
      if (tok) sessionStorage.setItem(STORAGE_KEY, tok);
    }
    return tok;
  }

  function setToken(tok) {
    sessionStorage.setItem(STORAGE_KEY, tok);
  }

  function clearToken() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY_LEGACY);
  }

  function getThreadId() {
    let id = sessionStorage.getItem(THREAD_KEY);
    if (!id) {
      id = sessionStorage.getItem(THREAD_KEY_LEGACY);
      if (id) sessionStorage.setItem(THREAD_KEY, id);
    }
    const session = getOmiSessionId();
    const candidate = id || session;
    if (isValidThreadId(candidate)) return candidate;
    if (candidate) {
      sessionStorage.removeItem(THREAD_KEY);
      sessionStorage.removeItem(THREAD_KEY_LEGACY);
    }
    return undefined;
  }

  function setThreadId(id) {
    if (id && isValidThreadId(id)) sessionStorage.setItem(THREAD_KEY, String(id));
  }

  function clearThreadId() {
    sessionStorage.removeItem(THREAD_KEY);
    sessionStorage.removeItem(THREAD_KEY_LEGACY);
  }

  function isTokenExpired(tok) {
    try {
      const part = tok.split('.')[1];
      if (!part) return true;
      const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return false;
      return payload.exp * 1000 < Date.now() + 30000;
    } catch {
      return true;
    }
  }

  async function ensureToken() {
    const existing = getToken();
    if (existing && !isTokenExpired(existing)) return existing;
    if (existing) clearToken();

    const user = getOmiUser();
    if (!user.external_id && !user.email) {
      throw new Error('Missing OMIBOT_USER.external_id or OMIBOT_USER.email');
    }

    const res = await fetch(API_BASE + '/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_id: user.external_id || undefined,
        email: user.email || undefined,
        first_name: user.first_name || undefined,
        last_name: user.last_name || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.error || data.message || 'bootstrap_failed');
    }
    setToken(data.access_token);
    return data.access_token;
  }

  function authHeaders(token) {
    return { Authorization: 'Bearer ' + token };
  }

  function normalizeBoldMarkers(s) {
    return String(s)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u2217\uFF0A\u2055]/g, '*')
      .replace(/\\\*\\\*/g, '**');
  }

  function appendFormattedContent(parent, text) {
    const normalized = normalizeBoldMarkers(text);
    const re = /\*\*([^*]+?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(normalized)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(normalized.slice(lastIndex, match.index)));
      }
      const strong = document.createElement('strong');
      strong.className = 'omibot-bold';
      strong.textContent = match[1];
      parent.appendChild(strong);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < normalized.length) {
      parent.appendChild(document.createTextNode(normalized.slice(lastIndex)));
    }
  }

  function formatThreadDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  function mount(rootId) {
    const root = findChatRoot(rootId);
    if (!root) {
      console.error('Omi Bot: add <div id="omibot-chat-root"></div> to the page');
      return;
    }

    root.innerHTML =
      '<style>' +
      '.omibot-shell{font-family:system-ui,-apple-system,sans-serif;max-width:920px;width:100%;margin:0 auto;padding:0 16px;box-sizing:border-box;color:#1a1a1a}' +
      '.omibot-shell .omibot-bold{font-weight:700!important}' +
      '.omibot-layout{display:flex;align-items:flex-start;gap:0;margin-top:8px}' +
      '.omibot-sidebar{width:11.5rem;flex-shrink:0;border-right:1px solid #e0dcd4;padding:4px 12px 16px 0}' +
      '.omibot-sidebar-head{font-size:0.75rem;color:#666;margin:0 0 8px;line-height:1.35}' +
      '.omibot-new-btn{width:100%;padding:8px 10px;margin:0 0 10px;border:1px solid #c9c0b5;border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:0.85rem}' +
      '.omibot-new-btn:hover:not(:disabled){background:#f7f4ef}' +
      '.omibot-new-btn:disabled{opacity:0.45;cursor:not-allowed}' +
      '.omibot-thread-list{list-style:none;margin:0;padding:0;max-height:16rem;overflow-y:auto}' +
      '.omibot-thread-item{display:block;width:100%;text-align:left;padding:8px 10px;border:none;background:transparent;border-radius:8px;cursor:pointer;font:inherit;font-size:0.82rem;line-height:1.35;margin:0 0 2px;color:#1a1a1a}' +
      '.omibot-thread-item:hover{background:#f0ebe3}' +
      '.omibot-thread-item.active{background:#e8e4dc;font-weight:600}' +
      '.omibot-thread-item-title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.omibot-thread-item-date{display:block;font-size:0.7rem;color:#888;margin-top:2px}' +
      '.omibot-main{flex:1;min-width:0;padding-left:14px}' +
      '#omibot-welcome{margin:0 0 12px}' +
      '.omibot-hello{font-size:clamp(2rem,6vw,2.75rem);font-weight:400;margin:0 0 8px;line-height:1.15;letter-spacing:-0.02em}' +
      '.omibot-welcome-prompt{font-size:1.05rem;line-height:1.55;color:#444;margin:0}' +
      '#omibot-status{margin:0 0 8px;color:#666;font-size:0.9rem;text-align:center}' +
      '#omibot-log{min-height:0;overflow:visible;padding:0;margin:0 0 12px}' +
      '.omibot-msg-user{display:flex;justify-content:flex-end;margin:12px 0}' +
      '.omibot-msg-user .omibot-bubble{background:#e8e4dc;border-radius:14px;padding:12px 16px;max-width:85%;line-height:1.5;white-space:pre-wrap}' +
      '.omibot-msg-bot{margin:16px 0;line-height:1.55;white-space:pre-wrap;max-width:100%}' +
      '.omibot-msg-system{margin:12px 0;padding:10px 12px;border-radius:8px;background:#f0ebe3;color:#5c5348;font-size:0.9rem;line-height:1.45}' +
      '.omibot-thinking{margin:16px 0;color:#666;font-size:0.95rem}' +
      '.omibot-thinking-dots{display:inline-block;margin-left:2px}' +
      '.omibot-thinking-dots span{display:inline-block;animation:omibot-dot 1.2s ease-in-out infinite}' +
      '.omibot-thinking-dots span:nth-child(2){animation-delay:.15s}' +
      '.omibot-thinking-dots span:nth-child(3){animation-delay:.3s}' +
      '@keyframes omibot-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
      '#omibot-input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #ddd;background:#fff;font:inherit;font-size:1rem;resize:vertical}' +
      '#omibot-input:focus{outline:2px solid #c9c0b5;outline-offset:1px;border-color:#c9c0b5}' +
      '@media(max-width:640px){.omibot-layout{flex-direction:column}.omibot-sidebar{width:100%;border-right:none;border-bottom:1px solid #e0dcd4;padding:0 0 12px;margin-bottom:12px}.omibot-main{padding-left:0}.omibot-thread-list{max-height:8rem}}' +
      '</style>' +
      '<div class="omibot-shell">' +
      '<p id="omibot-status">Preparing chat session...</p>' +
      '<div class="omibot-layout">' +
      '<aside class="omibot-sidebar">' +
      '<p class="omibot-sidebar-head" id="omibot-thread-meta">Conversations</p>' +
      '<button type="button" class="omibot-new-btn" id="omibot-new-thread">+ New conversation</button>' +
      '<ul class="omibot-thread-list" id="omibot-thread-list"></ul>' +
      '</aside>' +
      '<div class="omibot-main">' +
      '<div id="omibot-welcome"></div>' +
      '<div id="omibot-log"></div>' +
      '<textarea id="omibot-input" rows="2" placeholder="Write a message..."></textarea>' +
      '</div></div></div>';

    const status = root.querySelector('#omibot-status');
    const welcome = root.querySelector('#omibot-welcome');
    const log = root.querySelector('#omibot-log');
    const input = root.querySelector('#omibot-input');
    const threadListEl = root.querySelector('#omibot-thread-list');
    const threadMetaEl = root.querySelector('#omibot-thread-meta');
    const newThreadBtn = root.querySelector('#omibot-new-thread');

    let ready = false;
    let welcomeDismissed = false;
    let sending = false;
    let thinkingEl = null;
    let threadsMeta = { threadLimit: 2, threadCount: 0, tier: 'free' };
    let threadsCache = [];

    function dismissWelcome() {
      if (welcomeDismissed) return;
      welcomeDismissed = true;
      welcome.replaceChildren();
      welcome.hidden = true;
    }

    function restoreWelcome() {
      welcomeDismissed = false;
      welcome.hidden = false;
      welcome.replaceChildren();
      const hello = document.createElement('p');
      hello.className = 'omibot-hello';
      hello.textContent = formatWelcomeLine();
      const prompt = document.createElement('p');
      prompt.className = 'omibot-welcome-prompt';
      prompt.textContent = pickWelcomePrompt();
      welcome.appendChild(hello);
      welcome.appendChild(prompt);
    }

    function showWelcome() {
      restoreWelcome();
    }

    showWelcome();

    function setInputEnabled(on) {
      input.disabled = !on;
    }

    function updateThreadMeta() {
      const n = threadsMeta.threadCount;
      const cap = threadsMeta.threadLimit;
      threadMetaEl.textContent = n + ' of ' + cap + ' conversations';
      newThreadBtn.disabled = n >= cap;
    }

    function clearLog() {
      log.replaceChildren();
      removeThinking();
    }

    function isNearPageBottom(thresholdPx) {
      const threshold = thresholdPx == null ? 120 : thresholdPx;
      const doc = document.documentElement;
      const scrollY = window.scrollY || doc.scrollTop || 0;
      const viewportBottom = scrollY + window.innerHeight;
      const pageBottom = Math.max(doc.scrollHeight, document.body.scrollHeight);
      return viewportBottom >= pageBottom - threshold;
    }

    function scrollIntoViewIfNearBottom(el) {
      if (el && isNearPageBottom()) {
        el.scrollIntoView({ block: 'end' });
      }
    }

    function removeThinking() {
      if (thinkingEl && thinkingEl.parentNode) thinkingEl.parentNode.removeChild(thinkingEl);
      thinkingEl = null;
      const stale = log.querySelector('#omibot-thinking');
      if (stale) stale.remove();
    }

    function showThinking() {
      removeThinking();
      const d = document.createElement('div');
      d.id = 'omibot-thinking';
      d.className = 'omibot-thinking omibot-msg-bot';
      const line = document.createElement('span');
      line.appendChild(document.createTextNode('Reflecting'));
      const dots = document.createElement('span');
      dots.className = 'omibot-thinking-dots';
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.textContent = '.';
        dots.appendChild(dot);
      }
      line.appendChild(dots);
      d.appendChild(line);
      thinkingEl = d;
      log.appendChild(d);
      scrollIntoViewIfNearBottom(d);
    }

    function append(role, text) {
      const isUser = role === 'You';
      const isSystem = role === 'System';
      const row = document.createElement('div');
      row.className = isUser
        ? 'omibot-msg-user'
        : isSystem
          ? 'omibot-msg-system'
          : 'omibot-msg-bot';

      if (isUser) {
        const bubble = document.createElement('div');
        bubble.className = 'omibot-bubble';
        bubble.textContent = text;
        row.appendChild(bubble);
      } else {
        const body = document.createElement('div');
        body.className = 'omibot-message-body';
        if (isSystem) {
          body.textContent = text;
        } else {
          appendFormattedContent(body, text);
        }
        row.appendChild(body);
      }
      log.appendChild(row);
      scrollIntoViewIfNearBottom(row);
    }

    function renderThreadList(activeId) {
      threadListEl.replaceChildren();
      if (!threadsCache.length) {
        const empty = document.createElement('li');
        empty.style.cssText = 'font-size:0.8rem;color:#888;padding:4px 10px';
        empty.textContent = 'No saved chats yet';
        threadListEl.appendChild(empty);
        return;
      }
      for (let i = 0; i < threadsCache.length; i++) {
        const t = threadsCache[i];
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'omibot-thread-item' + (t.id === activeId ? ' active' : '');
        btn.dataset.threadId = t.id;
        const title = document.createElement('span');
        title.className = 'omibot-thread-item-title';
        title.textContent = t.title || 'Conversation';
        const date = document.createElement('span');
        date.className = 'omibot-thread-item-date';
        date.textContent = formatThreadDate(t.updatedAt || t.createdAt);
        btn.appendChild(title);
        btn.appendChild(date);
        btn.addEventListener('click', function () {
          if (sending || t.id === getThreadId()) return;
          selectThread(t.id);
        });
        li.appendChild(btn);
        threadListEl.appendChild(li);
      }
    }

    async function fetchThreads(token) {
      const res = await fetch(API_BASE + '/api/threads', { headers: authHeaders(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      threadsCache = data.threads || [];
      threadsMeta = {
        threadLimit: data.threadLimit || 2,
        threadCount: data.threadCount != null ? data.threadCount : threadsCache.length,
        tier: data.tier || 'free',
      };
      updateThreadMeta();
      return data;
    }

    async function loadThreadMessages(threadId, token) {
      const res = await fetch(API_BASE + '/api/threads/' + encodeURIComponent(threadId), {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    }

    async function selectThread(threadId, token) {
      const tok = token || (await ensureToken());
      setThreadId(threadId);
      clearLog();
      const messages = await loadThreadMessages(threadId, tok);
      if (messages.length) {
        dismissWelcome();
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          append(m.role === 'user' ? 'You' : 'Companion', m.content);
        }
      } else {
        restoreWelcome();
      }
      renderThreadList(threadId);
    }

    async function createNewThread() {
      if (!ready || sending) return;
      if (threadsMeta.threadCount >= threadsMeta.threadLimit) {
        append('System', 'You have reached the limit of ' + threadsMeta.threadLimit + ' saved conversations.');
        return;
      }
      let tok;
      try {
        tok = await ensureToken();
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
        return;
      }
      newThreadBtn.disabled = true;
      try {
        const res = await fetch(API_BASE + '/api/threads', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(tok)),
          body: JSON.stringify({ title: 'New conversation' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          append(
            'System',
            data.message || data.error || 'Could not start a new conversation.'
          );
          return;
        }
        await fetchThreads(tok);
        const id = data.thread && data.thread.id;
        if (id) {
          clearLog();
          clearThreadId();
          setThreadId(id);
          restoreWelcome();
          renderThreadList(id);
        }
      } finally {
        updateThreadMeta();
        newThreadBtn.disabled = threadsMeta.threadCount >= threadsMeta.threadLimit;
      }
    }

    newThreadBtn.addEventListener('click', function () {
      createNewThread();
    });

    async function initSession() {
      const token = await ensureToken();
      status.textContent = "You're Signed In";
      await fetchThreads(token);

      let activeId = getThreadId();
      if (activeId && !threadsCache.some(function (t) { return t.id === activeId; })) {
        clearThreadId();
        activeId = undefined;
      }
      if (!activeId && threadsCache.length) {
        activeId = threadsCache[0].id;
        setThreadId(activeId);
      }

      if (activeId) {
        await selectThread(activeId, token);
      } else {
        renderThreadList(null);
        restoreWelcome();
      }

      ready = true;
      setInputEnabled(true);
    }

    ensureToken()
      .then(function () {
        return initSession();
      })
      .catch(function (e) {
        status.textContent = 'Unable to create session: ' + String(e && e.message ? e.message : e);
        setInputEnabled(false);
      });

    setInputEnabled(false);

    async function postChat(message, token) {
      const threadId = getThreadId();
      const res = await fetch(API_BASE + '/api/chat/send', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
        body: JSON.stringify({ message, threadId }),
      });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    }

    async function send() {
      if (!ready || sending) return;
      const message = (input.value || '').trim();
      if (!message) return;
      sending = true;
      setInputEnabled(false);
      dismissWelcome();
      append('You', message);
      input.value = '';
      showThinking();
      try {
        let tok = await ensureToken();
        let result = await postChat(message, tok);
        if (
          result.res.status === 401 &&
          (result.data.error === 'invalid_token' || result.data.error === 'missing_bearer_token')
        ) {
          clearToken();
          tok = await ensureToken();
          result = await postChat(message, tok);
        }
        if (!result.res.ok) {
          if (result.data.error === 'invalid_token') {
            clearToken();
            status.textContent = 'Session expired. Refresh the page to sign in again.';
          }
          append('System', result.data.message || result.data.error || 'Request failed');
          return;
        }
        if (result.data.threadId) {
          setThreadId(result.data.threadId);
          await fetchThreads(tok);
          renderThreadList(result.data.threadId);
        }
        append('Companion', result.data.text || '');
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
      } finally {
        removeThinking();
        sending = false;
        setInputEnabled(true);
        input.focus({ preventScroll: true });
      }
    }

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        send();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount(getOmiRootId());
    });
  } else {
    mount(getOmiRootId());
  }
})();
