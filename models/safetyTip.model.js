import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const contentSectionSchema = new mongoose.Schema(
  {
    heading: {
      type: String,
      default: ''
    },
    body: {
      type: String,
      default: ''
    }
  },
  {
    _id: false
  }
);

const safetyTipSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('tip')
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      required: true,
      trim: true
    },
    summary: {
      type: String,
      required: true,
      trim: true
    },
    contentSections: {
      type: [contentSectionSchema],
      default: []
    },
    doList: {
      type: [String],
      default: []
    },
    dontList: {
      type: [String],
      default: []
    },
    tags: {
      type: [String],
      default: []
    },
    estimatedReadMinutes: {
      type: Number,
      default: 4
    },
    coverImageUrl: {
      type: String,
      default: ''
    },
    thumbnailUrl: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'published'
    },
    language: {
      type: String,
      default: 'en'
    },
    featured: {
      type: Boolean,
      default: false
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'safety_tips'
  }
);

const SafetyTip =
  mongoose.models.SafetyTip || mongoose.model('SafetyTip', safetyTipSchema);

export default SafetyTip;
