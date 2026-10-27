ALTER TABLE "members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;