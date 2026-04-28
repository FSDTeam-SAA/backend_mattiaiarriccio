export const DEFAULT_WELCOME_MESSAGE =
  'Hello! I am your Emergency Response Assistant. ' +
  'I can help you with step-by-step guidance for emergencies such as ' +
  'fire, earthquake, blackout, and first aid (including CPR). ' +
  'Please describe your situation and I will assist you immediately. ' +
  'Type in any language and I will respond in the same language.';

export const DEFAULT_SYSTEM_INSTRUCTION = `You are a professional Emergency Response Assistant.

YOUR ROLE:
- Provide calm, clear, accurate, and step-by-step guidance for emergencies.
- Supported emergency types: fire, earthquake, blackout/power outage, first aid, CPR, flooding, gas leaks.

EMERGENCY TYPE CONTEXT:
- If the user message includes a line like "Selected emergency type: Fire", treat that as the active emergency context.
- For the first assistant response with a selected emergency type, do not start with a generic greeting or welcome message.
- Start immediately with the most important actions for that emergency type.
- Keep follow-up answers aligned with the selected emergency type unless the user clearly changes the situation.
- If the selected emergency type and the user's message conflict, prioritize the user's latest described situation and briefly state the assumption.

LANGUAGE RULE:
- Follow the selected app language instruction exactly.
- If no selected app language is supplied, respond in the same language as the user.

RESPONSE FORMAT:
- Maximum 3 numbered steps.
- Each step: one imperative sentence, 12 words or fewer.
- Total response 55 words or fewer, including the closing line.
- No preamble, no explanations, no markdown bold/headings.
- Use plain, direct language.
- End with exactly one short line reminding to call emergency services.

BOUNDARIES:
- Only answer emergency-related queries.
- No casual conversation.
- Keep responses concise and actionable.
`;

export const DEFAULT_FALLBACK_RESPONSE =
  "I'm sorry, I can only assist with emergency situations...";

const OFFLINE_GUIDES = {
  en: {
    fire: [
      'Get out fast — stay low under smoke and close doors behind you.',
      'Do not use elevators; use stairs and never go back inside.',
      'Once outside, move far from the building and call emergency services.',
      'If clothes catch fire: stop, drop, cover face, and roll.',
      'Call your local emergency number immediately.'
    ],
    earthquake: [
      'Drop to the ground, take cover under sturdy furniture, hold on.',
      'Stay away from windows, mirrors, and heavy objects that can fall.',
      'If outside, move to an open area away from buildings and power lines.',
      'After shaking stops, check for injuries and gas leaks before moving.',
      'Call your local emergency number if anyone is hurt or trapped.'
    ],
    blackout: [
      'Use a flashlight — avoid candles to prevent fire risk.',
      'Unplug sensitive electronics to protect them from a power surge.',
      'Keep the fridge and freezer doors closed to preserve food.',
      'Check on neighbors who may need medical equipment power.',
      'Call your local emergency number if anyone needs urgent help.'
    ],
    'first aid': [
      'Check the scene is safe before approaching the injured person.',
      'If unresponsive and not breathing, start CPR: 30 chest compressions, 2 rescue breaths.',
      'For heavy bleeding, apply firm pressure with a clean cloth.',
      'Keep the person warm and still until help arrives.',
      'Call your local emergency number immediately.'
    ],
    flood: [
      'Move to higher ground immediately — do not walk or drive through floodwater.',
      'Disconnect electrical appliances only if you can do so safely.',
      'Avoid contact with flood water; it may be contaminated or electrified.',
      'Listen to local authorities for evacuation orders.',
      'Call your local emergency number if you are trapped or injured.'
    ],
    'gas leak': [
      'Do not switch lights or any electrical device on or off.',
      'Open windows and doors to ventilate, then leave the building.',
      'Do not use phones inside; call from outside the property.',
      'Shut off the gas at the meter only if it is safe to do so.',
      'Call your gas provider emergency line and emergency services.'
    ],
    general: [
      'Stay calm and check if you and others around you are safe.',
      'Move away from immediate danger to a secure location.',
      'Share your exact location with anyone who can help.',
      'Listen for instructions from local authorities.',
      'Call your local emergency number for urgent assistance.'
    ]
  },
  it: {
    fire: [
      'Esci subito — resta basso sotto il fumo e chiudi le porte dietro di te.',
      'Non usare l\'ascensore; prendi le scale e non rientrare per nessun motivo.',
      'Una volta fuori allontanati dall\'edificio e chiama i soccorsi.',
      'Se i vestiti prendono fuoco: fermati, sdraiati, copri il viso e rotola.',
      'Chiama subito il numero di emergenza locale.'
    ],
    earthquake: [
      'Abbassati a terra, ripàrati sotto un mobile robusto e tieniti stretto.',
      'Stai lontano da vetri, specchi e oggetti pesanti che possono cadere.',
      'Se sei all\'aperto, vai in uno spazio libero lontano da edifici e cavi.',
      'Dopo la scossa controlla feriti e perdite di gas prima di muoverti.',
      'Chiama il numero di emergenza locale se ci sono feriti o intrappolati.'
    ],
    blackout: [
      'Usa una torcia — evita le candele per non causare incendi.',
      'Stacca gli elettrodomestici sensibili per proteggerli dagli sbalzi.',
      'Tieni chiusi frigorifero e congelatore per conservare il cibo.',
      'Controlla i vicini che possono dipendere da dispositivi medici.',
      'Chiama il numero di emergenza locale se serve aiuto urgente.'
    ],
    'first aid': [
      'Verifica che la scena sia sicura prima di avvicinarti al ferito.',
      'Se non risponde e non respira, inizia la RCP: 30 compressioni e 2 respirazioni.',
      'In caso di emorragia grave, applica pressione decisa con un panno pulito.',
      'Tieni la persona al caldo e ferma finche non arrivano i soccorsi.',
      'Chiama subito il numero di emergenza locale.'
    ],
    flood: [
      'Vai subito in un punto piu alto — non attraversare acqua a piedi o in auto.',
      'Stacca gli elettrodomestici solo se puoi farlo in sicurezza.',
      'Evita il contatto con l\'acqua: puo essere contaminata o sotto tensione.',
      'Segui le indicazioni delle autorita locali per l\'evacuazione.',
      'Chiama il numero di emergenza locale se sei intrappolato o ferito.'
    ],
    'gas leak': [
      'Non accendere o spegnere luci o dispositivi elettrici.',
      'Apri porte e finestre per ventilare, poi lascia l\'edificio.',
      'Non usare il telefono in casa; chiama una volta fuori.',
      'Chiudi il gas al contatore solo se puoi farlo in sicurezza.',
      'Chiama il numero di emergenza del gas e i soccorsi.'
    ],
    general: [
      'Mantieni la calma e verifica che tu e chi ti sta accanto siate al sicuro.',
      'Allontanati dal pericolo immediato e raggiungi un luogo sicuro.',
      'Condividi la tua posizione esatta con chi puo aiutarti.',
      'Ascolta le indicazioni delle autorita locali.',
      'Chiama il numero di emergenza locale per assistenza urgente.'
    ]
  }
};

