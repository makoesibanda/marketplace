// Load environment variables
require("dotenv").config();

const fs = require("fs"); // for file deletion from the local storage 

const crypto = require("crypto");     // Generates random verification tokens
const nodemailer = require("nodemailer"); // Sends emails



const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const session = require("express-session");

const uploadDir = path.join(__dirname, "public/uploads/items");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


const multer = require("multer"); // for umage upload


const app = express();



/*
  =========================
  EXPRESS CONFIGURATION
  =========================
*/
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const basePath = process.env.BASE_PATH || "";
// helper to generate correct paths on server
function url(p) {
  return basePath + p;
}

app.use(basePath, express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

/*
=========================
EMAIL CONFIGURATION
=========================
Used to send verification emails
*/

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/*
  =========================
  SESSION CONFIGURATION
  =========================
*/

app.use(
  session({
    secret: "marketplace_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 // 1 hour
    }
  })
);


app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}); /// carte flash msges


// Make logged-in user available in all views
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

/*
  =========================
  DATABASE CONNECTION
  =========================
*/
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

global.db = db;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads/items");
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage
});

app.use((req, res, next) => {
  res.locals.BASE_PATH = process.env.BASE_PATH || "";
  next();
});

// carteforyy
app.use(async (req, res, next) => {
  try {
    const [cats] = await db.execute("SELECT * FROM categories ORDER BY name");
    res.locals.categories = cats;
  } catch {
    res.locals.categories = [];
  }
  next();
});

/*
  =========================
  AUTH MIDDLEWARE
  =========================
*/

 function requireUser(req, res, next) {
  if (!req.session.user) {
    return res.redirect(url("/login"));
  }

  // allow BOTH normal users and admins
  next();
}


// Admin only
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.redirect(url("/admin/login"));
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect(url("/login"));
  }
  next();
}

// password strong
function isStrongPassword(password) {
  const minLength = 6;
  const hasNumber = /\d/;
  const hasSpecial = /[@$!%*?&]/;

  return (
    password.length >= minLength &&
    hasNumber.test(password) &&
    hasSpecial.test(password)
  );
}



/*
  =========================
  PUBLIC ROUTES
  
  =========================
*/
app.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT site_name, site_description FROM settings WHERE id = 1 LIMIT 1"
    );

    const settings = rows.length
      ? rows[0]
      : { site_name: "Marketplace", site_description: "" };

    res.render("index", {
      siteName: settings.site_name,
      siteDescription: settings.site_description
    });
  } catch (err) {
    console.error(err);
    res.render("index", {
      siteName: "Marketplace",
      siteDescription: ""
    });
  }
});

app.get("/explore", (req, res) => {
  if (req.session.user && req.session.user.is_admin === 1) {
    return res.redirect(url("/admin"));
  }

  res.redirect(url("/buyer"));
});



app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register", { formData: {} });
});



