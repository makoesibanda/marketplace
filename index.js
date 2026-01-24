// Load environment variables
require("dotenv").config();

const fs = require("fs");
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const session = require("express-session");
const multer = require("multer");

const app = express();

/*
=========================
EXPRESS CONFIGURATION
=========================
*/
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const basePath = process.env.BASE_PATH || "";

// helper for DOC-safe redirects
function url(p) {
  return basePath + p;
}

// static files (DOC compatible)
app.use(basePath, express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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
      maxAge: 1000 * 60 * 60
    }
  })
);

// expose user to all views
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

/*
=========================
FILE UPLOAD (MULTER)
=========================
*/
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

const upload = multer({ storage });

/*
=========================
AUTH MIDDLEWARE
=========================
*/
function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect(url("/login"));
  if (req.session.user.is_admin === 1) return res.redirect(url("/admin"));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.is_admin !== 1) {
    return res.redirect(url("/admin/login"));
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect(url("/login"));
  next();
}

/*
=========================
PUBLIC ROUTES
=========================
*/
app.get("/", async (req, res) => {
  try {
    const [[settings]] = await db.execute(
      "SELECT site_name, site_description FROM settings WHERE id = 1 LIMIT 1"
    );

    res.render("index", {
      siteName: settings?.site_name || "Marketplace",
      siteDescription: settings?.site_description || ""
    });
  } catch {
    res.render("index", { siteName: "Marketplace", siteDescription: "" });
  }
});

app.get("/explore", (req, res) => {
  if (!req.session.user) return res.redirect(url("/login"));
  if (req.session.user.is_admin === 1) return res.redirect(url("/admin"));
  res.redirect(url("/buyer"));
});

app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register", { formData: {} }));

/*
=========================
BUYER
=========================
*/
app.get("/buyer", requireUser, async (req, res) => {
  try {
    const q = req.query.q || "";
    let sql = `
      SELECT i.id, i.title, i.price, i.description,
      COALESCE(
        (SELECT image_path FROM item_images WHERE item_id = i.id LIMIT 1),
        '/images/seller_cover.png'
      ) AS cover_image
      FROM items i
      WHERE i.status IN ('approved','sold')
    `;
    const params = [];

    if (q) {
      sql += " AND (i.title LIKE ? OR i.description LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    sql += " ORDER BY i.created_at DESC";

    const [items] = await db.execute(sql, params);
    res.render("buyer", { items, query: { q } });
  } catch {
    res.render("buyer", { items: [], query: {} });
  }
});

/*
=========================
SELLER
=========================
*/
app.get("/seller", requireUser, async (req, res) => {
  try {
    const sellerId = req.session.user.id;
    const q = req.query.q || "";
    const status = req.query.status || "";

    let sql = `
      SELECT i.*, 
      (SELECT image_path FROM item_images WHERE item_id = i.id LIMIT 1) AS cover_image
      FROM items i WHERE seller_id = ?
    `;
    const params = [sellerId];

    if (q) {
      sql += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";

    const [items] = await db.execute(sql, params);

    const [[counts]] = await db.execute(`
      SELECT COUNT(*) total,
      SUM(status='pending') pending,
      SUM(status='approved') approved,
      SUM(status='rejected') rejected
      FROM items WHERE seller_id = ?
    `,[sellerId]);

    res.render("seller", { items, counts, query:{q,status} });
  } catch {
    res.render("seller",{items:[],counts:{total:0,pending:0,approved:0,rejected:0}});
  }
});

/*
=========================
ADMIN
=========================
*/
app.get("/admin/login", (req,res)=>res.render("admin-login"));

app.post("/admin/login", async (req,res)=>{
  const {email,password}=req.body;
  const [[admin]]=await db.execute(
    "SELECT * FROM users WHERE email=? AND is_admin=1 LIMIT 1",[email]
  );
  if(!admin || !(await bcrypt.compare(password,admin.password))){
    return res.render("admin-login",{error:"Invalid admin credentials"});
  }
  req.session.user={id:admin.id,email:admin.email,is_admin:1};
  res.redirect(url("/admin"));
});

app.get("/admin", requireAdmin, async (req,res)=>{
  const [[stats]]=await db.execute(`
    SELECT COUNT(*) total,
    SUM(status='pending') pending,
    SUM(status='approved') approved,
    SUM(status='sold') sold,
    SUM(status='rejected') rejected FROM items
  `);
  res.render("admin",{stats});
});

/*
=========================
AUTH
=========================
*/
app.post("/login", async (req,res)=>{
  const {email,password}=req.body;
  const [[user]]=await db.execute("SELECT * FROM users WHERE email=?",[email]);
  if(!user || !(await bcrypt.compare(password,user.password))){
    return res.render("login",{error:"Invalid email or password"});
  }
  req.session.user={id:user.id,email:user.email,is_admin:0};
  res.redirect(url("/buyer"));
});

app.get("/logout",(req,res)=>{
  req.session.destroy(()=>res.redirect(url("/")));
});

/*
=========================
START SERVER
=========================
*/
const PORT = process.env.PORT || 8000;
app.listen(PORT,()=>{
  console.log("Server running on port "+PORT);
});
