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
    // True when this answer was produced with the OpenAI web_search tool.
    usedWebSearch: {
      type: Boolean,
      default: false
    },
    // Official sources cited by that search. Persisted (rather than derived) so
    // the source chips survive a history reload.
    sources: {
      type: [
        new mongoose.Schema(
          {
            title: { type: String, default: '' },
            url: { type: String, default: '' },
            domain: { type: String, default: '' }
          },
          { _id: false }
        )
      ],
      default: []
    },
    // The weather snapshot this answer was built on, when there was one.
    // Persisted like `sources` so the weather card survives a history reload,
    // and Mixed because the provider's shape is the contract - pinning it to a
    // sub-schema here would mean a migration every time a field is added.
    weather: {
      type: mongoose.Schema.Types.Mixed,
      default: null
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
