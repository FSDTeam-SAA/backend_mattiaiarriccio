import mongoose from 'mongoose';

/**
 * The "Live Information / Informazioni in tempo reale" shortcuts shown in the
 * chat welcome screen, replacing the old Checklist/Guide card.
 *
 * Same shape as EmergencyResponse (per-row `language`, `order`, `active`) so the
 * admin CRUD and reorder UI behave identically. Tapping one sends `prompt` as a
 * normal chat message - it is a shortcut, not a separate code path, so the usual
 * web-search gate and limits apply exactly as they would to a typed question.
 */
const liveInfoSuggestionSchema = new mongoose.Schema(
  {
    _id: {
      type: String
    },
    // Short label on the chip, e.g. "Weather in my area".
    title: {
      type: String,
      required: true,
      trim: true
    },
    // What is actually sent to the chat when tapped.
    prompt: {
      type: String,
      required: true,
      trim: true
    },
    // Leading emoji shown on the chip, e.g. "🌤". Optional.
    icon: {
      type: String,
      default: '',
      trim: true
    },
    language: {
      type: String,
      enum: ['en', 'it'],
      default: 'en',
      index: true
    },
    order: {
      type: Number,
      default: 0
    },
    active: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: String,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'live_info_suggestions'
  }
);

liveInfoSuggestionSchema.index({ language: 1, active: 1, order: 1 });

const LiveInfoSuggestion =
  mongoose.models.LiveInfoSuggestion ||
  mongoose.model('LiveInfoSuggestion', liveInfoSuggestionSchema);

export default LiveInfoSuggestion;
