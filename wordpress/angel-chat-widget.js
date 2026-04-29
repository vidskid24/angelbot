/**
 * Minimal embeddable chat for a WordPress page.
 *
 * Setup:
 * 1. Host this file or inline it after setting window.ANGELBOT_API_BASE and optionally window.ANGELBOT_SESSION_ID.
 * 2. After Thinkific SSO completes, the app redirects to your page with hash:
 *    #angelbot_access_token=<jwt>
 * 3. The script reads the token from the hash, stores it in sessionStorage, clears the hash.
 *
 * Example (before this script):
 *   window.ANGELBOT_API_BASE = 'https://api.yoursite.com';
 *   window.ANGELBOT_SESSION_ID = 'my-thread-1'; // optional, stable per conversation
 */

(function () {
  const API = window.ANGELBOT_API_BASE || '';
  if (!API) {
    console.error('AngelBot: set window.ANGELBOT_API_BASE to your API origin (no trailing slash)');
    return;
  }

  const HASH_KEY = 'angelbot_access_token=';
  const STORAGE_KEY = 'angelbot_access_token';

  function readTokenFromHash() {
    const h = window.location.hash || '';
    if (!h.includes(HASH_KEY)) return null;
    const part = h.slice(1).split('&').find((p) => p.startsWith(HASH_KEY));
    if (!part) return null;
    return decodeURIComponent(part.slice(HASH_KEY.length));
  }

  function bootstrapToken() {
    const fromHash = readTokenFromHash();
    if (fromHash) {
      sessionStorage.setItem(STORAGE_KEY, fromHash);
      const url = new URL(window.location.href);
      url.hash = '';
      history.replaceState(null, '', url.pathname + url.search);
    }
  }

  function getToken() {
    return sessionStorage.getItem(STORAGE_KEY);
  }

  function mount(rootId) {
    const root = document.getElementById(rootId || 'angelbot-chat-root');
    if (!root) {
      console.error('AngelBot: add <div id="angelbot-chat-root"></div> to the page');
      return;
    }

    root.innerHTML =
      '<div class="angelbot-chat" style="font-family:system-ui,sans-serif;max-width:42rem">' +
      '<p id="angelbot-status" style="color:#666;font-size:0.9rem">Not signed in. Open the chat from your course link.</p>' +
      '<div id="angelbot-log" style="border:1px solid #ddd;border-radius:8px;padding:12px;min-height:12rem;max-height:24rem;overflow:auto;background:#fafafa;margin:8px 0"></div>' +
      '<textarea id="angelbot-input" rows="3" style="width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #ccc" placeholder="Your reflection or question…"></textarea>' +
      '<button id="angelbot-send" type="button" style="margin-top:8px;padding:8px 16px;border-radius:8px;border:0;background:#333;color:#fff;cursor:pointer">Send</button>' +
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

    const token = getToken();
    if (token) status.textContent = 'Signed in. Session is stored in this browser until you close the tab.';

    async function send() {
      const message = (input.value || '').trim();
      if (!message) return;
      const tok = getToken();
      if (!tok) {
        status.textContent = 'Missing session. Use your course SSO link to open this page.';
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
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) send();
    });
  }

  bootstrapToken();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount(window.ANGELBOT_ROOT_ID);
    });
  } else {
    mount(window.ANGELBOT_ROOT_ID);
  }
})();
