import mongoose from 'mongoose';

const legalDocumentSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    body: {
      type: String,
      required: true
    }
  },
  {
    versionKey: false,
    timestamps: true,
    collection: 'legal_documents'
  }
);

const LegalDocument =
  mongoose.models.LegalDocument || mongoose.model('LegalDocument', legalDocumentSchema);

export default LegalDocument;
