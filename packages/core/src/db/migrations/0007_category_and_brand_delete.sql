-- Administrators may delete a category or brand that nothing uses, to remove
-- a mistake (backend spec, step 5). The catalogue service checks that it is
-- unused, and the foreign keys from products refuse it otherwise.
GRANT DELETE ON categories, brands TO ecokart_web;
