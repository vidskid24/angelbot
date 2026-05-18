/**
 * Minimal embeddable chat for a Thinkific (or any) site page.
 *
 * Hosted by the API at GET /angel-chat-widget.js when deployed.
 *
 * Setup:
 * 1. Set window.ANGELBOT_API_BASE (required).
 * 2. Provide user context for bootstrap token issuance:
 *    window.ANGELBOT_USER = { external_id, email, first_name, last_name };
 *    - external_id OR email is required
 * 3. Optional: window.ANGELBOT_SESSION_ID for stable thread id
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

  async function ensureToken() {
    const existing = getToken();
    if (existing) return existing;

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

  function mount(rootId) {
    const root = document.getElementById(rootId || 'angelbot-chat-root');
    if (!root) {
      console.error('AngelBot: add <div id="angelbot-chat-root"></div> to the page');
      return;
    }

    root.innerHTML =
      '<div class="angelbot-chat" style="font-family:system-ui,sans-serif;max-width:42rem">' +
      '<p id="angelbot-status" style="color:#666;font-size:0.9rem">Preparing chat session...</p>' +
      '<div id="angelbot-log" style="border:1px solid #ddd;border-radius:8px;padding:12px;min-height:12rem;max-height:24rem;overflow:auto;background:#fafafa;margin:8px 0"></div>' +
      '<textarea id="angelbot-input" rows="3" style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #ccc" placeholder="Your reflection or question..."></textarea>' +
      '<button id="angelbot-send" type="button" style="margin-top:8px;padding:8px 16px;border-radius:8px;border:0;background:#333;color:#fff;cursor:pointer" disabled>Send</button>' +
      '</div>';

    const status = root.querySelector('#angelbot-status');
    const log = root.querySelector('#angelbot-log');
    const input = root.querySelector('#angelbot-input');
    const btn = root.querySelector('#angelbot-send');

    function append(role, text) {
      const d = document.createElement('div');
      d.style.margin = '8px 0';
      d.style.whiteSpace = 'pre-wrap';
      d.innerHTML = '<strong>' + role + '</strong><br/>' + escapeHtml(text);
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    ensureToken()
      .then(function () {
        status.textContent = 'Signed in. Your session is active in this browser tab.';
        btn.disabled = false;
      })
      .catch(function (e) {
        status.textContent = 'Unable to create session: ' + String(e && e.message ? e.message : e);
      });

    async function send() {
      const message = (input.value || '').trim();
      if (!message) return;
      const tok = getToken();
      if (!tok) {
        status.textContent = 'Missing session token. Refresh and try again.';
        return;
      }
      append('You', message);
      input.value = '';
      btn.disabled = true;
      try {
        const sessionId = window.ANGELBOT_SESSION_ID || undefined;
        const res = await fetch(API.replace(/\/$/, '') + '/api/chat/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + tok,
          },
          body: JSON.stringify({ message, sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          append('System', data.message || data.error || 'Request failed');
          return;
        }
        append('Companion', data.text || '');
      } catch (e) {
        append('System', String(e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
      }
    }

    btn.addEventListener('click', send);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) send();
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
