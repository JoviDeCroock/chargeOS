PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_service_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_id` text,
	`recovery_release_id` text,
	`action` text NOT NULL,
	`subject_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_audit_actor" CHECK(("__new_service_audit"."actor_id" IS NOT NULL AND "__new_service_audit"."recovery_release_id" IS NULL) OR ("__new_service_audit"."actor_id" IS NULL AND "__new_service_audit"."recovery_release_id" IS NOT NULL AND length("__new_service_audit"."recovery_release_id") > 0))
);
--> statement-breakpoint
INSERT INTO `__new_service_audit`("id", "organization_id", "actor_id", "recovery_release_id", "action", "subject_id", "created_at") SELECT "id", "organization_id", "actor_id", "recovery_release_id", "action", "subject_id", "created_at" FROM `service_audit`;--> statement-breakpoint
DROP TABLE `service_audit`;--> statement-breakpoint
ALTER TABLE `__new_service_audit` RENAME TO `service_audit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_reimbursement_assignment_end` (
	`assignment_id` text PRIMARY KEY NOT NULL,
	`effective_until` integer NOT NULL,
	`created_by` text,
	`recovery_release_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `reimbursement_assignment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assignment_end_actor" CHECK(("__new_reimbursement_assignment_end"."created_by" IS NOT NULL AND "__new_reimbursement_assignment_end"."recovery_release_id" IS NULL) OR ("__new_reimbursement_assignment_end"."created_by" IS NULL AND "__new_reimbursement_assignment_end"."recovery_release_id" IS NOT NULL AND length("__new_reimbursement_assignment_end"."recovery_release_id") > 0))
);
--> statement-breakpoint
INSERT INTO `__new_reimbursement_assignment_end`("assignment_id", "effective_until", "created_by", "recovery_release_id", "created_at") SELECT "assignment_id", "effective_until", "created_by", "recovery_release_id", "created_at" FROM `reimbursement_assignment_end`;--> statement-breakpoint
DROP TABLE `reimbursement_assignment_end`;--> statement-breakpoint
ALTER TABLE `__new_reimbursement_assignment_end` RENAME TO `reimbursement_assignment_end`;