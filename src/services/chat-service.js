/**
 * Transport-agnostic wisdom chat (used by the HTTP API).
 */

import { getWisdomReply } from '../bot/wisdom.js';
import { getHistory, appendTurn, getStoredExcerpts, setStoredExcerpts } from '../bot/memory.js';
import * as threadDb from '../db/threads.js';
import * as users from '../db/users.js';
import { generateThreadTitleFromMessage } from '../lib/gemini.js';
import { buildUserPreferencesPromptBlock } from '../lib/user-preferences.js';
import { buildUserMemoryPromptBlock } from '../lib/user-memory.js';
import { retrieve } from '../rag/retrieve.js';
import {
  loadCourseCatalog,
  sourcesFromCatalogMatch,
  sourcesFromLevelTitles,
  mergeCatalogSources,
  MAX_REPLY_SOURCES,
} from '../rag/course-catalog.js';
import { resolveCourseLinkVariant, userHasAccessToCourseLevel } from '../lib/course-access.js';
import {
  parseMaterialScopeFromMessage,
  resolveMaterialScope,
  userAskedToClearMaterialScope,
  userNamedCourseLocation,
  buildMaterialScopePromptBlock,
} from '../rag/material-scope.js';
import {
  sanitizeReplyCitations,
  userAskedForCitation,
  userAskedForMoreDetail,
  mergeRetrievedExcerpts,
  excerptBodiesForModel,
  sourcesFromExcerpts,
} from '../lib/citation-repair.js';

const DEFAULT_RETRIEVE_TOP_K = 8;
const SCOPED_RETRIEVE_TOP_K = 12;
const DEFAULT_UPGRADE_URL = 'https://courses.masteringalchemy.com/courses/omi-ai';

function upgradeUrl() {
  return String(process.env.OMIBOT_UPGRADE_URL || process.env.ANGELBOT_UPGRADE_URL || DEFAULT_UPGRADE_URL).trim();
}

/**
 * @param {{
 *   tier: 'free' | 'paid';
 *   message: string;
 *   requestedScopeKey?: string | null;
 *   threadId?: string;
 *   useDb: boolean;
 *   userId: string;
 *   email?: string;
 *   catalog: import('../rag/course-catalog.js').CourseCatalog;
 * }} params
 */
async function resolveActiveMaterialScope({
  tier,
  message,
  requestedScopeKey,
  threadId,
  useDb,
  userId,
  email,
  catalog,
}) {
  /** @type {Array<{ kind: string; message: string; url?: string }>} */
  const notices = [];
  const named = parseMaterialScopeFromMessage(message, catalog);
  const requested = resolveMaterialScope(catalog, requestedScopeKey);
  const incoming = named || requested;
  const askedByName = Boolean(named) || Boolean(requested) || userNamedCourseLocation(message);

  if (tier !== 'paid') {
    if (askedByName) {
      notices.push({
        kind: 'upgrade',
        message:
          'Focusing a conversation on a specific course or session is available on the paid plan.',
        url: upgradeUrl(),
      });
    }
    return { scope: null, notices };
  }

  if (userAskedToClearMaterialScope(message)) {
    if (useDb && threadId) await threadDb.setThreadMaterialScopeKey(threadId, null);
    return { scope: null, notices };
  }

  let pinned = null;
  if (useDb && threadId) {
    pinned = resolveMaterialScope(catalog, await threadDb.getThreadMaterialScopeKey(threadId));
  }

  const candidate = incoming || pinned;
  if (!candidate) return { scope: null, notices };

  const allowed = await userHasAccessToCourseLevel(userId, email, candidate.levelCode, catalog);
  if (!allowed) {
    notices.push({
      kind: 'purchase',
      message: `Focusing on ${candidate.courseTitle} is available when you are enrolled in that course.`,
      url: candidate.purchaseUrl || '',
    });
    if (incoming && pinned && pinned.scopeKey !== incoming.scopeKey) {
      const pinnedAllowed = await userHasAccessToCourseLevel(
        userId,
        email,
        pinned.levelCode,
        catalog
      );
      if (pinnedAllowed) return { scope: pinned, notices };
    }
    return { scope: null, notices };
  }

  if (useDb && threadId && incoming) {
    await threadDb.setThreadMaterialScopeKey(threadId, candidate.scopeKey);
  }
  return { scope: candidate, notices };
}

function isContextDependentFollowup(message) {
  const normalized = String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (normalized.length <= 40) return true;
  return /\b(it|that|this|those|these|them|same|again)\b/.test(normalized);
}

