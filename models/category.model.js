import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const categorySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('category')
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    description: {
      type: String,
      default: '',
      trim: true
    },
    sortOrder: {
      type: Number,
      default: 0
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
    collection: 'categories'
  }
);

categorySchema.index({ sortOrder: 1, name: 1 });

const Category =
  mongoose.models.Category || mongoose.model('Category', categorySchema);

export default Category;
