import { PAGE_CLOSE_GRACE_MS } from '../shared/config.js';

export class PageLifetime {
  private connections = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly onShutdown?: () => void, private readonly graceMs = PAGE_CLOSE_GRACE_MS) {}

  connect(): () => void {
    if (this.disposed) return () => {};
    this.connections += 1;
    clearTimeout(this.timer);
    let connected = true;
    return () => {
      if (!connected || this.disposed) return;
      connected = false;
      this.connections -= 1;
      if (this.connections === 0 && this.onShutdown) {
        this.timer = setTimeout(() => this.onShutdown?.(), this.graceMs);
      }
    };
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
