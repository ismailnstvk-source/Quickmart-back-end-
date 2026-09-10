/**
 * QuickMart backend v2 — zero external dependencies.
 * Adds: saved addresses, favorites/wishlist, and an order status
 * timeline (placed -> packed -> out_for_delivery -> delivered) that
 * advances automatically based on elapsed time — no cron needed.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { randomUUID } = crypto;

const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, "db.json");
const FREE_DELIVERY_OVER = 199;
const DELIVERY_FEE = 15;

// Order status advances automatically based on age, simulating a real
// fulfillment pipeline without needing a background job.
const STATUS_STAGES = [
  { key: "placed", afterSeconds: 0, label: "Order confirmed" },
  { key: "packed", afterSeconds: 60, label: "Packed at dark store" },
  { key: "out_for_delivery", afterSeconds: 180, label: "Out for delivery" },
  { key: "delivered", afterSeconds: 540, label: "Delivered" },
];

class Store {
  constructor(file) {
    this.file = file;
    this.data = this._load();
  }
  _load() {
    if (fs.existsSync(this.file)) return JSON.parse(fs.readFileSync(this.file, "utf8"));
    const seed = {
      products: SEED_PRODUCTS,
      users: [],
      sessions: {},
      carts: {},
      orders: [],
      addresses: {}, // userId -> [{id, label, line1, line2}]
      favorites: {}, // userId -> [productId]
    };
    this._save(seed);
    return seed;
  }
  _save(data = this.data) { fs.writeFileSync(this.file, JSON.stringify(data, null, 2)); }
  persist() { this._save(); }
}

const SEED_PRODUCTS = [
  { id: 1, cat: "fruit", name: "Cavendish Bananas", unit: "6 pc", price: 49, mrp: 60, tag: "Fresh today", emoji: "🍌", rating: 4.3 },
  { id: 2, cat: "fruit", name: "Alphonso Mangoes", unit: "1 kg", price: 249, mrp: 299, tag: "Peak season", emoji: "🥭", rating: 4.6 },
  { id: 3, cat: "fruit", name: "English Cucumber", unit: "500 g", price: 29, mrp: 35, tag: null, emoji: "🥒", rating: 4.1 },
  { id: 4, cat: "fruit", name: "Vine Tomatoes", unit: "1 kg", price: 55, mrp: 65, tag: null, emoji: "🍅", rating: 4.2 },
  { id: 5, cat: "fruit", name: "Baby Spinach", unit: "200 g", price: 39, mrp: 45, tag: "Fresh today", emoji: "🥬", rating: 4.4 },
  { id: 6, cat: "fruit", name: "Red Onions", unit: "1 kg", price: 42, mrp: 48, tag: null, emoji: "🧅", rating: 4.0 },
  { id: 7, cat: "dairy", name: "Full Cream Milk", unit: "500 ml", price: 32, mrp: 34, tag: null, emoji: "🥛", rating: 4.5 },
  { id: 8, cat: "dairy", name: "Farm Eggs", unit: "6 pc", price: 59, mrp: 69, tag: "Bestseller", emoji: "🥚", rating: 4.7 },
  { id: 9, cat: "dairy", name: "Salted Butter", unit: "100 g", price: 54, mrp: 58, tag: null, emoji: "🧈", rating: 4.3 },
  { id: 10, cat: "dairy", name: "Greek Yogurt", unit: "400 g", price: 89, mrp: 99, tag: null, emoji: "🍦", rating: 4.4 },
  { id: 11, cat: "snacks", name: "Masala Peanuts", unit: "150 g", price: 45, mrp: 50, tag: null, emoji: "🥜", rating: 4.2 },
  { id: 12, cat: "snacks", name: "Choco Cookies", unit: "200 g", price: 65, mrp: 75, tag: "Bestseller", emoji: "🍪", rating: 4.6 },
  { id: 13, cat: "snacks", name: "Potato Chips", unit: "90 g", price: 30, mrp: 35, tag: null, emoji: "🍟", rating: 4.3 },
  { id: 14, cat: "bev", name: "Cold Brew Coffee", unit: "250 ml", price: 99, mrp: 120, tag: "New", emoji: "🥤", rating: 4.5 },
  { id: 15, cat: "bev", name: "Fresh Orange Juice", unit: "1 L", price: 110, mrp: 130, tag: null, emoji: "🧃", rating: 4.4 },
  { id: 16, cat: "bev", name: "Sparkling Water", unit: "1 L", price: 40, mrp: 45, tag: null, emoji: "💧", rating: 4.1 },
  { id: 17, cat: "bakery", name: "Multigrain Bread", unit: "400 g", price: 55, mrp: 60, tag: "Fresh today", emoji: "🍞", rating: 4.3 },
  { id: 18, cat: "bakery", name: "Butter Croissant", unit: "2 pc", price: 79, mrp: 89, tag: null, emoji: "🥐", rating: 4.6 },
  { id: 19, cat: "care", name: "Hand Wash", unit: "250 ml", price: 89, mrp: 99, tag: null, emoji: "🧼", rating: 4.2 },
  { id: 20, cat: "care", name: "Toothpaste", unit: "100 g", price: 65, mrp: 75, tag: null, emoji: "🪥", rating: 4.4 },
];

const db = new Store(DB_FILE);

// ---------------- Auth ----------------
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}
function createUser(name, phone, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const user = { id: randomUUID(), name, phone, salt, passwordHash: hashPassword(password, salt), createdAt: new Date().toISOString() };
  db.data.users.push(user);
  db.data.addresses[user.id] = [
    { id: randomUUID(), label: "Home", line1: "Koramangala 5th Block", line2: "80 Feet Road, near St. John's Church, Bengaluru" },
  ];
  db.data.favorites[user.id] = [];
  db.persist();
  return user;
}
function findUserByPhone(phone) { return db.data.users.find((u) => u.phone === phone); }
function createSession(userId) { const token = randomUUID(); db.data.sessions[token] = userId; db.persist(); return token; }
function userFromToken(token) { const userId = db.data.sessions[token]; return userId ? db.data.users.find((u) => u.id === userId) : null; }
function authenticate(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return token ? { user: userFromToken(token), token } : null;
}

// ---------------- Cart ----------------
function getCart(userId) { return db.data.carts[userId] || {}; }
function setCartQty(userId, productId, qty) {
  const cart = db.data.carts[userId] || {};
  if (qty <= 0) delete cart[productId]; else cart[productId] = qty;
  db.data.carts[userId] = cart;
  db.persist();
  return cart;
}
function priceCart(cart) {
  const items = Object.entries(cart).map(([id, qty]) => {
    const product = db.data.products.find((p) => p.id === Number(id));
    return product ? { product, qty, lineTotal: product.price * qty } : null;
  }).filter(Boolean);
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const fee = subtotal === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  return { items, subtotal, fee, total: subtotal + fee };
}

// ---------------- Orders / status timeline ----------------
function computeStatus(order) {
  const ageSeconds = (Date.now() - new Date(order.createdAt).getTime()) / 1000;
  let current = STATUS_STAGES[0];
  for (const stage of STATUS_STAGES) {
    if (ageSeconds >= stage.afterSeconds) current = stage;
  }
  const currentIndex = STATUS_STAGES.findIndex((s) => s.key === current.key);
  const nextStage = STATUS_STAGES[currentIndex + 1];
  const secondsToNext = nextStage ? Math.max(0, Math.round(nextStage.afterSeconds - ageSeconds)) : 0;
  return {
    ...order,
    status: current.key,
    statusLabel: current.label,
    stages: STATUS_STAGES.map((s, i) => ({ key: s.key, label: s.label, done: i <= currentIndex })),
    secondsToNextStage: secondsToNext,
  };
}

// ---------------- Router plumbing ----------------
function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) reject(new Error("Payload too large")); });
    req.on("end", () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error("Invalid JSON body")); } });
  });
}
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp("^" + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$");
  routes.push({ method, regex, keys, handler });
}

// ---- products ----
route("GET", "/api/products", async (req, res) => send(res, 200, db.data.products));
route("GET", "/api/products/:id", async (req, res, p) => {
  const product = db.data.products.find((x) => x.id === Number(p.id));
  if (!product) return send(res, 404, { error: "Product not found" });
  send(res, 200, product);
});

// ---- auth ----
route("POST", "/api/auth/signup", async (req, res) => {
  const { name, phone, password } = await readBody(req);
  if (!name || !phone || !password) return send(res, 400, { error: "name, phone and password are required" });
  if (findUserByPhone(phone)) return send(res, 409, { error: "An account with this phone number already exists" });
  const user = createUser(name, phone, password);
  const token = createSession(user.id);
  send(res, 201, { token, user: { id: user.id, name: user.name, phone: user.phone } });
});
route("POST", "/api/auth/login", async (req, res) => {
  const { phone, password } = await readBody(req);
  const user = findUserByPhone(phone);
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) return send(res, 401, { error: "Invalid phone number or password" });
  const token = createSession(user.id);
  send(res, 200, { token, user: { id: user.id, name: user.name, phone: user.phone } });
});
route("GET", "/api/auth/me", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  send(res, 200, { id: auth.user.id, name: auth.user.name, phone: auth.user.phone });
});

// ---- cart ----
route("GET", "/api/cart", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  send(res, 200, priceCart(getCart(auth.user.id)));
});
route("POST", "/api/cart/set", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const { productId, qty } = await readBody(req);
  if (typeof productId === "undefined" || typeof qty !== "number") return send(res, 400, { error: "productId and numeric qty are required" });
  send(res, 200, priceCart(setCartQty(auth.user.id, productId, qty)));
});

// ---- addresses ----
route("GET", "/api/addresses", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  send(res, 200, db.data.addresses[auth.user.id] || []);
});
route("POST", "/api/addresses", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const { label, line1, line2 } = await readBody(req);
  if (!label || !line1) return send(res, 400, { error: "label and line1 are required" });
  const addr = { id: randomUUID(), label, line1, line2: line2 || "" };
  db.data.addresses[auth.user.id] = db.data.addresses[auth.user.id] || [];
  db.data.addresses[auth.user.id].push(addr);
  db.persist();
  send(res, 201, addr);
});
route("DELETE", "/api/addresses/:id", async (req, res, p) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const list = db.data.addresses[auth.user.id] || [];
  db.data.addresses[auth.user.id] = list.filter((a) => a.id !== p.id);
  db.persist();
  send(res, 200, db.data.addresses[auth.user.id]);
});

// ---- favorites ----
route("GET", "/api/favorites", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  send(res, 200, db.data.favorites[auth.user.id] || []);
});
route("POST", "/api/favorites/toggle", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const { productId } = await readBody(req);
  const list = db.data.favorites[auth.user.id] || [];
  const idx = list.indexOf(productId);
  if (idx === -1) list.push(productId); else list.splice(idx, 1);
  db.data.favorites[auth.user.id] = list;
  db.persist();
  send(res, 200, list);
});

// ---- orders ----
route("POST", "/api/orders/checkout", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const { addressId, paymentMethod } = await readBody(req);
  const cart = getCart(auth.user.id);
  const priced = priceCart(cart);
  if (priced.items.length === 0) return send(res, 400, { error: "Cart is empty" });

  const address = (db.data.addresses[auth.user.id] || []).find((a) => a.id === addressId) || (db.data.addresses[auth.user.id] || [])[0];

  const order = {
    id: randomUUID(),
    userId: auth.user.id,
    items: priced.items.map((i) => ({ productId: i.product.id, name: i.product.name, emoji: i.product.emoji, unit: i.product.unit, qty: i.qty, lineTotal: i.lineTotal })),
    subtotal: priced.subtotal,
    fee: priced.fee,
    total: priced.total,
    address: address || null,
    paymentMethod: paymentMethod || "UPI",
    etaMinutes: 9,
    createdAt: new Date().toISOString(),
  };
  db.data.orders.push(order);
  db.data.carts[auth.user.id] = {};
  db.persist();
  send(res, 201, computeStatus(order));
});
route("GET", "/api/orders", async (req, res) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const orders = db.data.orders.filter((o) => o.userId === auth.user.id).reverse().map(computeStatus);
  send(res, 200, orders);
});
route("GET", "/api/orders/:id", async (req, res, p) => {
  const auth = authenticate(req);
  if (!auth?.user) return send(res, 401, { error: "Not authenticated" });
  const order = db.data.orders.find((o) => o.id === p.id && o.userId === auth.user.id);
  if (!order) return send(res, 404, { error: "Order not found" });
  send(res, 200, computeStatus(order));
});

route("GET", "/api/health", async (req, res) => send(res, 200, { status: "ok", time: new Date().toISOString() }));

// ---------------- Server ----------------
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const url = req.url.split("?")[0];
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = url.match(r.regex);
    if (!match) continue;
    const params = {};
    r.keys.forEach((key, i) => (params[key] = match[i + 1]));
    try { return await r.handler(req, res, params); }
    catch (err) { console.error(err); return send(res, 500, { error: "Internal server error" }); }
  }
  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`QuickMart API v2 listening on http://localhost:${PORT}`));
module.exports = server;
