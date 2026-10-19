-- Only administrators decide a review (backend spec, step 7). The catalogue
-- services check this already; the trigger makes sure a missed check in the
-- web app can never let a seller approve or reject their own listing, or set
-- the GST rate and publication time that approval sets. The worker, the
-- database owner, and the web app with full access (admin or system) pass.
CREATE FUNCTION app.guard_product_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF current_user <> 'ecokart_web' OR app.has_full_access() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('approved', 'rejected')
       OR NEW.gst_rate_bps IS NOT NULL
       OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only an administrator can approve or reject a product or set its GST rate'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected'))
     OR NEW.gst_rate_bps IS DISTINCT FROM OLD.gst_rate_bps
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'Only an administrator can approve or reject a product or set its GST rate'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER products_guard_decision
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION app.guard_product_decision();
