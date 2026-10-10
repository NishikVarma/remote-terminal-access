import { z } from 'zod';

export type SessionState = 'running' | 'disconnected' | 'exited';

const size = z.number().int().min(1).max(500);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(64 * 1024) }),
  z.object({ type: z.literal('resize'), cols: size, rows: size }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ServerMessage = { type: 'output'; data: string } | { type: 'exit'; exitCode: number };
