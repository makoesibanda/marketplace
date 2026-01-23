/*
  CREATE DATABASE
  ---------------
  Creates the database for the marketplace project.
*/
CREATE DATABASE IF NOT EXISTS marketplace;
USE marketplace;


/*
  USERS TABLE
  -----------
  Stores all users of the platform.
  This table represents identity only.
*/
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- User full name
  full_name VARCHAR(100) NOT NULL,

  -- Login email
  email VARCHAR(255) NOT NULL UNIQUE,

  -- Hashed password
  password VARCHAR(255) NOT NULL,

  -- Account creation timestamp
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


/*
  ROLES TABLE
  -----------
  Defines the possible roles in the system.
*/
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Role name (buyer, seller, admin)
  name VARCHAR(50) NOT NULL UNIQUE
);


/*
  USER_ROLES TABLE
  ----------------
  Links users to the roles they have.
  A user can have multiple roles.
*/
CREATE TABLE user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id, role_id),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);


/*
  CATEGORIES TABLE
  ----------------
  Stores all available listing categories.
*/
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Category name (e.g. Electronics, Property, Services)
  name VARCHAR(100) NOT NULL UNIQUE
);


/*
  LISTINGS TABLE
  --------------
  Core marketplace listings.
*/
CREATE TABLE listings (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Title shown on the marketplace
  title VARCHAR(255) NOT NULL,

  -- Full description of the item or service
  description TEXT NOT NULL,

  -- Price of the listing
  price DECIMAL(10,2) NOT NULL,

  -- Optional image path
  image VARCHAR(255),

  -- Status controls visibility
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',

  -- Seller who created the listing
  seller_id INT NOT NULL,

  -- Category
  category_id INT NOT NULL,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
             ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);


/*
  MESSAGES TABLE
  --------------
  Messages sent from buyers to sellers.
*/
CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,

  listing_id INT NOT NULL,
  buyer_id INT NOT NULL,
  seller_id INT NOT NULL,

  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (buyer_id) REFERENCES users(id),
  FOREIGN KEY (seller_id) REFERENCES users(id)
);


/*
  SETTINGS TABLE
  --------------
  Stores editable platform settings.
  Expected to contain a single row.
*/
CREATE TABLE settings (
  id INT PRIMARY KEY,

  site_name VARCHAR(100) NOT NULL,
  site_description TEXT NOT NULL
);
