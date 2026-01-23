/*
  INITIAL PLATFORM DATA
  ---------------------
  Seeds essential data required for the application to run.
  This includes platform settings and default roles.
*/

USE marketplace;

-- Default platform settings (single row)
INSERT INTO settings (id, site_name, site_description)
VALUES (
  1,
  'Marketplace',
  'A platform for buying and selling goods and services'
);

-- Default roles used by the system
INSERT INTO roles (name) VALUES
('buyer'),
('seller'),
('admin');
