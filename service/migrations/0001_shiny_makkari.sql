CREATE TABLE `reimbursement_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`driver_alias` text NOT NULL,
	`station_alias` text NOT NULL,
	`vehicle_alias` text NOT NULL,
	`card_alias` text NOT NULL,
	`cost_center` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_until` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_version_id`) REFERENCES `reimbursement_policy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reimbursement_assignment_organization` ON `reimbursement_assignment` (`organization_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `reimbursement_assignment_end` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`effective_until` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `reimbursement_assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reimbursement_claim` (
	`organization_id` text NOT NULL,
	`station_alias` text NOT NULL,
	`session_id` text NOT NULL,
	`statement_id` text NOT NULL,
	PRIMARY KEY(`organization_id`, `station_alias`, `session_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`statement_id`) REFERENCES `reimbursement_statement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reimbursement_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_until` integer NOT NULL,
	`rate_eur_per_kwh` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_policy_version` ON `reimbursement_policy` (`organization_id`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `reimbursement_statement` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`draft_key` text NOT NULL,
	`period_from` integer NOT NULL,
	`period_until` integer NOT NULL,
	`assignment_until` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`snapshot_json` text NOT NULL,
	`snapshot_sha256` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`energy_wh` integer NOT NULL,
	`included_records` integer NOT NULL,
	`held_records` integer NOT NULL,
	`invalid_records` integer NOT NULL,
	`revision_of` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`rejection_reason` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `reimbursement_assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_statement_draft` ON `reimbursement_statement` (`organization_id`,`draft_key`);--> statement-breakpoint
CREATE INDEX `reimbursement_statement_employee` ON `reimbursement_statement` (`organization_id`,`employee_id`);