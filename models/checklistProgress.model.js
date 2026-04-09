import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const checklistProgressSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('progress')
    },
    userId: {
      type: String,
      required: true,
      index: true
    },
    checklistId: {
      type: String,
      required: true,
      index: true
    },
    completedItemIds: {
      type: [String],
      default: []
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'checklist_progress'
  }
);

checklistProgressSchema.index({ userId: 1, checklistId: 1 }, { unique: true });

const ChecklistProgress =
  mongoose.models.ChecklistProgress ||
  mongoose.model('ChecklistProgress', checklistProgressSchema);

export default ChecklistProgress;
