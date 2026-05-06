ALTER TABLE "on_market_candidates" ADD COLUMN "description_title" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "per_area_price_median_bydel" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_fmv" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_fmv_source" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_alpha" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_investeret" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_off_market_pris" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_afkast_worst" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_afkast_base" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_afkast_best" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_profit_best" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "v3_calculated_at" timestamp with time zone;