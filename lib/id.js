import crypto from 'crypto';

export const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
