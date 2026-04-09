const buildLongText = (paragraphs) => paragraphs.join('\n\n');

export const buildSeedData = () => {
  const now = new Date();

  return {
    users: [
      {
        _id: 'user_madiha_aroa',
        role: 'user',
        firstName: 'Madiha',
        lastName: 'Aroa',
        fullName: 'Madiha Aroa',
        email: 'madiha.aroa@example.com',
        phoneNumber: '+39 312 000 1111',
        avatarUrl: 'https://placehold.co/160x160/png?text=MA',
        preferredLanguage: 'en',
        notificationsEnabled: true,
        onboardingCompleted: true,
        password: 'Password123!',
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'user_luca_moretti',
        role: 'user',
        firstName: 'Luca',
        lastName: 'Moretti',
        fullName: 'Luca Moretti',
        email: 'luca.moretti@example.com',
        phoneNumber: '+39 312 000 2222',
        avatarUrl: 'https://placehold.co/160x160/png?text=LM',
        preferredLanguage: 'it',
        notificationsEnabled: true,
        onboardingCompleted: true,
        password: 'Password123!',
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'admin_roni_morris',
        role: 'admin',
        firstName: 'Roni',
        lastName: 'Morris',
        fullName: 'Roni Morris',
        email: 'admin@wesafe.app',
        phoneNumber: '+39 312 000 3333',
        avatarUrl: 'https://placehold.co/160x160/png?text=RM',
        preferredLanguage: 'en',
        notificationsEnabled: true,
        onboardingCompleted: true,
        password: 'Admin123!',
        createdAt: now,
        updatedAt: now
      }
    ],
    notifications: [
      {
        _id: 'notif_guide_cpr',
        userId: 'user_madiha_aroa',
        title: 'Guide updated: CPR Basics',
        body: 'The CPR basics guide now includes AED preparation steps.',
        type: 'guide',
        read: false,
        createdAt: now
      },
      {
        _id: 'notif_new_checklist',
        userId: 'user_madiha_aroa',
        title: 'New checklist: Earthquake Kit',
        body: 'A new earthquake readiness checklist is available for your home.',
        type: 'checklist',
        read: false,
        createdAt: now
      },
      {
        _id: 'notif_prompt_update',
        userId: 'user_madiha_aroa',
        title: 'Chatbot update',
        body: 'Emergency chat responses now include calmer step-by-step language.',
        type: 'chat',
        read: true,
        createdAt: now
      }
    ],
    safetyTips: [
      {
        _id: 'tip_fire_safety_home',
        slug: 'fire-safety-at-home',
        title: 'Fire Safety at Home',
        category: 'Fire Safety',
        summary:
          'Reduce home fire risks with safer cooking, wiring checks, and an evacuation plan.',
        contentSections: [
          {
            heading: 'Before a fire',
            body:
              'Install smoke alarms on every level, keep exits clear, and assign one outdoor meeting point for everyone in the home.'
          },
          {
            heading: 'During a fire',
            body:
              'Leave immediately, stay low under smoke, and close doors behind you if possible to slow the spread of flames.'
          },
          {
            heading: 'After evacuation',
            body:
              'Never go back inside until emergency responders say it is safe. Account for everyone and call emergency services.'
          }
        ],
        doList: [
          'Test smoke alarms every month.',
          'Keep a fire extinguisher near the kitchen.',
          'Practice a family evacuation route twice a year.'
        ],
        dontList: [
          'Do not re-enter a burning building.',
          'Do not throw water on a grease fire.',
          'Do not block exits with furniture or storage.'
        ],
        tags: ['kitchen', 'smoke alarm', 'evacuation'],
        estimatedReadMinutes: 4,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Fire+Safety',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Fire+Safety',
        status: 'published',
        language: 'en',
        featured: true,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_earthquake_prep',
        slug: 'earthquake-preparedness',
        title: 'Earthquake Preparedness',
        category: 'Earthquake',
        summary:
          'Prepare your home and family with safe sheltering steps, emergency supplies, and communication plans.',
        contentSections: [
          {
            heading: 'Prepare your space',
            body:
              'Secure tall furniture, heavy mirrors, and appliances. Store breakable items on lower shelves and know your safest shelter spots.'
          },
          {
            heading: 'When shaking starts',
            body:
              'Drop, cover, and hold on. Stay away from windows and do not run outside while the ground is still shaking.'
          },
          {
            heading: 'After the shaking',
            body:
              'Check for injuries, gas leaks, and structural damage. Expect aftershocks and use text messages instead of calls when possible.'
          }
        ],
        doList: [
          'Keep shoes and a flashlight near your bed.',
          'Store emergency water and food at home.',
          'Practice drop, cover, and hold on with your family.'
        ],
        dontList: [
          'Do not stand in a doorway unless it is a known structural support.',
          'Do not use elevators during or after a quake.',
          'Do not move seriously injured people unless they are in immediate danger.'
        ],
        tags: ['drop cover hold', 'aftershock', 'home safety'],
        estimatedReadMinutes: 5,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Earthquake+Prep',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Earthquake+Prep',
        status: 'published',
        language: 'en',
        featured: true,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_basic_cpr',
        slug: 'basic-cpr-the-cab-method',
        title: 'Basic CPR: The CAB Method',
        category: 'First Aid',
        summary:
          'Use the CPR CAB sequence to respond quickly while emergency services are on the way.',
        contentSections: [
          {
            heading: 'C is for compressions',
            body:
              'Push hard and fast in the center of the chest at a steady rhythm. Let the chest rise fully between compressions.'
          },
          {
            heading: 'A is for airway',
            body:
              'Open the airway with a head-tilt and chin-lift if no spinal injury is suspected.'
          },
          {
            heading: 'B is for breathing',
            body:
              'Give rescue breaths only if trained and safe to do so. Continue until help arrives or the person recovers.'
          }
        ],
        doList: [
          'Call emergency services or ask someone nearby to call.',
          'Use an AED as soon as one is available.',
          'Continue CPR until professionals take over.'
        ],
        dontList: [
          'Do not stop compressions for long periods.',
          'Do not move the person unnecessarily.',
          'Do not delay calling for help.'
        ],
        tags: ['cpr', 'aed', 'first response'],
        estimatedReadMinutes: 6,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Basic+CPR',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Basic+CPR',
        status: 'published',
        language: 'en',
        featured: true,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_snake_bite',
        slug: 'snake-bite-response',
        title: 'Snake Bite Response',
        category: 'First Aid',
        summary:
          'Keep the person calm, limit movement, and seek urgent medical care after a snake bite.',
        contentSections: [
          {
            heading: 'Immediate steps',
            body:
              'Move to a safe area, call emergency services, and keep the bitten limb still and below heart level if possible.'
          },
          {
            heading: 'Monitoring',
            body:
              'Remove rings or tight clothing before swelling starts. Watch for breathing difficulty, fainting, or signs of shock.'
          }
        ],
        doList: [
          'Call for urgent medical help.',
          'Keep the person still and reassured.',
          'Note the snake appearance only if it is safe to do so.'
        ],
        dontList: [
          'Do not cut the wound.',
          'Do not suck out venom.',
          'Do not apply ice or a tourniquet.'
        ],
        tags: ['venom', 'bite', 'urgent care'],
        estimatedReadMinutes: 3,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Snake+Bite',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Snake+Bite',
        status: 'published',
        language: 'en',
        featured: false,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_allergic_reaction',
        slug: 'allergic-reaction-response',
        title: 'Allergic Reaction Response',
        category: 'First Aid',
        summary:
          'Recognize severe allergic reactions early and use prescribed emergency medication immediately.',
        contentSections: [
          {
            heading: 'Recognize the warning signs',
            body:
              'Trouble breathing, swelling of the lips or throat, hives, dizziness, and vomiting can signal a serious allergic reaction.'
          },
          {
            heading: 'Act fast',
            body:
              'Use an epinephrine auto-injector if prescribed and call emergency services right away. A second dose may be needed if symptoms continue.'
          }
        ],
        doList: [
          'Lay the person flat if they feel faint unless breathing is easier sitting up.',
          'Use the prescribed auto-injector immediately.',
          'Monitor breathing and be ready to start CPR if needed.'
        ],
        dontList: [
          'Do not wait for symptoms to worsen before calling for help.',
          'Do not give food or drink during severe breathing trouble.',
          'Do not assume symptoms are mild if throat swelling begins.'
        ],
        tags: ['anaphylaxis', 'epi pen', 'allergy'],
        estimatedReadMinutes: 4,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Allergic+Reaction',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Allergic+Reaction',
        status: 'published',
        language: 'en',
        featured: false,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_blackout',
        slug: 'blackout-readiness',
        title: 'Blackout Readiness',
        category: 'Blackout',
        summary:
          'Prepare lighting, device charging, food storage, and backup plans before a power outage.',
        contentSections: [
          {
            heading: 'Before the outage',
            body:
              'Keep flashlights, batteries, and charged power banks ready. Save emergency contacts and know how to manually open your garage or gate.'
          },
          {
            heading: 'During the outage',
            body:
              'Use flashlights instead of candles when possible. Keep refrigerator and freezer doors closed to preserve food.'
          }
        ],
        doList: [
          'Unplug sensitive electronics if power quality is unstable.',
          'Keep extra water available if pumps rely on electricity.',
          'Check on older adults and neighbors who may need support.'
        ],
        dontList: [
          'Do not run generators indoors.',
          'Do not touch fallen power lines.',
          'Do not use grills or fuel stoves indoors.'
        ],
        tags: ['generator', 'power outage', 'food safety'],
        estimatedReadMinutes: 4,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Blackout',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Blackout',
        status: 'published',
        language: 'en',
        featured: false,
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'tip_gas_leak',
        slug: 'gas-leak-response',
        title: 'Gas Leak Response',
        category: 'Gas Leak',
        summary:
          'Leave immediately, avoid sparks, and contact emergency services if you suspect a gas leak.',
        contentSections: [
          {
            heading: 'Recognize a leak',
            body:
              'The smell of gas, a hissing sound, or dead plants around a line can all signal a possible leak.'
          },
          {
            heading: 'Evacuate safely',
            body:
              'Do not use electrical switches, phones, or open flames inside. Move everyone outside and call for help from a safe distance.'
          }
        ],
        doList: [
          'Open doors only if you can do it safely while leaving.',
          'Move uphill and upwind if outdoors near a large leak.',
          'Follow instructions from the gas company and firefighters.'
        ],
        dontList: [
          'Do not turn lights on or off.',
          'Do not start a car in an attached garage.',
          'Do not re-enter until officials say it is safe.'
        ],
        tags: ['evacuation', 'utility', 'spark risk'],
        estimatedReadMinutes: 3,
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Gas+Leak',
        thumbnailUrl: 'https://placehold.co/600x400/png?text=Gas+Leak',
        status: 'published',
        language: 'en',
        featured: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    checklists: [
      {
        _id: 'checklist_earthquake_prep',
        type: 'template',
        ownerId: null,
        title: 'Earthquake Preparedness',
        category: 'Earthquake',
        description:
          'Build a safer home setup, stock essential supplies, and agree on a family communication plan.',
        iconUrl: 'https://placehold.co/128x128/png?text=EQ',
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Earthquake+Checklist',
        status: 'published',
        createdBy: 'admin_roni_morris',
        createdAt: now,
        updatedAt: now,
        items: [
          { _id: 'eq_item_1', text: 'Anchor heavy furniture to walls', order: 1 },
          { _id: 'eq_item_2', text: 'Identify safe spots in each room', order: 2 },
          { _id: 'eq_item_3', text: 'Practice drop, cover, and hold on', order: 3 },
          { _id: 'eq_item_4', text: 'Keep emergency water accessible', order: 4 },
          { _id: 'eq_item_5', text: 'Store battery-powered lights and radios', order: 5 },
          { _id: 'eq_item_6', text: 'Know how to turn off utilities', order: 6 },
          { _id: 'eq_item_7', text: 'Store emergency food supply at home', order: 7 },
          { _id: 'eq_item_8', text: 'Keep a full fuel tank above half', order: 8 },
          { _id: 'eq_item_9', text: 'Learn drop, cover, and hold on technique', order: 9 },
          { _id: 'eq_item_10', text: 'Know your building evacuation plan', order: 10 }
        ]
      },
      {
        _id: 'checklist_fire_safety',
        type: 'template',
        ownerId: null,
        title: 'Fire Safety',
        category: 'Fire Safety',
        description:
          'Keep fire prevention, smoke detection, and evacuation essentials ready at home.',
        iconUrl: 'https://placehold.co/128x128/png?text=FIRE',
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Fire+Checklist',
        status: 'published',
        createdBy: 'admin_roni_morris',
        createdAt: now,
        updatedAt: now,
        items: [
          { _id: 'fire_item_1', text: 'Test smoke alarms monthly', order: 1 },
          { _id: 'fire_item_2', text: 'Keep extinguisher in the kitchen', order: 2 },
          { _id: 'fire_item_3', text: 'Practice a two-exit evacuation plan', order: 3 },
          { _id: 'fire_item_4', text: 'Keep matches away from children', order: 4 },
          { _id: 'fire_item_5', text: 'Check overloaded electrical outlets', order: 5 }
        ]
      },
      {
        _id: 'checklist_first_aid',
        type: 'template',
        ownerId: null,
        title: 'First Aid Readiness',
        category: 'First Aid',
        description: 'Make sure core first-aid supplies are stocked and easy to reach.',
        iconUrl: 'https://placehold.co/128x128/png?text=AID',
        coverImageUrl: 'https://placehold.co/1200x800/png?text=First+Aid+Checklist',
        status: 'published',
        createdBy: 'admin_roni_morris',
        createdAt: now,
        updatedAt: now,
        items: [
          { _id: 'aid_item_1', text: 'Restock sterile gauze and bandages', order: 1 },
          { _id: 'aid_item_2', text: 'Confirm gloves and scissors are packed', order: 2 },
          { _id: 'aid_item_3', text: 'Check expiry date of medications', order: 3 },
          { _id: 'aid_item_4', text: 'Store CPR mask in the kit', order: 4 },
          { _id: 'aid_item_5', text: 'Keep first aid guide in the box', order: 5 }
        ]
      },
      {
        _id: 'checklist_home_safety',
        type: 'template',
        ownerId: null,
        title: 'Home Safety',
        category: 'Home Safety',
        description:
          'Keep essential household hazards under control with a simple monthly review.',
        iconUrl: 'https://placehold.co/128x128/png?text=HOME',
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Home+Safety',
        status: 'published',
        createdBy: 'admin_roni_morris',
        createdAt: now,
        updatedAt: now,
        items: [
          { _id: 'home_item_1', text: 'Lock cleaning products away', order: 1 },
          { _id: 'home_item_2', text: 'Check window and balcony safety', order: 2 },
          { _id: 'home_item_3', text: 'Inspect loose rugs and trip hazards', order: 3 },
          { _id: 'home_item_4', text: 'Review household emergency contacts', order: 4 }
        ]
      },
      {
        _id: 'checklist_family_bag',
        type: 'custom',
        ownerId: 'user_madiha_aroa',
        title: 'Family Go-Bag',
        category: 'Custom',
        description:
          'A personal checklist for grab-and-go emergency supplies for the whole family.',
        iconUrl: 'https://placehold.co/128x128/png?text=BAG',
        coverImageUrl: 'https://placehold.co/1200x800/png?text=Family+Go+Bag',
        status: 'published',
        createdBy: 'user_madiha_aroa',
        createdAt: now,
        updatedAt: now,
        items: [
          { _id: 'bag_item_1', text: 'Pack copies of IDs and medical cards', order: 1 },
          { _id: 'bag_item_2', text: 'Add one change of clothes per person', order: 2 },
          { _id: 'bag_item_3', text: 'Keep spare phone cables and battery pack', order: 3 }
        ]
      }
    ],
    checklistProgress: [
      {
        _id: 'progress_madiha_eq',
        userId: 'user_madiha_aroa',
        checklistId: 'checklist_earthquake_prep',
        completedItemIds: [
          'eq_item_1',
          'eq_item_2',
          'eq_item_4',
          'eq_item_5',
          'eq_item_7',
          'eq_item_10'
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'progress_madiha_bag',
        userId: 'user_madiha_aroa',
        checklistId: 'checklist_family_bag',
        completedItemIds: ['bag_item_1'],
        createdAt: now,
        updatedAt: now
      }
    ],
    conversations: [
      {
        _id: 'conv_choking_help',
        userId: 'user_madiha_aroa',
        title: 'Choking Emergency',
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            _id: 'msg_choking_user_1',
            role: 'user',
            content: 'How do I perform CPR? What should I do first?',
            createdAt: now
          },
          {
            _id: 'msg_choking_assistant_1',
            role: 'assistant',
            content:
              '1. Call emergency services immediately.\n2. Begin chest compressions in the center of the chest at a steady pace.\n3. Use an AED if available.\nIf the person is not breathing, keep CPR going until help arrives.',
            createdAt: now
          }
        ]
      },
      {
        _id: 'conv_fire_tips',
        userId: 'user_madiha_aroa',
        title: 'Fire Safety Tips',
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            _id: 'msg_fire_user_1',
            role: 'user',
            content: 'What should I do if grease catches fire while cooking?',
            createdAt: now
          },
          {
            _id: 'msg_fire_assistant_1',
            role: 'assistant',
            content:
              '1. Turn off the heat if it is safe.\n2. Cover the pan with a lid or metal tray.\n3. Never use water.\n4. If the fire spreads, evacuate and call emergency services.',
            createdAt: now
          }
        ]
      }
    ],
    legalDocuments: [
      {
        _id: 'legal_about_app',
        slug: 'about-app',
        title: 'About App',
        body: buildLongText([
          'We Safe is an emergency assistance and preparedness companion built to give people fast access to safety guides, checklists, and AI-assisted support in stressful situations.',
          'The app is designed to complement emergency preparedness, not replace trained professionals or local emergency responders.',
          'For life-threatening situations, always contact your local emergency number immediately.'
        ]),
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'legal_privacy_policy',
        slug: 'privacy-policy',
        title: 'Privacy Policy',
        body: buildLongText([
          'We Safe stores account details, preferences, and app activity required to deliver personalized emergency guidance, checklist progress, and chat history.',
          'Personal data is used only for service delivery, product support, and safety-related features requested by the user.',
          'Users can request account deletion or data export through the support channel exposed in the app settings.'
        ]),
        createdAt: now,
        updatedAt: now
      },
      {
        _id: 'legal_terms',
        slug: 'terms-and-conditions',
        title: 'Terms & Conditions',
        body: buildLongText([
          'We Safe provides educational safety content and guidance support. It does not replace professional medical advice, emergency dispatch, or licensed emergency services.',
          'By using the app, you agree to use it responsibly and verify critical instructions with local authorities whenever possible.',
          'Emergency instructions may vary by region, building type, and incident severity. Use judgment and prioritize official instructions from responders on site.'
        ]),
        createdAt: now,
        updatedAt: now
      }
    ],
    activityLog: [
      {
        _id: 'activity_guide_update',
        type: 'guide.updated',
        actorId: 'admin_roni_morris',
        title: 'Guide updated: CPR Basics',
        description: 'Refined CPR instructions and AED guidance for clarity.',
        createdAt: now
      },
      {
        _id: 'activity_checklist_create',
        type: 'checklist.created',
        actorId: 'admin_roni_morris',
        title: 'New checklist: Earthquake Preparedness',
        description: 'Published a 10-step earthquake readiness checklist.',
        createdAt: now
      },
      {
        _id: 'activity_prompt_update',
        type: 'ai.prompt.updated',
        actorId: 'admin_roni_morris',
        title: 'Chatbot tone updated',
        description: 'Prompt tuned to be calmer and more directive in emergencies.',
        createdAt: now
      }
    ]
  };
};
