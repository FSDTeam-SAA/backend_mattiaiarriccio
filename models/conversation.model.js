import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const conversationMessageSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('msg')
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true
    },
    content: {
      type: String,
      required: true
    },
    routingSource: {
      type: String,
      default: ''
    },
    routingConfidence: {
      type: Number,
      default: null
    },
    matchedPlaybookId: {
      type: String,
      default: ''
    },
    routingReason: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    versionKey: false
  }
);

const conversationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('conv')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    emergencyType: {
      type: String,
      default: '',
      trim: true
    },
    language: {
      type: String,
      enum: ['en', 'it'],
      default: 'en'
    },
    messages: {
      type: [conversationMessageSchema],
      default: []
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'conversations'
  }
);

const Conversation =
  mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

export default Conversation;
