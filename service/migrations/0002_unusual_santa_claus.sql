CREATE TABLE `reimbursement_adjustment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`root_statement_id` text NOT NULL,
	`previous_statement_id` text NOT NULL,
	`replacement_statement_id` text NOT NULL,
	`receipt_json` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`difference_cents` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`root_statement_id`) REFERENCES `reimbursement_statement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_statement_id`) REFERENCES `reimbursement_statement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replacement_statement_id`) REFERENCES `reimbursement_statement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_adjustment_predecessor` ON `reimbursement_adjustment` (`previous_statement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reimbursement_adjustment_replacement` ON `reimbursement_adjustment` (`replacement_statement_id`);--> statement-breakpoint
CREATE INDEX `reimbursement_adjustment_organization` ON `reimbursement_adjustment` (`organization_id`,`employee_id`);