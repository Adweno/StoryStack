export class Clock {
  nowIso(): string {
    return new Date().toISOString();
  }
}
