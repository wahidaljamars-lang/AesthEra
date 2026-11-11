# AesthEra

A style-first clothing marketplace with separate buyer and seller accounts, a
responsive storefront, locally stored product photos, and a SQLite backend.
It uses only the Python standard library and runs on Python 3.11+.

## Open the standalone page

Open `public/index.html` directly in a modern browser (for example, double-click
it in Windows Explorer). This is a browser-only demo: accounts, listings, photos,
carts, and orders are saved in that browser's local storage and are not shared
with the SQLite database or other devices. Browser-only sign-in is for demo use
and is not secure storage for real credentials or customer data. Clearing the
browser's site data resets the standalone demo.

## Run locally

To use the SQLite-backed version instead:

```powershell
python server.py
```

Open [http://localhost:8000](http://localhost:8000). The SQLite database is
created as `marketplace.db` on first launch, and uploaded product images are
stored under `public/uploads/`.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Buyer | `buyer@closet.test` | `closet123` |
| Seller | `seller@closet.test` | `closet123` |

Ten starter listings are created for the demo seller on first launch. If the
demo seller already exists, startup adds any missing starter listings without
replacing existing products. Remove the database file while the server is
stopped to reset the local demo data.
The standalone page and server-backed version keep separate data.

## Included flows

- Buyer and seller registration, role-specific sign-in with a show/hide password control, persistent secure sessions, profile editing, and optional JPG, PNG, WEBP, or GIF profile photos up to 2 MB.
- Style-led product discovery, search, size/condition/price filters, product details, and multi-image listings. Prices are listed in Philippine pesos (₱) with two decimal places, and sellers set each listing's price.
- Product cards show the seller's name and each product's average rating. Buyers can view order details and rate each purchased product with a comment from "My orders" after an order is completed; reviews can also be edited from the product detail view, where comments are shown.
- Buyer and seller profile previews show only a member's name, profile photo, and bio. Sellers can view buyer profiles only when they have an order or conversation together; private contact and delivery details are not part of the profile preview.
- Buyers can privately message a seller about a product. Both people can continue the conversation from their Messages inbox.
- Orders show an estimated delivery date about one week after placement. Order numbers are not shown in the buyer or seller views.
- Seller-owned product creation, editing, stock management, and removal.
- Seller dashboards report active listings, in-stock listings, order statuses, completed-order revenue, and an overall rating averaged across the seller's product reviews. Buyer and seller profiles both support an editable bio up to 500 characters.
- Buyer cart, quantity updates, checkout, per-seller order records, payment status tracking, and pending-order cancellation within 24 hours.
- Seller order status management and dashboard summaries.
- Checkout offers cash on delivery, GCash, and Maya. GCash/Maya are demo selections only: no wallet connection or transfer is made, and those orders remain marked awaiting payment. Buyers arrange delivery directly with the seller.

This project is a local demo and does not integrate a payment processor or transactional shipping service.
