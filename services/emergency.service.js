import EmergencyResponse from '../models/emergencyResponse.model.js';
import { getSetting } from './settings.service.js';
import { normalizeLanguageCode } from './language.service.js';

export const ROUTING_SOURCES = {
  STORED: 'stored',
  STORED_WITH_AI_CONTEXT: 'stored_with_ai_context',
  OPENAI: 'openai'
};

export const ROUTING_THRESHOLDS = {
  STORED: 70,
  CONTEXT: 40
};

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_RESPONSE_MODES = new Set([
  'stored_high_confidence',
  'ai_with_context',
  'ai_only'
]);
const VALID_FOLLOW_UP_POLICIES = new Set([
  'ai_when_needed',
  'always_ai',
  'stored_only'
]);

const FOLLOW_UP_PATTERNS = [
  /\bafter\b/i,
  /\bover\b/i,
  /\bfinish(?:ed)?\b/i,
  /\bnow safe\b/i,
  /\bsafe to\b/i,
  /\bgo outside\b/i,
  /\bgo back\b/i,
  /\bwhat next\b/i,
  /\bnext step/i,
  /\bchild\b/i,
  /\bscared\b/i,
  /\banxious\b/i,
  /\bclean up\b/i,
  /\binsurance\b/i,
  /\bdamage\b/i,
  /\bprepare\b/i,
  /\bkit\b/i,
  /\b72h\b/i
];

const IMMEDIATE_PATTERNS = [
  /\bnow\b/i,
  /\bright now\b/i,
  /\bwhat do i do\b/i,
  /\bwhat should i do\b/i,
  /\bi feel\b/i,
  /\bshaking\b/i,
  /\bsmoke\b/i,
  /\bfire\b/i,
  /\bbleeding\b/i,
  /\bcan't breathe\b/i,
  /\bcannot breathe\b/i,
  /\btrapped\b/i,
  /\bhelp\b/i,
  /\bduring\b/i
];

const normalizeText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

export const normalizeIntentKey = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'general';

const termMatches = (normalizedText, term) => {
  const normalizedTerm = normalizeText(term);
  if (!normalizedText || !normalizedTerm) return false;
  if (normalizedText === normalizedTerm) return true;

  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(normalizedText);
};

const phraseMatches = (normalizedText, phrase) => {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return normalizedText === normalizedPhrase || normalizedText.includes(normalizedPhrase);
};

export const normalizeEmergencyPlaybook = (response = {}) => {
  const title = String(response.title || '').trim();
  const category = String(response.category || '').trim();
  const intentKey = String(response.intentKey || '').trim() ||
    normalizeIntentKey(category || title);
  const severity = VALID_SEVERITIES.has(response.severity)
    ? response.severity
    : 'medium';
  const responseMode = VALID_RESPONSE_MODES.has(response.responseMode)
    ? response.responseMode
    : 'stored_high_confidence';
  const followUpPolicy = VALID_FOLLOW_UP_POLICIES.has(response.followUpPolicy)
    ? response.followUpPolicy
    : 'ai_when_needed';

  return {
    ...response,
    _id: response._id || response.id || 'draft',
    title,
    category,
    intentKey,
    triggerKeywords: normalizeArray(response.triggerKeywords),
    matchPhrases: normalizeArray(response.matchPhrases),
    negativeKeywords: normalizeArray(response.negativeKeywords),
    responseTemplate: String(response.responseTemplate || '').trim(),
    language: normalizeLanguageCode(response.language, 'en'),
    severity,
    responseMode,
    followUpPolicy,
    aiContext: String(response.aiContext || '').trim(),
    active: response.active !== false,
    order: Number.isFinite(Number(response.order)) ? Number(response.order) : 0
  };
};

const hasFollowUpShape = (text, conversation) => {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const explicitFollowUp = FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized));
  const immediate = IMMEDIATE_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasHistory = Array.isArray(conversation?.messages) &&
    conversation.messages.some((message) => message?.role === 'assistant');

  return explicitFollowUp || (hasHistory && !immediate);
};

const scoreTermList = ({ normalizedText, terms, exactPoints, partialPoints, label }) => {
  let score = 0;
  const reasons = [];

  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;
    if (normalizedText === normalizedTerm) {
      score = Math.max(score, exactPoints);
      reasons.push(`${label} exact: ${term}`);
    } else if (phraseMatches(normalizedText, normalizedTerm)) {
      score = Math.max(score, partialPoints);
      reasons.push(`${label}: ${term}`);
    }
  }

  return { score, reasons };
};

