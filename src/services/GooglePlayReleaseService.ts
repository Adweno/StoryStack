import crypto from "node:crypto";

export interface GooglePlayCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface ReleaseOptions {
  packageName: string;
  track: string;
  versionCode: string;
  releaseName?: string;
  releaseNotes: string;
  status?: "draft" | "completed" | "halted" | "inProgress";
  testerGoogleGroups?: string[];
}

export interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

const API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD_ROOT = "https://www.googleapis.com/upload/androidpublisher/v3";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createJwt(credentials: GooglePlayCredentials, now = Math.floor(Date.now() / 1000)): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: TOKEN_SCOPE,
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${base64Url(signer.sign(credentials.private_key))}`;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    return body.error?.message ?? text;
  } catch {
    return text || response.statusText;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function buildTrackPayload(options: ReleaseOptions): Record<string, unknown> {
  return {
    releases: [{
      name: options.releaseName,
      versionCodes: [options.versionCode],
      status: options.status ?? "completed",
      releaseNotes: [{ language: "en-US", text: options.releaseNotes }],
    }],
  };
}

export class GooglePlayReleaseService {
  private accessToken: string | undefined;

  constructor(
    private readonly credentials: GooglePlayCredentials,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async publishBundle(bundle: Uint8Array, options: ReleaseOptions): Promise<{ editId: string; versionCode: string }> {
    const editId = await this.createEdit(options.packageName);
    try {
      const uploadedVersionCode = await this.uploadBundle(options.packageName, editId, bundle);
      if (options.testerGoogleGroups?.length) {
        await this.updateTesters(options.packageName, editId, options.track, options.testerGoogleGroups);
      }
      await this.updateTrack(options.packageName, editId, options.track, {
        ...options,
        versionCode: uploadedVersionCode,
      });
      await this.commitEdit(options.packageName, editId);
      return { editId, versionCode: uploadedVersionCode };
    } catch (error) {
      await this.deleteEdit(options.packageName, editId).catch(() => undefined);
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const tokenUri = this.credentials.token_uri ?? "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJwt(this.credentials),
    });
    const response = await this.request(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error("Google OAuth response did not include an access token.");
    this.accessToken = data.access_token;
    return data.access_token;
  }

  private async request(url: string, init: RequestInit, attempts = 3, timeoutMs = 5000): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...init, signal: init.signal ?? controller.signal });
        if (response.ok) return response;
        if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
          throw new Error(`Google Play API ${response.status}: ${await readError(response)}`);
        }
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) throw error;
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(500 * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error("Google Play API request failed.");
  }

  private async authorizedRequest(url: string, init: RequestInit = {}, attempts = 3, timeoutMs = 5000): Promise<Response> {
    const token = await this.getAccessToken();
    return this.request(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    }, attempts, timeoutMs);
  }

  private async createEdit(packageName: string): Promise<string> {
    const response = await this.authorizedRequest(`${API_ROOT}/applications/${encodeURIComponent(packageName)}/edits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json() as { id?: string };
    if (!data.id) throw new Error("Google Play did not return an edit ID.");
    return data.id;
  }

  private async uploadBundle(packageName: string, editId: string, bundle: Uint8Array): Promise<string> {
    const response = await this.authorizedRequest(`${UPLOAD_ROOT}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bundle as unknown as BodyInit,
    }, 2, 600000);
    const data = await response.json() as { versionCode?: string | number };
    if (data.versionCode === undefined) throw new Error("Google Play did not return the uploaded version code.");
    return String(data.versionCode);
  }

  private async updateTrack(packageName: string, editId: string, track: string, options: ReleaseOptions): Promise<void> {
    await this.authorizedRequest(`${API_ROOT}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildTrackPayload(options)),
    });
  }

  private async updateTesters(packageName: string, editId: string, track: string, googleGroups: string[]): Promise<void> {
    await this.authorizedRequest(`${API_ROOT}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}/testers/${encodeURIComponent(track)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleGroups }),
    });
  }

  private async commitEdit(packageName: string, editId: string): Promise<void> {
    await this.authorizedRequest(`${API_ROOT}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}:commit`, { method: "POST" });
  }

  private async deleteEdit(packageName: string, editId: string): Promise<void> {
    await this.authorizedRequest(`${API_ROOT}/applications/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(editId)}`, { method: "DELETE" });
  }
}

export function validateCredentials(value: unknown): GooglePlayCredentials {
  if (!value || typeof value !== "object") throw new Error("Play credentials must be a JSON object.");
  const credentials = value as Partial<GooglePlayCredentials>;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Play credentials must include client_email and private_key.");
  }
  return credentials as GooglePlayCredentials;
}
