import mongoose from 'mongoose';
import { createId } from '../lib/id.js';

const auditLogSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => createId('audit')
    },
    adminId: {
      type: String,
      required: true,
      index: true
    },
    action: {
      type: String,
      required: true
    },
    targetUserId: {
      type: String,
      default: null,
      index: true
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs'
  }
);

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
