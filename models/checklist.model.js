import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const checklistItemSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('item')
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    order: {
      type: Number,
      required: true
    },
    icon: {
      type: String,
      default: '',
      trim: true
    }
  },
  {
    versionKey: false
  }
);

const checklistSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('checklist')
    },
    type: {
      type: String,
      enum: ['template', 'custom'],
      required: true
    },
    ownerId: {
      type: String,
      default: null,
      index: true
    },
    sourceChecklistId: {
      type: String,
      default: null,
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
    description: {
      type: String,
      default: '',
      trim: true
    },
    iconUrl: {
      type: String,
      default: ''
    },
    icon: {
      type: String,
      default: '',
      trim: true
    },
    coverImageUrl: {
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
      default: 'en',
      index: true
    },
    createdBy: {
      type: String,
      required: true
    },
    items: {
      type: [checklistItemSchema],
      default: []
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'checklists'
  }
);

checklistSchema.index(
  { ownerId: 1, sourceChecklistId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      ownerId: { $type: 'string' },
      sourceChecklistId: { $type: 'string' }
    }
  }
);

const Checklist = mongoose.models.Checklist || mongoose.model('Checklist', checklistSchema);

export default Checklist;
