ALTER TABLE "on_market_candidates" ADD COLUMN "historical_sales" jsonb;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "last_sale_date" text;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "last_sale_amount" double precision;--> statement-breakpoint
ALTER TABLE "on_market_candidates" ADD COLUMN "public_valuation" double precision;