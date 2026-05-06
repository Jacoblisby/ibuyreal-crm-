CREATE TABLE "on_market_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'boligsiden' NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"case_url" text,
	"address" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text,
	"bydel" text,
	"kvm" integer,
	"rooms" integer,
	"year_built" integer,
	"list_price" double precision,
	"monthly_expense" double precision,
	"per_area_price" double precision,
	"latest_valuation" double precision,
	"broker_kind" text,
	"realtor_name" text,
	"days_on_market" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sold_at" timestamp with time zone,
	"estimated_alpha" double precision,
	"status" text DEFAULT 'active' NOT NULL,
	"review_status" text DEFAULT 'ny' NOT NULL,
	"converted_property_id" uuid,
	"primary_image" text
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"run_kind" text DEFAULT 'manual' NOT NULL,
	"postnr_codes" jsonb NOT NULL,
	"min_rooms" integer,
	"max_rooms" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"scraped" integer DEFAULT 0 NOT NULL,
	"new_listings" integer DEFAULT 0 NOT NULL,
	"updated_listings" integer DEFAULT 0 NOT NULL,
	"marked_sold" integer DEFAULT 0 NOT NULL,
	"error_msg" text
);
--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD CONSTRAINT "on_market_candidates_converted_property_id_properties_id_fk" FOREIGN KEY ("converted_property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "on_market_source_idx" ON "on_market_candidates" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "on_market_status_idx" ON "on_market_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "on_market_postal_idx" ON "on_market_candidates" USING btree ("postal_code");--> statement-breakpoint
CREATE INDEX "on_market_review_idx" ON "on_market_candidates" USING btree ("review_status");