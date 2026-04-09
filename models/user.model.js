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
      default: 'en'
    },
    notificationsEnabled: {
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
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'users'
  }
);

userSchema.index({ email: 1, role: 1 }, { unique: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