function extractAssistantQuotes(text) {
  const s = String(text || '');
  const quotes = [];
  const patterns = [
    /^>\s*["“]([^"”\n]{20,})["”]/gm,
    /^>\s*([^"\n]{40,})/gm,
    /["“]([^"”\n]{40,})["”]/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(s)) !== null) {
      quotes.push(String(match[1] || '').trim());
    }
  }
  return [...new Set(quotes)].filter(Boolean);
}

function looksLikeCitationHuntReply(text) {
  const t = String(text || '');
  return (
    /track down that exact coordinate/i.test(t) ||
    /slide the dial right over to track down/i.test(t)
  );
}

function citationRetrievalContext(history) {
  const userTopic =
    [...history]
      .reverse()
      .find((t) => t.role === 'user' && t.content && !userAskedForCitation(t.content))?.content || '';

  const assistantTurns = history.filter((t) => t.role === 'assistant' && String(t.content || '').trim());
  const quotes = [];
  for (const t of assistantTurns.slice(-8)) {
    quotes.push(...extractAssistantQuotes(t.content));
  }

  const teaching =
    [...assistantTurns].reverse().find((t) => !looksLikeCitationHuntReply(t.content)) ||
    assistantTurns[assistantTurns.length - 1];

  return {
    userTopic: String(userTopic).slice(0, 500),
    quotes: [...new Set(quotes)].slice(0, 5),
    teachingText: String(teaching?.content || '').slice(-1800),
  };
}

function needsRetrievalContext(message) {
  return isContextDependentFollowup(message) || userAskedForMoreDetail(message);
}

function buildRetrievalQuery(message, history) {
  const current = String(message || '').trim();
  const citationAsk = userAskedForCitation(current);
  if (!citationAsk && !needsRetrievalContext(current)) return current;

  if (citationAsk) {
    const ctx = citationRetrievalContext(history);
    const query = [ctx.userTopic, ...ctx.quotes, ctx.teachingText].filter(Boolean).join('\n\n');
    return query || current;
  }

  const detailAsk = userAskedForMoreDetail(current);
  const userCap = detailAsk ? 800 : 400;
  const assistantCap = detailAsk ? 1000 : 500;
  const lastTopicUser =
    [...history]
      .reverse()
      .find((t) => t.role === 'user' && t.content && !userAskedForCitation(t.content))?.content || '';
  const lastAssistant =
    [...history].reverse().find((t) => t.role === 'assistant' && t.content)?.content || '';
  return [
    String(lastTopicUser).slice(0, userCap),
    String(lastAssistant).slice(0, assistantCap),
    current,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * @param {{ userId: string; sessionKey: string; message: string; threadId?: string; useDb?: boolean; email?: string; materialScopeKey?: string | null }} params
 * @returns {Promise<
 *   | { ok: false; code: 'error'; text: string }
 *   | { ok: true; kind: 'reply'; assistantReply: string; threadTitle?: string | null; sources?: Array<{ title: string; url: string; detail: string; access: string }>; hadRetrieval?: boolean; tier?: 'free' | 'paid'; notices?: Array<{ kind: string; message: string; url?: string }>; materialScope?: { key: string; label: string } | null }
 * >}
 */
export async function processWisdomMessage({
  userId,
  sessionKey,
  message,
  threadId,
  useDb = false,
  email,
  materialScopeKey = null,
}) {
  const history =
    useDb && threadId ? await threadDb.getThreadMessages(threadId) : getHistory(sessionKey);

  try {
    const retrievalQuery = buildRetrievalQuery(message, history);
    let userPreferencesBlock = null;
    let userMemoryBlock = null;
    /** @type {'free' | 'paid'} */
    let tier = 'free';
    if (useDb) {
      const settings = await users.getUserSettings(userId);
      tier = settings.tier === 'paid' ? 'paid' : 'free';
      userPreferencesBlock = buildUserPreferencesPromptBlock(settings);
      if (tier === 'paid') {
        userMemoryBlock = buildUserMemoryPromptBlock(settings);
      }
    }
    const citationAsk = userAskedForCitation(message);
    const sourceDetail = 'full';
    // Resolve Thinkific owned vs membership for everyone so Source lines can link
    // to the appropriate class page (classroom when enrolled, otherwise purchase).
    const linkVariant = useDb ? await resolveCourseLinkVariant(userId, email) : null;
    const catalog = await loadCourseCatalog();
    const { scope: materialScope, notices } = await resolveActiveMaterialScope({
      tier,
      message,
      requestedScopeKey: materialScopeKey,
      threadId,
      useDb,
      userId,
      email,
      catalog,
    });
    const materialScopeBlock = materialScope ? buildMaterialScopePromptBlock(materialScope) : null;
    let storedExcerpts =
      useDb && threadId ? await threadDb.getThreadSourceExcerpts(threadId) : null;
    if (!(storedExcerpts || '').trim()) {
      storedExcerpts = getStoredExcerpts(sessionKey);
    }
    let styleExcerpts = '';
    /** @type {Array<{ title: string; url: string; detail: string; access: string }>} */
    let sources = [];
    if (citationAsk && String(storedExcerpts || '').trim()) {
      styleExcerpts = storedExcerpts || '';
      sources = sourcesFromExcerpts(styleExcerpts, catalog);
    } else {
      const retrieved = await retrieve(retrievalQuery, materialScope ? SCOPED_RETRIEVE_TOP_K : DEFAULT_RETRIEVE_TOP_K, {
        linkVariant,
        sourceDetail,
        scopeKey: materialScope?.scopeKey || null,
      });
      const newExcerpts =
        typeof retrieved === 'string' ? retrieved : String(retrieved?.text || '');
      const newSources =
        typeof retrieved === 'object' && Array.isArray(retrieved?.sources) && retrieved.sources.length
          ? retrieved.sources
          : sourcesFromExcerpts(newExcerpts, catalog);
      const detailFollowUp =
        userAskedForMoreDetail(message) && String(storedExcerpts || '').trim();
      if (detailFollowUp) {
        styleExcerpts = mergeRetrievedExcerpts(storedExcerpts, newExcerpts);
        sources = mergeCatalogSources(
          sourcesFromExcerpts(storedExcerpts, catalog),
          newSources,
          MAX_REPLY_SOURCES
        );
      } else {
        styleExcerpts = newExcerpts;
        sources = newSources;
      }
    }
    const result = await getWisdomReply(
      message,
      history,
      excerptBodiesForModel(styleExcerpts || '') || null,
      userPreferencesBlock,
      userMemoryBlock,
      materialScopeBlock
    );
    const reply = sanitizeReplyCitations(result.text, styleExcerpts || '', message);
    const passage = `${styleExcerpts || ''}\n${reply}\n${message}`;
    if (!materialScope) {
      sources = mergeCatalogSources(
        sources,
        sources.length >= MAX_REPLY_SOURCES
          ? []
          : sourcesFromCatalogMatch(
              passage,
              catalog,
              linkVariant || 'owned',
              MAX_REPLY_SOURCES - sources.length
            ),
        MAX_REPLY_SOURCES
      );
    }
    const hadRetrievalRaw = Boolean(String(styleExcerpts || '').trim());
    if (!materialScope && !sources.length && hadRetrievalRaw) {
      sources = sourcesFromLevelTitles(passage, catalog, linkVariant || 'owned');
    }
    // Source panel is a paid-plan feature.
    const sourcesForClient = tier === 'paid' ? sources : [];
    const hadRetrieval = tier === 'paid' ? hadRetrievalRaw : false;
    if (!citationAsk && String(styleExcerpts || '').trim()) {
      if (useDb && threadId) {
        await threadDb.setThreadSourceExcerpts(threadId, styleExcerpts);
      }
      setStoredExcerpts(sessionKey, styleExcerpts);
    }
    const thoughtSignature = result.thoughtSignature;
    let threadTitle = null;
    if (useDb && threadId) {
      await threadDb.appendThreadTurn(
        threadId,
        message,
        reply,
        thoughtSignature,
        sourcesForClient.length ? sourcesForClient : null
      );
      await users.touchUserChatActivity(userId);
      if (history.length === 0) {
        try {
          const thread = await threadDb.getThreadForUser(threadId, userId);
          if (thread && threadDb.isDefaultThreadTitle(thread.title)) {
            const aiTitle = await generateThreadTitleFromMessage(message);
            const updated = await threadDb.updateThreadTitle(threadId, userId, aiTitle);
            threadTitle = updated?.title || null;
          }
        } catch (titleErr) {
          console.error('Auto thread title error:', titleErr);
        }
      }
    } else {
      appendTurn(sessionKey, message, reply, thoughtSignature);
    }
    return {
      ok: true,
      kind: 'reply',
      assistantReply: reply,
      threadTitle,
      sources: sourcesForClient,
      hadRetrieval,
      tier,
      notices,
      materialScope: materialScope
        ? { key: materialScope.scopeKey, label: materialScope.label }
        : null,
    };
  } catch (err) {
    console.error('Wisdom reply error:', err);
    return { ok: false, code: 'error', text: 'Something shifted in the field. Please try again in a moment.' };
  }
}
