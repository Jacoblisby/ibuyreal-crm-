CREATE TABLE "external_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handels_id" text NOT NULL,
	"address" text NOT NULL,
	"sale_date" text NOT NULL,
	"amount" double precision NOT NULL,
	"kvm" integer,
	"per_area_price" double precision,
	"postal_code" text NOT NULL,
	"municipality_code" integer,
	"handelstype" text,
	"handelsmetode" text,
	"anvendelse" text,
	"broker" text,
	"import_batch" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_sales_handels_id_unique" UNIQUE("handels_id")
);
--> statement-breakpoint
CREATE INDEX "external_sales_postal_idx" ON "external_sales" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "external_sales_date_idx" ON "external_sales" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "external_sales_address_idx" ON "external_sales" USING btree ("address");