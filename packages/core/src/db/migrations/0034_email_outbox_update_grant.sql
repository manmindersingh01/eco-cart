-- An administrator puts a failed or stuck email back in the queue, which
-- changes only its status and attempts; the web_update policy limits it to
-- full access. Everything else on the row stays the worker's to change.
GRANT UPDATE (status, attempts) ON email_outbox TO ecokart_web;
