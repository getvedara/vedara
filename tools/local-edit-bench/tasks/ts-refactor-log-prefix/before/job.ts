export type Logger = (line: string) => void;

export class SyncJob {
  private done = 0;

  constructor(
    readonly name: string,
    private readonly total: number,
    private readonly logger: Logger = console.log,
  ) {}

  start(): void {
    this.done = 0;
    this.logger(`[sync] starting ${this.total} items`);
  }

  step(count = 1): void {
    this.done = Math.min(this.total, this.done + count);
    this.logger(`[sync] progress ${this.done}/${this.total}`);
  }

  finish(): boolean {
    const complete = this.done === this.total;
    this.logger(`[sync] finished (${complete ? 'complete' : 'partial'})`);
    return complete;
  }
}
