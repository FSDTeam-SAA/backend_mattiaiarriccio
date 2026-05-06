import mongoose from 'mongoose';

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

promptConfigSchema.index({ type: 1, language: 1 }, { unique: true });

const PromptConfig =
  mongoose.models.PromptConfig ||
  mongoose.model('PromptConfig', promptConfigSchema);

export default PromptConfig;
