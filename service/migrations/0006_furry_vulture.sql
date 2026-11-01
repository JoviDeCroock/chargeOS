CREATE TABLE `support_case` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`assignee_id` text NOT NULL,
	`subject` text NOT NULL,
	`topic` text NOT NULL,
	`statement_id` text,
	`statement_sha256` text,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statement_id`) REFERENCES `reimbursement_statement`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "support_statement_reference" CHECK(("support_case"."statement_id" IS NULL AND "support_case"."statement_sha256" IS NULL) OR ("support_case"."statement_id" IS NOT NULL AND "support_case"."statement_sha256" IS NOT NULL AND length("support_case"."statement_sha256")=64)),
	CONSTRAINT "support_revision" CHECK("support_case"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `support_case_organization` ON `support_case` (`organization_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `support_case_reporter` ON `support_case` (`organization_id`,`reporter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `support_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`case_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`payload_json` text NOT NULL,
	`request_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `support_case`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_event_revision` ON `support_event` (`case_id`,`revision`);--> statement-breakpoint
CREATE INDEX `support_event_organization` ON `support_event` (`organization_id`,`case_id`);