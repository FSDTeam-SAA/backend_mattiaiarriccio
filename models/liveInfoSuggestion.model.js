import mongoose from 'mongoose';

/**
 * Every tappable prompt the chat welcome screen offers, in two flavours
 * distinguished by `kind`:
 *
 *  - `live_info`          : the Live Information buttons (Weather, Alerts,
 *                           Earthquakes, Official Updates), shown only when a
 *                           live search can actually run.
 *  - `suggested_question` : the ordinary Suggested Questions list, a deliberate
 *                           mix of questions that trigger a live search and
 *                           questions WeSafe answers from its own guidance.
 *
 * One collection rather than two because the admin needs exactly the same five
 * controls over both - title, prompt, language, order, enabled - and a single
 * CRUD keeps the dashboard and the API honest about that.
 *
 * Same shape as EmergencyResponse (per-row `language`, `order`, `active`) so the
 * admin CRUD and reorder UI behave identically. Tapping one sends `prompt` as a
 * normal chat message - it is a shortcut, not a separate code path, so the usual
 * web-search gate and limits apply exactly as they would to a typed question.
 */

/** The two flavours of prompt this collection holds. */
export const SUGGESTION_KINDS = ['live_info', 'suggested_question'];

/**
 * Placeholder the admin puts in a prompt where the place belongs, e.g.
 * "Are there active alerts in {location} today?". The app substitutes the
 * user's own city or the one they name; a prompt without it simply runs as
 * written.
 */
export const LOCATION_PLACEHOLDER = '{location}';

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
    // Which of the two lists this row belongs to.
    kind: {
      type: String,
      enum: SUGGESTION_KINDS,
      default: 'live_info',
      index: true
    },
    // Whether tapping this asks the user to place the question first. Weather,
    // alerts and seismic activity are only meaningful somewhere; "what are the
    // latest official updates" is not, and being asked for a city before every
    // answer is what makes a shortcut stop feeling like one.
    requiresLocation: {
      type: Boolean,
      default: false
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

liveInfoSuggestionSchema.index({ kind: 1, language: 1, active: 1, order: 1 });

const LiveInfoSuggestion =
  mongoose.models.LiveInfoSuggestion ||
  mongoose.model('LiveInfoSuggestion', liveInfoSuggestionSchema);

export default LiveInfoSuggestion;
