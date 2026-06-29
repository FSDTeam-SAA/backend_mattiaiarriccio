import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaybookAiContext,
  scoreEmergencyPlaybook
} from '../services/emergency.service.js';

const earthquakePlaybook = {
  _id: 'emergency_earthquake',
  title: 'Earthquake',
  category: 'earthquake',
  triggerKeywords: ['earthquake', 'shaking'],
  matchPhrases: ['I feel shaking', 'what should I do during earthquake'],
  negativeKeywords: ['movie', 'history'],
  responseTemplate: 'Drop, cover, and hold on.',
  language: 'en',
  active: true
};

test('scores exact match phrases as high-confidence stored candidates', () => {
  const result = scoreEmergencyPlaybook({
    text: 'I feel shaking',
    response: earthquakePlaybook
  });

  assert.equal(result.confidence >= 70, true);
  assert.equal(result.followUp, false);
});

test('scores contextual follow-up earthquake questions without treating them as immediate templates', () => {
  const result = scoreEmergencyPlaybook({
    text: 'what to do when earthquake finish',
    conversation: {
      emergencyType: 'earthquake',
      messages: [{ role: 'assistant', content: 'Drop, cover, and hold on.' }]
    },
    response: earthquakePlaybook
  });

  assert.equal(result.confidence >= 40, true);
  assert.equal(result.followUp, true);
});

test('negative keywords reduce false-positive matches', () => {
  const result = scoreEmergencyPlaybook({
    text: 'earthquake movie history',
    response: earthquakePlaybook
  });

  assert.equal(result.confidence < 40, true);
});

test('unmatched messages score as low confidence', () => {
  const result = scoreEmergencyPlaybook({
    text: 'how do I store documents safely',
    response: earthquakePlaybook
  });

  assert.equal(result.confidence, 0);
});

test('playbook AI context includes approved template and admin context', () => {
  const context = buildPlaybookAiContext({
    matchedPlaybook: {
      ...earthquakePlaybook,
      severity: 'high',
      aiContext: 'Ask whether the user is indoors or outdoors.'
    }
  });

  assert.match(context, /APPROVED EMERGENCY PLAYBOOK CONTEXT/);
  assert.match(context, /Drop, cover, and hold on/);
  assert.match(context, /indoors or outdoors/);
});
