-- The subscriber's e-mail is their primary identity on the platform: it can never be used twice —
-- not by another company, not by a user of another company, not by a new application after a
-- rejection (a rejected application is reopened instead). Login codes are sent to that e-mail.

-- The demo company shared the platform mailbox with the platform administrator: give it its own.
UPDATE users SET email = 'darhaccp+demo-admin@darhaccp.com'
 WHERE tenant_id = 2 AND LOWER(email) = 'darhaccp@darhaccp.com';
UPDATE tenants SET email = 'darhaccp+demo@darhaccp.com'
 WHERE id = 2 AND LOWER(email) = 'darhaccp@darhaccp.com';

-- Companies: code and e-mail unique for ever (all statuses).
DROP INDEX ux_tenants_code;
DROP INDEX ux_tenants_email;
CREATE UNIQUE INDEX ux_tenants_code ON tenants (LOWER(code));
CREATE UNIQUE INDEX ux_tenants_email ON tenants (LOWER(email));

-- Users: one e-mail = one account across the whole platform (IoT service accounts excluded).
DROP INDEX ux_users_tenant_email;
CREATE UNIQUE INDEX ux_users_email_global ON users (LOWER(email)) WHERE employee_no <> 'SYS-IOT';
