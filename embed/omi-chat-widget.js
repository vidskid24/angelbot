/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 * OMIBOT_WIDGET_VERSION=43
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
      '.omibot-sidebar{width:11.5rem;flex-shrink:0;border-right:1px solid #e0dcd4;padding:4px 12px 16px 0;box-sizing:border-box}' +
      '.omibot-sidebar .omibot-new-btn,.omibot-sidebar .omibot-thread-list,.omibot-sidebar .omibot-thread-row{width:100%}' +
      '.omibot-tier-row{margin:0 0 8px;text-align:right;line-height:1.35}' +
      '.omibot-thread-meta-footer{font-size:0.75rem;color:#666;margin:8px 0 2px;padding:6px 0 0;line-height:1.35}' +
      '.omibot-tier-badge{font-size:0.7rem;font-weight:600;letter-spacing:0.04em;flex-shrink:0;text-transform:uppercase;white-space:nowrap}' +
      '.omibot-tier-badge-paid{color:#5c5348}' +
      '.omibot-tier-link{color:#7a5c1e;text-decoration:none;border-bottom:1px solid rgba(122,92,30,.45);cursor:pointer;text-transform:none}' +
      '.omibot-tier-link:hover{color:#1a1a1a;border-bottom-color:#1a1a1a}' +
      '.omibot-new-btn{width:100%;padding:8px 10px;margin:0 0 8px;border:1px solid #c9c0b5;border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:0.85rem}' +
      '.omibot-new-btn:hover:not(:disabled){background:#f7f4ef}' +
      '.omibot-new-btn:disabled{opacity:0.45;cursor:not-allowed}' +
      '.omibot-recents-label{font-size:0.75rem;color:#666;margin:0 0 6px;line-height:1.35}' +
      '.omibot-thread-list{margin:0;padding:0;overflow:visible}' +
      '.omibot-thread-list-item{margin:0;padding:0;list-style:none}' +
      '.omibot-thread-row{display:flex;align-items:center;gap:2px;width:100%;box-sizing:border-box;margin:0 0 6px;border-radius:8px;position:relative}' +
      '.omibot-thread-row.active{background:#e8e4dc}' +
      '.omibot-thread-row:hover{background:#f7f4ef}' +
      '.omibot-thread-row.active:hover{background:#e8e4dc}' +
      '.omibot-thread-select{flex:1;min-width:0;text-align:left;padding:8px 32px 8px 10px;border:none;background:transparent;cursor:pointer;font:inherit;font-size:0.82rem;line-height:1.35;color:#1a1a1a}' +
      '.omibot-thread-row.active .omibot-thread-select{font-weight:600}' +
      '.omibot-thread-item-title{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.omibot-thread-menu-wrap{position:absolute;right:4px;top:50%;transform:translateY(-50%);opacity:0;pointer-events:none;transition:opacity .15s ease}' +
      '.omibot-thread-row:hover .omibot-thread-menu-wrap,.omibot-thread-row.active .omibot-thread-menu-wrap,.omibot-thread-row.menu-open .omibot-thread-menu-wrap{opacity:1;pointer-events:auto}' +
      '.omibot-thread-menu-btn{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;color:#666;font-size:1.1rem;line-height:1}' +
      '.omibot-thread-menu-btn:hover,.omibot-thread-row.menu-open .omibot-thread-menu-btn{background:#e0dcd4;color:#1a1a1a}' +
      '.omibot-thread-dropdown{position:fixed;z-index:100000;display:none;min-width:9.5rem;background:#fff;border:1px solid #e0dcd4;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:4px 0;overflow:hidden}' +
      '.omibot-thread-dropdown.is-open{display:block}' +
      '.omibot-thread-menu-item{display:block;width:100%;text-align:left;padding:9px 14px;border:none;background:transparent;cursor:pointer;font:inherit;font-size:0.85rem;color:#1a1a1a}' +
      '.omibot-thread-menu-item:hover{background:#f7f4ef}' +
      '.omibot-thread-menu-item-danger{color:#8b3a34}' +
      '.omibot-thread-menu-item-danger:hover{background:#f5e8e6}' +
      '.omibot-thread-toolbar{display:flex;align-items:center;margin:0 0 12px}' +
      '.omibot-thread-toolbar[hidden]{display:none!important}' +
      '.omibot-active-title-btn{display:flex;align-items:center;gap:8px;max-width:100%;padding:0;border:none;background:transparent;cursor:pointer;font:inherit;font-size:1.08rem;font-style:italic;font-weight:600;color:#1a1a1a;text-align:left;line-height:1.35}' +
      '.omibot-active-title-btn:hover:not(:disabled){color:#5c5348}' +
      '.omibot-active-title-btn:disabled{cursor:default}' +
      '#omibot-active-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-style:italic}' +
      '.omibot-active-title-chevron{flex-shrink:0;font-size:0.75rem;line-height:1;opacity:0.65;transition:transform .15s ease}' +
      '.omibot-active-title-btn.is-open .omibot-active-title-chevron{transform:rotate(180deg);opacity:0.9}' +
      '.omibot-active-title-chevron[hidden]{display:none}' +
      '.omibot-thread-switcher-dropdown{position:fixed;z-index:100000;display:none;min-width:12rem;max-width:min(22rem,92vw);max-height:14rem;overflow-y:auto;background:#fff;border:1px solid #e0dcd4;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:4px 0}' +
      '.omibot-thread-switcher-dropdown.is-open{display:block}' +
      '.omibot-thread-switcher-item{display:block;width:100%;text-align:left;padding:9px 14px;border:none;background:transparent;cursor:pointer;font:inherit;font-size:0.92rem;font-style:italic;color:#1a1a1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.omibot-thread-switcher-item:hover{background:#f7f4ef}' +
      '.omibot-thread-switcher-item.active{background:#e8e4dc;font-weight:600}' +
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
      '.omibot-msg-system a.omibot-tier-link{color:#7a5c1e;text-decoration:none;border-bottom:1px solid rgba(122,92,30,.45)}' +
      '.omibot-msg-system a.omibot-tier-link:hover{color:#1a1a1a;border-bottom-color:#1a1a1a}' +
      '.omibot-thinking{margin:16px 0;color:#666;font-size:0.95rem}' +
      '.omibot-thinking-dots{display:inline-block;margin-left:2px}' +
      '.omibot-thinking-dots span{display:inline-block;animation:omibot-dot 1.2s ease-in-out infinite}' +
      '.omibot-thinking-dots span:nth-child(2){animation-delay:.15s}' +
      '.omibot-thinking-dots span:nth-child(3){animation-delay:.3s}' +
      '@keyframes omibot-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
      '#omibot-input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #ddd;background:#fff;font:inherit;font-size:1rem;resize:vertical}' +
      '#omibot-input:focus{outline:2px solid #c9c0b5;outline-offset:1px;border-color:#c9c0b5}' +
      '@media(max-width:640px){.omibot-layout{flex-direction:column}.omibot-sidebar{width:100%;border-right:none;border-bottom:1px solid #e0dcd4;padding:0 0 12px;margin-bottom:12px}.omibot-main{padding-left:0}}' +
      '</style>' +
      '<div class="omibot-shell">' +
      '<p id="omibot-status" hidden></p>' +
      '<div class="omibot-layout">' +
      '<aside class="omibot-sidebar">' +
      '<div class="omibot-tier-row"><span id="omibot-tier-badge"></span></div>' +
      '<button type="button" class="omibot-new-btn" id="omibot-new-thread">+ New conversation</button>' +
      '<p class="omibot-recents-label">Recents</p>' +
      '<div class="omibot-thread-list" id="omibot-thread-list"></div>' +
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
    const tierBadgeEl = root.querySelector('#omibot-tier-badge');
    const upgradeUrl =
      window.OMIBOT_UPGRADE_URL ||
      window.ANGELBOT_UPGRADE_URL ||
      'https://courses.masteringalchemy.com/pages/omi-ai';

    function appendThreadLimitMessage(limit, tier) {
      const cap = limit || 2;
      const isPaid = tier === 'paid';
      const row = document.createElement('div');
      row.className = 'omibot-msg-system';
      const body = document.createElement('div');
      body.appendChild(
        document.createTextNode(
          'You can save up to ' +
            cap +
            ' conversations on your ' +
            (isPaid ? 'plan' : 'free plan') +
            '. Please delete one to continue or ask your question in one of your other saved conversations. '
        )
      );
      if (isPaid) {
        body.appendChild(
          document.createTextNode(
            'If you would like a larger plan, please email and let us know, service@masteringalchemy.com'
          )
        );
      } else {
        body.appendChild(document.createTextNode('You can also '));
        const link = document.createElement('a');
        link.className = 'omibot-tier-link';
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'upgrade';
        body.appendChild(link);
        body.appendChild(document.createTextNode(' to a paid plan'));
      }
      row.appendChild(body);
      log.appendChild(row);
      scrollIntoViewIfNearBottom(row);
    }

    function appendDailyLimitMessage(limit, tier) {
      const cap = limit || threadsMeta.dailyMessageLimit || 11;
      const isPaid = tier === 'paid';
      const row = document.createElement('div');
      row.className = 'omibot-msg-system';
      const body = document.createElement('div');
      if (isPaid) {
        body.appendChild(
          document.createTextNode(
            "You have reached today's limit of " +
              cap +
              ' messages on your plan. Please try again tomorrow, or email service@masteringalchemy.com if you need assistance.'
          )
        );
      } else {
        body.appendChild(
          document.createTextNode(
            "You have reached today's limit of " +
              cap +
              ' messages on your free plan. Please try again tomorrow, or '
          )
        );
        const link = document.createElement('a');
        link.className = 'omibot-tier-link';
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'upgrade';
        body.appendChild(link);
        body.appendChild(document.createTextNode(' to a paid plan for a higher daily limit.'));
      }
      row.appendChild(body);
      log.appendChild(row);
      scrollIntoViewIfNearBottom(row);
    }

    function isAtDailyMessageLimit() {
      const n = threadsMeta.dailyMessageCount != null ? threadsMeta.dailyMessageCount : 0;
      const cap = threadsMeta.dailyMessageLimit != null ? threadsMeta.dailyMessageLimit : 11;
      return n >= cap;
    }

    function refreshInputEnabled() {
      if (!ready || sending) return;
      setInputEnabled(!isAtDailyMessageLimit());
    }

    const newThreadBtn = root.querySelector('#omibot-new-thread');
    const mainEl = root.querySelector('.omibot-main');

    const threadToolbar = document.createElement('div');
    threadToolbar.className = 'omibot-thread-toolbar';
    threadToolbar.id = 'omibot-thread-toolbar';
    threadToolbar.hidden = true;

    const activeTitleBtn = document.createElement('button');
    activeTitleBtn.type = 'button';
    activeTitleBtn.className = 'omibot-active-title-btn';
    activeTitleBtn.id = 'omibot-active-title-btn';
    activeTitleBtn.setAttribute('aria-haspopup', 'listbox');

    const activeTitleEl = document.createElement('span');
    activeTitleEl.id = 'omibot-active-title';

    const activeTitleChevron = document.createElement('span');
    activeTitleChevron.className = 'omibot-active-title-chevron';
    activeTitleChevron.setAttribute('aria-hidden', 'true');
    activeTitleChevron.textContent = '\u25BE';

    activeTitleBtn.appendChild(activeTitleEl);
    activeTitleBtn.appendChild(activeTitleChevron);
    threadToolbar.appendChild(activeTitleBtn);
    mainEl.insertBefore(threadToolbar, welcome);

    let threadSwitcherOpen = false;

    const threadSwitcherDropdown = document.createElement('div');
    threadSwitcherDropdown.className = 'omibot-thread-switcher-dropdown';
    threadSwitcherDropdown.id = 'omibot-thread-switcher-dropdown';
    threadSwitcherDropdown.setAttribute('role', 'listbox');
    threadSwitcherDropdown.hidden = true;
    document.body.appendChild(threadSwitcherDropdown);

    let openMenuRow = null;
    let openMenuThreadId = null;

    const threadMenuDropdown = document.createElement('div');
    threadMenuDropdown.className = 'omibot-thread-dropdown';
    threadMenuDropdown.id = 'omibot-thread-dropdown';
    threadMenuDropdown.setAttribute('role', 'menu');
    threadMenuDropdown.hidden = true;

    const threadMenuRename = document.createElement('button');
    threadMenuRename.type = 'button';
    threadMenuRename.className = 'omibot-thread-menu-item';
    threadMenuRename.setAttribute('role', 'menuitem');
    threadMenuRename.textContent = 'Rename';

    const threadMenuDelete = document.createElement('button');
    threadMenuDelete.type = 'button';
    threadMenuDelete.className = 'omibot-thread-menu-item omibot-thread-menu-item-danger';
    threadMenuDelete.setAttribute('role', 'menuitem');
    threadMenuDelete.textContent = 'Delete';

    threadMenuDropdown.appendChild(threadMenuRename);
    threadMenuDropdown.appendChild(threadMenuDelete);
    document.body.appendChild(threadMenuDropdown);

    function positionThreadDropdown(menuBtn) {
      threadMenuDropdown.hidden = false;
      threadMenuDropdown.classList.add('is-open');
      threadMenuDropdown.style.visibility = 'hidden';
      threadMenuDropdown.style.top = '0';
      threadMenuDropdown.style.left = '0';
      const rect = menuBtn.getBoundingClientRect();
      const ddHeight = threadMenuDropdown.offsetHeight;
      const ddWidth = threadMenuDropdown.offsetWidth;
      let top = rect.bottom + 4;
      let left = rect.right - ddWidth;
      if (top + ddHeight > window.innerHeight - 8) {
        top = rect.top - ddHeight - 4;
      }
      if (left < 8) left = 8;
      if (left + ddWidth > window.innerWidth - 8) {
        left = window.innerWidth - ddWidth - 8;
      }
      threadMenuDropdown.style.top = Math.round(top) + 'px';
      threadMenuDropdown.style.left = Math.round(left) + 'px';
      threadMenuDropdown.style.visibility = '';
    }

    function closeThreadSwitcher() {
      threadSwitcherOpen = false;
      activeTitleBtn.classList.remove('is-open');
      activeTitleBtn.setAttribute('aria-expanded', 'false');
      threadSwitcherDropdown.classList.remove('is-open');
      threadSwitcherDropdown.hidden = true;
    }

    function populateThreadSwitcher(activeId) {
      threadSwitcherDropdown.replaceChildren();
      for (let i = 0; i < threadsCache.length; i++) {
        const th = threadsCache[i];
        const item = document.createElement('button');
        item.type = 'button';
        item.className =
          'omibot-thread-switcher-item' + (th.id === activeId ? ' active' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', th.id === activeId ? 'true' : 'false');
        item.textContent = th.title || 'Conversation';
        item.addEventListener('click', function (ev) {
          ev.stopPropagation();
          closeThreadSwitcher();
          if (sending || th.id === getThreadId()) return;
          selectThread(th.id);
        });
        threadSwitcherDropdown.appendChild(item);
      }
    }

    function positionThreadSwitcher() {
      threadSwitcherDropdown.hidden = false;
      threadSwitcherDropdown.classList.add('is-open');
      threadSwitcherDropdown.style.visibility = 'hidden';
      threadSwitcherDropdown.style.top = '0';
      threadSwitcherDropdown.style.left = '0';
      const rect = activeTitleBtn.getBoundingClientRect();
      const ddHeight = threadSwitcherDropdown.offsetHeight;
      const ddWidth = threadSwitcherDropdown.offsetWidth;
      let top = rect.bottom + 6;
      let left = rect.left;
      if (top + ddHeight > window.innerHeight - 8) {
        top = rect.top - ddHeight - 6;
      }
      if (left + ddWidth > window.innerWidth - 8) {
        left = window.innerWidth - ddWidth - 8;
      }
      if (left < 8) left = 8;
      threadSwitcherDropdown.style.top = Math.round(top) + 'px';
      threadSwitcherDropdown.style.left = Math.round(left) + 'px';
      threadSwitcherDropdown.style.visibility = '';
    }

    function openThreadSwitcher() {
      closeAllThreadMenus();
      const activeId = getThreadId();
      if (!activeId || threadsCache.length <= 1) return;
      populateThreadSwitcher(activeId);
      threadSwitcherOpen = true;
      activeTitleBtn.classList.add('is-open');
      activeTitleBtn.setAttribute('aria-expanded', 'true');
      positionThreadSwitcher();
    }

    function toggleThreadSwitcher() {
      if (threadSwitcherOpen) {
        closeThreadSwitcher();
        return;
      }
      openThreadSwitcher();
    }

    activeTitleBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (sending || threadsCache.length <= 1) return;
      toggleThreadSwitcher();
    });

    function closeAllThreadMenus() {
      closeThreadSwitcher();
      if (openMenuRow) {
        openMenuRow.classList.remove('menu-open');
        openMenuRow = null;
      }
      openMenuThreadId = null;
      threadMenuDropdown.classList.remove('is-open');
      threadMenuDropdown.hidden = true;
    }

    function openThreadMenu(row, menuBtn, threadId) {
      openMenuRow = row;
      openMenuThreadId = threadId;
      row.classList.add('menu-open');
      positionThreadDropdown(menuBtn);
    }

    function toggleThreadMenu(row, menuBtn, threadId) {
      if (openMenuRow === row && threadMenuDropdown.classList.contains('is-open')) {
        closeAllThreadMenus();
        return;
      }
      closeAllThreadMenus();
      openThreadMenu(row, menuBtn, threadId);
    }

    threadMenuRename.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const id = openMenuThreadId;
      closeAllThreadMenus();
      if (id) renameThread(id);
    });

    threadMenuDelete.addEventListener('click', function (ev) {
      ev.stopPropagation();
      const id = openMenuThreadId;
      closeAllThreadMenus();
      if (id) deleteThread(id);
    });

    document.addEventListener('click', function (ev) {
      if (openMenuRow) {
        if (ev.target.closest && ev.target.closest('.omibot-thread-menu-wrap')) return;
        if (ev.target.closest && ev.target.closest('#omibot-thread-dropdown')) return;
        closeAllThreadMenus();
        return;
      }
      if (threadSwitcherOpen) {
        if (ev.target.closest && ev.target.closest('#omibot-active-title-btn')) return;
        if (ev.target.closest && ev.target.closest('#omibot-thread-switcher-dropdown')) return;
        closeThreadSwitcher();
      }
    });

    threadListEl.addEventListener('scroll', closeAllThreadMenus);
    window.addEventListener('resize', closeAllThreadMenus);

    let ready = false;
    let welcomeDismissed = false;
    let sending = false;
    let thinkingEl = null;
    let threadsMeta = {
      threadLimit: 2,
      threadCount: 0,
      tier: 'free',
      dailyMessageLimit: 11,
      dailyMessageCount: 0,
    };
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

    function updateTierBadge() {
      const tier = threadsMeta.tier === 'paid' ? 'paid' : 'free';
      tierBadgeEl.replaceChildren();
      if (tier === 'paid') {
        tierBadgeEl.className = 'omibot-tier-badge omibot-tier-badge-paid';
        tierBadgeEl.textContent = 'PAID';
      } else {
        tierBadgeEl.className = 'omibot-tier-badge';
        tierBadgeEl.appendChild(document.createTextNode('FREE - '));
        const link = document.createElement('a');
        link.className = 'omibot-tier-link';
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Upgrade';
        link.title = 'Upgrade to Omi AI paid';
        tierBadgeEl.appendChild(link);
      }
    }

    function appendThreadMetaFooter() {
      const existing = threadListEl.querySelector('#omibot-thread-meta-footer');
      if (existing) existing.remove();

      const n = threadsMeta.threadCount;
      const cap = threadsMeta.threadLimit;
      if (n < cap - 1) return;

      const footer = document.createElement('div');
      footer.id = 'omibot-thread-meta-footer';
      footer.className = 'omibot-thread-meta-footer';
      footer.appendChild(document.createTextNode(n + ' of ' + cap + ' conversations'));

      const tier = threadsMeta.tier === 'paid' ? 'paid' : 'free';
      if (tier !== 'paid' && n >= cap) {
        footer.appendChild(document.createTextNode(' '));
        const link = document.createElement('a');
        link.className = 'omibot-tier-link';
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Upgrade';
        link.title = 'Upgrade to Omi AI paid';
        footer.appendChild(link);
      }

      threadListEl.appendChild(footer);
    }

    function appendDailyMetaFooter() {
      const existing = threadListEl.querySelector('#omibot-daily-meta-footer');
      if (existing) existing.remove();

      const n = threadsMeta.dailyMessageCount != null ? threadsMeta.dailyMessageCount : 0;
      const cap = threadsMeta.dailyMessageLimit != null ? threadsMeta.dailyMessageLimit : 11;
      if (n < cap - 1) return;

      const footer = document.createElement('div');
      footer.id = 'omibot-daily-meta-footer';
      footer.className = 'omibot-thread-meta-footer';
      footer.appendChild(document.createTextNode(n + ' of ' + cap + ' messages today'));

      const tier = threadsMeta.tier === 'paid' ? 'paid' : 'free';
      if (tier !== 'paid' && n >= cap) {
        footer.appendChild(document.createTextNode(' '));
        const link = document.createElement('a');
        link.className = 'omibot-tier-link';
        link.href = upgradeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Upgrade';
        link.title = 'Upgrade to Omi AI paid';
        footer.appendChild(link);
      }

      threadListEl.appendChild(footer);
    }

    function updateThreadMeta() {
      const n = threadsMeta.threadCount;
      const cap = threadsMeta.threadLimit;
      newThreadBtn.disabled = n >= cap;
      updateTierBadge();
      appendThreadMetaFooter();
      appendDailyMetaFooter();
      refreshInputEnabled();
    }

    function getThreadFromCache(threadId) {
      for (let i = 0; i < threadsCache.length; i++) {
        if (threadsCache[i].id === threadId) return threadsCache[i];
      }
      return null;
    }

    function updateActiveToolbar(threadId) {
      closeThreadSwitcher();
      if (!threadId || !isValidThreadId(threadId)) {
        threadToolbar.hidden = true;
        return;
      }
      const t = getThreadFromCache(threadId);
      activeTitleEl.textContent = (t && t.title) || 'Conversation';
      const canSwitch = threadsCache.length > 1;
      activeTitleChevron.hidden = !canSwitch;
      activeTitleBtn.disabled = !canSwitch;
      threadToolbar.hidden = false;
    }

    function promptThreadTitle(currentTitle) {
      const next = window.prompt('Conversation name', currentTitle || 'Conversation');
      if (next === null) return null;
      const trimmed = String(next).trim();
      if (!trimmed) return null;
      return trimmed.slice(0, 200);
    }

    async function renameThread(threadId) {
      if (!threadId || sending) return;
      const t = getThreadFromCache(threadId);
      const newTitle = promptThreadTitle((t && t.title) || 'Conversation');
      if (newTitle === null) return;
      let tok;
      try {
        tok = await ensureToken();
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
        return;
      }
      const res = await fetch(API_BASE + '/api/threads/' + encodeURIComponent(threadId), {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(tok)),
        body: JSON.stringify({ title: newTitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        append('System', data.message || data.error || 'Could not rename conversation.');
        return;
      }
      closeAllThreadMenus();
      await fetchThreads(tok);
      renderThreadList(getThreadId());
      updateActiveToolbar(threadId);
    }

    async function deleteThread(threadId) {
      if (!threadId || sending) return;
      const t = getThreadFromCache(threadId);
      const label = (t && t.title) || 'this conversation';
      if (!window.confirm('Delete "' + label + '"? This cannot be undone.')) return;
      let tok;
      try {
        tok = await ensureToken();
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
        return;
      }
      const res = await fetch(API_BASE + '/api/threads/' + encodeURIComponent(threadId), {
        method: 'DELETE',
        headers: authHeaders(tok),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        append('System', data.message || data.error || 'Could not delete conversation.');
        return;
      }
      closeAllThreadMenus();
      const wasActive = getThreadId() === threadId;
      await fetchThreads(tok);
      if (wasActive) {
        clearThreadId();
        clearLog();
        if (threadsCache.length) {
          await selectThread(threadsCache[0].id, tok);
        } else {
          threadToolbar.hidden = true;
          restoreWelcome();
          renderThreadList(null);
        }
      } else {
        renderThreadList(getThreadId());
      }
      updateThreadMeta();
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
      closeAllThreadMenus();
      threadListEl.replaceChildren();
      if (!threadsCache.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:0.8rem;color:#888;padding:4px 0';
        empty.textContent = 'No saved chats yet';
        threadListEl.appendChild(empty);
        appendThreadMetaFooter();
        return;
      }
      for (let i = 0; i < threadsCache.length; i++) {
        const t = threadsCache[i];
        const item = document.createElement('div');
        item.className = 'omibot-thread-list-item';
        const row = document.createElement('div');
        row.className = 'omibot-thread-row' + (t.id === activeId ? ' active' : '');

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'omibot-thread-select';
        selectBtn.dataset.threadId = t.id;
        const titleEl = document.createElement('span');
        titleEl.className = 'omibot-thread-item-title';
        titleEl.textContent = t.title || 'Conversation';
        selectBtn.appendChild(titleEl);
        selectBtn.addEventListener('click', function () {
          if (sending || t.id === getThreadId()) return;
          selectThread(t.id);
        });

        const menuWrap = document.createElement('div');
        menuWrap.className = 'omibot-thread-menu-wrap';

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'omibot-thread-menu-btn';
        menuBtn.setAttribute('aria-label', 'Conversation options');
        menuBtn.setAttribute('aria-haspopup', 'true');
        menuBtn.textContent = '\u22EE';
        menuBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          toggleThreadMenu(row, menuBtn, t.id);
        });

        menuWrap.appendChild(menuBtn);
        row.appendChild(selectBtn);
        row.appendChild(menuWrap);
        item.appendChild(row);
        threadListEl.appendChild(item);
      }
      appendThreadMetaFooter();
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
        dailyMessageLimit: data.dailyMessageLimit != null ? data.dailyMessageLimit : 11,
        dailyMessageCount: data.dailyMessageCount != null ? data.dailyMessageCount : 0,
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
      closeAllThreadMenus();
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
      updateActiveToolbar(threadId);
    }

    function beginNewConversation() {
      closeAllThreadMenus();
      clearThreadId();
      clearLog();
      restoreWelcome();
      threadToolbar.hidden = true;
      renderThreadList(null);
    }

    async function createNewThread() {
      if (!ready || sending) return;
      if (!getThreadId()) {
        beginNewConversation();
        return;
      }
      if (threadsMeta.threadCount >= threadsMeta.threadLimit) {
        appendThreadLimitMessage(threadsMeta.threadLimit, threadsMeta.tier);
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
          body: JSON.stringify({ title: 'Conversation' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === 'thread_limit') {
            appendThreadLimitMessage(data.limit || threadsMeta.threadLimit, data.tier || threadsMeta.tier);
          } else {
            append('System', data.message || data.error || 'Could not start a new conversation.');
          }
          return;
        }
        await fetchThreads(tok);
        const id = data.thread && data.thread.id;
        if (id) {
          beginNewConversation();
          setThreadId(id);
          renderThreadList(id);
          updateActiveToolbar(id);
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
      status.textContent = '';
      status.hidden = true;
      await fetchThreads(token);
      beginNewConversation();
      ready = true;
      refreshInputEnabled();
    }

    ensureToken()
      .then(function () {
        return initSession();
      })
      .catch(function (e) {
        status.hidden = false;
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
      if (isAtDailyMessageLimit()) {
        appendDailyLimitMessage(threadsMeta.dailyMessageLimit, threadsMeta.tier);
        return;
      }
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
            status.hidden = false;
            status.textContent = 'Session expired. Refresh the page to sign in again.';
          }
          if (result.data.error === 'thread_limit') {
            appendThreadLimitMessage(
              result.data.limit || threadsMeta.threadLimit,
              result.data.tier || threadsMeta.tier
            );
            return;
          }
          if (result.data.error === 'daily_message_limit') {
            if (result.data.dailyMessageCount != null) {
              threadsMeta.dailyMessageCount = result.data.dailyMessageCount;
            }
            if (result.data.dailyMessageLimit != null) {
              threadsMeta.dailyMessageLimit = result.data.dailyMessageLimit;
            }
            appendDailyLimitMessage(
              result.data.dailyMessageLimit || threadsMeta.dailyMessageLimit,
              result.data.tier || threadsMeta.tier
            );
            updateThreadMeta();
            return;
          }
          append('System', result.data.message || result.data.error || 'Request failed');
          return;
        }
        if (result.data.threadId) {
          setThreadId(result.data.threadId);
          if (result.data.threadTitle) {
            for (let ti = 0; ti < threadsCache.length; ti++) {
              if (threadsCache[ti].id === result.data.threadId) {
                threadsCache[ti].title = result.data.threadTitle;
                break;
              }
            }
          }
          await fetchThreads(tok);
          renderThreadList(result.data.threadId);
          updateActiveToolbar(result.data.threadId);
        }
        if (result.data.dailyMessageCount != null) {
          threadsMeta.dailyMessageCount = result.data.dailyMessageCount;
        }
        if (result.data.dailyMessageLimit != null) {
          threadsMeta.dailyMessageLimit = result.data.dailyMessageLimit;
        }
        append('Companion', result.data.text || '');
        updateThreadMeta();
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
      } finally {
        removeThinking();
        sending = false;
        refreshInputEnabled();
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
