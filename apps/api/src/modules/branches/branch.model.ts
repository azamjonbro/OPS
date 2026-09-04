import { model, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface BranchDocument {
  _id: Types.ObjectId;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = createSchema<BranchDocument>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
  address: { type: String, default: null, trim: true, maxlength: 240 },
  phone: { type: String, default: null, trim: true, maxlength: 32 },
  isActive: { type: Boolean, required: true, default: true },
});

// The code is how staff and imports refer to a branch, so it must be unique.
branchSchema.index({ code: 1 }, { unique: true });

export const BranchModel: Model<BranchDocument> = model<BranchDocument>('Branch', branchSchema);
