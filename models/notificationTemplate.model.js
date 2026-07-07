import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const notificationTemplateSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('notiftemplate')
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    body: {
      type: String,
      required: true,
      trim: true
    },
    channels: {
      type: [String],
      enum: ['push', 'email'],
      default: ['push']
    },
    audience: {
      type: {
        type: String,
        enum: ['all', 'free', 'premium', 'category'],
        default: 'all'
      },
      categorySlug: {
        type: String,
        default: '',
        trim: true
      }
    },
    createdBy: {
      type: String,
      default: null
    },
    updatedBy: {
      type: String,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'notification_templates'
  }
);

notificationTemplateSchema.index({ updatedAt: -1 });

const NotificationTemplate =
  mongoose.models.NotificationTemplate ||
  mongoose.model('NotificationTemplate', notificationTemplateSchema);

export default NotificationTemplate;
