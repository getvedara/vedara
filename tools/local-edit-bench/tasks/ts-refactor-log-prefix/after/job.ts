export type Logger = (line: string) => void;

export class SyncJob {
  private done = 0;

  constructor(
    readonly name: string,
    private readonly total: number,
    private readonly logger: Logger = console.log,
  ) {}

  private log(message: string): void {
    this.logger(`[sync:${this.name}] ${message}`);
  }

  start(): void {
    this.done = 0;
    this.log(`starting ${this.total} items`);
  }

  step(count = 1): void {
    this.done = Math.min(this.total, this.done + count);
    this.log(`progress ${this.done}/${this.total}`);
  }

  finish(): boolean {
    const complete = this.done === this.total;
    this.log(`finished (${complete ? 'complete' : 'partial'})`);
    return complete;
  }
}
