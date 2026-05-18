/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 * ANGELBOT_WIDGET_VERSION=4
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
      '<style>.angelbot-chat .angelbot-bold{font-weight:700!important}</style>' +
      '<div class="angelbot-chat" style="font-family:system-ui,sans-serif;max-width:42rem">' +
      '<p id="angelbot-status" style="color:#666;font-size:0.9rem">Preparing chat session...</p>' +
      '<div id="angelbot-log" style="border:1px solid #ddd;border-radius:8px;padding:12px;min-height:12rem;max-height:24rem;overflow:auto;background:#fafafa;margin:8px 0"></div>' +
      '<textarea id="angelbot-input" rows="3" style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #ccc" placeholder="Your reflection or question… (Enter to send, Shift+Enter for new line)"></textarea>' +
      '</div>';

    const status = root.querySelector('#angelbot-status');
    const log = root.querySelector('#angelbot-log');
    const input = root.querySelector('#angelbot-input');
    let ready = false;
    let sending = false;

    function setInputEnabled(on) {
      input.disabled = !on;
    }

    function append(role, text) {
      const d = document.createElement('div');
      d.style.margin = '8px 0';
      d.style.whiteSpace = 'pre-wrap';

      const label = document.createElement('strong');
      label.textContent = role;
      d.appendChild(label);
      d.appendChild(document.createElement('br'));

      const body = document.createElement('span');
      body.className = 'angelbot-message-body';
      if (role === 'You') {
        body.textContent = text;
      } else {
        appendFormattedContent(body, text);
      }
      d.appendChild(body);

      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    ensureToken()
      .then(function () {
        status.textContent = 'Signed in. Your session is active in this browser tab.';
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
      append('You', message);
      input.value = '';
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
        sending = false;
        setInputEnabled(true);
        input.focus();
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
