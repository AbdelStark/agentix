import type {
  DashboardEventEnvelope,
  DashboardLiveEvent,
} from "./dashboard-types";

type StreamOptions = {
  heartbeatMs?: number;
  replayLimit?: number;
};

type ReplayRequest = {
  afterSeq: number | null;
  runId?: string | null;
};

type Subscriber = (event: DashboardLiveEvent) => void;

export class DashboardEventStream {
  private readonly heartbeatMs: number;
  private readonly replayLimit: number;
  private nextSeq: number;
  private readonly replayBuffer: DashboardEventEnvelope[];
  private readonly eventKeyToSeq: Map<string, number>;
  private readonly subscribers: Set<Subscriber>;
  private heartbeatTimer: Timer | null;

  constructor(opts: StreamOptions = {}) {
    this.heartbeatMs =
      Number.isFinite(opts.heartbeatMs) && Number(opts.heartbeatMs) > 0
        ? Math.floor(Number(opts.heartbeatMs))
        : 1_000;
    this.replayLimit =
      Number.isFinite(opts.replayLimit) && Number(opts.replayLimit) > 0
        ? Math.floor(Number(opts.replayLimit))
        : 500;
    this.nextSeq = 1;
    this.replayBuffer = [];
    this.eventKeyToSeq = new Map();
    this.subscribers = new Set();
    this.heartbeatTimer = null;
  }

  publish(input: Omit<DashboardEventEnvelope, "seq" | "timestamp"> & {
    seq?: number;
    timestamp?: string;
  }): number {
    const existingSeq = this.eventKeyToSeq.get(input.eventKey);
    if (existingSeq != null) {
      return existingSeq;
    }

    const seq = this.nextSeq;
    this.nextSeq += 1;

    const event: DashboardEventEnvelope = {
      ...input,
      seq,
      timestamp: new Date(input.timestampMs).toISOString(),
    };

    this.eventKeyToSeq.set(event.eventKey, event.seq);
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > this.replayLimit) {
      const removed = this.replayBuffer.shift();
      if (removed) this.eventKeyToSeq.delete(removed.eventKey);
    }

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }

    return seq;
  }

  getLatestSeq(): number {
    return Math.max(0, this.nextSeq - 1);
  }

  getReplay(request: ReplayRequest): DashboardEventEnvelope[] {
    const afterSeq =
      request.afterSeq == null || !Number.isFinite(request.afterSeq)
        ? null
        : Math.floor(request.afterSeq);

    return this.replayBuffer.filter((event) => {
      if (request.runId && event.runId !== request.runId) return false;
      if (afterSeq == null) return true;
      return event.seq > afterSeq;
    });
  }

  subscribe(listener: Subscriber): () => void {
    this.subscribers.add(listener);
    this.ensureHeartbeat();

    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    };
  }

  close(): void {
    this.subscribers.clear();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer || this.subscribers.size === 0) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.subscribers.size === 0) return;
      const heartbeat: DashboardLiveEvent = {
        type: "heartbeat",
        cursor: String(this.getLatestSeq()),
        timestamp: new Date().toISOString(),
      };

      for (const subscriber of this.subscribers) {
        subscriber(heartbeat);
      }
    }, this.heartbeatMs);
  }
}

export function createDashboardEventEnvelope(
  input: Omit<DashboardEventEnvelope, "seq" | "timestamp">,
): DashboardEventEnvelope {
  return {
    ...input,
    seq: 0,
    timestamp: new Date(input.timestampMs).toISOString(),
  };
}

export function encodeSseEvent(event: DashboardLiveEvent): string {
  const payload = JSON.stringify(event);
  return `data: ${payload}\n\n`;
}
