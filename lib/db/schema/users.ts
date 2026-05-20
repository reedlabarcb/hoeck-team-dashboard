/**
 * users — application accounts.
 * Mike Hoeck, Jack Chapman, Nadya Gorelov, Reed LaBar (admin) seeded in scripts/seed-users.ts.
 *
 * Pattern:
 *   - Soft delete only (`deleted_at`) — never hard DELETE.
 *   - Optimistic locking via `version` column auto-incremented by Postgres trigger.
 *   - Idempotent seeding (ON CONFLICT (email) DO NOTHING) — never UPDATE/DELETE existing rows.
 *     Lineage: inbound-tracker commit 0fdcb2f.
 */

import { pgTable, uuid, text, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['admin', 'broker']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('broker'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdBy: text('created_by').notNull().default(sql`'system'`),
  updatedBy: text('updated_by').notNull().default(sql`'system'`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
