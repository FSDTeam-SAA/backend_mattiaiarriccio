import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const passwordResetSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('reset')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    otpCode: {
      type: String,
      required: true
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    resetToken: {
      type: String,
      default: null
    },
    expiresAt: {
      type: Date,
      required: true
    },
    consumedAt: {
      type: Date,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'password_resets'
  }
);

const PasswordReset =
  mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);

export default PasswordReset;
