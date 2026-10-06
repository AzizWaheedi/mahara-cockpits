import { AsyncLocalStorage } from 'node:async_hooks';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;
export type SourceStamp = { name: string; freshestAt?: number; ok: boolean; note?: string };
export type DailyPoint = { date: string; metric: string; scope: string; value: number };
export type SectionResult = { payload: unknown; sources: SourceStamp[]; daily?: DailyPoint[] };
export type Adapter = { key: string; label: string; compute(context: { repository: Repository }): Promise<SectionResult> };
export type Filter = { field: string; op: 'eq' | 'gte' | 'gt' | 'lte' | 'lt'; value: Json | undefined };
export interface Repository {
  read(table: string, filters: Filter[], limit: number, descending?: boolean): Promise<Row[]>;
  delivery(): Promise<unknown>; clients(): Promise<unknown>; team(): Promise<unknown>; billing(): Promise<unknown>;
  jobs(): Promise<Row[]>; sources(): Promise<Row[]>; staleJobs(): Promise<Row[]>; askAiHealth(): Promise<Row>;
}
export interface ProviderTools {
  graph(resource: string, params?: Record<string, string | number>): Promise<Row>;
  request(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  clickup(resource: string): Promise<Row>;
  typeform(url: string): Promise<Row>;
  hiring(resource: string): Promise<Row>;
  youtubeToken(): Promise<string>;
  rest(resource: string, body?: unknown): Promise<unknown>;
}
export type Runtime = {
  env(name: string): string | undefined;
  read(project: string, query: string): Promise<Row[]>;
  repository: Repository;
  tools: ProviderTools;
};
const state = new AsyncLocalStorage<Runtime>();
export function runtime(): Runtime {
  const value = state.getStore();
  if (!value) throw new Error('Install the native CEO repository and providers before computing a section');
  return value;
}
export function withRuntime<T>(value: Runtime, run: () => Promise<T>): Promise<T> { return state.run(value, run); }
export function object(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} returned no object`);
  return value as Row;
}
export function rows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${label} returned no row collection`);
  return value.map(row => object(row, label));
}
export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[provider]').replace(/(?:Bearer|access_token[=:])\s*\S+/gi, '[credential]').slice(0, 250);
}
