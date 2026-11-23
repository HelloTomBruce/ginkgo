import type { Checkpoint } from "./types";

/**
 * 状态检查点持久化接口（对标 LangGraph Checkpointer）
 */
export interface Checkpointer<TState = Record<string, unknown>> {
  save(checkpoint: Checkpoint<TState>): Promise<void>;
  load(checkpointId: string): Promise<Checkpoint<TState> | undefined>;
  loadLatest(sessionId: string): Promise<Checkpoint<TState> | undefined>;
  list(sessionId: string): Promise<Checkpoint<TState>[]>;
}

/**
 * 内存检查点存储实现（开发与单测默认）
 */
export class InMemoryCheckpointer<TState = Record<string, unknown>>
  implements Checkpointer<TState>
{
  private readonly checkpoints = new Map<string, Checkpoint<TState>>();

  async save(checkpoint: Checkpoint<TState>): Promise<void> {
    this.checkpoints.set(checkpoint.id, {
      ...checkpoint,
      state: JSON.parse(JSON.stringify(checkpoint.state)),
    });
  }

  async load(checkpointId: string): Promise<Checkpoint<TState> | undefined> {
    const cp = this.checkpoints.get(checkpointId);
    return cp ? JSON.parse(JSON.stringify(cp)) : undefined;
  }

  async loadLatest(sessionId: string): Promise<Checkpoint<TState> | undefined> {
    const list = await this.list(sessionId);
    return list[list.length - 1];
  }

  async list(sessionId: string): Promise<Checkpoint<TState>[]> {
    const matched: Checkpoint<TState>[] = [];
    for (const cp of this.checkpoints.values()) {
      if (cp.sessionId === sessionId) {
        matched.push(JSON.parse(JSON.stringify(cp)));
      }
    }
    return matched.sort((a, b) => a.createdAt - b.createdAt);
  }
}
