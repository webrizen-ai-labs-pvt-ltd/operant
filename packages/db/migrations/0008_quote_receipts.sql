ALTER TABLE "finance_settings" ADD COLUMN "receipt_prefix" text DEFAULT 'RCPT' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_link_amount" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_number" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_cgst" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_sgst" bigint;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_igst" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_key" ON "payments" USING btree ("org_id","receipt_number") WHERE "payments"."receipt_number" is not null;