-- Order numbers such as EK-261018-000123 (backend spec step 12): the date in
-- Asia/Kolkata and the next value of this sequence. A rolled-back checkout
-- leaves a gap, which is harmless for order numbers (invoice numbers, which
-- must not have gaps, come from each seller's own sequence instead).
CREATE SEQUENCE order_number_seq;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE order_number_seq TO ecokart_web, ecokart_worker;
