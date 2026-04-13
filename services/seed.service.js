import User from '../models/user.model.js';
import Notification from '../models/notification.model.js';
import SafetyTip from '../models/safetyTip.model.js';
import Checklist from '../models/checklist.model.js';
import ChecklistProgress from '../models/checklistProgress.model.js';
import Conversation from '../models/conversation.model.js';
import LegalDocument from '../models/legalDocument.model.js';
import Activity from '../models/activity.model.js';
import { buildSeedData } from '../data/seed.js';
import { hashPassword } from './security.service.js';
import { syncManagedCategoriesFromContentIfEmpty } from './category.service.js';

export const seedDatabase = async () => {
  const existingUsers = await User.countDocuments();

  if (existingUsers > 0) {
    return;
  }

  const seed = buildSeedData();

  const users = await Promise.all(
    seed.users.map(async ({ password, ...user }) => ({
      ...user,
      passwordHash: await hashPassword(password)
    }))
  );

  await User.insertMany(users);
  await Notification.insertMany(seed.notifications);
  await SafetyTip.insertMany(seed.safetyTips);
  await Checklist.insertMany(seed.checklists);
  await syncManagedCategoriesFromContentIfEmpty();
  await ChecklistProgress.insertMany(seed.checklistProgress);
  await Conversation.insertMany(seed.conversations);
  await LegalDocument.insertMany(seed.legalDocuments);
  await Activity.insertMany(seed.activityLog);
};
