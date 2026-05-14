import mongoose from 'mongoose';

const DEFAULT_PROMPT_TYPE = 'global_prompt';
const DEFAULT_PROMPT_LANGUAGE = 'en';
const PROMPT_CONFIG_UNIQUE_INDEX = 'type_1_language_1';
const PROMPT_TEXT_FIELDS = [
  'welcome_instruction',
  'system_instruction',
  'fallback_message'
];

const promptConfigSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      default: 'global_prompt'
    },
    language: {
      type: String,
      required: true,
      default: 'en',
      index: true
    },
    welcome_instruction: { type: String, default: '' },
    system_instruction: { type: String, default: '' },
    fallback_message: { type: String, default: '' },
    updated_at: { type: Date, default: Date.now }
  },
  {
    versionKey: false,
    collection: 'prompt_config'
  }
);

promptConfigSchema.index(
  { type: 1, language: 1 },
  { unique: true, name: PROMPT_CONFIG_UNIQUE_INDEX }
);

const PromptConfig =
  mongoose.models.PromptConfig ||
  mongoose.model('PromptConfig', promptConfigSchema);

const isSingleTypeUniqueIndex = (index) => {
  const keys = Object.keys(index.key || {});
  return index.unique === true && keys.length === 1 && index.key.type === 1;
};

const migratePromptConfigLanguage = async () => {
  const missingLanguageDocs = await PromptConfig.find({
    $or: [
      { language: { $exists: false } },
      { language: null },
      { language: '' }
    ]
  })
    .sort({ updated_at: -1 })
    .lean();

  for (const doc of missingLanguageDocs) {
    const type = doc.type || DEFAULT_PROMPT_TYPE;
    const existing = await PromptConfig.findOne({
      _id: { $ne: doc._id },
      type,
      language: DEFAULT_PROMPT_LANGUAGE
    });

    if (!existing) {
      await PromptConfig.updateOne(
        { _id: doc._id },
        {
          $set: {
            type,
            language: DEFAULT_PROMPT_LANGUAGE
          }
        }
      );
      continue;
    }

    const merge = {};
    for (const field of PROMPT_TEXT_FIELDS) {
      if (!existing[field] && doc[field]) {
        merge[field] = doc[field];
      }
    }

    if (Object.keys(merge).length > 0) {
      await PromptConfig.updateOne({ _id: existing._id }, { $set: merge });
    }

    await PromptConfig.deleteOne({ _id: doc._id });
  }
};

export const ensurePromptConfigIndexes = async () => {
  await PromptConfig.createCollection();
  await migratePromptConfigLanguage();

  const indexes = await PromptConfig.collection.indexes();
  for (const index of indexes) {
    if (isSingleTypeUniqueIndex(index)) {
      await PromptConfig.collection.dropIndex(index.name);
    }
  }

  await PromptConfig.collection.createIndex(
    { type: 1, language: 1 },
    { unique: true, name: PROMPT_CONFIG_UNIQUE_INDEX }
  );
};

export default PromptConfig;
