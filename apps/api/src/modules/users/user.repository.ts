import { BaseRepository } from '../../core/db/base-repository.js';
import { UserModel, type UserDocument } from './user.model.js';

class UserRepository extends BaseRepository<UserDocument> {
  constructor() {
    super(UserModel);
  }

  /**
   * Reads a user together with the password hash, which the schema excludes by
   * default. Only the authentication flow may call this.
   */
  async findByUsernameWithSecret(username: string): Promise<UserDocument | null> {
    return UserModel.findOne({ username: username.trim().toLowerCase() })
      .select('+passwordHash')
      .lean<UserDocument | null>()
      .exec();
  }

  async findByIdWithSecret(id: string): Promise<UserDocument | null> {
    return UserModel.findById(id).select('+passwordHash').lean<UserDocument | null>().exec();
  }

  async usernameExists(username: string): Promise<boolean> {
    return this.exists({ username: username.trim().toLowerCase() });
  }

  async touchLastLogin(id: string, at: Date): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { lastLoginAt: at } }).exec();
  }
}

export const userRepository = new UserRepository();
