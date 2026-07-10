import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const userSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('user')
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      required: true
    },
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      default: '',
      trim: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    phoneNumber: {
      type: String,
      default: ''
    },
    avatarUrl: {
      type: String,
      default: ''
    },
    preferredLanguage: {
      type: String,
      enum: ['en', 'it'],
      default: 'en'
    },
    // Master switch (kept for backwards compatibility). When false, neither push
    // nor email is delivered regardless of the per-channel flags below.
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    // Where reminder/notification emails are delivered. Empty falls back to the
    // account `email`. Kept separate so a user can receive notifications at a
    // different address than the one they log in with.
    notificationEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true
    },
    notificationEmailVerified: {
      type: Boolean,
      default: false
    },
    // Per-channel opt-in. Both default on so existing users keep receiving.
    receiveEmailNotifications: {
      type: Boolean,
      default: true
    },
    receivePushNotifications: {
      type: Boolean,
      default: true
    },
    // Wall-clock time, in `timezone`, at which reminders are delivered. Without
    // these a reminder inherits the time-of-day stored on the expiry date —
    // midnight UTC, i.e. 02:00 in Italy. Defaults to a civil 09:00.
    reminderHour: {
      type: Number,
      min: 0,
      max: 23,
      default: 9
    },
    reminderMinute: {
      type: Number,
      min: 0,
      max: 59,
      default: 0
    },
    // IANA zone reported by the device (e.g. 'Europe/Rome'). Interpreting the
    // hour above requires it; the server itself runs in UTC.
    timezone: {
      type: String,
      trim: true,
      default: 'Europe/Rome'
    },
    // Per-category opt-in, gating BOTH channels for notifications of that
    // category (see utils/notificationPrefs.js for the type->category map).
    // All default on so existing users keep receiving until they opt out.
    notifyReminders: {
      type: Boolean,
      default: true
    },
    notifyGuideUpdates: {
      type: Boolean,
      default: true
    },
    notifyPremiumOffers: {
      type: Boolean,
      default: true
    },
    notifyAppUpdates: {
      type: Boolean,
      default: true
    },
    onboardingCompleted: {
      type: Boolean,
      default: false
    },
    passwordHash: {
      type: String,
      required: true
    },
    tier: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free'
    },
    premiumSource: {
      type: String,
      enum: ['google_play', 'app_store', 'manual', 'coupon', null],
      default: null
    },
    premiumExpiresAt: {
      type: Date,
      default: null
    },
    premiumGrantedBy: {
      type: String,
      default: null
    },
    // Manual/coupon grant store, kept independent of store subscriptions so
    // recomputeTier() can combine both sources. null expiresAt + active = lifetime.
    manualPremiumActive: {
      type: Boolean,
      default: false
    },
    manualPremiumExpiresAt: {
      type: Date,
      default: null
    },
    manualPremiumSource: {
      type: String,
      enum: ['manual', 'coupon', null],
      default: null
    },
    dailyUsage: {
      type: new mongoose.Schema(
        {
          date: { type: String, default: '' },
          messages: { type: Number, default: 0 },
          chats: { type: Number, default: 0 }
        },
        { _id: false }
      ),
      default: () => ({ date: '', messages: 0, chats: 0 })
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'users'
  }
);

userSchema.index({ email: 1, role: 1 }, { unique: true });
userSchema.index({ premiumExpiresAt: 1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
