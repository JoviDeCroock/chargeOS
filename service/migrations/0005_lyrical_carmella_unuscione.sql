ALTER TABLE `local_outbox` ADD `channel` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `next_attempt_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `local_outbox` ADD `last_failure` text;