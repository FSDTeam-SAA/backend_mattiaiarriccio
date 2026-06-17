import mongoose from 'mongoose';

const appSettingSchema = new mongoose.Schema(
  {
    // The key IS the document _id so reads/writes are atomic by key.
    _id: {
      type: String,
      required: true
    },
    key: {
      type: String,
      required: true
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
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
    collection: 'app_settings'
  }
);

appSettingSchema.index({ key: 1 }, { unique: true });

const AppSetting =
  mongoose.models.AppSetting || mongoose.model('AppSetting', appSettingSchema);

export default AppSetting;