const OFFLINE_HEADER = {
  en:
    "I'm working in offline mode right now. Here is the most important guidance for ",
  it:
    'Sto rispondendo in modalita offline. Ecco la guida piu importante per '
};

const OFFLINE_FOOTER = {
  en: '\n\nIf you have a real emergency, call your local emergency number now.',
  it: '\n\nSe e una vera emergenza, chiama subito il numero di emergenza locale.'
};

const matchEmergencyKey = (emergencyType) => {
  const value = String(emergencyType || '').toLowerCase().trim();
  if (!value) return 'general';

  if (value.includes('fire') || value.includes('incendio')) return 'fire';
  if (value.includes('earthquake') || value.includes('terremoto')) return 'earthquake';
  if (
    value.includes('blackout') ||
    value.includes('power outage') ||
    value.includes('power cut') ||
    value.includes('mancanza di corrente')
  ) {
    return 'blackout';
  }
  if (
    value.includes('first aid') ||
    value.includes('cpr') ||
    value.includes('primo soccorso') ||
    value.includes('aid')
  ) {
    return 'first aid';
  }
  if (value.includes('flood') || value.includes('alluvion') || value.includes('inondazi')) {
    return 'flood';
  }
  if (value.includes('gas')) return 'gas leak';

  return 'general';
};

export const buildOfflineEmergencyGuide = ({ emergencyType, language } = {}) => {
  const lang = normalizeLanguage(language);
  const key = matchEmergencyKey(emergencyType);
  const guides = OFFLINE_GUIDES[lang] || OFFLINE_GUIDES.en;
  const steps = guides[key] || guides.general;

  const labelMap = {
    en: {
      fire: 'a fire emergency',
      earthquake: 'an earthquake',
      blackout: 'a power outage',
      'first aid': 'first aid',
      flood: 'a flood',
      'gas leak': 'a gas leak',
      general: 'an emergency'
    },
    it: {
      fire: 'un incendio',
      earthquake: 'un terremoto',
      blackout: 'un blackout',
      'first aid': 'il primo soccorso',
      flood: 'un\'alluvione',
      'gas leak': 'una fuga di gas',
      general: 'un\'emergenza'
    }
  };

  const labels = labelMap[lang] || labelMap.en;
  const header = (OFFLINE_HEADER[lang] || OFFLINE_HEADER.en) + (labels[key] || labels.general) + ':';
  const numbered = steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
  const footer = OFFLINE_FOOTER[lang] || OFFLINE_FOOTER.en;

  return `${header}\n${numbered}${footer}`;
};

export const normalizeLanguage = (language) => {
  const value = String(language || 'en').trim().toLowerCase().replace(/_/g, '-');
  if (value.startsWith('it')) return 'it';
  return 'en';
};

export const languageInstructionFor = (language) => {
  if (normalizeLanguage(language) === 'it') {
    return (
      'Selected app language: Italian (it). Respond only in Italian, ' +
      'including steps, warnings, and emergency service reminders, unless ' +
      'the user explicitly asks for another language.'
    );
  }
  return (
    'Selected app language: English (en). Respond only in English, ' +
    'including steps, warnings, and emergency service reminders, unless ' +
    'the user explicitly asks for another language.'
  );
};

export const buildSystemMessage = ({
  systemInstruction,
  welcomeInstruction,
  fallbackMessage,
  languageInstruction,
  emergencyType,
  includeWelcome = true
}) => {
  const welcomeBlock = includeWelcome
    ? `

WELCOME BEHAVIOR:
- If the user greets and no urgent situation is provided, respond with a brief welcome message.
- If an urgent situation is provided, skip the welcome message and begin with emergency-specific steps.

Welcome Style:
${welcomeInstruction}`
    : '';

  return `${systemInstruction}${welcomeBlock}

Fallback:
${fallbackMessage}

SELECTED LANGUAGE:
${languageInstruction}

SELECTED EMERGENCY TYPE:
${emergencyType}
`.trim();
};
