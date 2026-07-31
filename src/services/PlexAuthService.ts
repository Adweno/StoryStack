import type { User, UserRole } from "../domain/types";
import type { StoryStackDatabase } from "../storage/StoryStackDatabase";
import { AuthService, type LoginResult } from "./AuthService";

const PLEX_HEADERS = {
  "X-Plex-Product": "Story Stack",
  "X-Plex-Version": "1.0.0",
  "X-Plex-Platform": "Web",
  "X-Plex-Device": "Story Stack",
  Accept: "application/json"
};

export class PlexAuthService {
  private readonly clientIdentifier = process.env.STORY_STACK_PLEX_CLIENT_ID ?? "story-stack-self-hosted";
  private readonly adminEmail = (process.env.STORY_STACK_ADMIN_EMAIL ?? "adam.w.nott@gmail.com").toLowerCase();

  constructor(
    private readonly database: StoryStackDatabase,
    private readonly authService: AuthService
  ) {}

  async createPin(): Promise<PlexPinStart> {
    const response = await fetch("https://plex.tv/api/v2/pins?strong=true", {
      method: "POST",
      headers: this.headers()
    });
    if (!response.ok) {
      throw new Error("Plex login could not be started.");
    }
    const pin = (await response.json()) as PlexPinResponse;
    return {
      id: pin.id,
      code: pin.code,
      authUrl: this.authUrl(pin.code)
    };
  }

  async completePin(pinId: number): Promise<LoginResult | undefined> {
    const response = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: this.headers()
    });
    if (!response.ok) {
      throw new Error("Plex login status could not be checked.");
    }
    const pin = (await response.json()) as PlexPinResponse;
    if (!pin.authToken) {
      return undefined;
    }
    const plexUser = await this.fetchPlexUser(pin.authToken);
    const user = this.database.upsertPlexUser({
      email: plexUser.email,
      name: plexUser.name,
      plexId: plexUser.id,
      role: this.roleForEmail(plexUser.email),
      plexToken: pin.authToken
    });
    return this.authService.createSession(user);
  }

  private async fetchPlexUser(authToken: string): Promise<PlexAccount> {
    const response = await fetch("https://plex.tv/api/v2/user", {
      headers: {
        ...this.headers(),
        "X-Plex-Token": authToken
      }
    });
    if (!response.ok) {
      throw new Error("Plex account could not be verified.");
    }
    const data = (await response.json()) as PlexUserResponse;
    const email = data.email?.trim();
    if (!email) {
      throw new Error("Plex did not return an email address for this account.");
    }
    return {
      email,
      id: String(data.uuid ?? data.id ?? email),
      name: data.title ?? data.username ?? email
    };
  }

  private roleForEmail(email: string): UserRole {
    return email.toLowerCase() === this.adminEmail ? "admin" : "user";
  }

  private authUrl(code: string): string {
    const params = new URLSearchParams({
      clientID: this.clientIdentifier,
      code
    });
    params.set("context[device][product]", "Story Stack");
    return `https://app.plex.tv/auth#?${params.toString()}`;
  }

  private headers(): Record<string, string> {
    return {
      ...PLEX_HEADERS,
      "X-Plex-Client-Identifier": this.clientIdentifier
    };
  }
}

export interface PlexPinStart {
  id: number;
  code: string;
  authUrl: string;
}

interface PlexPinResponse {
  id: number;
  code: string;
  authToken?: string;
}

interface PlexUserResponse {
  id?: number | string;
  uuid?: string;
  email?: string;
  title?: string;
  username?: string;
}

interface PlexAccount {
  id: string;
  email: string;
  name: string;
}
