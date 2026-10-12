-- Invoice prefixes become at most 4 characters in the next migration, so an
-- invoice number such as GRB/2627/000041 fits the 16 characters GST allows
-- (backend spec, step 14). A seller with a longer prefix would make that
-- migration fail with only "violated by some row", so this stops first and
-- names them. It changes no data: an administrator gives each one a shorter
-- prefix (PATCH /api/admin/sellers/{id}, allowed until its first invoice),
-- and `pnpm db:migrate` then runs again.
DO $$
DECLARE
  too_long text;
BEGIN
  SELECT string_agg(format('%s (seller %s)', invoice_prefix, id), ', ' ORDER BY invoice_prefix)
    INTO too_long
    FROM sellers
   WHERE length(invoice_prefix) > 4;
  IF too_long IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice prefixes may now have at most 4 characters. Give these sellers a shorter prefix first, for example with PATCH /api/admin/sellers/{id}, then run pnpm db:migrate again: %', too_long;
  END IF;
END $$;
