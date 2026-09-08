/** Frontend-local types. Everything the backend emits lives in src/api/types.ts. */
export interface FeedEvent {
  /** Always present — assigned by App.addFeed. A row key is never an index. */
  id: string;
  t: string;
  s: string;
  k: string;
  c: string;
  u: number;
  p: string;
  isAutoAdvice?: boolean;
}

export type ViewMode = "split" | "analytics" | "chat";

export interface AlertState {
  on: boolean;
  kind: string;
  sym: string;
  key: string;
  txt: string;
}

