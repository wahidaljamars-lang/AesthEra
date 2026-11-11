from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
UPLOADS = PUBLIC / "uploads"
DATABASE = ROOT / "marketplace.db"
SESSION_COOKIE = "closet_session"
SESSION_SECONDS = 60 * 60 * 24 * 14
STYLES = ("Y2K", "Kawaii", "Vintage", "Coquette", "Streetwear")
CONDITIONS = ("New", "Pre-loved")
ORDER_STATUSES = ("Pending", "Confirmed", "Shipped", "Completed")
MAX_BODY = 25 * 1024 * 1024


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DATABASE, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split(":", 1)
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), 310_000
        ).hex()
        return hmac.compare_digest(candidate, digest_hex)
    except (ValueError, TypeError):
        return False


def validate_avatar(value: object) -> str | None:
    if value is None or value == "":
        return None
    match = re.fullmatch(
        r"data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})",
        str(value),
    )
    if not match:
        raise APIError(400, "Profile photos must be JPG, PNG, WEBP, or GIF.")
    try:
        image = base64.b64decode(match.group(2), validate=True)
    except ValueError:
        raise APIError(400, "That profile photo could not be decoded.") from None
    if len(image) > 2 * 1024 * 1024:
        raise APIError(400, "Your profile photo must be smaller than 2 MB.")
    return str(value)


