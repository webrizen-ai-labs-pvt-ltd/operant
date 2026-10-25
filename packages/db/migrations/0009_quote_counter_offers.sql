CREATE TABLE "quote_counter_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"portal_user_id" uuid,
	"amount" bigint NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"response" text,
	"revised_quote_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_counter_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_counter_offers" ADD CONSTRAINT "quote_counter_offers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_counter_offers" ADD CONSTRAINT "quote_counter_offers_quote_id_invoices_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_counter_offers" ADD CONSTRAINT "quote_counter_offers_portal_user_id_portal_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_counter_offers" ADD CONSTRAINT "quote_counter_offers_revised_quote_id_invoices_id_fk" FOREIGN KEY ("revised_quote_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_counter_offers_quote_idx" ON "quote_counter_offers" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_counter_offers_pending_key" ON "quote_counter_offers" USING btree ("quote_id") WHERE "quote_counter_offers"."status" = 'pending';