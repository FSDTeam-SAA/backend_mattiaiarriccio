export const appConfig = {
  appName: 'We Safe',
  version: '1.0.0',
  supportedLanguages: [
    {
      code: 'en',
      name: 'English',
      nativeName: 'English',
      flag: 'GB'
    },
    {
      code: 'it',
      name: 'Italian',
      nativeName: 'Italiano',
      flag: 'IT'
    }
  ],
  emergencyCategories: [
    {
      slug: 'fire-safety',
      names: { en: 'Fire Safety', it: 'Sicurezza antincendio' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'earthquake',
      names: { en: 'Earthquake', it: 'Terremoto' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'first-aid',
      names: { en: 'First Aid', it: 'Primo soccorso' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'flooding',
      names: { en: 'Flooding', it: 'Alluvione' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'blackout',
      names: { en: 'Blackout', it: 'Blackout' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'gas-leak',
      names: { en: 'Gas Leak', it: 'Fuga di gas' },
      descriptions: { en: '', it: '' }
    },
    {
      slug: 'home-safety',
      names: { en: 'Home Safety', it: 'Sicurezza domestica' },
      descriptions: { en: '', it: '' }
    }
  ]
};
