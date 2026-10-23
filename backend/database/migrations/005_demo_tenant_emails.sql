-- Every login now sends a one-time code by e-mail. The pre-SaaS demo company used placeholder
-- addresses on a third-party domain; move them to the platform's own domain so no code is ever
-- e-mailed outside it. The demo admin receives codes in the platform mailbox; the other demo
-- users get sub-addresses on the same domain. No effect on fresh installations.
UPDATE users
   SET email = CASE
                 WHEN LOWER(email) = 'admin@daraldhiafa.sa' THEN 'darhaccp@darhaccp.com'
                 ELSE 'darhaccp+' || replace(split_part(LOWER(email), '@', 1), '.', '-') || '@darhaccp.com'
               END
 WHERE tenant_id = 2 AND LOWER(email) LIKE '%@daraldhiafa.sa'
   AND EXISTS (SELECT 1 FROM tenants WHERE id = 2 AND code = 'DarAl0000020102026');

UPDATE tenants SET email = 'darhaccp@darhaccp.com'
 WHERE id = 2 AND code = 'DarAl0000020102026' AND LOWER(email) = 'admin@daraldhiafa.sa';