export const scoreEmergencyPlaybook = ({
  text,
  emergencyType,
  conversation,
  response
} = {}) => {
  const playbook = normalizeEmergencyPlaybook(response);
  const normalizedText = normalizeText(text);
  const normalizedEmergencyType = normalizeText(emergencyType);
  const normalizedConversationType = normalizeText(conversation?.emergencyType);
  const reasons = [];

  if (!normalizedText || !playbook.active || !playbook.responseTemplate) {
    return {
      playbook,
      confidence: 0,
      reasons: ['inactive or empty playbook'],
      negativeMatched: false,
      followUp: false
    };
  }

  let confidence = 0;

  const phraseScore = scoreTermList({
    normalizedText,
    terms: playbook.matchPhrases,
    exactPoints: 85,
    partialPoints: 55,
    label: 'phrase'
  });
  confidence += phraseScore.score;
  reasons.push(...phraseScore.reasons);

  const keywordScore = scoreTermList({
    normalizedText,
    terms: playbook.triggerKeywords,
    exactPoints: 75,
    partialPoints: 35,
    label: 'keyword'
  });
  confidence += keywordScore.score;
  reasons.push(...keywordScore.reasons);

  const categoryTerms = [
    playbook.category,
    playbook.intentKey.replace(/_/g, ' '),
    playbook.title
  ].filter(Boolean);
  if (
    categoryTerms.some((term) => termMatches(normalizedText, term)) ||
    (normalizedEmergencyType &&
      categoryTerms.some((term) => termMatches(normalizedEmergencyType, term)))
  ) {
    confidence += 25;
    reasons.push('category/emergency type match');
  }

  if (
    normalizedConversationType &&
    categoryTerms.some((term) => termMatches(normalizedConversationType, term))
  ) {
    confidence += 15;
    reasons.push('recent conversation context match');
  }

  let negativeMatched = false;
  for (const negative of playbook.negativeKeywords) {
    if (phraseMatches(normalizedText, negative)) {
      confidence -= 60;
      negativeMatched = true;
      reasons.push(`negative keyword: ${negative}`);
    }
  }

  const followUp = hasFollowUpShape(normalizedText, conversation);
  if (followUp) {
    reasons.push('follow-up/contextual question');
  }

  return {
    playbook,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    reasons,
    negativeMatched,
    followUp
  };
};

const decisionForBestScore = (best) => {
  if (!best || best.confidence < ROUTING_THRESHOLDS.CONTEXT) {
    return ROUTING_SOURCES.OPENAI;
  }

  const { playbook, confidence, followUp } = best;

  if (playbook.responseMode === 'ai_only') {
    return ROUTING_SOURCES.STORED_WITH_AI_CONTEXT;
  }

  if (playbook.responseMode === 'ai_with_context') {
    return ROUTING_SOURCES.STORED_WITH_AI_CONTEXT;
  }

  if (playbook.followUpPolicy === 'always_ai' && followUp) {
    return ROUTING_SOURCES.STORED_WITH_AI_CONTEXT;
  }

  if (
    confidence >= ROUTING_THRESHOLDS.STORED &&
    (!followUp || playbook.followUpPolicy === 'stored_only')
  ) {
    return ROUTING_SOURCES.STORED;
  }

  return ROUTING_SOURCES.STORED_WITH_AI_CONTEXT;
};

const routingReasonFor = (source, best) => {
  if (!best) return 'No emergency playbook reached the routing threshold.';
  const details = best.reasons.length > 0 ? best.reasons.join('; ') : 'matched playbook';
  if (source === ROUTING_SOURCES.STORED) {
    return `Stored playbook selected (${details}).`;
  }
  if (source === ROUTING_SOURCES.STORED_WITH_AI_CONTEXT) {
    return `OpenAI selected with approved playbook context (${details}).`;
  }
  return `OpenAI selected; best playbook confidence was ${best.confidence}.`;
};

const routingMetadata = (decision) => ({
  routingSource: decision.source,
  routingConfidence: decision.confidence,
  matchedPlaybookId: decision.matchedPlaybookId || '',
  routingReason: decision.reason
});

