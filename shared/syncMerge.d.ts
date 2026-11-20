import type { HistoryRecord, Preset, SyncPayload } from '../src/types';

export const SYNC_SCHEMA_VERSION: number;

export function mergeItemLists<T extends { id: string; updatedAt: number; deletedAt?: number }>(
  localItems?: T[],
  remoteItems?: T[]
): T[];

export function mergeSyncPayloads(
  localPayload: Partial<SyncPayload> | null | undefined,
  remotePayload: Partial<SyncPayload> | null | undefined
): SyncPayload;

export function normalizePayload(raw: unknown): SyncPayload;

export type SyncPreset = Preset;
export type SyncRecord = HistoryRecord;
