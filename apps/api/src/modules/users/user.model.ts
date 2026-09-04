import {
  DEFAULT_TIMEZONE,
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface UserDocument {
  _id: Types.ObjectId;
  username: string;
  /** Never selected by default; only the auth service asks for it explicitly. */
  passwordHash: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  phone: string | null;
  branch: Types.ObjectId | null;
  /**
   * IANA zone the employee's wall clock is read in. It belongs to the account
   * rather than to the browser: a reminder set from a phone abroad still means
   * ten o'clock at the shop.
   */
  timezone: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = createSchema<UserDocument>({
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 40,
  },
  passwordHash: { type: String, required: true, select: false },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  role: { type: String, required: true, enum: USER_ROLES },
  status: { type: String, required: true, enum: USER_STATUSES, default: 'active' },
  phone: { type: String, default: null, trim: true, maxlength: 32 },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  timezone: { type: String, required: true, trim: true, maxlength: 64, default: DEFAULT_TIMEZONE },
  lastLoginAt: { type: Date, default: null },
});

// Login looks a user up by username; the uniqueness constraint enforces the
// account identity at the same time.
userSchema.index({ username: 1 }, { unique: true });
// Staff listings are always filtered by branch and, usually, by status.
userSchema.index({ branch: 1, status: 1 });

export const UserModel: Model<UserDocument> = model<UserDocument>('User', userSchema);