export const buildPlaybookAiContext = (decision) => {
  const playbook = decision?.matchedPlaybook;
  if (!playbook) return '';

  return [
    'APPROVED EMERGENCY PLAYBOOK CONTEXT:',
    `Title: ${playbook.title || 'Untitled playbook'}`,
    playbook.category ? `Category: ${playbook.category}` : '',
    `Severity: ${playbook.severity}`,
    playbook.aiContext ? `Admin AI context: ${playbook.aiContext}` : '',
    'Approved response template:',
    playbook.responseTemplate,
    '',
    'Use this playbook as the safety-approved source of truth. Answer the user\'s follow-up directly, add only necessary context, and do not contradict the approved steps.'
  ]
    .filter((line) => line !== '')
    .join('\n');
};

export const routeEmergencyResponse = async ({
  text,
  language,
  emergencyType,
  conversation,
  extraResponses = []
} = {}) => {
  const trimmedText = String(text || '').trim();
  const lang = normalizeLanguageCode(language, 'en');

  if (!trimmedText) {
    return {
      source: ROUTING_SOURCES.OPENAI,
      confidence: 0,
      matchedPlaybook: null,
      matchedPlaybookId: '',
      reason: 'Empty user message.',
      metadata: routingMetadata({
        source: ROUTING_SOURCES.OPENAI,
        confidence: 0,
        matchedPlaybookId: '',
        reason: 'Empty user message.'
      })
    };
  }

  const overrideEnabled = await getSetting('emergencyOverrideEnabled');
  if (!overrideEnabled) {
    return {
      source: ROUTING_SOURCES.OPENAI,
      confidence: 0,
      matchedPlaybook: null,
      matchedPlaybookId: '',
      reason: 'Emergency playbook routing is disabled in settings.',
      metadata: routingMetadata({
        source: ROUTING_SOURCES.OPENAI,
        confidence: 0,
        matchedPlaybookId: '',
        reason: 'Emergency playbook routing is disabled in settings.'
      })
    };
  }

  const fetchedResponses = await EmergencyResponse.find({
    language: lang,
    active: true
  })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  const extra = Array.isArray(extraResponses)
    ? extraResponses.filter(Boolean)
    : [];
  const extraIds = new Set(extra.map((item) => String(item?._id || item?.id || '')));
  const candidates = [
    ...extra,
    ...fetchedResponses.filter((item) => !extraIds.has(String(item._id || item.id || '')))
  ]
    .map(normalizeEmergencyPlaybook)
    .filter((item) => item.language === lang && item.active);

  const scored = candidates
    .map((response) =>
      scoreEmergencyPlaybook({
        text: trimmedText,
        emergencyType,
        conversation,
        response
      })
    )
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.playbook.order !== b.playbook.order) return a.playbook.order - b.playbook.order;
      return String(a.playbook.title).localeCompare(String(b.playbook.title));
    });

  const best = scored[0] || null;
  const source = decisionForBestScore(best);
  const matchedPlaybook =
    best && best.confidence >= ROUTING_THRESHOLDS.CONTEXT ? best.playbook : null;
  const confidence = best?.confidence || 0;
  const matchedPlaybookId = matchedPlaybook ? String(matchedPlaybook._id || '') : '';
  const reason = routingReasonFor(source, matchedPlaybook ? best : null);

  const decision = {
    source,
    confidence,
    matchedPlaybook,
    matchedPlaybookId,
    reason,
    followUp: Boolean(best?.followUp),
    scores: scored.slice(0, 5).map((item) => ({
      id: String(item.playbook._id || ''),
      title: item.playbook.title,
      confidence: item.confidence,
      reasons: item.reasons
    }))
  };

  return {
    ...decision,
    metadata: routingMetadata(decision)
  };
};

/**
 * Backward-compatible wrapper for older callers. New chat paths should use
 * routeEmergencyResponse() so they can choose stored vs AI context.
 */
export const matchEmergencyResponse = async (params = {}) => {
  const decision = await routeEmergencyResponse(params);
  return decision.source === ROUTING_SOURCES.STORED
    ? decision.matchedPlaybook
    : null;
};

/**
 * Lists active emergency responses for the public/user-facing endpoint,
 * optionally filtered by category, scoped to the request language, ordered.
 *
 * @param {{ category?: string, language?: string }} params
 * @returns {Promise<Array>} active emergency responses (lean docs)
 */
export const listActiveEmergencyResponses = async ({
  category,
  language
} = {}) => {
  const filter = { active: true };

  if (language !== undefined && language !== null && language !== '') {
    filter.language = normalizeLanguageCode(language, 'en');
  }

  const trimmedCategory = String(category || '').trim();
  if (trimmedCategory) {
    filter.category = trimmedCategory;
  }

  return EmergencyResponse.find(filter)
    .sort({ order: 1, createdAt: 1 })
    .lean();
};
