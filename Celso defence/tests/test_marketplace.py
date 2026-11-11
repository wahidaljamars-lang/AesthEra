import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import server


class MarketplaceFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.original_database = server.DATABASE
        cls.original_uploads = server.UPLOADS
        server.DATABASE = Path(cls.tempdir.name) / "marketplace.db"
        server.UPLOADS = Path(cls.tempdir.name) / "uploads"
        server.initialize()
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.MarketplaceHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=3)
        server.DATABASE = cls.original_database
        server.UPLOADS = cls.original_uploads
        cls.tempdir.cleanup()

    def setUp(self):
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, path, method="GET", body=None, expected=200):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            self.base_url + path, data=data, method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            response = self.client.open(req)
        except urllib.error.HTTPError as error:
            response = error
        payload = response.read().decode()
        response.close()
        self.assertEqual(response.status, expected, payload)
        return json.loads(payload)

    def login(self, role="buyer"):
        email = "buyer@closet.test" if role == "buyer" else "seller@closet.test"
        self.request("/api/auth/login", "POST", {"email": email, "password": "closet123", "role": role})

    def test_seeded_products_use_requested_peso_prices(self):
        products = self.request("/api/products")["products"]
        expected_names = {
            "Cherry Baby Tee", "Petal Knit Cardigan", "Sunday Market Denim",
            "Rosewater Ribbon Blouse", "After Hours Bomber", "Cloud Nine Mini Skirt",
            "Daisy Daydream Dress", "Weekend Denim Jacket", "Buttercream Knit Top",
            "Everyday Cargo Trousers",
        }
        with server.connect() as db:
            seeded_names = {
                row["name"] for row in db.execute(
                    """SELECT name FROM products
                       WHERE seller_id=(SELECT id FROM users WHERE email='seller@closet.test')"""
                )
            }
        self.assertLessEqual(expected_names, seeded_names)
        expected = {
            "Cherry Baby Tee": (180, "Y2K", "Pre-loved", "S"),
            "Petal Knit Cardigan": (450, "Kawaii", "New", "M"),
            "Sunday Market Denim": (350, "Vintage", "Pre-loved", "M"),
            "Rosewater Ribbon Blouse": (320, "Coquette", "New", "S"),
        }
        for product in products:
            if product["name"] in expected:
                price, style, condition, size = expected[product["name"]]
                self.assertEqual(product["price"], price)
                self.assertEqual(product["currency"], "PHP")
                self.assertEqual((product["style"], product["condition"], product["size"]), (style, condition, size))

    def test_app_seeded_product_can_be_purchased_on_server(self):
        self.login("buyer")
        product = next(
            product for product in self.request("/api/products")["products"]
            if product["name"] == "Everyday Cargo Trousers"
        )
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        order = self.request("/api/orders")["orders"][0]
        self.assertEqual(order["items"][0]["product_name"], product["name"])
        self.assertEqual(order["items"][0]["price"], product["price"])

    def test_registration_is_role_specific_and_login_redirect_data_is_correct(self):
        registered = self.request("/api/auth/register", "POST", {
            "name": "New Seller", "phone": "555-0102", "email": "new-seller@example.test",
            "password": "strong-pass-123", "address": "4 Market Street", "role": "seller",
        })
        self.assertEqual(self.request("/api/session")["user"]["role"], "seller")
        self.assertEqual(registered["user"]["bio"], "")
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {
            "email": "seller@closet.test", "password": "closet123", "role": "buyer",
        }, expected=401)

    def test_sellers_cannot_edit_or_remove_another_sellers_product(self):
        self.login("seller")
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/register", "POST", {
            "name": "Second Seller", "phone": "555-0104", "email": "second-seller@example.test",
            "password": "strong-pass-123", "address": "5 Market Street", "role": "seller",
        })
        product = self.request("/api/seller/products", "POST", {
            "name": "Second Seller Piece", "description": "Owned by another seller.",
            "price": "25", "size": "M", "condition": "New", "style": "Vintage", "stock": "1",
        }, expected=201)["productId"]
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        self.request(
            f"/api/seller/products/{product}", "PUT",
            {"name": "Hijacked listing"}, expected=404,
        )
        self.request(f"/api/seller/products/{product}", "DELETE", expected=404)
        listing = self.request(f"/api/products/{product}")["product"]
        self.assertNotEqual(listing["name"], "Hijacked listing")

    def test_buyer_cart_checkout_and_seller_order_management(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        buyer_order = self.request("/api/orders")["orders"][0]
        self.assertEqual(len(buyer_order["items"]), 1)
        self.assertEqual(buyer_order["items"][0]["product_name"], product["name"])
        self.assertEqual(buyer_order["items"][0]["quantity"], 1)
        self.assertEqual(buyer_order["items"][0]["price"], product["price"])
        self.assertEqual(buyer_order["status"], "Pending")
        self.assertEqual(buyer_order["payment_status"], "Pending")
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        seller_orders = self.request("/api/orders")["orders"]
        self.assertEqual(seller_orders[0]["id"], buyer_order["id"])
        self.request("/api/seller/orders/status", "POST", {
            "orderId": buyer_order["id"], "status": "Completed",
        })
        self.request("/api/seller/orders/status", "POST", {
            "orderId": buyer_order["id"] + 9999, "status": "Shipped",
        }, expected=404)
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        finished = self.request("/api/orders")["orders"][0]
        self.assertEqual(finished["status"], "Completed")
        self.assertEqual(finished["payment_status"], "Paid")
        self.request("/api/orders/cancel", "POST", {"orderId": buyer_order["id"]}, expected=409)

    def test_ewallet_demo_options_are_recorded_without_processing_payment(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        for method in ("GCash (demo)", "Maya (demo)"):
            self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
            self.request("/api/orders", "POST", {
                "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
                "paymentMethod": method,
            }, expected=201)
            order = self.request("/api/orders")["orders"][0]
            self.assertEqual(order["payment_method"], method)
            self.assertEqual(order["payment_status"], "Awaiting payment")

    def test_completed_order_products_can_be_rated_once_and_show_product_average(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        another_product = self.request("/api/products")["products"][1]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        order = self.request("/api/orders")["orders"][0]
        order_id = order["id"]
        self.request("/api/ratings", "POST", {
            "orderId": order_id, "productId": product["id"], "rating": 5,
        }, expected=409)

        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        self.request("/api/seller/orders/status", "POST", {"orderId": order_id, "status": "Completed"})
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        self.request("/api/ratings", "POST", {
            "orderId": order_id, "productId": another_product["id"], "rating": 5,
        }, expected=409)
        self.request("/api/ratings", "POST", {
            "orderId": order_id, "productId": product["id"], "rating": 5,
            "comment": "Fits perfectly and feels lovely.",
        }, expected=200)
        buyer_order = self.request("/api/orders")["orders"][0]
        self.assertEqual(buyer_order["items"][0]["buyer_rating"], 5)
        self.assertEqual(buyer_order["items"][0]["buyer_comment"], "Fits perfectly and feels lovely.")
        reviews = self.request(f"/api/products/{product['id']}/reviews")["reviews"]
        self.assertEqual(reviews[0]["comment"], "Fits perfectly and feels lovely.")
        updated_product = self.request(f"/api/products/{product['id']}")["product"]
        self.assertEqual(updated_product["product_rating"], 5)
        self.assertEqual(updated_product["product_rating_count"], 1)
        self.request("/api/ratings", "POST", {
            "orderId": order_id, "productId": product["id"], "rating": 3,
            "comment": "Changed my mind after wearing it.",
        }, expected=200)
        updated_order = self.request("/api/orders")["orders"][0]
        self.assertEqual(updated_order["items"][0]["buyer_rating"], 3)
        self.assertEqual(updated_order["items"][0]["buyer_comment"], "Changed my mind after wearing it.")

    def test_profiles_are_limited_and_product_messages_are_private_to_participants(self):
        seller = self.request("/api/profiles/1")["profile"]
        self.assertEqual(seller["role"], "seller")
        self.assertEqual(set(seller), {"id", "name", "role", "avatar", "bio"})

        buyer = self.request("/api/auth/register", "POST", {
            "name": "Private Message Buyer", "phone": "555-0199",
            "email": "private-message-buyer@example.test", "password": "strong-pass-123",
            "address": "Private Buyer Address", "role": "buyer",
        })["user"]
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        self.request(f"/api/profiles/{buyer['id']}", expected=404)
        self.request("/api/auth/logout", "POST", {})

        self.request("/api/auth/login", "POST", {
            "email": "private-message-buyer@example.test", "password": "strong-pass-123", "role": "buyer",
        })
        product = self.request("/api/products")["products"][0]
        result = self.request("/api/messages", "POST", {
            "productId": product["id"], "message": "Is this still available?",
        }, expected=201)
        buyer_threads = self.request("/api/messages")["threads"]
        self.assertEqual(len(buyer_threads), 1)
        self.assertEqual(buyer_threads[0]["id"], result["threadId"])
        self.assertEqual(buyer_threads[0]["messages"][0]["body"], "Is this still available?")
        self.request("/api/auth/logout", "POST", {})

        self.login("seller")
        thread = self.request("/api/messages")["threads"][0]
        self.assertEqual(thread["counterpart_name"], "Private Message Buyer")
        buyer_profile = self.request(f"/api/profiles/{buyer['id']}")["profile"]
        self.assertEqual(buyer_profile["name"], "Private Message Buyer")
        self.assertEqual(set(buyer_profile), {"id", "name", "role", "avatar", "bio"})
        self.request("/api/messages", "POST", {
            "threadId": result["threadId"], "message": "Yes, it is available.",
        }, expected=201)
        self.request("/api/auth/logout", "POST", {})

        self.request("/api/auth/login", "POST", {
            "email": "private-message-buyer@example.test", "password": "strong-pass-123", "role": "buyer",
        })
        conversation = self.request("/api/messages")["threads"][0]
        self.assertEqual([message["body"] for message in conversation["messages"]], [
            "Is this still available?", "Yes, it is available.",
        ])

    def test_orders_include_a_one_week_delivery_estimate(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        order = self.request("/api/orders")["orders"][0]
        self.assertEqual(order["estimated_delivery_at"], order["created_at"] + 7 * 24 * 60 * 60)
        self.assertEqual(order["seller_name"], "Mia's Vintage Closet")

    def test_seller_dashboard_counts_revenue_and_all_product_ratings(self):
        seller_email = "dashboard-seller@example.test"
        self.request("/api/auth/register", "POST", {
            "name": "Dashboard Seller", "phone": "555-0110", "email": seller_email,
            "password": "strong-pass-123", "address": "10 Market Street", "role": "seller",
        })
        product_id = self.request("/api/seller/products", "POST", {
            "name": "Dashboard Test Piece", "description": "A test product for seller metrics.",
            "price": "80", "size": "M", "condition": "New", "style": "Vintage", "stock": "1",
        }, expected=201)["productId"]
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        self.request("/api/cart", "POST", {"productId": product_id, "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        order_id = self.request("/api/orders")["orders"][0]["id"]
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {
            "email": seller_email, "password": "strong-pass-123", "role": "seller",
        })
        self.request("/api/seller/orders/status", "POST", {"orderId": order_id, "status": "Completed"})
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        self.request("/api/ratings", "POST", {
            "orderId": order_id, "productId": product_id, "rating": 4,
        }, expected=200)
        self.request("/api/auth/logout", "POST", {})
        self.request("/api/auth/login", "POST", {
            "email": seller_email, "password": "strong-pass-123", "role": "seller",
        })
        summary = self.request("/api/seller/summary")
        self.assertEqual(summary["products"], {"total": 1, "available": 0})
        self.assertEqual(summary["orders"]["total"], 1)
        self.assertEqual(summary["orders"]["pending"], 0)
        self.assertEqual(summary["orders"]["completed"], 1)
        self.assertEqual(summary["orders"]["sales"], 80)
        self.assertEqual(summary["rating"], {"average": 4.0, "count": 1})

    def test_profile_photo_can_be_saved_and_removed(self):
        self.login("buyer")
        photo = "data:image/png;base64,aGVsbG8="
        profile = self.request("/api/profile", "PUT", {
            "name": "Alex Morgan", "phone": "555-0101", "email": "buyer@closet.test",
            "address": "Brooklyn, NY", "avatar": photo, "bio": "I love finding a great vintage piece.",
        })["user"]
        self.assertEqual(profile["avatar"], photo)
        self.assertEqual(profile["bio"], "I love finding a great vintage piece.")
        cleared = self.request("/api/profile", "PUT", {
            "name": "Alex Morgan", "phone": "555-0101", "email": "buyer@closet.test",
            "address": "Brooklyn, NY", "avatar": None, "bio": "I love finding a great vintage piece.",
        })["user"]
        self.assertIsNone(cleared["avatar"])
        self.assertEqual(cleared["bio"], "I love finding a great vintage piece.")
        self.request("/api/profile", "PUT", {
            "name": "Alex Morgan", "phone": "555-0101", "email": "buyer@closet.test",
            "address": "Brooklyn, NY", "avatar": "data:text/html;base64,aGVsbG8=",
            "bio": "I love finding a great vintage piece.",
        }, expected=400)
        self.request("/api/profile", "PUT", {
            "name": "Alex Morgan", "phone": "555-0101", "email": "buyer@closet.test",
            "address": "Brooklyn, NY", "bio": "a" * 501,
        }, expected=400)
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        seller = self.request("/api/profile", "PUT", {
            "name": "Mia's Vintage Closet", "phone": "+1 555 0100", "email": "seller@closet.test",
            "address": "Brooklyn, New York", "bio": "Curated vintage and one-of-a-kind finds.",
        })["user"]
        self.assertEqual(seller["bio"], "Curated vintage and one-of-a-kind finds.")

    def test_completed_ewallet_demo_order_stays_unpaid(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Maya (demo)",
        }, expected=201)
        order_id = self.request("/api/orders")["orders"][0]["id"]
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        self.request("/api/seller/orders/status", "POST", {"orderId": order_id, "status": "Completed"})
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        order = self.request("/api/orders")["orders"][0]
        self.assertEqual(order["status"], "Completed")
        self.assertEqual(order["payment_status"], "Awaiting payment")

    def test_order_cancellation_is_limited_to_24_hours_and_restores_stock(self):
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        with server.connect() as db:
            initial_stock = db.execute(
                "SELECT stock FROM products WHERE id=?", (product["id"],)
            ).fetchone()["stock"]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        cancellable = self.request("/api/orders")["orders"][0]
        self.request(f"/api/orders/{cancellable['id']}", "DELETE", expected=409)
        self.request("/api/orders/cancel", "POST", {"orderId": cancellable["id"]})
        cancelled = self.request("/api/orders")["orders"][0]
        self.assertEqual(cancelled["status"], "Cancelled")
        self.assertEqual(cancelled["payment_status"], "Cancelled")
        with server.connect() as db:
            restored_stock = db.execute(
                "SELECT stock FROM products WHERE id=?", (product["id"],)
            ).fetchone()["stock"]
        self.assertEqual(restored_stock, initial_stock)
        self.request(f"/api/orders/{cancellable['id']}", "DELETE")
        remaining_orders = self.request("/api/orders")["orders"]
        self.assertNotIn(cancellable["id"], [order["id"] for order in remaining_orders])

        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Alex Morgan", "phone": "555-0101", "address": "Brooklyn, NY",
            "paymentMethod": "Cash on delivery",
        }, expected=201)
        expired = self.request("/api/orders")["orders"][0]
        with server.connect() as db:
            db.execute(
                "UPDATE orders SET created_at=? WHERE id=?",
                (int(server.time.time()) - 24 * 60 * 60 - 1, expired["id"]),
            )
        self.request("/api/orders/cancel", "POST", {"orderId": expired["id"]}, expected=409)
        pending = next(
            order for order in self.request("/api/orders")["orders"]
            if order["id"] == expired["id"]
        )
        self.assertEqual(pending["status"], "Pending")
        self.request("/api/auth/logout", "POST", {})
        self.login("seller")
        self.request("/api/orders/cancel", "POST", {"orderId": expired["id"]}, expected=403)

    def test_public_filters_and_product_validation(self):
        products = self.request("/api/products?style=Vintage")["products"]
        self.assertTrue(products)
        self.assertTrue(all(product["style"] == "Vintage" for product in products))
        self.login("seller")
        self.request("/api/seller/products", "POST", {
            "name": "Invalid", "description": "Bad category", "price": "10",
            "size": "M", "condition": "New", "style": "Unknown", "stock": "1",
        }, expected=400)
        tiny_png = "data:image/png;base64,iVBORw0KGgo="
        created = self.request("/api/seller/products", "POST", {
            "name": "Photo-ready piece", "description": "A listing with two locally stored photos.",
            "price": "10.567", "currency": "USD", "size": "M", "condition": "New", "style": "Vintage", "stock": "1",
            "images": [
                {"filename": "front.png", "data": tiny_png},
                {"filename": "detail.png", "data": tiny_png},
            ],
        }, expected=201)
        listing = next(
            item for item in self.request("/api/seller/products")["products"]
            if item["id"] == created["productId"]
        )
        self.assertEqual(len(listing["images"]), 2)
        self.assertEqual(listing["price"], 10.57)
        self.assertEqual(listing["currency"], "PHP")
        self.assertTrue(all((server.UPLOADS / Path(path).name).is_file() for path in listing["images"]))

    def test_currency_preference_is_removed_and_marketplace_uses_php(self):
        self.request("/api/auth/register", "POST", {
            "name": "Euro Buyer", "phone": "555-0103", "email": "euro-buyer@example.test",
            "password": "strong-pass-123", "address": "Paris, FR", "role": "buyer", "currency": "EUR",
        })
        current = self.request("/api/session")["user"]
        self.assertNotIn("currency", current)
        with server.connect() as db:
            currency = db.execute(
                "SELECT currency FROM users WHERE email='euro-buyer@example.test'"
            ).fetchone()["currency"]
        self.assertEqual(currency, "PHP")
        self.request("/api/auth/logout", "POST", {})
        self.login("buyer")
        product = self.request("/api/products")["products"][0]
        self.request("/api/cart", "POST", {"productId": product["id"], "quantity": 1})
        self.request("/api/orders", "POST", {
            "fullName": "Euro Buyer", "phone": "555-0103", "address": "Paris, FR",
            "paymentMethod": "Cash on delivery", "currency": "EUR",
        }, expected=201)
        newest = self.request("/api/orders")["orders"][0]
        self.assertEqual(newest["currency"], "PHP")


if __name__ == "__main__":
    unittest.main()
