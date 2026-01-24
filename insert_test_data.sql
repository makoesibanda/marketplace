USE marketplace;

-- Admin user
INSERT INTO users (full_name, email, password, is_admin)
VALUES (
  'Admin User',
  'admin@marketplace.com',
  '$2b$10$REPLACE_WITH_BCRYPT_HASH',
  1
);

-- Default site settings
INSERT INTO settings (id, site_name, site_description)
VALUES (
  1,
  'Marketplace',
  'Buy and sell items locally'
)
ON DUPLICATE KEY UPDATE
site_name = VALUES(site_name),
site_description = VALUES(site_description);
