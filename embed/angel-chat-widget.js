/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 * ANGELBOT_WIDGET_VERSION=19
 *
 * Hosted by the API at GET /angel-chat-widget.js when deployed.
 */

(function () {
  const API = window.ANGELBOT_API_BASE || '';
  if (!API) {
    console.error('AngelBot: set window.ANGELBOT_API_BASE to your API origin (no trailing slash)');
    return;
  }

  const STORAGE_KEY = 'angelbot_access_token';

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
    const user = window.ANGELBOT_USER || {};
    const first = String(user.first_name || '').trim();
    if (!isLiquidPlaceholder(first)) return first;
    return 'friend';
  }

  function getToken() {
    return sessionStorage.getItem(STORAGE_KEY);
  }

  function setToken(tok) {
    sessionStorage.setItem(STORAGE_KEY, tok);
  }

  function clearToken() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function isTokenExpired(tok) {
    try {
      const part = tok.split('.')[1];
      if (!part) return true;
      const payload = JSON.parse(
        atob(part.replace(/-/g, '+').replace(/_/g, '/'))
      );
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

    const user = window.ANGELBOT_USER || {};
    if (!user.external_id && !user.email) {
      throw new Error('Missing ANGELBOT_USER.external_id or ANGELBOT_USER.email');
    }

    const res = await fetch(API.replace(/\/$/, '') + '/auth/bootstrap', {
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
      strong.className = 'angelbot-bold';
      strong.textContent = match[1];
      parent.appendChild(strong);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < normalized.length) {
      parent.appendChild(document.createTextNode(normalized.slice(lastIndex)));
    }
  }

  function mount(rootId) {
    const root = document.getElementById(rootId || 'angelbot-chat-root');
    if (!root) {
      console.error('AngelBot: add <div id="angelbot-chat-root"></div> to the page');
      return;
    }

    root.innerHTML =
      '<style>' +
      '.angelbot-chat{font-family:system-ui,-apple-system,sans-serif;max-width:600px;width:100%;margin:0 auto;padding:0 16px;box-sizing:border-box;color:#1a1a1a}' +
      '.angelbot-chat .angelbot-bold{font-weight:700!important}' +
      '#angelbot-welcome{margin:0 0 12px}' +
      '.angelbot-hello{font-size:clamp(2rem,6vw,2.75rem);font-weight:400;margin:0 0 8px;line-height:1.15;letter-spacing:-0.02em}' +
      '.angelbot-welcome-prompt{font-size:1.05rem;line-height:1.55;color:#444;margin:0}' +
      '#angelbot-status{margin:0 0 8px;color:#666;font-size:0.9rem;text-align:center}' +
      '#angelbot-log{min-height:0;overflow:visible;padding:0;margin:0 0 12px}' +
      '.angelbot-msg-user{display:flex;justify-content:flex-end;margin:12px 0}' +
      '.angelbot-msg-user .angelbot-bubble{background:#e8e4dc;border-radius:14px;padding:12px 16px;max-width:85%;line-height:1.5;white-space:pre-wrap}' +
      '.angelbot-msg-bot{margin:16px 0;line-height:1.55;white-space:pre-wrap;max-width:100%}' +
      '.angelbot-msg-system{margin:12px 0;padding:10px 12px;border-radius:8px;background:#f0ebe3;color:#5c5348;font-size:0.9rem;line-height:1.45}' +
      '.angelbot-thinking{margin:16px 0;color:#666;font-size:0.95rem}' +
      '.angelbot-thinking-dots{display:inline-block;margin-left:2px}' +
      '.angelbot-thinking-dots span{display:inline-block;animation:angelbot-dot 1.2s ease-in-out infinite}' +
      '.angelbot-thinking-dots span:nth-child(2){animation-delay:.15s}' +
      '.angelbot-thinking-dots span:nth-child(3){animation-delay:.3s}' +
      '@keyframes angelbot-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}' +
      '#angelbot-input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid #ddd;background:#fff;font:inherit;font-size:1rem;resize:vertical}' +
      '#angelbot-input:focus{outline:2px solid #c9c0b5;outline-offset:1px;border-color:#c9c0b5}' +
      '</style>' +
      '<div class="angelbot-chat">' +
      '<p id="angelbot-status">Preparing chat session...</p>' +
      '<div id="angelbot-welcome"></div>' +
      '<div id="angelbot-log"></div>' +
      '<textarea id="angelbot-input" rows="2" placeholder="Write a message..."></textarea>' +
      '</div>';

    const status = root.querySelector('#angelbot-status');
    const welcome = root.querySelector('#angelbot-welcome');
    const log = root.querySelector('#angelbot-log');
    const input = root.querySelector('#angelbot-input');
    let ready = false;
    let welcomeDismissed = false;

    function dismissWelcome() {
      if (welcomeDismissed) return;
      welcomeDismissed = true;
      welcome.replaceChildren();
      welcome.hidden = true;
    }

    function showWelcome() {
      const hello = document.createElement('p');
      hello.className = 'angelbot-hello';
      hello.textContent = formatWelcomeLine();
      const prompt = document.createElement('p');
      prompt.className = 'angelbot-welcome-prompt';
      prompt.textContent = pickWelcomePrompt();
      welcome.appendChild(hello);
      welcome.appendChild(prompt);
    }

    showWelcome();
    let sending = false;
    let thinkingEl = null;

    function setInputEnabled(on) {
      input.disabled = !on;
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
      const stale = log.querySelector('#angelbot-thinking');
      if (stale) stale.remove();
    }

    function showThinking() {
      removeThinking();
      const d = document.createElement('div');
      d.id = 'angelbot-thinking';
      d.className = 'angelbot-thinking angelbot-msg-bot';

      const line = document.createElement('span');
      line.appendChild(document.createTextNode('Reflecting'));
      const dots = document.createElement('span');
      dots.className = 'angelbot-thinking-dots';
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
        ? 'angelbot-msg-user'
        : isSystem
          ? 'angelbot-msg-system'
          : 'angelbot-msg-bot';

      if (isUser) {
        const bubble = document.createElement('div');
        bubble.className = 'angelbot-bubble';
        bubble.textContent = text;
        row.appendChild(bubble);
      } else {
        const body = document.createElement('div');
        body.className = 'angelbot-message-body';
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

    ensureToken()
      .then(function () {
        status.textContent = "You're Signed In";
        ready = true;
        setInputEnabled(true);
      })
      .catch(function (e) {
        status.textContent = 'Unable to create session: ' + String(e && e.message ? e.message : e);
        setInputEnabled(false);
      });

    setInputEnabled(false);

    async function postChat(message, token) {
      const sessionId = window.ANGELBOT_SESSION_ID || undefined;
      const res = await fetch(API.replace(/\/$/, '') + '/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ message, sessionId }),
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
      mount(window.ANGELBOT_ROOT_ID);
    });
  } else {
    mount(window.ANGELBOT_ROOT_ID);
  }
})();
