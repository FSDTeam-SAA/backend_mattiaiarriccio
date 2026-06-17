import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const emergencyResponseSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('emergency')
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      default: '',
      trim: true
    },
    // Matched (case-insensitive contains) against user chat input.
    triggerKeywords: {
      type: [String],
      default: []
    },
    // The canned answer returned instead of calling the AI.
    responseTemplate: {
      type: String,
      required: true
    },
    // Single language per document (mirrors Checklist/SafetyTip).
    language: {
      type: String,
      default: 'en'
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
    collection: 'emergency_responses'
  }
);

emergencyResponseSchema.index({ category: 1, active: 1 });
emergencyResponseSchema.index({ language: 1, active: 1 });

const EmergencyResponse =
  mongoose.models.EmergencyResponse ||
  mongoose.model('EmergencyResponse', emergencyResponseSchema);

export default EmergencyResponse;
