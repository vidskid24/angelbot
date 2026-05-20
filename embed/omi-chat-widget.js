/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 * OMIBOT_WIDGET_VERSION=59
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

  /** Starter prompts for empty conversations (Teachers of Light omitted — discover-only). */
  const SUGGESTION_CHIPS = [
    { text: "Something\u2019s on my heart \u2014 I\u2019d like to be heard." },
    { text: "Help me understand what\u2019s happening energetically." },
    { text: "I\u2019d like to try a tool or practice from the coursework." },
    { text: "Help me capture what I\u2019m noticing today." },
    { text: "Walk me through a step-by-step energetic shift." },
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

  function pickSuggestionChips(count) {
    const pool = SUGGESTION_CHIPS.slice();
    const out = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
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

  function isValidItalicContent(inner) {
    const t = String(inner || '').trim();
    if (!t || t.length > 40) return false;
    if (/\n/.test(t)) return false;
    if (t.split(/\s+/).length > 4) return false;
    return true;
  }

  function appendItalicInTextChunk(parent, chunk) {
    const italicRe = /(?<!\*)\*(?!\*)(?!\s)([^*\n]{1,40}?)(?<!\s)\*(?!\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = italicRe.exec(chunk)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(chunk.slice(lastIndex, match.index)));
      }
      if (isValidItalicContent(match[1])) {
        const em = document.createElement('em');
        em.className = 'omibot-italic';
        em.textContent = match[1];
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = italicRe.lastIndex;
    }
    if (lastIndex < chunk.length) {
      parent.appendChild(document.createTextNode(chunk.slice(lastIndex)));
    }
  }

  function appendFormattedContent(parent, text) {
    const normalized = normalizeBoldMarkers(text);
    const boldRe = /\*\*([^*]+?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = boldRe.exec(normalized)) !== null) {
      if (match.index > lastIndex) {
        appendItalicInTextChunk(parent, normalized.slice(lastIndex, match.index));
      }
      const strong = document.createElement('strong');
      strong.className = 'omibot-bold';
      strong.textContent = match[1];
      parent.appendChild(strong);
      lastIndex = boldRe.lastIndex;
    }
    if (lastIndex < normalized.length) {
      appendItalicInTextChunk(parent, normalized.slice(lastIndex));
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
      '.omibot-shell .omibot-italic{font-style:italic}' +
      '.omibot-layout{display:flex;align-items:flex-start;gap:0;margin-top:8px}' +
      '.omibot-sidebar{width:11.5rem;flex-shrink:0;border-right:1px solid #e0dcd4;padding:4px 12px 16px 0;box-sizing:border-box}' +
      '.omibot-sidebar .omibot-new-btn,.omibot-sidebar .omibot-thread-list,.omibot-sidebar .omibot-thread-row{width:100%}' +
      '.omibot-tier-row{display:flex;align-items:center;justify-content:space-between;width:100%;flex-wrap:wrap;gap:10px;margin:0 0 8px;line-height:1.35;box-sizing:border-box}' +
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
      '.omibot-suggestions{margin:12px 0 0}' +
      '.omibot-suggestions[hidden]{display:none!important}' +
      '.omibot-suggestions-label{margin:0 0 8px;font-size:0.8rem;font-weight:600;color:#666;letter-spacing:0.02em}' +
      '.omibot-suggestions-chips{display:flex;flex-wrap:wrap;gap:8px}' +
      '.omibot-suggestion-chip{display:inline-flex;align-items:center;max-width:100%;padding:10px 14px;border:1px solid #e0dcd4;border-radius:999px;background:#f5f3ef;font:inherit;font-size:0.88rem;line-height:1.35;color:#1a1a1a;cursor:pointer;text-align:left}' +
      '.omibot-suggestion-chip:hover:not(:disabled){background:#ebe6dc;border-color:#c9c0b5}' +
      '.omibot-suggestion-chip:disabled{opacity:0.45;cursor:not-allowed}' +
      '.omibot-prefs-btn{margin:0;padding:0;border:none;background:transparent;font:inherit;font-size:0.7rem;font-weight:600;letter-spacing:0.04em;color:#7a5c1e;cursor:pointer;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;flex-shrink:0}' +
      '.omibot-prefs-btn:hover{color:#1a1a1a}' +
      '.omibot-chat-view[hidden],.omibot-prefs-view[hidden]{display:none!important}' +
      '.omibot-layout.is-prefs-mode .omibot-sidebar{display:none}' +
      '.omibot-layout.is-prefs-mode .omibot-main{width:100%;padding-left:0}' +
      '.omibot-prefs-view{padding:0 0 12px}' +
      '.omibot-prefs-back{display:inline-flex;align-items:center;margin:0 0 14px;padding:0;border:none;background:transparent;font:inherit;font-size:0.9rem;color:#7a5c1e;cursor:pointer;text-decoration:underline;text-underline-offset:2px}' +
      '.omibot-prefs-back:hover{color:#1a1a1a}' +
      '.omibot-prefs-back[hidden]{display:none!important}' +
      '.omibot-prefs-view h2{margin:0 0 8px;font-size:1.35rem;font-weight:500}' +
      '.omibot-prefs-desc{margin:0 0 18px;font-size:0.92rem;line-height:1.5;color:#555}' +
      '.omibot-prefs-footer{position:sticky;bottom:0;z-index:2;margin-top:20px;padding:12px 0;padding-bottom:max(12px,env(safe-area-inset-bottom));background:linear-gradient(to top,#fff 85%,rgba(255,255,255,0))}' +
      '.omibot-prefs-field{margin:0 0 14px}' +
      '.omibot-prefs-field label{display:block;font-size:0.85rem;font-weight:600;color:#444;margin-bottom:6px}' +
      '.omibot-prefs-field select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #ddd;font:inherit;font-size:0.95rem;background:#fff}' +
      '.omibot-prefs-field textarea{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #ddd;font:inherit;font-size:0.9rem;line-height:1.45;background:#fff;resize:vertical;min-height:5rem}' +
      '.omibot-prefs-field textarea.omibot-memory-summary{min-height:11rem;font-family:Georgia,serif}' +
      '.omibot-prefs-field textarea:disabled{background:#f5f3ef;color:#888;cursor:not-allowed}' +
      '.omibot-prefs-memory-note{font-size:0.82rem;color:#666;margin:4px 0 8px;line-height:1.4}' +
      '.omibot-prefs-memory-upgrade{font-size:0.82rem;color:#666;margin:0 0 10px;line-height:1.4}' +
      '.omibot-prefs-memory-upgrade a.omibot-tier-link{color:#7a5c1e}' +
      '.omibot-prefs-paid-only{font-style:italic;font-weight:400;color:#999;margin-left:6px;font-size:0.88em;letter-spacing:0;text-transform:none}' +
      '.omibot-prefs-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}' +
      '.omibot-prefs-save{padding:10px 18px;border-radius:10px;border:none;background:#7a5c1e;color:#fff;font:inherit;font-size:0.95rem;cursor:pointer}' +
      '.omibot-prefs-save:hover{background:#5c4616}' +
      '.omibot-prefs-save:disabled{opacity:.55;cursor:not-allowed}' +
      '.omibot-prefs-footer .omibot-prefs-error{margin:0 0 10px}' +
      '.omibot-prefs-error{font-size:0.85rem;color:#8b3a3a}' +
      '@media(max-width:640px){.omibot-layout{flex-direction:column}.omibot-sidebar{width:100%;border-right:none;border-bottom:1px solid #e0dcd4;padding:0 0 12px;margin-bottom:12px}.omibot-main{padding-left:0}}' +
      '</style>' +
      '<div class="omibot-shell">' +
      '<p id="omibot-status" hidden></p>' +
      '<div class="omibot-layout">' +
      '<aside class="omibot-sidebar">' +
      '<div class="omibot-tier-row"><button type="button" class="omibot-prefs-btn" id="omibot-prefs-open">Preferences</button><span id="omibot-tier-badge"></span></div>' +
      '<button type="button" class="omibot-new-btn" id="omibot-new-thread">+ New conversation</button>' +
      '<p class="omibot-recents-label">Recents</p>' +
      '<div class="omibot-thread-list" id="omibot-thread-list"></div>' +
      '</aside>' +
      '<div class="omibot-main">' +
      '<div class="omibot-chat-view" id="omibot-chat-view">' +
      '<div id="omibot-welcome"></div>' +
      '<div id="omibot-log"></div>' +
      '<textarea id="omibot-input" rows="2" placeholder="Write a message..."></textarea>' +
      '<div class="omibot-suggestions" id="omibot-suggestions" hidden>' +
      '<p class="omibot-suggestions-label">Suggestions to try</p>' +
      '<div class="omibot-suggestions-chips" id="omibot-suggestions-chips"></div>' +
      '</div>' +
      '<section class="omibot-prefs-view" id="omibot-prefs-view" hidden aria-labelledby="omibot-prefs-title">' +
      '<button type="button" class="omibot-prefs-back" id="omibot-prefs-back">\u2190 Back to chat</button>' +
      '<h2 id="omibot-prefs-title">Preferences</h2>' +
      '<p class="omibot-prefs-desc" id="omibot-prefs-desc">You can change these anytime.</p>' +
      '<div class="omibot-prefs-field">' +
      '<label for="omibot-pref-tone">How would you like Omi to hold the space with you?</label>' +
      '<select id="omibot-pref-tone">' +
      '<option value="warm">Warm and companionable</option>' +
      '<option value="playful">Playful and lighthearted</option>' +
      '<option value="concise">Concise and direct</option>' +
      '</select></div>' +
      '<div class="omibot-prefs-field">' +
      '<label for="omibot-pref-ma">Your experience with Mastering Alchemy</label>' +
      '<select id="omibot-pref-ma">' +
      '<option value="new">Just getting started</option>' +
      '<option value="some_experience">Some experience</option>' +
      '<option value="long_time">Long-time participant</option>' +
      '</select></div>' +
      '<p class="omibot-prefs-memory-upgrade" id="omibot-prefs-memory-upgrade" hidden>' +
      'Memory across conversations is available on the paid plan. <a class="omibot-tier-link" id="omibot-prefs-memory-upgrade-link" href="#" target="_blank" rel="noopener noreferrer">Upgrade</a></p>' +
      '<div class="omibot-prefs-field">' +
      '<label for="omibot-pref-memory-instructions">What I would like Omi to know about me <span class="omibot-prefs-paid-only">paid plans only</span></label>' +
      '<textarea id="omibot-pref-memory-instructions" rows="4" placeholder="Optional — Tell Omi a little about you. Sharing your interests or learning style help customize responses to feel more aligned and clear."></textarea>' +
      '</div>' +
      '<div class="omibot-prefs-field" id="omibot-prefs-memory-summary-field">' +
      '<label for="omibot-pref-memory-summary">What Omi remembers <span class="omibot-prefs-paid-only">paid plans only</span></label>' +
      '<p class="omibot-prefs-memory-note" id="omibot-prefs-memory-note">Here\u2019s what Omi remembers about you. This summary is regenerated each night based off your conversations.</p>' +
      '<textarea id="omibot-pref-memory-summary" class="omibot-memory-summary" rows="10" placeholder="Work context, personal context, how to work with you, top of mind, and brief history will appear here."></textarea>' +
      '</div>' +
      '<div class="omibot-prefs-footer">' +
      '<p class="omibot-prefs-error" id="omibot-prefs-error" hidden></p>' +
      '<div class="omibot-prefs-actions">' +
      '<button type="button" class="omibot-prefs-save" id="omibot-prefs-save">Save preferences</button>' +
      '</div></div></section></div></div></div>';

    const status = root.querySelector('#omibot-status');
    const welcome = root.querySelector('#omibot-welcome');
    const log = root.querySelector('#omibot-log');
    const input = root.querySelector('#omibot-input');
    const suggestionsEl = root.querySelector('#omibot-suggestions');
    const suggestionsChipsEl = root.querySelector('#omibot-suggestions-chips');
    const threadListEl = root.querySelector('#omibot-thread-list');
    const tierBadgeEl = root.querySelector('#omibot-tier-badge');
    const upgradeUrl =
      window.OMIBOT_UPGRADE_URL ||
      window.ANGELBOT_UPGRADE_URL ||
      'https://courses.masteringalchemy.com/pages/omi-ai';

    function appendThreadLimitMessage(limit, tier) {
      const cap = limit || 3;
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
      if (log.querySelector('#omibot-daily-limit-notice')) return;
      const cap = limit || threadsMeta.dailyMessageLimit || 11;
      const isPaid = tier === 'paid';
      const row = document.createElement('div');
      row.id = 'omibot-daily-limit-notice';
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


    function removeDailyLimitNotice() {
      const el = log.querySelector('#omibot-daily-limit-notice');
      if (el) el.remove();
    }

    function syncDailyLimitUi() {
      appendDailyMetaFooter();
      if (!ready) return;
      if (isAtDailyMessageLimit()) {
        appendDailyLimitMessage(threadsMeta.dailyMessageLimit, threadsMeta.tier);
      } else {
        removeDailyLimitNotice();
      }
      refreshInputEnabled();
    }

    function refreshInputEnabled() {
      if (!ready || sending) return;
      const atLimit = isAtDailyMessageLimit();
      setInputEnabled(!atLimit);
      input.placeholder = atLimit
        ? "You've reached today's message limit. Try again tomorrow."
        : 'Write a message...';
    }

    const newThreadBtn = root.querySelector('#omibot-new-thread');
    const prefsOpenBtn = root.querySelector('#omibot-prefs-open');

    let userPrefs = {
      tone: 'warm',
      maExperience: 'some_experience',
      preferencesCompleted: false,
      tier: 'free',
      memoryInstructions: '',
      memorySummary: '',
      memoryAvailable: false,
    };

    const layoutEl = root.querySelector('.omibot-layout');
    const chatViewEl = root.querySelector('#omibot-chat-view');
    const prefsViewEl = root.querySelector('#omibot-prefs-view');

    const prefsTitleEl = prefsViewEl.querySelector('#omibot-prefs-title');
    const prefsDescEl = prefsViewEl.querySelector('#omibot-prefs-desc');
    const prefsToneSelect = prefsViewEl.querySelector('#omibot-pref-tone');
    const prefsMaSelect = prefsViewEl.querySelector('#omibot-pref-ma');
    const prefsSaveBtn = prefsViewEl.querySelector('#omibot-prefs-save');
    const prefsBackBtn = prefsViewEl.querySelector('#omibot-prefs-back');
    const prefsErrorEl = prefsViewEl.querySelector('#omibot-prefs-error');
    const prefsMemoryInstructions = prefsViewEl.querySelector('#omibot-pref-memory-instructions');
    const prefsMemorySummary = prefsViewEl.querySelector('#omibot-pref-memory-summary');
    const prefsMemoryUpgrade = prefsViewEl.querySelector('#omibot-prefs-memory-upgrade');
    const prefsMemoryUpgradeLink = prefsViewEl.querySelector('#omibot-prefs-memory-upgrade-link');
    const prefsMemoryNote = prefsViewEl.querySelector('#omibot-prefs-memory-note');
    const prefsMemorySummaryField = prefsViewEl.querySelector('#omibot-prefs-memory-summary-field');
    let prefsViewMode = null;

    function isPaidTier() {
      return userPrefs.tier === 'paid' || threadsMeta.tier === 'paid';
    }

    function applyMemoryFieldsUi() {
      const paid = isPaidTier();
      const isOnboarding = prefsViewMode === 'onboarding';
      if (prefsMemorySummaryField) prefsMemorySummaryField.hidden = isOnboarding;
      if (prefsMemoryUpgrade) prefsMemoryUpgrade.hidden = paid || isOnboarding;
      if (prefsMemoryInstructions) {
        prefsMemoryInstructions.disabled = !paid;
        prefsMemoryInstructions.value = userPrefs.memoryInstructions || '';
      }
      if (prefsMemorySummary) {
        prefsMemorySummary.disabled = !paid;
        prefsMemorySummary.value = userPrefs.memorySummary || '';
      }
      if (prefsMemoryNote) prefsMemoryNote.hidden = !paid;
      if (prefsMemoryUpgradeLink) prefsMemoryUpgradeLink.href = upgradeUrl;
    }

    function syncPrefsFormFromState() {
      if (prefsToneSelect) prefsToneSelect.value = userPrefs.tone || 'warm';
      if (prefsMaSelect) prefsMaSelect.value = userPrefs.maExperience || 'some_experience';
      applyMemoryFieldsUi();
    }

    function setPrefsError(msg) {
      if (!prefsErrorEl) return;
      if (msg) {
        prefsErrorEl.textContent = msg;
        prefsErrorEl.hidden = false;
      } else {
        prefsErrorEl.textContent = '';
        prefsErrorEl.hidden = true;
      }
    }

    function showPrefsView(mode) {
      const isOnboarding = mode === 'onboarding';
      prefsViewMode = mode || 'edit';
      if (prefsTitleEl) {
        prefsTitleEl.textContent = isOnboarding ? 'Before you begin...' : 'Preferences';
      }
      if (prefsDescEl) {
        prefsDescEl.textContent = isOnboarding
          ? 'Choose what feels aligned for you today. You can change these anytime.'
          : 'You can change these anytime.';
      }
      if (prefsBackBtn) prefsBackBtn.hidden = isOnboarding;
      syncPrefsFormFromState();
      setPrefsError('');
      chatViewEl.hidden = true;
      prefsViewEl.hidden = false;
      if (layoutEl) layoutEl.classList.add('is-prefs-mode');
      if (prefsSaveBtn) prefsSaveBtn.disabled = false;
      if (isOnboarding) {
        ready = false;
        setInputEnabled(false);
      }
      try {
        root.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) {
        root.scrollIntoView(true);
      }
    }

    function showChatView() {
      prefsViewMode = null;
      prefsViewEl.hidden = true;
      chatViewEl.hidden = false;
      if (layoutEl) layoutEl.classList.remove('is-prefs-mode');
      syncPrefsFormFromState();
      setPrefsError('');
    }

    async function fetchPreferences(token) {
      const res = await fetch(API_BASE + '/api/user/preferences', { headers: authHeaders(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      return data;
    }

    async function savePreferencesFromModal(token) {
      setPrefsError('');
      if (prefsSaveBtn) prefsSaveBtn.disabled = true;
      try {
        const body = {
          tone: prefsToneSelect ? prefsToneSelect.value : 'warm',
          maExperience: prefsMaSelect ? prefsMaSelect.value : 'some_experience',
        };
        if (isPaidTier()) {
          if (prefsMemoryInstructions) body.memoryInstructions = prefsMemoryInstructions.value;
          if (prefsViewMode !== 'onboarding' && prefsMemorySummary) {
            body.memorySummary = prefsMemorySummary.value;
          }
        }
        const res = await fetch(API_BASE + '/api/user/preferences', {
          method: 'PATCH',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPrefsError(data.message || data.error || 'Could not save preferences.');
          return false;
        }
        userPrefs = {
          tone: data.tone || 'warm',
          maExperience: data.maExperience || 'some_experience',
          preferencesCompleted: Boolean(data.preferencesCompleted),
          tier: data.tier || userPrefs.tier || 'free',
          memoryInstructions: data.memoryInstructions || '',
          memorySummary: data.memorySummary || '',
          memoryAvailable: Boolean(data.memoryAvailable),
        };
        if (data.tier) threadsMeta.tier = data.tier;
        updateTierBadge();
        showChatView();
        if (!ready) {
          ready = true;
          syncDailyLimitUi();
        }
        return true;
      } catch (e) {
        setPrefsError(String(e && e.message ? e.message : e));
        return false;
      } finally {
        if (prefsSaveBtn) prefsSaveBtn.disabled = false;
      }
    }

    if (prefsOpenBtn) {
      prefsOpenBtn.addEventListener('click', function () {
        showPrefsView('edit');
      });
    }

    prefsSaveBtn.addEventListener('click', function () {
      ensureToken()
        .then(function (tok) {
          return savePreferencesFromModal(tok);
        })
        .catch(function (e) {
          setPrefsError(String(e && e.message ? e.message : e));
        });
    });

    if (prefsBackBtn) {
      prefsBackBtn.addEventListener('click', function () {
        syncPrefsFormFromState();
        showChatView();
      });
    }

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
    if (chatViewEl) chatViewEl.insertBefore(threadToolbar, welcome);
    else mainEl.insertBefore(threadToolbar, welcome);

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
      threadLimit: 3,
      threadCount: 0,
      tier: 'free',
      dailyMessageLimit: 11,
      dailyMessageCount: 0,
    };
    let threadsCache = [];

    function hideSuggestionChips() {
      if (suggestionsEl) suggestionsEl.hidden = true;
      if (suggestionsChipsEl) suggestionsChipsEl.replaceChildren();
    }

    function renderSuggestionChips() {
      if (!suggestionsEl || !suggestionsChipsEl) return;
      suggestionsChipsEl.replaceChildren();
      const chips = pickSuggestionChips(2);
      for (let i = 0; i < chips.length; i++) {
        const chip = chips[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'omibot-suggestion-chip';
        btn.textContent = chip.text;
        btn.disabled = Boolean(input && input.disabled);
        btn.addEventListener('click', function () {
          if (!input || input.disabled) return;
          input.value = chip.text;
          input.focus();
        });
        suggestionsChipsEl.appendChild(btn);
      }
      suggestionsEl.hidden = chips.length === 0;
    }

    function dismissWelcome() {
      if (welcomeDismissed) return;
      welcomeDismissed = true;
      welcome.replaceChildren();
      welcome.hidden = true;
      hideSuggestionChips();
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
      renderSuggestionChips();
    }

    function showWelcome() {
      restoreWelcome();
    }

    showWelcome();

    function setInputEnabled(on) {
      input.disabled = !on;
      if (suggestionsChipsEl) {
        const chips = suggestionsChipsEl.querySelectorAll('.omibot-suggestion-chip');
        for (let i = 0; i < chips.length; i++) chips[i].disabled = !on;
      }
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
      syncDailyLimitUi();
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
        appendDailyMetaFooter();
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
      appendDailyMetaFooter();
    }

    async function fetchThreads(token) {
      const res = await fetch(API_BASE + '/api/threads', { headers: authHeaders(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      threadsCache = data.threads || [];
      threadsMeta = {
        threadLimit: data.threadLimit || 3,
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
      syncDailyLimitUi();
    }

    function beginNewConversation() {
      closeAllThreadMenus();
      clearThreadId();
      clearLog();
      restoreWelcome();
      threadToolbar.hidden = true;
      renderThreadList(null);
      syncDailyLimitUi();
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
      const prefs = await fetchPreferences(token);
      if (prefs) {
        userPrefs = {
          tone: prefs.tone || 'warm',
          maExperience: prefs.maExperience || 'some_experience',
          preferencesCompleted: Boolean(prefs.preferencesCompleted),
          tier: prefs.tier || 'free',
          memoryInstructions: prefs.memoryInstructions || '',
          memorySummary: prefs.memorySummary || '',
          memoryAvailable: Boolean(prefs.memoryAvailable),
        };
        if (prefs.tier) threadsMeta.tier = prefs.tier;
      }
      await fetchThreads(token);
      beginNewConversation();
      if (prefs && !userPrefs.preferencesCompleted) {
        showPrefsView('onboarding');
      } else {
        ready = true;
        syncDailyLimitUi();
      }
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
