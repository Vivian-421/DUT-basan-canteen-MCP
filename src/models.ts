import { Schema } from 'mongoose';
import type { Model, Mongoose } from 'mongoose';

export interface CanteenProfile {
  _id: string;
  email: string;
  createdAt: Date;
}

export interface CanteenEmailCode {
  _id: string;
  hash: string;
  attempts: number;
  sentAt: Date;
  expiresAt: Date;
}

export interface CanteenCredential {
  _id: string;
  profile: string;
  kind: 'session' | 'client';
  name: string;
  createdAt: Date;
  expiresAt?: Date;
}

/** Food profiles are independent of the application's chat accounts. */
export function createCanteenModels(mongoose: Mongoose) {
  const profiles = new Schema<CanteenProfile>({
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true },
  });
  const codes = new Schema<CanteenEmailCode>({
    _id: { type: String, required: true },
    hash: { type: String, required: true },
    attempts: { type: Number, required: true },
    sentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  });
  codes.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const credentials = new Schema<CanteenCredential>({
    _id: { type: String, required: true },
    profile: { type: String, required: true, index: true },
    kind: { type: String, enum: ['session', 'client'], required: true },
    name: { type: String, required: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date },
  });
  credentials.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return {
    profiles: (mongoose.models.CanteenProfile ??
      mongoose.model('CanteenProfile', profiles)) as Model<CanteenProfile>,
    codes: (mongoose.models.CanteenEmailCode ??
      mongoose.model('CanteenEmailCode', codes)) as Model<CanteenEmailCode>,
    credentials: (mongoose.models.CanteenCredential ??
      mongoose.model('CanteenCredential', credentials)) as Model<CanteenCredential>,
  };
}
