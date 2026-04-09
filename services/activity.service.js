import Activity from '../models/activity.model.js';

export const logActivity = async ({ type, actorId, title, description = '' }) =>
  Activity.create({
    type,
    actorId,
    title,
    description
  });
