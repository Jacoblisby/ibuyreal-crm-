ALTER TABLE "antagelser" ALTER COLUMN "lt_indreby" SET DEFAULT 220;--> statement-breakpoint
ALTER TABLE "antagelser" ALTER COLUMN "lt_osterbro" SET DEFAULT 200;--> statement-breakpoint
ALTER TABLE "antagelser" ALTER COLUMN "lt_noerrebro" SET DEFAULT 180;--> statement-breakpoint
ALTER TABLE "antagelser" ALTER COLUMN "lt_vesterbro" SET DEFAULT 195;--> statement-breakpoint
ALTER TABLE "antagelser" ALTER COLUMN "lt_frederiksberg" SET DEFAULT 210;--> statement-breakpoint
ALTER TABLE "antagelser" ALTER COLUMN "lt_amager" SET DEFAULT 170;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "address_id" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "avm_unit_uuid" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "avm_price_per_sqm" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "avm_calculated_at" timestamp with time zone;