/**
 * Dropbox API v2 client for listing a folder and downloading files.
 * Used when style-guide source is a Dropbox folder (DROPBOX_ACCESS_TOKEN + DROPBOX_FOLDER_PATH).
 */

const LIST_FOLDER_URL = 'https://api.dropboxapi.com/2/files/list_folder';
const LIST_FOLDER_CONTINUE_URL = 'https://api.dropboxapi.com/2/files/list_folder/continue';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';

/**
 * List all files in a Dropbox folder (non-recursive). Handles pagination.
 * @param {string} accessToken - OAuth2 access token
 * @param {string} folderPath - Path in Dropbox, e.g. "" for root or "/AngelBot-StyleGuides"
 * @returns {Promise<Array<{ path_display: string, name: string }>>} File entries (files only)
 */
export async function listFilesInFolder(accessToken, folderPath) {
  const files = [];
  let body = { path: folderPath === '' ? '' : folderPath };
  let url = LIST_FOLDER_URL;

  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errTag = null;
      try {
        const errJson = JSON.parse(errText);
        errTag = errJson.error?.['.tag'] ?? null;
      } catch (_) {}
      if (res.status === 401 && errTag === 'expired_access_token') {
        throw new Error(
          'Dropbox access token has expired. Generate a new token at https://www.dropbox.com/developers/apps (your app → Permissions → Generate access token) and set DROPBOX_ACCESS_TOKEN in .env'
        );
      }
      let message = `Dropbox list_folder failed: ${res.status} ${res.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.error_summary) message += ` — ${errJson.error.error_summary}`;
      } catch (_) {
        if (errText) message += ` — ${errText}`;
      }
      throw new Error(message);
    }

    const data = await res.json();
    for (const entry of data.entries || []) {
      if (entry['.tag'] === 'file') {
        files.push({ path_display: entry.path_display, name: entry.name });
      }
    }

    if (!data.has_more) break;
    body = { cursor: data.cursor };
    url = LIST_FOLDER_CONTINUE_URL;
  }

  return files;
}

/**
 * Download a file from Dropbox by path and return its UTF-8 text content.
 * @param {string} accessToken - OAuth2 access token
 * @param {string} path - Dropbox path, e.g. "/AngelBot-StyleGuides/guide.txt"
 * @returns {Promise<string>}
 */
export async function downloadFileAsText(accessToken, path) {
  const res = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = `Dropbox download failed: ${res.status} ${res.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.error_summary) message += ` — ${errJson.error.error_summary}`;
    } catch (_) {
      if (errText) message += ` — ${errText}`;
    }
    throw new Error(message);
  }

  return res.text();
}

/**
 * Download a file from Dropbox by path and return its raw bytes (e.g. for PDFs).
 * @param {string} accessToken - OAuth2 access token
 * @param {string} path - Dropbox path, e.g. "/AngelBot-StyleGuides/doc.pdf"
 * @returns {Promise<Buffer>}
 */
export async function downloadFileAsBuffer(accessToken, path) {
  const res = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    let message = `Dropbox download failed: ${res.status} ${res.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error?.error_summary) message += ` — ${errJson.error.error_summary}`;
    } catch (_) {
      if (errText) message += ` — ${errText}`;
    }
    throw new Error(message);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
