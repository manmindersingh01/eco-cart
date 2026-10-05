CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"user_id" uuid,
	"seller_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_inr" bigint,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_requests_feature_check" CHECK (feature in ('listing_draft', 'import_mapping', 'import_fill', 'nl_search', 'image_search', 'similar', 'assistant', 'screening', 'embedding')),
	CONSTRAINT "ai_requests_status_check" CHECK (status in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "ai_requests_counts_check" CHECK (input_tokens >= 0 and output_tokens >= 0 and cost_micro_inr >= 0 and latency_ms >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"session_id" text,
	"kind" text NOT NULL,
	"query_text" text,
	"parsed" jsonb,
	"result_count" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_queries_kind_check" CHECK (kind in ('keyword', 'natural', 'image')),
	CONSTRAINT "search_queries_counts_check" CHECK (result_count >= 0 and latency_ms >= 0)
);
--> statement-breakpoint
ALTER TABLE "search_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"phone_number" text,
	"phone_number_verified" boolean,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cart_id_variant_id_key" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_items_quantity_check" CHECK (quantity between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_token" text,
	"coupon_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "carts_guest_token_unique" UNIQUE("guest_token"),
	CONSTRAINT "carts_owner_check" CHECK (user_id is not null or guest_token is not null)
);
--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"min_order_paise" bigint DEFAULT 0 NOT NULL,
	"max_discount_paise" bigint,
	"usage_limit" integer,
	"per_user_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_code_check" CHECK (code = upper(code) and code <> ''),
	CONSTRAINT "coupons_discount_type_check" CHECK (discount_type in ('percent', 'fixed')),
	CONSTRAINT "coupons_discount_value_check" CHECK (discount_value > 0 and (discount_type <> 'percent' or discount_value <= 10000)),
	CONSTRAINT "coupons_min_order_paise_check" CHECK (min_order_paise >= 0),
	CONSTRAINT "coupons_max_discount_paise_check" CHECK (max_discount_paise > 0),
	CONSTRAINT "coupons_usage_limit_check" CHECK (usage_limit > 0),
	CONSTRAINT "coupons_per_user_limit_check" CHECK (per_user_limit > 0),
	CONSTRAINT "coupons_used_count_check" CHECK (used_count >= 0 and (usage_limit is null or used_count <= usage_limit)),
	CONSTRAINT "coupons_dates_check" CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"default_hsn_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_depth_check" CHECK (depth >= 0),
	CONSTRAINT "categories_gst_rate_bps_check" CHECK (gst_rate_bps between 0 and 10000),
	CONSTRAINT "categories_default_hsn_code_check" CHECK (default_hsn_code ~ '^[0-9]{4,8}$')
);
--> statement-breakpoint
CREATE TABLE "product_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"image_id" uuid,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_embeddings_product_id_kind_image_id_key" UNIQUE NULLS NOT DISTINCT("product_id","kind","image_id"),
	CONSTRAINT "product_embeddings_kind_check" CHECK (kind in ('text', 'image')),
	CONSTRAINT "product_embeddings_image_id_check" CHECK ((kind = 'image') = (image_id is not null))
);
--> statement-breakpoint
ALTER TABLE "product_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"storage_key" text NOT NULL,
	"content_hash" text,
	"width" integer,
	"height" integer,
	"alt" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "product_images_dimensions_check" CHECK (width > 0 and height > 0)
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_moderation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_risk" text,
	"ai_request_id" uuid,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_moderation_ai_risk_check" CHECK (ai_risk in ('low', 'medium', 'high')),
	CONSTRAINT "product_moderation_decision_check" CHECK (decision in ('approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "product_moderation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_paise" bigint NOT NULL,
	"mrp_paise" bigint NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_product_id_sku_key" UNIQUE("product_id","sku"),
	CONSTRAINT "product_variants_price_paise_check" CHECK (price_paise > 0),
	CONSTRAINT "product_variants_mrp_paise_check" CHECK (mrp_paise >= price_paise),
	CONSTRAINT "product_variants_stock_check" CHECK (stock >= 0)
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"option_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"hsn_code" text,
	"gst_rate_bps" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"published_at" timestamp with time zone,
	"min_price_paise" bigint,
	"max_price_paise" bigint,
	"min_mrp_paise" bigint,
	"total_stock" integer DEFAULT 0 NOT NULL,
	"in_stock" boolean GENERATED ALWAYS AS (total_stock > 0) STORED,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"primary_image_id" uuid,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
	"ai_draft_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_status_check" CHECK (status in ('draft', 'pending_review', 'approved', 'rejected', 'archived')),
	CONSTRAINT "products_hsn_code_check" CHECK (hsn_code ~ '^[0-9]{4,8}$'),
	CONSTRAINT "products_gst_rate_bps_check" CHECK (gst_rate_bps between 0 and 10000),
	CONSTRAINT "products_total_stock_check" CHECK (total_stock >= 0),
	CONSTRAINT "products_price_range_check" CHECK (min_price_paise > 0 and max_price_paise >= min_price_paise and min_mrp_paise >= min_price_paise),
	CONSTRAINT "products_rating_check" CHECK (rating_avg between 0 and 5 and rating_count >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"landmark" text,
	"city" text NOT NULL,
	"state_code" char(2) NOT NULL,
	"pincode" char(6) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "addresses_phone_check" CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "addresses_state_code_check" CHECK (state_code ~ '^[0-9]{2}$'),
	CONSTRAINT "addresses_pincode_check" CHECK (pincode ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalogue_import_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_import_rows_import_id_row_number_key" UNIQUE("import_id","row_number"),
	CONSTRAINT "catalogue_import_rows_status_check" CHECK (status in ('pending', 'ok', 'error')),
	CONSTRAINT "catalogue_import_rows_row_number_check" CHECK (row_number > 0)
);
--> statement-breakpoint
ALTER TABLE "catalogue_import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalogue_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_type" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"headers" text[],
	"column_mapping" jsonb,
	"ai_request_id" uuid,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ok_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"error_report_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "catalogue_imports_file_type_check" CHECK (file_type in ('csv', 'xlsx')),
	CONSTRAINT "catalogue_imports_status_check" CHECK (status in ('uploaded', 'mapping_suggested', 'mapping_confirmed', 'validating', 'importing', 'completed', 'failed')),
	CONSTRAINT "catalogue_imports_row_counts_check" CHECK (total_rows >= 0 and ok_rows >= 0 and error_rows >= 0 and ok_rows + error_rows <= total_rows)
);
--> statement-breakpoint
ALTER TABLE "catalogue_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "seller_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"return_request_id" uuid,
	"entry_type" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_ledger_entries_entry_type_check" CHECK (entry_type in ('sale', 'commission', 'refund_reversal', 'commission_reversal', 'payout', 'adjustment')),
	CONSTRAINT "seller_ledger_entries_sign_check" CHECK (case entry_type
        when 'sale' then amount_paise > 0
        when 'commission_reversal' then amount_paise > 0
        when 'commission' then amount_paise < 0
        when 'refund_reversal' then amount_paise < 0
        when 'payout' then amount_paise < 0
        else amount_paise <> 0
      end)
);
--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"buyer_snapshot" jsonb NOT NULL,
	"place_of_supply_state_code" char(2) NOT NULL,
	"is_interstate" boolean NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint DEFAULT 0 NOT NULL,
	"sgst_paise" bigint DEFAULT 0 NOT NULL,
	"igst_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"pdf_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_order_id_seller_id_key" UNIQUE("order_id","seller_id"),
	CONSTRAINT "invoices_place_of_supply_check" CHECK (place_of_supply_state_code ~ '^[0-9]{2}$'),
	CONSTRAINT "invoices_gst_split_check" CHECK ((is_interstate and cgst_paise = 0 and sgst_paise = 0) or (not is_interstate and igst_paise = 0)),
	CONSTRAINT "invoices_amounts_check" CHECK (taxable_paise >= 0 and cgst_paise >= 0 and sgst_paise >= 0 and igst_paise >= 0 and total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise)
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_actor_role_check" CHECK (actor_role in ('buyer', 'seller', 'admin', 'system'))
);
--> statement-breakpoint
ALTER TABLE "order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"shipment_id" uuid,
	"title" text NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb NOT NULL,
	"image_key" text,
	"hsn_code" text NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"unit_mrp_paise" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_paise" bigint NOT NULL,
	"discount_share_paise" bigint DEFAULT 0 NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"tax_paise" bigint NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission_paise" bigint NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_status_check" CHECK (status in ('confirmed', 'dispatched', 'delivered', 'cancelled', 'return_requested', 'returned')),
	CONSTRAINT "order_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "order_items_prices_check" CHECK (unit_price_paise > 0 and unit_mrp_paise >= unit_price_paise),
	CONSTRAINT "order_items_line_total_check" CHECK (line_total_paise = unit_price_paise * quantity),
	CONSTRAINT "order_items_discount_share_check" CHECK (discount_share_paise between 0 and line_total_paise),
	CONSTRAINT "order_items_tax_check" CHECK (taxable_paise >= 0 and tax_paise >= 0 and taxable_paise + tax_paise = line_total_paise - discount_share_paise),
	CONSTRAINT "order_items_gst_rate_bps_check" CHECK (gst_rate_bps between 0 and 10000),
	CONSTRAINT "order_items_commission_check" CHECK (commission_bps between 0 and 10000 and commission_paise >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"payment_method" text NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"delivery_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"coupon_id" uuid,
	"coupon_code" text,
	"shipping_address" jsonb NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_phone" text NOT NULL,
	"buyer_email" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_status_check" CHECK (status in ('pending_payment', 'confirmed', 'cancelled', 'completed')),
	CONSTRAINT "orders_payment_method_check" CHECK (payment_method in ('razorpay', 'cod')),
	CONSTRAINT "orders_amounts_check" CHECK (subtotal_paise >= 0 and discount_paise >= 0 and delivery_paise >= 0 and tax_paise >= 0 and discount_paise <= subtotal_paise),
	CONSTRAINT "orders_total_check" CHECK (total_paise = subtotal_paise - discount_paise + delivery_paise)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"admin_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"refund_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_requests_status_check" CHECK (status in ('requested', 'approved', 'rejected', 'refunded')),
	CONSTRAINT "return_requests_quantity_check" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "return_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"courier_name" text NOT NULL,
	"tracking_number" text NOT NULL,
	"tracking_url" text,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_status_check" CHECK (status in ('dispatched', 'delivered'))
);
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "payment_events_provider_event_id_key" UNIQUE("provider","event_id"),
	CONSTRAINT "payment_events_provider_check" CHECK (provider in ('razorpay'))
);
--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"method" text,
	"failure_reason" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_provider_check" CHECK (provider in ('razorpay', 'cod')),
	CONSTRAINT "payments_status_check" CHECK (status in ('created', 'captured', 'failed', 'refunded', 'partially_refunded')),
	CONSTRAINT "payments_amount_paise_check" CHECK (amount_paise > 0),
	CONSTRAINT "payments_currency_check" CHECK (currency = 'INR')
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"return_request_id" uuid,
	"amount_paise" bigint NOT NULL,
	"provider_refund_id" text,
	"method" text NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_amount_paise_check" CHECK (amount_paise > 0),
	CONSTRAINT "refunds_method_check" CHECK (method in ('gateway', 'bank_transfer'))
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_role_check" CHECK (actor_role in ('buyer', 'seller', 'admin', 'system'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"updated_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pages_slug_unique" UNIQUE("slug"),
	CONSTRAINT "content_pages_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "content_pages_status_check" CHECK (status in ('draft', 'published'))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"to_email" text NOT NULL,
	"template" text NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_template_check" CHECK (template in ('otp', 'order_placed', 'payment_received', 'dispatched', 'cancelled', 'refund_recorded')),
	CONSTRAINT "email_outbox_status_check" CHECK (status in ('queued', 'sent', 'failed')),
	CONSTRAINT "email_outbox_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_count_check" CHECK (count >= 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_item_id" uuid,
	"rating" smallint NOT NULL,
	"title" text,
	"body" text,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_product_id_user_id_key" UNIQUE("product_id","user_id"),
	CONSTRAINT "reviews_rating_check" CHECK (rating between 1 and 5),
	CONSTRAINT "reviews_status_check" CHECK (status in ('published', 'hidden'))
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"gstin" text,
	"pan" text,
	"line1" text NOT NULL,
	"city" text NOT NULL,
	"state_code" char(2) NOT NULL,
	"pincode" char(6) NOT NULL,
	"support_email" text NOT NULL,
	"support_phone" text NOT NULL,
	"commission_bps" integer,
	"invoice_prefix" text NOT NULL,
	"invoice_seq" integer DEFAULT 0 NOT NULL,
	"invoice_seq_fy" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_owner_user_id_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "sellers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "sellers_invoice_prefix_unique" UNIQUE("invoice_prefix"),
	CONSTRAINT "sellers_status_check" CHECK (status in ('pending', 'approved', 'suspended')),
	CONSTRAINT "sellers_gstin_check" CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "sellers_pan_check" CHECK (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
	CONSTRAINT "sellers_state_code_check" CHECK (state_code ~ '^[0-9]{2}$'),
	CONSTRAINT "sellers_pincode_check" CHECK (pincode ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "sellers_support_phone_check" CHECK (support_phone ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "sellers_commission_bps_check" CHECK (commission_bps between 0 and 10000),
	CONSTRAINT "sellers_invoice_prefix_check" CHECK (invoice_prefix ~ '^[A-Z0-9]{1,6}$'),
	CONSTRAINT "sellers_invoice_seq_check" CHECK (invoice_seq >= 0),
	CONSTRAINT "sellers_invoice_seq_fy_check" CHECK (invoice_seq_fy ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "sellers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_image_id_product_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."product_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation" ADD CONSTRAINT "product_moderation_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation" ADD CONSTRAINT "product_moderation_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_moderation" ADD CONSTRAINT "product_moderation_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_primary_image_id_product_images_id_fk" FOREIGN KEY ("primary_image_id") REFERENCES "public"."product_images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_ai_draft_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_draft_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_import_rows" ADD CONSTRAINT "catalogue_import_rows_import_id_catalogue_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."catalogue_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_import_rows" ADD CONSTRAINT "catalogue_import_rows_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_imports" ADD CONSTRAINT "catalogue_imports_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_imports" ADD CONSTRAINT "catalogue_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_imports" ADD CONSTRAINT "catalogue_imports_ai_request_id_ai_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_ledger_entries" ADD CONSTRAINT "seller_ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pages" ADD CONSTRAINT "content_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_feature_input_hash_idx" ON "ai_requests" USING btree ("feature","input_hash");--> statement-breakpoint
CREATE INDEX "ai_requests_seller_id_created_at_idx" ON "ai_requests" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_queries_zero_results_created_at_idx" ON "search_queries" USING btree ("created_at") WHERE result_count = 0;--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "categories_parent_id_sort_order_idx" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_embeddings_text_hnsw_idx" ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops) WHERE kind = 'text';--> statement-breakpoint
CREATE INDEX "product_embeddings_image_hnsw_idx" ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops) WHERE kind = 'image';--> statement-breakpoint
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_moderation_product_id_created_at_idx" ON "product_moderation" USING btree ("product_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_moderation_open_created_at_idx" ON "product_moderation" USING btree ("created_at") WHERE decision is null;--> statement-breakpoint
CREATE INDEX "products_seller_id_status_idx" ON "products" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "products_category_id_status_idx" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_status_created_at_idx" ON "products" USING btree ("status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_status_min_price_paise_idx" ON "products" USING btree ("status","min_price_paise","id");--> statement-breakpoint
CREATE INDEX "products_search_vector_idx" ON "products" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "products_search_text_trgm_idx" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "addresses_user_id_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default_per_user_idx" ON "addresses" USING btree ("user_id") WHERE is_default and deleted_at is null;--> statement-breakpoint
CREATE INDEX "catalogue_import_rows_import_id_status_idx" ON "catalogue_import_rows" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "catalogue_imports_seller_id_created_at_idx" ON "catalogue_imports" USING btree ("seller_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seller_ledger_entries_seller_id_created_at_idx" ON "seller_ledger_entries" USING btree ("seller_id","created_at","id");--> statement-breakpoint
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_seller_id_status_created_at_idx" ON "order_items" USING btree ("seller_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_user_id_created_at_idx" ON "orders" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_created_at_idx" ON "orders" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "return_requests_status_created_at_idx" ON "return_requests" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "return_requests_user_id_idx" ON "return_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "return_requests_seller_id_idx" ON "return_requests" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "shipments_order_id_seller_id_idx" ON "shipments" USING btree ("order_id","seller_id");--> statement-breakpoint
CREATE INDEX "payments_order_id_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_order_id_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_status_created_at_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rate_limits_window_start_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews" USING btree ("product_id","status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "web_all" ON "ai_requests" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (app.has_full_access() or (user_id is null and seller_id is null) or user_id = app.user_id() or seller_id = app.seller_id()) WITH CHECK (app.has_full_access() or (user_id is null and seller_id is null) or user_id = app.user_id() or seller_id = app.seller_id());--> statement-breakpoint
CREATE POLICY "worker_all" ON "ai_requests" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "search_queries" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "search_queries" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (user_id is null or user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "search_queries" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_all" ON "cart_items" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (exists (select 1 from carts c where c.id = cart_items.cart_id)) WITH CHECK (exists (select 1 from carts c where c.id = cart_items.cart_id));--> statement-breakpoint
CREATE POLICY "worker_all" ON "cart_items" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_all" ON "carts" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (user_id = app.user_id() or (user_id is null and guest_token = app.guest_token()) or app.has_full_access()) WITH CHECK (user_id = app.user_id() or (user_id is null and guest_token = app.guest_token()) or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "carts" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "product_embeddings" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_embeddings.product_id));--> statement-breakpoint
CREATE POLICY "worker_all" ON "product_embeddings" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "product_images" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_images.product_id));--> statement-breakpoint
CREATE POLICY "web_insert" ON "product_images" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (exists (select 1 from products p where p.id = product_images.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_update" ON "product_images" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_images.product_id and (p.seller_id = app.seller_id() or app.has_full_access()))) WITH CHECK (exists (select 1 from products p where p.id = product_images.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_delete" ON "product_images" AS PERMISSIVE FOR DELETE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_images.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "worker_all" ON "product_images" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "product_moderation" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access() or exists (select 1 from products p where p.id = product_moderation.product_id and p.seller_id = app.seller_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "product_moderation" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (exists (select 1 from products p where p.id = product_moderation.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_update" ON "product_moderation" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "product_moderation" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "product_variants" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_variants.product_id));--> statement-breakpoint
CREATE POLICY "web_insert" ON "product_variants" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (exists (select 1 from products p where p.id = product_variants.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_update" ON "product_variants" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_variants.product_id and (p.seller_id = app.seller_id() or app.has_full_access()))) WITH CHECK (exists (select 1 from products p where p.id = product_variants.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "web_delete" ON "product_variants" AS PERMISSIVE FOR DELETE TO "ecokart_web" USING (exists (select 1 from products p where p.id = product_variants.product_id and (p.seller_id = app.seller_id() or app.has_full_access())));--> statement-breakpoint
CREATE POLICY "worker_all" ON "product_variants" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "products" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING ((status = 'approved' and deleted_at is null) or seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "products" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "products" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access()) WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "products" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_all" ON "addresses" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access()) WITH CHECK (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "addresses" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "catalogue_import_rows" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (exists (select 1 from catalogue_imports i where i.id = catalogue_import_rows.import_id));--> statement-breakpoint
CREATE POLICY "worker_all" ON "catalogue_import_rows" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_all" ON "catalogue_imports" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access()) WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "catalogue_imports" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "seller_ledger_entries" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "seller_ledger_entries" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "seller_ledger_entries" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "invoices" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access() or exists (select 1 from orders o where o.id = invoices.order_id and o.user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "invoices" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "invoices" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "invoices" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "order_events" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access() or (exists (select 1 from orders o where o.id = order_events.order_id) and (order_events.order_item_id is null or exists (select 1 from order_items oi where oi.id = order_events.order_item_id))));--> statement-breakpoint
CREATE POLICY "web_insert" ON "order_events" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access() or exists (select 1 from orders o where o.id = order_events.order_id));--> statement-breakpoint
CREATE POLICY "worker_all" ON "order_events" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "order_items" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access() or exists (select 1 from orders o where o.id = order_items.order_id and o.user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "order_items" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "order_items" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access()) WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "order_items" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "orders" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access() or app.is_order_seller(orders.id));--> statement-breakpoint
CREATE POLICY "web_insert" ON "orders" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "orders" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "orders" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "return_requests" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (user_id = app.user_id() or seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "return_requests" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "return_requests" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "return_requests" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "shipments" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access() or exists (select 1 from orders o where o.id = shipments.order_id and o.user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "shipments" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "shipments" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (seller_id = app.seller_id() or app.has_full_access()) WITH CHECK (seller_id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "shipments" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_all" ON "payment_events" AS PERMISSIVE FOR ALL TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "payment_events" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "payments" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access() or exists (select 1 from orders o where o.id = payments.order_id and o.user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "payments" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "payments" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (app.has_full_access()) WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "payments" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "refunds" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access() or exists (select 1 from orders o where o.id = refunds.order_id and o.user_id = app.user_id()));--> statement-breakpoint
CREATE POLICY "web_insert" ON "refunds" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "refunds" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "audit_logs" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access() or actor_user_id = app.user_id());--> statement-breakpoint
CREATE POLICY "worker_all" ON "audit_logs" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "email_outbox" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "email_outbox" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "worker_all" ON "email_outbox" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "reviews" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (status = 'published' or user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "reviews" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "reviews" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access()) WITH CHECK (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_delete" ON "reviews" AS PERMISSIVE FOR DELETE TO "ecokart_web" USING (user_id = app.user_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "reviews" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "web_select" ON "sellers" AS PERMISSIVE FOR SELECT TO "ecokart_web" USING (status = 'approved' or owner_user_id = app.user_id() or id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_insert" ON "sellers" AS PERMISSIVE FOR INSERT TO "ecokart_web" WITH CHECK (app.has_full_access());--> statement-breakpoint
CREATE POLICY "web_update" ON "sellers" AS PERMISSIVE FOR UPDATE TO "ecokart_web" USING (id = app.seller_id() or app.has_full_access()) WITH CHECK (id = app.seller_id() or app.has_full_access());--> statement-breakpoint
CREATE POLICY "worker_all" ON "sellers" AS PERMISSIVE FOR ALL TO "ecokart_worker" USING (true) WITH CHECK (true);