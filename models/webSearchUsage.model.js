import mongoose from 'mongoose';

/**
 * Daily roll-up of actual web searches performed, for the dashboard counters
 * (searches today / this month / total).
 *
 * This exists because User.dailyUsage is a single rolling bucket that is
 * overwritten on date rollover and keeps no history - it can answer "how many
 * has THIS user done today" but never "how many this month" or "total".
 *
 * One document per day (`_id` is the YYYY-MM-DD string, so $inc upserts are
 * atomic and duplicate-proof). ~365 documents per year.
 *
 * Incremented only when the model actually performed a search, never when the
 * tool was merely offered - so the numbers reflect billable calls.
 */
const webSearchUsageSchema = new mongoose.Schema(
  {
    // YYYY-MM-DD (UTC), matching the convention in middlewares/dailyLimit.js
    _id: {
      type: String,
      required: true
    },
    date: {
      type: String,
      required: true
    },
    count: {
      type: Number,
      default: 0
    },
    freeCount: {
      type: Number,
      default: 0
    },
    premiumCount: {
      type: Number,
      default: 0
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'web_search_usage'
  }
);

const WebSearchUsage =
  mongoose.models.WebSearchUsage ||
  mongoose.model('WebSearchUsage', webSearchUsageSchema);

export default WebSearchUsage;
