import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const activitySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('activity')
    },
    type: {
      type: String,
      required: true
    },
    actorId: {
      type: String,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ''
    }
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'activity_log'
  }
);

const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);

export default Activity;
