-- ===============================
-- DATABASE
-- ===============================
CREATE DATABASE IF NOT EXISTS marketplace;
USE marketplace;

-- ===============================
-- USERS TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_admin TINYINT(1) DEFAULT 0,
  reset_token VARCHAR(255) DEFAULT NULL,
  reset_token_expires DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===============================
-- ITEMS TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS items (
  id INT NOT NULL AUTO_INCREMENT,
  seller_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  status ENUM('pending','approved','rejected','sold') NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  rejection_reason TEXT,
  buyer_id INT DEFAULT NULL,
  sold_at DATETIME DEFAULT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  location VARCHAR(120) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY seller_id (seller_id),
  CONSTRAINT items_ibfk_1
    FOREIGN KEY (seller_id)
    REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===============================
-- ITEM IMAGES TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS item_images (
  id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  KEY item_id (item_id),
  CONSTRAINT item_images_ibfk_1
    FOREIGN KEY (item_id)
    REFERENCES items (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===============================
-- SETTINGS TABLE
-- ===============================
CREATE TABLE IF NOT EXISTS settings (
  id INT NOT NULL,
  site_name VARCHAR(100) NOT NULL,
  site_description TEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===============================
-- APPLICATION DATABASE USER
-- ===============================
CREATE USER IF NOT EXISTS 'marketplace_app'@'localhost'
IDENTIFIED BY 'CHANGE_ME_PASSWORD';

GRANT ALL PRIVILEGES ON marketplace.*
TO 'marketplace_app'@'localhost';

FLUSH PRIVILEGES;