/*
  =========================
  USER DASHBOARDS
  =========================
*/
app.get("/buyer", async (req, res) => {
  try {
    const q = req.query.q || "";
    const category = req.query.category || "";

    let sql = `
      SELECT
        i.id,
        i.title,
        i.price,
        i.description,
        i.status,
        COALESCE(
          (
            SELECT image_path
            FROM item_images
            WHERE item_id = i.id
              AND image_path IS NOT NULL
              AND image_path != ''
            LIMIT 1
          ),
          '/images/seller_cover.png'
        ) AS cover_image
      FROM items i
      WHERE i.status IN ('approved', 'sold')
    `;

    const params = [];

    // keyword search
    if (q) {
      sql += " AND (i.title LIKE ? OR i.description LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    // category filter
    if (category) {
      sql += " AND i.category_id = ?";
      params.push(category);
    }

    sql += " ORDER BY i.created_at DESC";

    const [items] = await db.execute(sql, params);

    res.render("buyer", {
      items,
      query: { q, category }
    });

  } catch (err) {
    console.error("Buyer dashboard error:", err);
    res.render("buyer", {
      items: [],
      query: {}
    });
  }
});


app.post("/items/:id/buy", requireUser, async (req, res) => {
  try {
    const itemId = req.params.id;
    const buyerId = req.session.user.id;

    // Only approved items can be bought
    const [items] = await db.execute(
      `
      SELECT id
      FROM items
      WHERE id = ? AND status = 'approved'
      LIMIT 1
      `,
      [itemId]
    );

    if (items.length === 0) {
      return res.redirect(url("/buyer"));
    }

    // Mark as sold
    await db.execute(
      `
      UPDATE items
      SET status = 'sold',
          buyer_id = ?,
          sold_at = NOW()
      WHERE id = ?
      `,
      [buyerId, itemId]
    );

    res.redirect(url("/buyer"));

  } catch (err) {
    console.error("Buy item error:", err);
    res.redirect(url("/buyer"));
  }
});


app.get("/go-sell", requireUser, (req, res) => {
  res.redirect(url("/seller"));
});

app.get("/seller", requireUser, async (req, res) => {
  try {
    const sellerId = req.session.user.id;

    const q = req.query.q || "";
    const status = req.query.status || "";


    // Fetch seller items
    let sql = `
   SELECT 
    i.id,
    i.title,
    i.description,
    i.price,
    i.status,
    i.rejection_reason,
    i.created_at,
    COALESCE(
  (
    SELECT image_path
    FROM item_images
    WHERE item_id = i.id
      AND image_path IS NOT NULL
      AND image_path != ''
    LIMIT 1
  ),
  '/images/seller_cover.png'
) AS cover_image

  FROM items i
  WHERE i.seller_id = ?

`;

const params = [sellerId];

// keyword search
if (q) {
  sql += " AND (i.title LIKE ? OR i.description LIKE ?)";
  params.push(`%${q}%`, `%${q}%`);
}

// status filter
if (status) {
  sql += " AND i.status = ?";
  params.push(status);
}

sql += " ORDER BY i.created_at DESC";

const [items] = await db.execute(sql, params);


    // Summary counts
    const [counts] = await db.execute(
      `
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'approved') AS approved,
        SUM(status = 'rejected') AS rejected
      FROM items
      WHERE seller_id = ?
      `,
      [sellerId]
    );

   res.render("seller", {
  items,
  counts: counts[0],
  query: { q, status }
});


  } catch (error) {
    console.error("Seller dashboard error:", error);
    res.render("seller", {
      items: [],
      counts: { total: 0, pending: 0, approved: 0, rejected: 0 }
    });
  }
});

//FORGOT PASSWORD ROUTES 

app.get("/forgot-password", (req,res)=>{
  res.render("forgot-password", {
    error: null,
    success: null
  });
});


app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const [[user]] = await db.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    // SECURITY: do NOT reveal if email exists
    if (!user) {
      return res.render("forgot-password", {
  success: "If this email exists, a reset link has been sent.", 
        error: null
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.execute(
      "UPDATE users SET reset_token=?, reset_expires=? WHERE id=?",
      [token, expires, user.id]
    );

    const link = `${process.env.BASE_URL}/reset-password/${token}`;

    await transporter.sendMail({
      to: email,
      subject: "Password Reset",
      html: `
        <h3>Password Reset</h3>
        <p>Click below:</p>
        <a href="${link}">Reset Password</a>
      `
    });

    res.render("forgot-password", {
      success: "If this email exists, a reset link has been sent.",
      error: null
    });

  } catch (err) {
    console.error(err);
    res.render("forgot-password", {
      error: "Something went wrong.",
      success: null
    });
  }
});


////

///reset routes 

app.get("/reset-password/:token", async (req, res) => {
  const token = req.params.token;

  const [[user]] = await db.execute(
    "SELECT id FROM users WHERE reset_token=? AND reset_expires > NOW()",
    [token]
  );

  if (!user) {
    return res.send("Invalid or expired link.");
  }

  res.render("reset-password", {
    token,
    error: null,
    success: null
  });
});


app.post("/reset-password/:token", async (req, res) => {

  const { password, confirm } = req.body;
  const token = req.params.token;

  try {

    // Passwords must match
if (password !== confirm) {
  return res.render("register", {
    error: "Passwords do not match.",
    formData: { full_name, email }
  });
}

// Password strength
if (!isStrongPassword(password)) {
  return res.render("register", {
    error: "Password must be at least 6 characters and include 1 number and 1 special character.",
    formData: { full_name, email }
  });
}


    // 2. Hash password
    const hashed = await bcrypt.hash(password, 10);

    // 3. Update user
    const [result] = await db.execute(
      `
      UPDATE users
      SET password=?, reset_token=NULL, reset_expires=NULL
      WHERE reset_token=? AND reset_expires > NOW()
      `,
      [hashed, token]
    );

    if (!result.affectedRows) {
      return res.render("reset-password", {
        error: "Link expired or invalid.",
        success: null,
        token
      });
    }

    // 4. Success
    res.render("reset-password", {
      success: "Password updated successfully. You can now login.",
      error: null,
      token
    });

  } catch (err) {
    console.error(err);
    res.render("reset-password", {
      error: "Something went wrong.",
      success: null,
      token
    });
  }
});


// Create new item
app.post(
  "/seller/items/create",
  requireUser,
  upload.array("images"),
  async (req, res) => {
    try {
     const {
  title,
  description,
  price,
  phone,
  location,
  category_id
} = req.body;


      const sellerId = req.session.user.id;

      // Basic validation
      if (!title || !description || !price || !category_id) {
  return res.send("Missing required fields");
}

      // Insert item including contact details
      const [result] = await db.execute(
        `
        INSERT INTO items
(seller_id, title, description, price, phone, location, category_id)

        VALUES
          (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          sellerId,
title,
description,
price,
phone || null,
location || null,
category_id

        ]
      );

      const itemId = result.insertId;

      // Save uploaded images (if any)
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const imagePath = "/uploads/items/" + file.filename;

          await db.execute(
            `
            INSERT INTO item_images (item_id, image_path)
            VALUES (?, ?)
            `,
            [itemId, imagePath]
          );
        }
      }

      res.redirect(url("/seller"));

    } catch (err) {
      console.error("Item creation error:", err);
      res.send("Failed to create item");
    }
  }
);

app.get("/items/:id", async (req, res) => {
  try {
    const itemId = req.params.id;

    // Fetch item
    const [[item]] = await db.execute(
      `
      SELECT
        i.*,
        u.email AS seller_email,
        c.name AS category_name
      FROM items i
      JOIN users u ON i.seller_id = u.id
      LEFT JOIN categories c ON i.category_id = c.id
      WHERE i.id = ?
      LIMIT 1
      `,
      [itemId]
    );

    if (!item) {
      return res.redirect(url("/buyer"));
    }

    // Fetch images
    let [images] = await db.execute(
      "SELECT image_path FROM item_images WHERE item_id = ?",
      [itemId]
    );

    // Fallback image
    if (images.length === 0) {
      images = [{ image_path: "/images/seller_cover.png" }];
    }

    // Default back button (guest / buyer)
    let backUrl = "/buyer";

    // Logged in logic
    if (req.session.user) {

      // Admin
      if (req.session.user.is_admin === 1) {
        backUrl = "/admin/items";

      // Seller viewing own item
      } else if (item.seller_id === req.session.user.id) {
        backUrl = "/seller";
      }
    }

    res.render("item-view", {
      item,
      images,
      backUrl
    });

  } catch (err) {
    console.error("Item view error:", err);
    res.redirect(url("/buyer"));
  }
});

/*
  =========================
  SELLER – EDIT ITEM (GET)
  =========================
*/app.get("/seller/items/:id/edit", requireUser, async (req, res) => {
  try {
    const itemId = req.params.id;
    const sellerId = req.session.user.id;

    const [items] = await db.execute(
      `
      SELECT *
      FROM items
      WHERE id = ? AND seller_id = ?
      LIMIT 1
      `,
      [itemId, sellerId]
    );

    const [categories] = await db.execute(
      "SELECT id, name FROM categories ORDER BY name"
    );

    if (items.length === 0) {
      return res.redirect(url("/seller"));
    }

    const item = items[0];

    const [images] = await db.execute(
      `
      SELECT id, image_path
      FROM item_images
      WHERE item_id = ?
      `,
      [itemId]
    );

   res.render("edit-item", {
  item,
  images,
  categories,
  backUrl: "/seller",
  isAdminEdit: false
});


  } catch (err) {
    console.error("Edit item GET error:", err);
    res.redirect(url("/seller"));
  }
});


app.post(
  "/seller/items/:id/edit",
  requireUser,
  upload.array("images"),
  async (req, res) => {
    const itemId = req.params.id;
    const sellerId = req.session.user.id;
const { title, price, description, category_id, remove_images } = req.body;

    try {
      // 1. Ensure item belongs to seller AND is pending
      const [items] = await db.execute(
`
SELECT *
FROM items
WHERE id = ? AND seller_id = ? AND status = 'pending'
LIMIT 1

`,
[itemId, sellerId]
);
if (items.length === 0) {
  req.session.flash = {
    error: "Only pending items can be edited."
  };
  return res.redirect(url("/seller"));
}


      // 2. Update item details
      await db.execute(
`
UPDATE items
SET title=?, price=?, description=?, category_id=?
WHERE id=?
`,
[title, price, description, category_id, itemId]
);


      if (req.session.user.is_admin === 1) {
  await db.execute(
    "UPDATE items SET status='approved', rejection_reason=NULL WHERE id=?",
    [itemId]
  );
}


      // 3. Remove selected images (if any)
      if (remove_images) {
        const imagesToRemove = Array.isArray(remove_images)
          ? remove_images
          : [remove_images];

        await db.execute(
          `
          DELETE FROM item_images
          WHERE id IN (${imagesToRemove.map(() => "?").join(",")})
          AND item_id = ?
          `,
          [...imagesToRemove, itemId]
        );
      }

      // 4. Add newly uploaded images (if any)
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const imagePath = "/uploads/items/" + file.filename;

          await db.execute(
            `
            INSERT INTO item_images (item_id, image_path)
            VALUES (?, ?)
            `,
            [itemId, imagePath]
          );
        }
      }

      // 5. Redirect back to seller dashboard
      res.redirect(url("/seller"));

    } catch (error) {
      console.error("Edit item error:", error);
      res.redirect(url("/seller"));
    }
  }
);

app.post("/seller/items/:id/delete", requireUser, async (req, res) => {
  try {
    const itemId = req.params.id;
    const sellerId = req.session.user.id;

    // 1. Ensure item belongs to seller AND is pending
    const [items] = await db.execute(
      "SELECT id FROM items WHERE id = ? AND seller_id = ? AND status = 'pending'",
      [itemId, sellerId]
    );

    if (items.length === 0) {
      return res.redirect(url("/seller"));
    }

    // 2. Get image paths from DB (ONLY real uploaded images exist here)
    const [images] = await db.execute(
      "SELECT image_path FROM item_images WHERE item_id = ?",
      [itemId]
    );

    // 3. Delete uploaded image files from disk (never touch /images/seller_cover.png)
    for (const img of images) {
      const imagePath = img.image_path || "";

      // extra safety: skip default + skip empty
      if (!imagePath || imagePath === "/images/seller_cover.png") continue;

      const filePath = path.join(__dirname, "public", imagePath);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // 4. Delete images from DB
    await db.execute("DELETE FROM item_images WHERE item_id = ?", [itemId]);

    // 5. Delete item
    await db.execute("DELETE FROM items WHERE id = ?", [itemId]);

    res.redirect(url("/seller"));
  } catch (err) {
    console.error("Delete item error:", err);
    res.redirect(url("/seller"));
  }
});

/*
  =========================
  SELLER – MARK ITEM AS SOLD
  =========================
*/
app.post("/seller/items/:id/sold", requireUser, async (req, res) => {
  try {
    const itemId = req.params.id;
    const sellerId = req.session.user.id;

    // Ensure item belongs to seller AND is approved
    const [items] = await db.execute(
      `
      SELECT id
      FROM items
      WHERE id = ?
        AND seller_id = ?
        AND status = 'approved'
      LIMIT 1
      `,
      [itemId, sellerId]
    );

    if (items.length === 0) {
      return res.redirect(url("/seller"));
    }

    // Mark item as sold
    await db.execute(
      `
      UPDATE items
      SET status = 'sold',
          sold_at = NOW()
      WHERE id = ?
      `,
      [itemId]
    );

    res.redirect(url("/seller"));

  } catch (err) {
    console.error("Mark as sold error:", err);
    res.redirect(url("/seller"));
  }
});





/*
  =========================
  ADMIN ROUTES
  =========================


*/

/*
  =========================
  ADMIN – VIEW ALL ITEMS
  =========================
*/
app.get("/admin/items", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || "";

    let sql = `
      SELECT
        i.id,
        i.title,
        i.price,
        i.status,
        i.created_at,
        u.email AS seller_email,
        (
          SELECT image_path
          FROM item_images
          WHERE item_id = i.id
          LIMIT 1
        ) AS cover_image
      FROM items i
      JOIN users u ON i.seller_id = u.id
      WHERE 1 = 1
    `;

    const params = [];

    // status filter
    if (status) {
      sql += " AND i.status = ?";
      params.push(status);
    }

    sql += " ORDER BY i.created_at DESC";

    const [items] = await db.execute(sql, params);

    res.render("admin-items", {
      items,
      query: { status }
    });

  } catch (err) {
    console.error("Admin items error:", err);
    res.render("admin-items", {
      items: [],
      query: {}
    });
  }
});

//admin
app.get("/admin/categories", requireAdmin, async (req, res) => {
  try {
    const [categories] = await db.execute(
      "SELECT * FROM categories ORDER BY name ASC"
    );

    res.render("admin-categories", { categories });

  } catch (err) {
    console.error(err);
    res.redirect(url("/admin"));
  }
});

app.post("/admin/categories/create", requireAdmin, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    req.session.flash = { error: "Category name required." };
    return res.redirect(url("/admin/categories"));
  }

  try {
    await db.execute(
      "INSERT INTO categories (name) VALUES (?)",
      [name]
    );

    req.session.flash = { success: "Category created successfully." };
    res.redirect(url("/admin/categories"));

  } catch (err) {
    console.error(err);
    req.session.flash = { error: "Category already exists." };
    res.redirect(url("/admin/categories"));
  }
});


app.post("/admin/categories/:id/delete", requireAdmin, async (req, res) => {
  const id = req.params.id;

  try {
    const [[count]] = await db.execute(
      "SELECT COUNT(*) AS total FROM items WHERE category_id = ?",
      [id]
    );

    if (count.total > 0) {
      req.session.flash = {
        error: "Cannot delete category with active items."
      };
      return res.redirect(url("/admin/categories"));
    }

    await db.execute("DELETE FROM categories WHERE id = ?", [id]);

    req.session.flash = { success: "Category deleted successfully." };
    res.redirect(url("/admin/categories"));

  } catch (err) {
    console.error(err);
    req.session.flash = { error: "Delete failed." };
    res.redirect(url("/admin/categories"));
  }
});




app.get("/admin/items/:id/edit", requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id;

    const [[item]] = await db.execute(
      `
      SELECT i.*, u.email AS seller_email
      FROM items i
      JOIN users u ON i.seller_id = u.id
WHERE i.id = ? AND i.status = 'pending'
      LIMIT 1
      `,
      [itemId]
    );

    const [categories] = await db.execute(
  "SELECT id, name FROM categories ORDER BY name"
);


if (!item) {
  req.session.flash = {
    error: "Only pending items can be edited."
  };
  return res.redirect(url("/admin/items"));
}

    const [images] = await db.execute(
      "SELECT id, image_path FROM item_images WHERE item_id = ?",
      [itemId]
    );

    // Reuse the same edit page, but tell it admin mode
   res.render("edit-item", {
  item,
  images,
  categories,
  backUrl: "/admin/items",
  isAdminEdit: true
});


  } catch (err) {
    console.error("Admin edit item GET error:", err);
    res.redirect(url("/admin/items"));
  }
});


app.post(
  "/admin/items/:id/edit",
  requireAdmin,
  upload.array("images"),
  async (req, res) => {
    const itemId = req.params.id;
const { title, price, description, category_id, remove_images } = req.body;

    try {
      // Make sure item exists
      const [[item]] = await db.execute(
        "SELECT id FROM items WHERE id = ? AND status = 'pending' LIMIT 1",
        [itemId]
      );

if (!item) {
  req.session.flash = {
    error: "Only pending items can be edited."
  };
  return res.redirect(url("/admin/items"));
}

      // Update item
     await db.execute(
`
UPDATE items
SET title=?, price=?, description=?, category_id=?
WHERE id=?
`,
[title, price, description, category_id, itemId]
);


      // Remove selected images
      if (remove_images) {
        const imagesToRemove = Array.isArray(remove_images)
          ? remove_images
          : [remove_images];

        await db.execute(
          `
          DELETE FROM item_images
          WHERE id IN (${imagesToRemove.map(() => "?").join(",")})
            AND item_id = ?
          `,
          [...imagesToRemove, itemId]
        );
      }

      // Add new images
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const imagePath = "/uploads/items/" + file.filename;

          await db.execute(
            `
            INSERT INTO item_images (item_id, image_path)
            VALUES (?, ?)
            `,
            [itemId, imagePath]
          );
        }
      }

      // Back to admin items list
      res.redirect(url("/admin/items"));

    } catch (err) {
      console.error("Admin edit item POST error:", err);
      res.redirect(url("/admin/items"));
    }
  }
);


/*
=========================
EMAIL VERIFICATION
=========================
*/

app.get("/verify/:token", async (req, res) => {

  const token = req.params.token;

  const [rows] = await db.execute(
    "SELECT id FROM users WHERE verification_token = ? LIMIT 1",
    [token]
  );

  if (!rows.length) {
    return res.send("Invalid or expired verification link.");
  }

  await db.execute(
    `
    UPDATE users
    SET email_verified = 1,
        verification_token = NULL
    WHERE id = ?
    `,
    [rows[0].id]
  );

res.send(`
  <html>
    <head>
      <title>Email Verified</title>
      <style>
        body {
          font-family: Arial;
          background:#f5f5f5;
          display:flex;
          align-items:center;
          justify-content:center;
          height:100vh;
        }

        .box {
          background:white;
          padding:40px;
          border-radius:8px;
          box-shadow:0 0 15px rgba(0,0,0,.1);
          text-align:center;
        }

        a {
          display:inline-block;
          margin-top:20px;
          padding:10px 20px;
          background:black;
          color:white;
          text-decoration:none;
          border-radius:5px;
        }
      </style>
    </head>

    <body>
      <div class="box">
        <h2>Email Verified Successfully ✅</h2>
        <p>Your account is now active.</p>

        <a href="/login">Go to Login</a>
      </div>
    </body>
  </html>
`);
});


app.get("/admin/login", (req, res) => {
  res.render("admin-login");
});

app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email = ? AND is_admin = 1 LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.render("admin-login", {
        error: "Invalid admin credentials"
      });
    }

    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      return res.render("admin-login", {
        error: "Invalid admin credentials"
      });
    }



    /*
  =====================================
  ADMIN SETTINGS – VIEW SETTINGS PAGE
  =====================================
  This route allows an admin to view and edit
  marketplace-wide settings such as:
  - Marketplace name
  - Marketplace description

  These values are stored in the `settings` table
  and are used across the public-facing site.
*/

    // =========================
// ADMIN – APPROVE ITEM
// =========================
app.post("/admin/items/:id/approve", requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id;

    // Update item status to approved
    await db.execute(
      "UPDATE items SET status = 'approved' WHERE id = ?",
      [itemId]
    );

    // Redirect back to admin items page
    res.redirect(url("/admin/items"));

  } catch (err) {
    console.error("Approve item error:", err);
    res.redirect(url("/admin/items"));
  }
});

// =========================
// ADMIN – REJECT ITEM
// =========================
app.post("/admin/items/:id/reject", requireAdmin, async (req, res) => {
  try {
    const itemId = req.params.id;
    const { reason } = req.body;

    // NEVER allow undefined to reach MySQL
    const safeReason =
      reason && reason.trim() !== "" ? reason : null;

    await db.execute(
  `
  UPDATE items
  SET status = 'rejected',
      rejection_reason = ?
  WHERE id = ?
  `,
  [req.body.reason || null, req.params.id]
);


    res.redirect(url("/admin/items"));

  } catch (err) {
    console.error("Reject item error:", err);
    res.redirect(url("/admin/items"));
  }
});

    // Admin session
    req.session.user = {
      id: admin.id,
      email: admin.email,
      is_admin: 1
    };

    res.redirect(url("/admin"));
  } catch (err) {
    console.error(err);
    res.render("admin-login", {
      error: "Something went wrong. Please try again."
    });
  }
});




app.get("/admin/settings", requireAdmin, async (req, res) => {
  try {
    // Fetch current marketplace settings (single row system)
    const [[settings]] = await db.execute(
      `
      SELECT site_name, site_description
      FROM settings
      WHERE id = 1
      LIMIT 1
      `
    );

    // Render settings page with current values
    res.render("admin-settings", {
      settings
    });

  } catch (err) {
    // If anything goes wrong, log it and return admin safely
    console.error("Failed to load admin settings:", err);
    res.redirect(url("/admin"));
  }
});


/*
  =====================================
  ADMIN SETTINGS – UPDATE SETTINGS
  =====================================
  This route handles saving updates made by the admin
  to the marketplace configuration.

  Once saved:
  - Homepage title updates
  - Marketplace description updates
  - Branding changes are reflected immediately
*/
app.post("/admin/settings", requireAdmin, async (req, res) => {
  try {
    const { site_name, site_description } = req.body;

    // Update marketplace configuration
    await db.execute(
      `
      UPDATE settings
      SET site_name = ?, site_description = ?
      WHERE id = 1
      `,
      [site_name, site_description]
    );

    // Re-fetch updated values to confirm save
    const [[settings]] = await db.execute(
      `
      SELECT site_name, site_description
      FROM settings
      WHERE id = 1
      LIMIT 1
      `
    );

    // Render page again with success feedback
    res.render("admin-settings", {
      settings,
      success: "Marketplace settings updated successfully."
    });

  } catch (err) {
    // Log error and keep admin in control
    console.error("Failed to update admin settings:", err);
    res.redirect(url("/admin/settings"));
  }
});



app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const [stats] = await db.execute(`
      SELECT
  COUNT(*) AS total,
  SUM(status = 'pending') AS pending,
  SUM(status = 'approved') AS approved,
  SUM(status = 'sold') AS sold,
  SUM(status = 'rejected') AS rejected
FROM items;

    `);

    res.render("admin", {
      stats: stats[0]
    });

  } catch (err) {
    console.error("Admin dashboard stats error:", err);

    // Fallback so page never breaks
    res.render("admin", {
      stats: {
        pending: 0,
        approved: 0,
        rejected: 0
      }
    });
  }
});


/*
  =========================
  USER REGISTRATION
  =========================
*/
app.post("/register", async (req, res) => {
  const { full_name, email, password, confirm } = req.body;

  try {

    // Validation
    if (!full_name || !email || !password || !confirm) {
      return res.render("register", {
        error: "All fields are required.",
        formData: { full_name, email }
      });
    }

    if (password !== confirm) {
      if (!isStrongPassword(password)) {
  return res.render("register", {
    error: "Password must be at least 6 characters and include 1 number and 1 special character.",
    formData: { full_name, email }
  });
}

      return res.render("register", {
        error: "Passwords do not match.",
        formData: { full_name, email }
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate email verification token
    const token = crypto.randomBytes(32).toString("hex");

   // Check if email already exists
const [existing] = await db.execute(
  "SELECT id, email_verified FROM users WHERE email = ? LIMIT 1",
  [email]
);

if (existing.length > 0) {

  // If already verified -> block registration
  if (existing[0].email_verified) {
    return res.render("register", {
      error: "Email already registered. Please login.",
      formData: { full_name, email }
    });
  }

  // If NOT verified -> resend verification
  const newToken = crypto.randomBytes(32).toString("hex");

  await db.execute(
    `
    UPDATE users
    SET verification_token = ?
    WHERE email = ?
    `,
    [newToken, email]
  );

  const verifyLink = `${process.env.BASE_URL}/verify/${newToken}`;

  await transporter.sendMail({
    from: '"Marketplace" <no-reply@marketplace>',
    to: email,
    subject: "Verify your Marketplace account",
    html: `
      <h3>Welcome back!</h3>
      <p>Please verify your email:</p>
      <a href="${verifyLink}">Verify Account</a>
    `
  });

  return res.render("register", {
    success: "Verification email resent. Check your inbox.",
    formData: {}
  });
}

// New user
await db.execute(
  `
  INSERT INTO users (full_name, email, password, verification_token)
  VALUES (?, ?, ?, ?)
  `,
  [full_name, email, hashedPassword, token]
);

    // Create verification link
    const verifyLink = `${process.env.BASE_URL}/verify/${token}`;

    // Send email
    await transporter.sendMail({
      from: '"Marketplace" <no-reply@marketplace>',
      to: email,
      subject: "Verify your Marketplace account",
      html: `
        <h3>Welcome!</h3>
        <p>Please verify your email:</p>
        <a href="${verifyLink}">Verify Account</a>
      `
    });

    res.render("register", {
      success: "Check your email to verify your account.",
      formData: {}
    });

  } catch (err) {
    console.error(err);
    res.render("register", {
      error: "Registration failed.",
      formData: { full_name, email }
    });
  }
});


/*
  =========================
  USER LOGIN
  =========================
*/
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.render("login", {
        error: "Invalid email or password."
      });
    }

    const user = rows[0];

    if (!user.email_verified) {
  return res.render("login", {
    error: "Please verify your email first."
  });
}

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render("login", {
        error: "Invalid email or password."
      });
    }

  
    // Normal user session
    req.session.user = {
      id: user.id,
      email: user.email,
      is_admin: 0
    };

const redirectTo = req.session.returnTo || "/buyer";
delete req.session.returnTo;

res.redirect(url(redirectTo));
  } catch (err) {
    console.error(err);
    res.render("login", {
      error: "Something went wrong. Please try again."
    });
  }
});



// CART addtion 

app.post("/cart/add/:id", async (req, res) => {
  try {
    const itemId = req.params.id;

    // Fetch item (ONLY approved items)
    const [[item]] = await db.execute(
      `
      SELECT
        i.id,
        i.title,
        i.price,
        i.seller_id,
        COALESCE(
          (
            SELECT image_path
            FROM item_images
            WHERE item_id = i.id
            LIMIT 1
          ),
          '/images/seller_cover.png'
        ) AS cover_image
      FROM items i
      WHERE i.id = ? AND i.status = 'approved'
      LIMIT 1
      `,
      [itemId]
    );

    if (!item) {
      return res.redirect(url("/buyer"));
    }

    // Prevent seller adding own item
    if (req.session.user && req.session.user.id === item.seller_id) {
      req.session.flash = { error: "You cannot buy your own item." };
      return res.redirect(url("/buyer"));
    }

    // Initialize cart
    if (!req.session.cart) {
      req.session.cart = {};
    }

    // If already in cart, increase qty
   if (req.session.cart[itemId]) {
  req.session.cart[itemId].qty += 1;
  req.session.cart[itemId].price = Number(item.price);
}
else {
      req.session.cart[itemId] = {
  id: item.id,
  title: item.title,
  price: Number(item.price),
  image: item.cover_image,
  qty: 1
};

    }

    req.session.flash = { success: "Item added to cart." };

    res.redirect("back");

  } catch (err) {
    console.error("Add to cart error:", err);
    res.redirect(url("/buyer"));
  }
});



// UPDATE CART QTY
app.post("/cart/update/:id", (req, res) => {

  const id = req.params.id;
  const { action } = req.body;

  if (!req.session.cart || !req.session.cart[id]) {
    return res.redirect("/cart");
  }

  if (action === "increase") {
    req.session.cart[id].qty++;
  }

  if (action === "decrease") {
    req.session.cart[id].qty--;

    if (req.session.cart[id].qty <= 0) {
      delete req.session.cart[id];
    }
  }

  res.redirect("back");
});

// REMOVE ITEM FROM CART
app.post("/cart/remove/:id", (req, res) => {

  if (req.session.cart) {
    delete req.session.cart[req.params.id];
  }

  res.redirect("back");
});



// VIEW CART
app.get("/cart", (req, res) => {

  const cart = req.session.cart || {};

  // Convert object to array
  const items = Object.values(cart);

  // Calculate total
  let total = 0;
  items.forEach(i => {
    total += i.price * i.qty;
  });

  res.render("cart", {
    items,
    total
  });
});




app.get("/checkout", requireAuth, (req,res)=>{

const cart = req.session.cart || {};
const items = Object.values(cart);

if(items.length === 0){
  return res.redirect("/buyer");
}

let total = 0;
items.forEach(i=>{
  total += i.price * i.qty;
});

res.render("checkout",{
  items,
  total
});

});


app.post("/checkout/pay", requireAuth, async (req,res)=>{

try{

const { full_name, phone, address, city, postcode } = req.body;
const cart = req.session.cart;

if(!cart || Object.keys(cart).length===0){
  return res.redirect("/buyer");
}

const items = Object.values(cart);

let total = 0;
items.forEach(i=>{
  total += i.price * i.qty;
});

// Create order
const [result] = await db.execute(`
INSERT INTO orders
(user_id,full_name,phone,address,city,postcode,total)
VALUES(?,?,?,?,?,?,?)
`,
[
req.session.user.id,
full_name,
phone,
address,
city,
postcode,
total
]);

const orderId = result.insertId;

// Save order items
for(const i of items){
await db.execute(`
INSERT INTO order_items(order_id,item_id,price,qty)
VALUES(?,?,?,?)
`,
[orderId,i.id,i.price,i.qty]);
}

// Email confirmation
let itemList = items.map(i=>`${i.title} x${i.qty}`).join("<br>");

await transporter.sendMail({
to:req.session.user.email,
subject:"Order Confirmation",
html:`
<h3>Order Confirmed</h3>

<p>${itemList}</p>

<p>Total: £${total.toFixed(2)}</p>

<p>Delivery to:</p>
${full_name}<br>
${address}<br>
${city}<br>
${postcode}

<p>Expected delivery: ${new Date(Date.now()+172800000).toDateString()}</p>
`
});

// Clear cart
delete req.session.cart;

res.render("order-success");


}catch(err){
console.error("Checkout error:",err);
res.send("Checkout failed");
}

});


/*
  =========================
  LOGOUT (ADMIN + USERS)
  =========================
*/
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect(url("/"));
  });
});

/*
  =========================
  START SERVER
  =========================
*/
const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log("Server running on http://localhost:" + PORT);
});
