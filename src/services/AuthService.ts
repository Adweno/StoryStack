import { randomBytes } from "node:crypto";
import type { User } from "../domain/types";
import type { StoryStackDatabase } from "../storage/StoryStackDatabase";
import { PasswordHasher } from "./PasswordHasher";

const SESSION_DAYS = 14;

export class AuthService {
  private readonly passwordHasher = new PasswordHasher();

  constructor(private readonly database: StoryStackDatabase) {}

  login(username: string, password: string): LoginResult | undefined {
    const credentials = this.database.getUserCredentials(username);
    if (!credentials || credentials.status === "disabled" || !this.passwordHasher.verify(password, credentials.passwordHash)) {
      return undefined;
    }
    this.database.recordLastLogin(credentials.id);
    return this.createSession({
      id: credentials.id,
      name: credentials.name,
      role: credentials.role,
      status: credentials.status,
      username: credentials.username,
      email: credentials.email,
      passwordConfigured: Boolean(credentials.passwordHash),
      passwordResetRequired: Boolean(credentials.passwordResetRequired),
      theme: credentials.theme,
      reviewsEnabled: Boolean(credentials.reviewsEnabled)
    });
  }

  changePassword(userId: string, currentPassword: string | undefined, newPassword: string): User {
    const existingHash = this.database.getUserPasswordHash(userId);
    const resetRequired = this.database.isPasswordResetRequired(userId);
    if (existingHash && !resetRequired && !this.passwordHasher.verify(currentPassword ?? "", existingHash)) {
      throw new Error("Current password is incorrect.");
    }
    return this.database.setUserPassword(userId, newPassword);
  }

  resetPassword(userId: string, newPassword: string): User {
    return this.database.setUserPassword(userId, newPassword, { resetRequired: true });
  }

  createSession(user: User): LoginResult {
    const token = randomBytes(32).toString("hex");
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    this.database.createSession({
      token,
      userId: user.id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    return {
      token,
      expiresAt,
      user
    };
  }

  sessionUser(token: string | undefined): User | undefined {
    return token ? this.database.getSessionUser(token) : undefined;
  }

  logout(token: string | undefined): void {
    if (token) {
      this.database.deleteSession(token);
    }
  }
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: User;
}