def initialize() -> None:
    UPLOADS.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                address TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('buyer', 'seller')),
                avatar TEXT,
                bio TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD')),
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                seller_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price REAL NOT NULL CHECK(price >= 0),
                currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD')),
                size TEXT NOT NULL,
                condition TEXT NOT NULL CHECK(condition IN ('New', 'Pre-loved')),
                style TEXT NOT NULL CHECK(style IN ('Y2K','Kawaii','Vintage','Coquette','Streetwear')),
                images TEXT NOT NULL DEFAULT '[]',
                stock INTEGER NOT NULL DEFAULT 1 CHECK(stock >= 0),
                active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cart_items (
                buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL CHECK(quantity > 0),
                PRIMARY KEY (buyer_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                buyer_id INTEGER NOT NULL REFERENCES users(id),
                seller_id INTEGER NOT NULL REFERENCES users(id),
                full_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                address TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD')),
                status TEXT NOT NULL DEFAULT 'Pending',
                total REAL NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
                product_name TEXT NOT NULL,
                size TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL CHECK(quantity > 0)
            );
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
                method TEXT NOT NULL,
                transaction_ref TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS seller_ratings (
                order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
                buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS product_ratings (
                buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                comment TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                PRIMARY KEY (buyer_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS message_threads (
                id INTEGER PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(product_id, buyer_id, seller_id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_migrations (
                name TEXT PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS products_style_active ON products(style, active);
            CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_id, created_at);
            CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller_id, created_at);
            CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, created_at);
            """
        )
        for table, column, definition in (
            ("users", "bio", "TEXT NOT NULL DEFAULT ''"),
            ("users", "currency", "TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD'))"),
            ("users", "avatar", "TEXT"),
            ("products", "currency", "TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD'))"),
            ("orders", "currency", "TEXT NOT NULL DEFAULT 'PHP' CHECK(currency IN ('PHP','USD','EUR','GBP','JPY','SGD'))"),
            ("product_ratings", "comment", "TEXT NOT NULL DEFAULT ''"),
        ):
            existing = [row[1] for row in db.execute(f"PRAGMA table_info({table})").fetchall()]
            if column not in existing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        samples = [
            ("Cherry Baby Tee", "A playful cherry-print baby tee with a soft stretch fit.", 180, "PHP", "S", "Pre-loved", "Y2K",
             ["https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=85"], 4),
            ("Petal Knit Cardigan", "A cloud-soft cardigan with delicate pearl buttons.", 450, "PHP", "M", "New", "Kawaii",
             ["https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=85"], 3),
            ("Sunday Market Denim", "Broken-in straight leg denim, ready for a second life.", 350, "PHP", "M", "Pre-loved", "Vintage",
             ["https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=85"], 2),
            ("Rosewater Ribbon Blouse", "Romantic chiffon, a tie neckline, and softly gathered sleeves.", 320, "PHP", "S", "New", "Coquette",
             ["https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85"], 3),
            ("After Hours Bomber", "An oversized satin bomber with a little downtown energy.", 2799, "PHP", "L", "Pre-loved", "Streetwear",
             ["https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=85"], 1),
            ("Cloud Nine Mini Skirt", "A swishy pleated mini for your favorite going-out look.", 1299, "PHP", "S", "New", "Y2K",
             ["https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=85"], 2),
            ("Daisy Daydream Dress", "A breezy floral dress with a softly gathered waist.", 680, "PHP", "XS", "New", "Coquette",
             ["https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=85"], 2),
            ("Weekend Denim Jacket", "An easy, relaxed denim layer with plenty of life left.", 790, "PHP", "XL", "Pre-loved", "Vintage",
             ["https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=900&q=85"], 1),
            ("Buttercream Knit Top", "A soft neutral knit that pairs with just about anything.", 390, "PHP", "One size", "New", "Kawaii",
             ["https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85"], 3),
            ("Everyday Cargo Trousers", "Comfy utility trousers with a relaxed streetwear fit.", 560, "PHP", "L", "Pre-loved", "Streetwear",
             ["https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=85"], 2),
        ]
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            now = int(time.time())
            seller_id = db.execute(
                """INSERT INTO users(name,phone,email,password_hash,address,role,currency,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                ("Mia's Vintage Closet", "+1 555 0100", "seller@closet.test",
                 password_hash("closet123"), "Brooklyn, New York", "seller", "PHP", now),
            ).lastrowid
            db.execute(
                """INSERT INTO users(name,phone,email,password_hash,address,role,currency,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                ("Alex Morgan", "+1 555 0101", "buyer@closet.test",
                 password_hash("closet123"), "Brooklyn, New York", "buyer", "USD", now),
            )
        demo_seller = db.execute(
            "SELECT id FROM users WHERE email='seller@closet.test' AND role='seller'"
        ).fetchone()
        if demo_seller:
            now = int(time.time())
            for name, description, price, currency, size, condition, style, images, stock in samples:
                exists = db.execute(
                    "SELECT 1 FROM products WHERE seller_id=? AND name=?",
                    (demo_seller["id"], name),
                ).fetchone()
                if exists:
                    continue
                db.execute(
                    """INSERT INTO products
                       (seller_id,name,description,price,currency,size,condition,style,images,stock,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (demo_seller["id"], name, description, price, currency, size, condition, style,
                     json.dumps(images), stock, now),
                )
        migration = "standardize-marketplace-prices-to-php"
        if not db.execute("SELECT 1 FROM app_migrations WHERE name=?", (migration,)).fetchone():
            demo_prices = {
                "Cherry Baby Tee": 180,
                "Petal Knit Cardigan": 450,
                "Sunday Market Denim": 350,
                "Rosewater Ribbon Blouse": 320,
            }
            for name, price in demo_prices.items():
                db.execute(
                    """UPDATE products SET price=?,currency='PHP'
                       WHERE seller_id=(SELECT id FROM users WHERE email='seller@closet.test')
                         AND name=?""",
                    (price, name),
                )
            db.execute("UPDATE products SET currency='PHP'")
            db.execute("UPDATE orders SET currency='PHP'")
            db.execute(
                "INSERT INTO app_migrations(name,applied_at) VALUES(?,?)",
                (migration, int(time.time())),
            )
        currency_migration = "remove-user-currency-preference"
        if not db.execute("SELECT 1 FROM app_migrations WHERE name=?", (currency_migration,)).fetchone():
            db.execute("UPDATE users SET currency='PHP'")
            db.execute(
                "INSERT INTO app_migrations(name,applied_at) VALUES(?,?)",
                (currency_migration, int(time.time())),
            )


class APIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


class MarketplaceHandler(BaseHTTPRequestHandler):
    server_version = "ClosetClub/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, status: int, payload: object, extra_headers: dict[str, str] | None = None) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > MAX_BODY:
                raise APIError(413, "Request is too large.")
            if length == 0:
                return {}
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise APIError(400, "A JSON object is required.")
            return value
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise APIError(400, "Request body must be valid JSON.") from None

    def request_data(self) -> tuple[str, str]:
        parsed = urlparse(self.path)
        return parsed.path.rstrip("/") or "/", parsed.query

    def cookie_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else None
        except Exception:
            return None

    def current_user(self, role: str | None = None) -> sqlite3.Row:
        token = self.cookie_token()
        if not token:
            raise APIError(401, "Please sign in to continue.")
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect() as db:
            row = db.execute(
                """SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
                   WHERE sessions.token_hash=? AND sessions.expires_at>?""",
                (token_hash, int(time.time())),
            ).fetchone()
        if not row:
            raise APIError(401, "Your session has expired. Please sign in again.")
        if role and row["role"] != role:
            raise APIError(403, f"This action is only available to {role}s.")
        return row

    def save_uploads(self, images: object) -> list[str]:
        if not isinstance(images, list) or len(images) > 6:
            raise APIError(400, "Choose up to 6 product images.")
        saved = []
        for image in images:
            if not isinstance(image, dict):
                raise APIError(400, "Each image must include a filename and data URL.")
            match = re.fullmatch(r"data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)", str(image.get("data", "")))
            if not match:
                raise APIError(400, "Images must be JPG, PNG, WEBP, or GIF files.")
            import base64
            try:
                raw = base64.b64decode(match.group(2), validate=True)
            except ValueError:
                raise APIError(400, "One of those images could not be decoded.") from None
            if len(raw) > 3 * 1024 * 1024:
                raise APIError(400, "Each image must be smaller than 3 MB.")
            ext = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}[match.group(1)]
            name = f"{uuid.uuid4().hex}{ext}"
            (UPLOADS / name).write_bytes(raw)
            saved.append(f"/uploads/{name}")
        return saved

    def product_values(self, data: dict, existing: sqlite3.Row | None = None) -> tuple:
        required = ("name", "description", "size", "condition", "style")
        values = {
            key: data.get(key, existing[key] if existing else None)
            for key in (*required, "price", "currency")
        }
        if any(not isinstance(values[key], str) or not values[key].strip() for key in required):
            raise APIError(400, "Please complete all product details.")
        try:
            price = round(float(values["price"]), 2)
            stock = int(data.get("stock", existing["stock"] if existing else 1))
        except (TypeError, ValueError):
            raise APIError(400, "Enter a valid price and available quantity.") from None
        if not 0 <= price <= 1_000_000 or not 0 <= stock <= 10_000:
            raise APIError(400, "Price or quantity is outside the allowed range.")
        condition = values["condition"].strip()
        style = values["style"].strip()
        if condition not in CONDITIONS or style not in STYLES:
            raise APIError(400, "Choose a valid condition and fashion style.")
        name = values["name"].strip()[:100]
        description = values["description"].strip()[:2000]
        size = values["size"].strip()[:30]
        if not name or not description or not size:
            raise APIError(400, "Please complete all product details.")
        if "images" in data:
            images = self.save_uploads(data["images"])
        elif existing:
            images = json.loads(existing["images"])
        else:
            images = []
        return name, description, price, "PHP", size, condition, style, json.dumps(images), stock

    def do_GET(self) -> None:
        path, query = self.request_data()
        params = parse_qs(query)
        try:
            with connect() as db:
                if path == "/api/session":
                    try:
                        user = self.current_user()
                        self.send_json(200, {"user": self.public_user(user)})
                    except APIError as error:
                        if error.status == 401:
                            self.send_json(200, {"user": None})
                        else:
                            raise
                    return
                if path == "/api/products":
                    clauses = ["products.active=1", "products.stock>0"]
                    args: list[object] = []
                    if params.get("style", [""])[0] in STYLES:
                        clauses.append("products.style=?")
                        args.append(params["style"][0])
                    if params.get("q", [""])[0].strip():
                        clauses.append("(products.name LIKE ? OR products.description LIKE ?)")
                        term = f"%{params['q'][0].strip()[:100]}%"
                        args.extend([term, term])
                    if params.get("size", [""])[0]:
                        clauses.append("products.size=?")
                        args.append(params["size"][0][:30])
                    if params.get("condition", [""])[0] in CONDITIONS:
                        clauses.append("products.condition=?")
                        args.append(params["condition"][0])
                    try:
                        min_price = float(params.get("min", [""])[0]) if params.get("min", [""])[0] else None
                        max_price = float(params.get("max", [""])[0]) if params.get("max", [""])[0] else None
                    except ValueError:
                        raise APIError(400, "Enter a valid price range.") from None
                    if min_price is not None:
                        clauses.append("products.price>=?")
                        args.append(max(0, min_price))
                    if max_price is not None:
                        clauses.append("products.price<=?")
                        args.append(max_price)
                    rows = db.execute(
                        f"""SELECT products.*, users.name seller_name,
                                   (SELECT AVG(rating) FROM product_ratings WHERE product_id=products.id) product_rating,
                                   (SELECT COUNT(*) FROM product_ratings WHERE product_id=products.id) product_rating_count
                            FROM products
                            JOIN users ON users.id=products.seller_id
                            WHERE {' AND '.join(clauses)} ORDER BY products.created_at DESC""",
                        args,
                    ).fetchall()
                    self.send_json(200, {"products": [self.product_json(row) for row in rows]})
                    return
                if path == "/api/cart":
                    buyer = self.current_user("buyer")
                    rows = db.execute(
                        """SELECT cart_items.quantity, products.*, users.name seller_name
                           FROM cart_items JOIN products ON products.id=cart_items.product_id
                           JOIN users ON users.id=products.seller_id
                           WHERE cart_items.buyer_id=? AND products.active=1 ORDER BY cart_items.rowid""",
                        (buyer["id"],),
                    ).fetchall()
                    self.send_json(200, {"items": [
                        {**self.product_json(row), "quantity": row["quantity"]} for row in rows
                    ]})
                    return
                if path == "/api/orders":
                    user = self.current_user()
                    clause = "orders.buyer_id=?" if user["role"] == "buyer" else "orders.seller_id=?"
                    rows = db.execute(
                        f"""SELECT orders.*, buyers.name buyer_name, sellers.name seller_name, payments.method payment_method,
                                   payments.status payment_status, payments.transaction_ref
                            FROM orders JOIN users buyers ON buyers.id=orders.buyer_id
                            JOIN users sellers ON sellers.id=orders.seller_id
                            LEFT JOIN payments ON payments.order_id=orders.id
                            WHERE {clause} ORDER BY orders.created_at DESC""",
                        (user["id"],),
                    ).fetchall()
                    result = []
                    for order in rows:
                        items = db.execute(
                            """SELECT order_items.product_id, order_items.product_name, order_items.size,
                                      order_items.price, order_items.quantity, product_ratings.rating buyer_rating,
                                      product_ratings.comment buyer_comment
                               FROM order_items
                               LEFT JOIN product_ratings
                                 ON product_ratings.product_id=order_items.product_id
                                AND product_ratings.buyer_id=?
                               WHERE order_items.order_id=?""",
                            (user["id"], order["id"]),
                        ).fetchall()
                        result.append({
                            **dict(order),
                            "estimated_delivery_at": order["created_at"] + 7 * 24 * 60 * 60,
                            "items": [dict(item) for item in items],
                        })
                    self.send_json(200, {"orders": result})
                    return
                if path == "/api/messages":
                    user = self.current_user()
                    rows = db.execute(
                        """SELECT message_threads.*, products.name product_name,
                                  buyers.name buyer_name, sellers.name seller_name
                           FROM message_threads
                           JOIN products ON products.id=message_threads.product_id
                           JOIN users buyers ON buyers.id=message_threads.buyer_id
                           JOIN users sellers ON sellers.id=message_threads.seller_id
                           WHERE message_threads.buyer_id=? OR message_threads.seller_id=?
                           ORDER BY message_threads.updated_at DESC""",
                        (user["id"], user["id"]),
                    ).fetchall()
                    threads = []
                    for row in rows:
                        messages = db.execute(
                            """SELECT messages.id, messages.sender_id, users.name sender_name,
                                      messages.body, messages.created_at
                               FROM messages JOIN users ON users.id=messages.sender_id
                               WHERE messages.thread_id=? ORDER BY messages.created_at, messages.id""",
                            (row["id"],),
                        ).fetchall()
                        thread = dict(row)
                        thread["counterpart_id"] = row["seller_id"] if user["role"] == "buyer" else row["buyer_id"]
                        thread["counterpart_name"] = row["seller_name"] if user["role"] == "buyer" else row["buyer_name"]
                        thread["messages"] = [dict(message) for message in messages]
                        threads.append(thread)
                    self.send_json(200, {"threads": threads})
                    return
                if path.startswith("/api/profiles/"):
                    user_id = self.int_path(path.rsplit("/", 1)[-1])
                    profile = db.execute(
                        "SELECT id,name,role,avatar,bio FROM users WHERE id=?",
                        (user_id,),
                    ).fetchone()
                    if not profile:
                        raise APIError(404, "That profile was not found.")
                    if profile["role"] == "buyer":
                        viewer = self.current_user("seller")
                        related = db.execute(
                            """SELECT 1 FROM orders WHERE buyer_id=? AND seller_id=?
                               UNION ALL
                               SELECT 1 FROM message_threads WHERE buyer_id=? AND seller_id=?
                               LIMIT 1""",
                            (user_id, viewer["id"], user_id, viewer["id"]),
                        ).fetchone()
                        if not related:
                            raise APIError(404, "That profile was not found.")
                    self.send_json(200, {"profile": dict(profile)})
                    return
                if path == "/api/seller/summary":
                    seller = self.current_user("seller")
                    products = db.execute(
                        """SELECT SUM(active=1) total,
                                  SUM(active=1 AND stock>0) available
                           FROM products WHERE seller_id=?""",
                        (seller["id"],),
                    ).fetchone()
                    orders = db.execute(
                        """SELECT COUNT(*) total, SUM(status='Pending') pending,
                                  SUM(status='Completed') completed,
                                  COALESCE(SUM(CASE WHEN status='Completed' THEN total ELSE 0 END), 0) sales
                           FROM orders WHERE seller_id=?""",
                        (seller["id"],),
                    ).fetchone()
                    rating = db.execute(
                        """SELECT AVG(product_ratings.rating) average, COUNT(*) count
                           FROM product_ratings
                           JOIN products ON products.id=product_ratings.product_id
                           WHERE products.seller_id=?""",
                        (seller["id"],),
                    ).fetchone()
                    self.send_json(200, {
                        "products": {key: value or 0 for key, value in dict(products).items()},
                        "orders": {key: value or 0 for key, value in dict(orders).items()},
                        "rating": {"average": rating["average"], "count": rating["count"]},
                    })
                    return
                if path == "/api/seller/products":
                    seller = self.current_user("seller")
                    rows = db.execute(
                        """SELECT products.*,
                                  (SELECT AVG(rating) FROM product_ratings WHERE product_id=products.id) product_rating,
                                  (SELECT COUNT(*) FROM product_ratings WHERE product_id=products.id) product_rating_count
                           FROM products WHERE seller_id=? ORDER BY created_at DESC""", (seller["id"],)
                    ).fetchall()
                    self.send_json(200, {"products": [self.product_json(row) for row in rows]})
                    return
            if path.startswith("/api/products/") and path.endswith("/reviews"):
                product_id = self.int_path(path.split("/")[-2])
                with connect() as db:
                    reviews = db.execute(
                        """SELECT product_ratings.rating, product_ratings.comment, product_ratings.created_at
                           FROM product_ratings
                           WHERE product_ratings.product_id=? AND product_ratings.comment<>''
                           ORDER BY product_ratings.created_at DESC LIMIT 50""",
                        (product_id,),
                    ).fetchall()
                self.send_json(200, {"reviews": [dict(review) for review in reviews]})
                return
            if path.startswith("/api/products/"):
                product_id = self.int_path(path.rsplit("/", 1)[-1])
                with connect() as db:
                    row = db.execute(
                        """SELECT products.*, users.name seller_name,
                                  (SELECT AVG(rating) FROM product_ratings WHERE product_id=products.id) product_rating,
                                  (SELECT COUNT(*) FROM product_ratings WHERE product_id=products.id) product_rating_count
                           FROM products
                           JOIN users ON users.id=products.seller_id
                           WHERE products.id=? AND products.active=1""", (product_id,)
                    ).fetchone()
                if not row:
                    raise APIError(404, "This piece is no longer available.")
                self.send_json(200, {"product": self.product_json(row)})
                return
            if path.startswith("/api/"):
                raise APIError(404, "This API route does not exist.")
            self.serve_static(path)
        except APIError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "That change conflicts with existing marketplace data."})
        except Exception as error:
            print(f"GET {path} failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def do_POST(self) -> None:
        path, _ = self.request_data()
        try:
            data = self.read_json()
            if path == "/api/auth/register":
                name = str(data.get("name", "")).strip()
                phone = str(data.get("phone", "")).strip()
                email = str(data.get("email", "")).strip().lower()
                password = str(data.get("password", ""))
                address = str(data.get("address", "")).strip()
                role = data.get("role")
                if role not in ("buyer", "seller"):
                    raise APIError(400, "Choose a buyer or seller account.")
                if not all((name, phone, email, password, address)):
                    raise APIError(400, "Please complete every field.")
                if len(name) > 100 or len(phone) > 40 or len(email) > 254 or len(address) > 500 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                    raise APIError(400, "Enter valid contact and address details.")
                if len(password) < 8 or len(password) > 256:
                    raise APIError(400, "Your password must be between 8 and 256 characters.")
                with connect() as db:
                    user_id = db.execute(
                        """INSERT INTO users(name,phone,email,password_hash,address,role,created_at)
                           VALUES(?,?,?,?,?,?,?)""",
                        (name[:100], phone[:40], email, password_hash(password), address[:500], role, int(time.time())),
                    ).lastrowid
                    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
                self.login_session(user)
                return
            if path == "/api/auth/login":
                email = str(data.get("email", "")).strip()
                password = str(data.get("password", ""))
                role = data.get("role")
                if role not in ("buyer", "seller") or not email or not password:
                    raise APIError(400, "Enter your email, password, and account type.")
                with connect() as db:
                    user = db.execute("SELECT * FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
                if not user or user["role"] != role or not verify_password(password, user["password_hash"]):
                    raise APIError(401, "Those details don't match a " + role + " account.")
                self.login_session(user)
                return
            if path == "/api/auth/logout":
                token = self.cookie_token()
                if token:
                    with connect() as db:
                        db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
                self.send_json(200, {"ok": True}, {"Set-Cookie": f"{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
                return
            if path == "/api/messages":
                user = self.current_user()
                body = data.get("message")
                if not isinstance(body, str):
                    raise APIError(400, "Enter a valid message.")
                body = body.strip()
                if not body or len(body) > 2000:
                    raise APIError(400, "Messages must be between 1 and 2,000 characters.")
                thread_id = None
                with connect() as db:
                    if data.get("threadId") is not None:
                        thread_id = self.int_value(data.get("threadId"), "conversation")
                        thread = db.execute(
                            """SELECT id,buyer_id,seller_id FROM message_threads
                               WHERE id=? AND (buyer_id=? OR seller_id=?)""",
                            (thread_id, user["id"], user["id"]),
                        ).fetchone()
                        if not thread:
                            raise APIError(404, "That conversation was not found.")
                    else:
                        if user["role"] != "buyer":
                            raise APIError(403, "Start a product conversation from a buyer account.")
                        product_id = self.int_value(data.get("productId"), "product")
                        product = db.execute(
                            "SELECT id,seller_id,active FROM products WHERE id=?",
                            (product_id,),
                        ).fetchone()
                        if not product or not product["active"]:
                            raise APIError(404, "That product is no longer available.")
                        if product["seller_id"] == user["id"]:
                            raise APIError(403, "You cannot message yourself about your own listing.")
                        now = int(time.time())
                        db.execute(
                            """INSERT OR IGNORE INTO message_threads
                               (product_id,buyer_id,seller_id,created_at,updated_at)
                               VALUES(?,?,?,?,?)""",
                            (product_id, user["id"], product["seller_id"], now, now),
                        )
                        thread = db.execute(
                            """SELECT id FROM message_threads
                               WHERE product_id=? AND buyer_id=? AND seller_id=?""",
                            (product_id, user["id"], product["seller_id"]),
                        ).fetchone()
                        thread_id = thread["id"]
                    now = int(time.time())
                    db.execute(
                        "INSERT INTO messages(thread_id,sender_id,body,created_at) VALUES(?,?,?,?)",
                        (thread_id, user["id"], body, now),
                    )
                    db.execute(
                        "UPDATE message_threads SET updated_at=? WHERE id=?",
                        (now, thread_id),
                    )
                self.send_json(201, {"ok": True, "threadId": thread_id})
                return
            if path == "/api/ratings":
                buyer = self.current_user("buyer")
                order_id = self.int_value(data.get("orderId"), "order")
                product_id = self.int_value(data.get("productId"), "product")
                rating = data.get("rating")
                if type(rating) is not int:
                    raise APIError(400, "Choose a rating from 1 to 5 stars.") from None
                if not 1 <= rating <= 5:
                    raise APIError(400, "Choose a rating from 1 to 5 stars.")
                comment = data.get("comment", "")
                if not isinstance(comment, str):
                    raise APIError(400, "Enter a valid product comment.")
                comment = comment.strip()
                if len(comment) > 2000:
                    raise APIError(400, "Product comments must be 2,000 characters or fewer.")
                with connect() as db:
                    order = db.execute(
                        "SELECT status FROM orders WHERE id=? AND buyer_id=?",
                        (order_id, buyer["id"]),
                    ).fetchone()
                    if not order:
                        raise APIError(404, "That order was not found.")
                    if order["status"] != "Completed":
                        raise APIError(409, "You can rate a product after the order is completed.")
                    if db.execute(
                        "SELECT 1 FROM order_items WHERE order_id=? AND product_id=?",
                        (order_id, product_id),
                    ).fetchone() is None:
                        raise APIError(409, "That product was not part of this order.")
                    db.execute(
                        """INSERT INTO product_ratings(buyer_id,product_id,order_id,rating,comment,created_at)
                           VALUES(?,?,?,?,?,?)
                           ON CONFLICT(buyer_id,product_id) DO UPDATE SET
                             order_id=excluded.order_id, rating=excluded.rating,
                             comment=excluded.comment, created_at=excluded.created_at""",
                        (buyer["id"], product_id, order_id, rating, comment, int(time.time())),
                    )
                self.send_json(200, {"ok": True})
                return
            if path == "/api/cart":
                buyer = self.current_user("buyer")
                product_id = self.int_value(data.get("productId"), "product")
                quantity = self.int_value(data.get("quantity", 1), "quantity")
                if quantity < 1 or quantity > 100:
                    raise APIError(400, "Choose a quantity between 1 and 100.")
                with connect() as db:
                    product = db.execute(
                        "SELECT id,stock,active FROM products WHERE id=?", (product_id,)
                    ).fetchone()
                    if not product or not product["active"] or product["stock"] < 1:
                        raise APIError(404, "This piece is no longer available.")
                    current = db.execute(
                        "SELECT quantity FROM cart_items WHERE buyer_id=? AND product_id=?",
                        (buyer["id"], product_id),
                    ).fetchone()
                    new_quantity = quantity + (current["quantity"] if current else 0)
                    if new_quantity > product["stock"]:
                        raise APIError(409, f"Only {product['stock']} available right now.")
                    db.execute(
                        """INSERT INTO cart_items(buyer_id,product_id,quantity) VALUES(?,?,?)
                           ON CONFLICT(buyer_id,product_id) DO UPDATE SET quantity=excluded.quantity""",
                        (buyer["id"], product_id, new_quantity),
                    )
                self.send_json(200, {"ok": True})
                return
            if path == "/api/orders":
                buyer = self.current_user("buyer")
                full_name = str(data.get("fullName", "")).strip()
                phone = str(data.get("phone", "")).strip()
                address = str(data.get("address", "")).strip()
                currency = "PHP"
                method = data.get("paymentMethod")
                if not all((full_name, phone, address)) or method not in (
                    "Cash on delivery", "GCash (demo)", "Maya (demo)"
                ):
                    raise APIError(400, "Complete your delivery details and choose a payment method.")
                created = []
                with connect() as db:
                    cart = db.execute(
                        """SELECT cart_items.quantity, products.*, users.name seller_name
                           FROM cart_items JOIN products ON products.id=cart_items.product_id
                           JOIN users ON users.id=products.seller_id
                           WHERE cart_items.buyer_id=? AND products.active=1 ORDER BY products.seller_id""",
                        (buyer["id"],),
                    ).fetchall()
                    if not cart:
                        raise APIError(400, "Your bag is empty.")
                    for item in cart:
                        if item["quantity"] > item["stock"]:
                            raise APIError(409, f"{item['name']} has only {item['stock']} left.")
                    grouped: dict[int, list[sqlite3.Row]] = {}
                    for item in cart:
                        grouped.setdefault(item["seller_id"], []).append(item)
                    for seller_id, items in grouped.items():
                        total = sum(item["price"] * item["quantity"] for item in items)
                        order_id = db.execute(
                            """INSERT INTO orders(buyer_id,seller_id,full_name,phone,address,currency,total,created_at)
                               VALUES(?,?,?,?,?,?,?,?)""",
                            (buyer["id"], seller_id, full_name[:100], phone[:40], address[:500], currency, total, int(time.time())),
                        ).lastrowid
                        for item in items:
                            db.execute(
                                """INSERT INTO order_items(order_id,product_id,product_name,size,price,quantity)
                                   VALUES(?,?,?,?,?,?)""",
                                (order_id, item["id"], item["name"], item["size"], item["price"], item["quantity"]),
                            )
                            db.execute("UPDATE products SET stock=stock-? WHERE id=?", (item["quantity"], item["id"]))
                            db.execute("DELETE FROM cart_items WHERE buyer_id=? AND product_id=?", (buyer["id"], item["id"]))
                        payment_status = "Pending" if method == "Cash on delivery" else "Awaiting payment"
                        db.execute(
                            """INSERT INTO payments(order_id,method,transaction_ref,status,created_at)
                               VALUES(?,?,?,?,?)""",
                            (order_id, method, f"CL-{uuid.uuid4().hex[:12].upper()}", payment_status, int(time.time())),
                        )
                        created.append(order_id)
                self.send_json(201, {"ok": True, "orderIds": created})
                return
            if path == "/api/orders/cancel":
                buyer = self.current_user("buyer")
                order_id = self.int_value(data.get("orderId"), "order")
                now = int(time.time())
                with connect() as db:
                    order = db.execute(
                        "SELECT status,created_at FROM orders WHERE id=? AND buyer_id=?",
                        (order_id, buyer["id"]),
                    ).fetchone()
                    if not order:
                        raise APIError(404, "That order was not found.")
                    if order["status"] != "Pending":
                        raise APIError(409, "Only pending orders can be cancelled.")
                    if now > order["created_at"] + 24 * 60 * 60:
                        raise APIError(409, "The 24-hour cancellation period has expired.")
                    changed = db.execute(
                        """UPDATE orders SET status='Cancelled'
                           WHERE id=? AND buyer_id=? AND status='Pending' AND created_at>=?""",
                        (order_id, buyer["id"], now - 24 * 60 * 60),
                    ).rowcount
                    if not changed:
                        raise APIError(409, "This order can no longer be cancelled.")
                    items = db.execute(
                        "SELECT product_id,quantity FROM order_items WHERE order_id=?",
                        (order_id,),
                    ).fetchall()
                    for item in items:
                        if item["product_id"] is not None:
                            db.execute(
                                "UPDATE products SET stock=stock+? WHERE id=? AND active=1",
                                (item["quantity"], item["product_id"]),
                            )
                    db.execute(
                        "UPDATE payments SET status='Cancelled' WHERE order_id=?",
                        (order_id,),
                    )
                self.send_json(200, {"ok": True})
                return
            if path == "/api/seller/products":
                seller = self.current_user("seller")
                values = self.product_values(data)
                with connect() as db:
                    product_id = db.execute(
                        """INSERT INTO products
                           (seller_id,name,description,price,currency,size,condition,style,images,stock,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                        (seller["id"], *values, int(time.time())),
                    ).lastrowid
                self.send_json(201, {"ok": True, "productId": product_id})
                return
            if path == "/api/seller/orders/status":
                seller = self.current_user("seller")
                order_id = self.int_value(data.get("orderId"), "order")
                status = data.get("status")
                if status not in ORDER_STATUSES:
                    raise APIError(400, "Choose a valid order status.")
                with connect() as db:
                    changed = db.execute(
                        "UPDATE orders SET status=? WHERE id=? AND seller_id=? AND status!='Cancelled'",
                        (status, order_id, seller["id"]),
                    ).rowcount
                    if not changed:
                        raise APIError(404, "That order was not found in your shop.")
                    if status == "Completed":
                        db.execute(
                            "UPDATE payments SET status='Paid' WHERE order_id=? AND method='Cash on delivery'",
                            (order_id,),
                        )
                    elif status in ("Confirmed", "Shipped"):
                        db.execute(
                            """UPDATE payments SET status='Pending' WHERE order_id=? AND method='Cash on delivery'
                               AND status!='Paid'""", (order_id,)
                        )
                self.send_json(200, {"ok": True})
                return
            raise APIError(404, "This API route does not exist.")
        except APIError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "An account with that email already exists."})
        except Exception as error:
            print(f"POST {path} failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def do_PUT(self) -> None:
        path, _ = self.request_data()
        try:
            data = self.read_json()
            if path == "/api/profile":
                user = self.current_user()
                name = str(data.get("name", "")).strip()
                phone = str(data.get("phone", "")).strip()
                email = str(data.get("email", "")).strip().lower()
                address = str(data.get("address", "")).strip()
                bio = data.get("bio", "")
                if not isinstance(bio, str):
                    raise APIError(400, "Enter a valid bio.")
                bio = bio.strip()
                if len(bio) > 500:
                    raise APIError(400, "Your bio must be 500 characters or fewer.")
                if not all((name, phone, address)) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                    raise APIError(400, "Enter a valid name, phone, email, and delivery address.")
                avatar = validate_avatar(data.get("avatar", user["avatar"]))
                with connect() as db:
                    db.execute(
                        "UPDATE users SET name=?,phone=?,email=?,address=?,avatar=?,bio=? WHERE id=?",
                        (name[:100], phone[:40], email, address[:500], avatar, bio, user["id"]),
                    )
                    updated = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
                self.send_json(200, {"user": self.public_user(updated)})
                return
            if path == "/api/cart":
                buyer = self.current_user("buyer")
                product_id = self.int_value(data.get("productId"), "product")
                quantity = self.int_value(data.get("quantity"), "quantity")
                if quantity < 1 or quantity > 100:
                    raise APIError(400, "Choose a quantity between 1 and 100.")
                with connect() as db:
                    product = db.execute(
                        "SELECT stock,active FROM products WHERE id=?", (product_id,)
                    ).fetchone()
                    if not product or not product["active"] or quantity > product["stock"]:
                        raise APIError(409, "That quantity is no longer available.")
                    changed = db.execute(
                        "UPDATE cart_items SET quantity=? WHERE buyer_id=? AND product_id=?",
                        (quantity, buyer["id"], product_id),
                    ).rowcount
                    if not changed:
                        raise APIError(404, "That item is not in your bag.")
                self.send_json(200, {"ok": True})
                return
            if path.startswith("/api/seller/products/"):
                seller = self.current_user("seller")
                product_id = self.int_path(path.rsplit("/", 1)[-1])
                with connect() as db:
                    existing = db.execute(
                        "SELECT * FROM products WHERE id=? AND seller_id=?", (product_id, seller["id"])
                    ).fetchone()
                    if not existing:
                        raise APIError(404, "That piece was not found in your shop.")
                    values = self.product_values(data, existing)
                    db.execute(
                        """UPDATE products SET name=?,description=?,price=?,currency=?,size=?,condition=?,style=?,
                           images=?,stock=? WHERE id=? AND seller_id=?""",
                        (*values, product_id, seller["id"]),
                    )
                self.send_json(200, {"ok": True})
                return
            raise APIError(404, "This API route does not exist.")
        except APIError as error:
            self.send_json(error.status, {"error": error.message})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "That email address is already in use."})
        except Exception as error:
            print(f"PUT {path} failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def do_DELETE(self) -> None:
        path, query = self.request_data()
        params = parse_qs(query)
        try:
            if path == "/api/cart":
                buyer = self.current_user("buyer")
                product_id = self.int_value(params.get("productId", [None])[0], "product")
                with connect() as db:
                    db.execute(
                        "DELETE FROM cart_items WHERE buyer_id=? AND product_id=?",
                        (buyer["id"], product_id),
                    )
                self.send_json(200, {"ok": True})
                return
            if path.startswith("/api/orders/"):
                buyer = self.current_user("buyer")
                order_id = self.int_path(path.rsplit("/", 1)[-1])
                with connect() as db:
                    order = db.execute(
                        "SELECT status FROM orders WHERE id=? AND buyer_id=?",
                        (order_id, buyer["id"]),
                    ).fetchone()
                    if not order:
                        raise APIError(404, "That order was not found.")
                    if order["status"] != "Cancelled":
                        raise APIError(409, "Only cancelled orders can be removed.")
                    db.execute(
                        "DELETE FROM orders WHERE id=? AND buyer_id=?",
                        (order_id, buyer["id"]),
                    )
                self.send_json(200, {"ok": True})
                return
            if path.startswith("/api/seller/products/"):
                seller = self.current_user("seller")
                product_id = self.int_path(path.rsplit("/", 1)[-1])
                with connect() as db:
                    changed = db.execute(
                        "UPDATE products SET active=0,stock=0 WHERE id=? AND seller_id=?",
                        (product_id, seller["id"]),
                    ).rowcount
                    if not changed:
                        raise APIError(404, "That piece was not found in your shop.")
                    db.execute("DELETE FROM cart_items WHERE product_id=?", (product_id,))
                self.send_json(200, {"ok": True})
                return
            raise APIError(404, "This API route does not exist.")
        except APIError as error:
            self.send_json(error.status, {"error": error.message})
        except Exception as error:
            print(f"DELETE {path} failed: {error}")
            self.send_json(500, {"error": "Something went wrong. Please try again."})

    def login_session(self, user: sqlite3.Row) -> None:
        token = secrets.token_urlsafe(32)
        with connect() as db:
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(time.time()),))
            db.execute(
                "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), user["id"], int(time.time()) + SESSION_SECONDS),
            )
        self.send_json(
            200, {"user": self.public_user(user)},
            {"Set-Cookie": f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_SECONDS}"},
        )

    @staticmethod
    def public_user(user: sqlite3.Row) -> dict:
        return {key: user[key] for key in ("id", "name", "phone", "email", "address", "role", "avatar", "bio")}

    @staticmethod
    def product_json(row: sqlite3.Row) -> dict:
        result = dict(row)
        result["images"] = json.loads(result["images"])
        result["active"] = bool(result["active"])
        result["currency"] = "PHP"
        result["product_rating"] = result.get("product_rating")
        result["product_rating_count"] = result.get("product_rating_count", 0)
        return result

    @staticmethod
    def int_value(value: object, label: str) -> int:
        try:
            parsed = int(value)
            if parsed <= 0:
                raise ValueError
            return parsed
        except (TypeError, ValueError):
            raise APIError(400, f"Enter a valid {label} ID or quantity.") from None

    def int_path(self, value: str) -> int:
        return self.int_value(unquote(value), "product")

    def serve_static(self, url_path: str) -> None:
        relative = unquote(url_path).lstrip("/")
        target = (PUBLIC / relative).resolve() if relative else PUBLIC / "index.html"
        if not target.is_relative_to(PUBLIC.resolve()) or not target.is_file():
            target = PUBLIC / "index.html"
        content = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8" if mime.startswith(("text/", "application/javascript")) else mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(content)


if __name__ == "__main__":
    initialize()
    port = int(os.environ.get("PORT", "8000"))
    print(f"AesthEra is running at http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), MarketplaceHandler).serve_forever()
