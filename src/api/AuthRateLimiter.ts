type AttemptWindow = {
  count: number;
  resetAt: number;
};

export class AuthRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): number | undefined {
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + windowMs });
      return undefined;
    }
    if (current.count >= limit) {
      return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    }
    current.count += 1;
    return undefined;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
