import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const reminderRuleSchema = new mongoose.Schema(
  {
    // Notify offsetDays before the expiration date (e.g. 7 = one week before).
    offsetDays: {
      type: Number,
      default: 0
    },
    channel: {
      type: String,
      enum: ['push', 'local'],
      default: 'local'
    }
  },
  { _id: false }
);

const inspectionSchema = new mongoose.Schema(
  {
    intervalDays: {
      type: Number,
      default: null
    },
    lastInspectedAt: {
      type: Date,
      default: null
    },
    nextInspectionAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const materialSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('material')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      default: '',
      trim: true
    },
    imageUrl: {
      type: String,
      default: ''
    },
    expirationDate: {
      type: Date,
      default: null
    },
    inspection: {
      type: inspectionSchema,
      default: () => ({ intervalDays: null, lastInspectedAt: null, nextInspectionAt: null })
    },
    reminderRules: {
      type: [reminderRuleSchema],
      default: []
    },
    active: {
      type: Boolean,
      default: true
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'materials'
  }
);

materialSchema.index({ expirationDate: 1 });
materialSchema.index({ 'inspection.nextInspectionAt': 1 });

const Material = mongoose.models.Material || mongoose.model('Material', materialSchema);

export default Material;
