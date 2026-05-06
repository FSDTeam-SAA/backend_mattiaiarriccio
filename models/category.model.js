import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const localizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, default: '', trim: true },
    it: { type: String, default: '', trim: true }
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('category')
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    names: {
      type: localizedStringSchema,
      required: true,
      validate: {
        validator: (value) => Boolean(value && String(value.en || '').trim()),
        message: 'names.en is required'
      }
    },
    descriptions: {
      type: localizedStringSchema,
      default: () => ({ en: '', it: '' })
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

categorySchema.index({ sortOrder: 1, 'names.en': 1 });

const Category =
  mongoose.models.Category || mongoose.model('Category', categorySchema);

export default Category;
