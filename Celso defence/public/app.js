const styles = ["Y2K", "Kawaii", "Vintage", "Coquette", "Streetwear"];
const state = {
  user: null, products: [], cart: [], orders: [], sellerProducts: [], summary: null,
  messages: [], selectedThreadId: null,
  page: "home", style: "", search: "", filters: { size: "", condition: "", min: "", max: "" },
  authMode: "login", authRole: "buyer", sellerTab: "products", editingProduct: null,
  toastTimer: null, filterTimer: null,
};
const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modal-root");
const money = amount => `₱${new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(amount || 0))}`;
const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const imageOf = product => product.images?.[0] || "";
const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 700'%3E%3Crect width='100%25' height='100%25' fill='%23eee9e3'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23a49b92' font-family='serif' font-size='24'%3EAesthEra%3C/text%3E%3C/svg%3E";

const STORAGE_KEY = "aesthera-standalone-v1";
const seededProducts = [
  ["Cherry Baby Tee", "A playful cherry-print baby tee with a soft stretch fit.", 180, "S", "Pre-loved", "Y2K", "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=85", 4],
  ["Petal Knit Cardigan", "A cloud-soft cardigan with delicate pearl buttons.", 450, "M", "New", "Kawaii", "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=85", 3],
  ["Sunday Market Denim", "Broken-in straight leg denim, ready for a second life.", 350, "M", "Pre-loved", "Vintage", "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=85", 2],
  ["Rosewater Ribbon Blouse", "Romantic chiffon, a tie neckline, and softly gathered sleeves.", 320, "S", "New", "Coquette", "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85", 3],
  ["After Hours Bomber", "An oversized satin bomber with a little downtown energy.", 2799, "L", "Pre-loved", "Streetwear", "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=900&q=85", 1],
  ["Cloud Nine Mini Skirt", "A swishy pleated mini for your favorite going-out look.", 1299, "S", "New", "Y2K", "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=85", 2],
  ["Daisy Daydream Dress", "A breezy floral dress with a softly gathered waist.", 680, "XS", "New", "Coquette", "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=85", 2],
  ["Weekend Denim Jacket", "An easy, relaxed denim layer with plenty of life left.", 790, "XL", "Pre-loved", "Vintage", "https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=900&q=85", 1],
  ["Buttercream Knit Top", "A soft neutral knit that pairs with just about anything.", 390, "One size", "New", "Kawaii", "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85", 3],
  ["Everyday Cargo Trousers", "Comfy utility trousers with a relaxed streetwear fit.", 560, "L", "Pre-loved", "Streetwear", "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=85", 2],
];
function seedProduct([name, description, price, size, condition, style, image, stock], id, createdAt) {
  return { id, seller_id: 1, seller_name: "Mia's Vintage Closet", name, description, price,
    currency: "PHP", size, condition, style, images: [image], stock, active: true, created_at: createdAt };
}
function newStore() {
  const now = Math.floor(Date.now() / 1000);
  return {
    users: [
      { id: 1, name: "Mia's Vintage Closet", phone: "+1 555 0100", email: "seller@closet.test", password: "closet123", address: "Brooklyn, New York", role: "seller", avatar: null, bio: "" },
      { id: 2, name: "Alex Morgan", phone: "+1 555 0101", email: "buyer@closet.test", password: "closet123", address: "Brooklyn, New York", role: "buyer", avatar: null, bio: "" },
    ],
    products: seededProducts.map((item, index) => seedProduct(item, index + 1, now)),
    carts: {}, orders: [], productRatings: [], threads: [], messages: [],
    sessionUserId: null, nextUserId: 3, nextProductId: seededProducts.length + 1, nextOrderId: 1, nextThreadId: 1, nextMessageId: 1,
  };
}
let browserStore;
function getStore() {
  if (browserStore) return browserStore;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { browserStore = JSON.parse(saved); }
    catch { throw new Error("Saved marketplace data could not be read. Clear this page's browser storage to reset it."); }
    browserStore.products ||= [];
    browserStore.productRatings ||= [];
    browserStore.threads ||= [];
    browserStore.messages ||= [];
    for (const user of browserStore.users) {
      user.avatar ??= null;
      user.bio ??= "";
    }
    let nextId = Math.max(browserStore.nextProductId || 1, ...browserStore.products.map(product => product.id + 1));
    for (let index = 0; index < seededProducts.length; index += 1) {
      if (!browserStore.products.some(product => product.name === seededProducts[index][0])) {
        browserStore.products.push(seedProduct(seededProducts[index], nextId++, Math.floor(Date.now() / 1000)));
      }
    }
    browserStore.nextProductId = nextId;
    browserStore.nextThreadId ||= Math.max(1, ...browserStore.threads.map(thread => thread.id + 1));
    browserStore.nextMessageId ||= Math.max(1, ...browserStore.messages.map(message => message.id + 1));
  } else {
    browserStore = newStore();
    saveStore();
  }
  return browserStore;
}
function saveStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(browserStore)); }
  catch (error) {
    if (error?.name === "QuotaExceededError") throw new Error("Browser storage is full. Remove some product photos or clear this page's saved data.");
    throw new Error("The browser could not save marketplace data. Check this page's storage permissions.");
  }
}
function apiError(message) { throw new Error(message); }
function publicUser(user) {
  return user && Object.fromEntries(["id", "name", "phone", "email", "address", "role", "avatar", "bio"].map(key => [key, user[key] ?? null]));
}
function signedIn(store, role) {
  const user = store.users.find(item => item.id === store.sessionUserId);
  if (!user) apiError("Please sign in to continue.");
  if (role && user.role !== role) apiError(`This action is only available to ${role}s.`);
  return user;
}
function productJson(store, product) {
  const seller = store.users.find(user => user.id === product.seller_id);
  const ratings = (store.productRatings || []).filter(rating => rating.product_id === product.id);
  const productRating = ratings.length ? ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length : null;
  return { ...product, seller_name: seller?.name || product.seller_name, product_rating: productRating,
    product_rating_count: ratings.length, currency: "PHP" };
}
function parseBody(options) {
  if (!options.body) return {};
  try { return JSON.parse(options.body); }
  catch { apiError("Request body must be valid JSON."); }
}
async function api(path, options = {}) {
  if (location.protocol !== "file:") {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    return result;
  }
  const store = getStore();
  const url = new URL(path, location.href);
  const route = location.protocol === "file:" ? url.pathname.replace(/^\/[A-Za-z]:/, "") || "/" : url.pathname;
  const method = options.method || "GET";
  const data = parseBody(options);
  const products = store.products;
  const activeProducts = products.filter(product => product.active);
  const save = result => { saveStore(); return result; };

  if (method === "GET" && route === "/api/session") {
    return { user: publicUser(store.users.find(user => user.id === store.sessionUserId)) };
  }
  if (method === "GET" && /^\/api\/profiles\/\d+$/.test(route)) {
    const userId = Number(route.split("/").pop());
    const profile = store.users.find(user => user.id === userId);
    if (!profile) apiError("That profile was not found.");
    if (profile.role === "buyer") {
      const viewer = signedIn(store, "seller");
      const related = store.orders.some(order => order.buyer_id === profile.id && order.seller_id === viewer.id) ||
        store.threads.some(thread => thread.buyer_id === profile.id && thread.seller_id === viewer.id);
      if (!related) apiError("That profile was not found.");
    }
    return { profile: { id: profile.id, name: profile.name, role: profile.role, avatar: profile.avatar || null, bio: profile.bio || "" } };
  }
  if (method === "GET" && route === "/api/products") {
    const params = url.searchParams;
    let rows = activeProducts.filter(product => product.stock > 0);
    for (const [key, field] of [["style", "style"], ["size", "size"], ["condition", "condition"]]) {
      if (params.get(key)) rows = rows.filter(product => product[field] === params.get(key));
    }
    const term = (params.get("q") || "").trim().toLowerCase();
    if (term) rows = rows.filter(product => `${product.name} ${product.description}`.toLowerCase().includes(term));
    const min = params.get("min") ? Number(params.get("min")) : null;
    const max = params.get("max") ? Number(params.get("max")) : null;
    if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))) {
      apiError("Enter a valid non-negative price range.");
    }
    if (min !== null && max !== null && min > max) apiError("Minimum price cannot be greater than maximum price.");
    if (min !== null) rows = rows.filter(product => product.price >= min);
    if (max !== null) rows = rows.filter(product => product.price <= max);
    return { products: rows.sort((a, b) => b.created_at - a.created_at).map(product => productJson(store, product)) };
  }
  if (method === "GET" && /^\/api\/products\/\d+\/reviews$/.test(route)) {
    const productId = Number(route.split("/")[3]);
    return { reviews: (store.productRatings || []).filter(review => review.product_id === productId && review.comment)
      .sort((a, b) => b.created_at - a.created_at).slice(0, 50) };
  }
  if (method === "GET" && route === "/api/cart") {
    const user = signedIn(store, "buyer");
    const items = (store.carts[user.id] || []).flatMap(entry => {
      const product = activeProducts.find(item => item.id === entry.productId);
      return product ? [{ ...productJson(store, product), quantity: entry.quantity }] : [];
    });
    return { items };
  }
  if (method === "GET" && route === "/api/orders") {
    const user = signedIn(store);
    const orders = store.orders.filter(order => user.role === "buyer" ? order.buyer_id === user.id : order.seller_id === user.id);
    return { orders: orders.slice().sort((a, b) => b.created_at - a.created_at).map(order => ({
      ...order, buyer_name: store.users.find(item => item.id === order.buyer_id)?.name || "",
      seller_name: store.users.find(item => item.id === order.seller_id)?.name || "",
      estimated_delivery_at: order.created_at + 7 * 24 * 60 * 60,
      items: order.items.map(item => ({ ...item, buyer_rating: (store.productRatings || []).find(
        rating => rating.product_id === item.product_id && rating.buyer_id === user.id,
      )?.rating ?? null, buyer_comment: (store.productRatings || []).find(
        rating => rating.product_id === item.product_id && rating.buyer_id === user.id,
      )?.comment ?? "" })),
    })) };
  }
  if (method === "GET" && route === "/api/messages") {
    const user = signedIn(store);
    const threads = store.threads.filter(thread => thread.buyer_id === user.id || thread.seller_id === user.id)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(thread => {
        const buyer = store.users.find(item => item.id === thread.buyer_id);
        const seller = store.users.find(item => item.id === thread.seller_id);
        const product = products.find(item => item.id === thread.product_id);
        return { ...thread, product_name: product?.name || "Unavailable product",
          buyer_name: buyer?.name || "", seller_name: seller?.name || "",
          counterpart_id: user.role === "buyer" ? thread.seller_id : thread.buyer_id,
          counterpart_name: user.role === "buyer" ? seller?.name || "" : buyer?.name || "",
          messages: store.messages.filter(message => message.thread_id === thread.id)
            .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
            .map(message => ({ ...message, sender_name: store.users.find(item => item.id === message.sender_id)?.name || "" })),
        };
      });
    return { threads };
  }
  if (method === "GET" && route === "/api/seller/summary") {
    const user = signedIn(store, "seller");
    const allOwnProducts = products.filter(product => product.seller_id === user.id);
    const listedProducts = allOwnProducts.filter(product => product.active);
    const orders = store.orders.filter(order => order.seller_id === user.id);
    const ratings = (store.productRatings || []).filter(rating => allOwnProducts.some(product => product.id === rating.product_id));
    return { products: { total: listedProducts.length, available: listedProducts.filter(product => product.stock > 0).length },
      orders: { total: orders.length, pending: orders.filter(order => order.status === "Pending").length,
        completed: orders.filter(order => order.status === "Completed").length,
        sales: orders.filter(order => order.status === "Completed").reduce((sum, order) => sum + order.total, 0) },
      rating: { average: ratings.length ? ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length : null, count: ratings.length } };
  }
  if (method === "GET" && route === "/api/seller/products") {
    const user = signedIn(store, "seller");
    return { products: products.filter(product => product.seller_id === user.id).sort((a, b) => b.created_at - a.created_at).map(product => productJson(store, product)) };
  }
  if (method === "GET" && route.startsWith("/api/products/")) {
    const id = Number(route.split("/").pop());
    const product = activeProducts.find(item => item.id === id);
    if (!product) apiError("This piece is no longer available.");
    return { product: productJson(store, product) };
  }
  if (method === "POST" && route === "/api/auth/register") {
    const name = String(data.name || "").trim(), phone = String(data.phone || "").trim();
    const email = String(data.email || "").trim().toLowerCase(), address = String(data.address || "").trim();
    const password = String(data.password || "");
    if (!["buyer", "seller"].includes(data.role)) apiError("Choose a buyer or seller account.");
    if (!name || !phone || !email || !password || !address) apiError("Please complete every field.");
    if (name.length > 100 || phone.length > 40 || email.length > 254 || address.length > 500 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) apiError("Enter valid contact and address details.");
    if (password.length < 8 || password.length > 256) apiError("Your password must be between 8 and 256 characters.");
    if (store.users.some(user => user.email.toLowerCase() === email)) apiError("An account with that email already exists.");
    const user = { id: store.nextUserId++, name, phone, email, password, address, role: data.role, avatar: null, bio: "" };
    store.users.push(user); store.sessionUserId = user.id;
    return save({ user: publicUser(user) });
  }
  if (method === "POST" && route === "/api/auth/login") {
    const user = store.users.find(item => item.email.toLowerCase() === String(data.email || "").trim().toLowerCase());
    if (!["buyer", "seller"].includes(data.role) || !data.email || !data.password) apiError("Enter your email, password, and account type.");
    if (!user || user.role !== data.role || user.password !== data.password) apiError(`Those details don't match a ${data.role} account.`);
    store.sessionUserId = user.id;
    return save({ user: publicUser(user) });
  }
  if (method === "POST" && route === "/api/auth/logout") {
    store.sessionUserId = null;
    return save({ ok: true });
  }
  if (method === "POST" && route === "/api/cart") {
    const user = signedIn(store, "buyer");
    const productId = Number(data.productId), quantity = Number(data.quantity ?? 1);
    const product = activeProducts.find(item => item.id === productId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) apiError("Choose a quantity between 1 and 100.");
    if (!product || product.stock < 1) apiError("This piece is no longer available.");
    const cart = store.carts[user.id] ||= [];
    const entry = cart.find(item => item.productId === productId);
    const newQuantity = quantity + (entry?.quantity || 0);
    if (newQuantity > product.stock) apiError(`Only ${product.stock} available right now.`);
    if (entry) entry.quantity = newQuantity;
    else cart.push({ productId, quantity: newQuantity });
    return save({ ok: true });
  }
  if (method === "POST" && route === "/api/ratings") {
    const buyer = signedIn(store, "buyer"), orderId = Number(data.orderId), productId = Number(data.productId), rating = Number(data.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) apiError("Choose a rating from 1 to 5 stars.");
    if (data.comment !== undefined && typeof data.comment !== "string") apiError("Enter a valid product comment.");
    const previousRating = (store.productRatings || []).find(item => item.buyer_id === buyer.id && item.product_id === productId);
    const comment = data.comment === undefined ? previousRating?.comment || "" : data.comment.trim();
    if (comment.length > 2000) apiError("Product comments must be 2,000 characters or fewer.");
    const order = store.orders.find(item => item.id === orderId && item.buyer_id === buyer.id);
    if (!order) apiError("That order was not found.");
    if (order.status !== "Completed") apiError("You can rate a product after the order is completed.");
    if (!order.items.some(item => item.product_id === productId)) apiError("That product was not part of this order.");
    if (previousRating) Object.assign(previousRating, { order_id: order.id, rating, comment, created_at: Math.floor(Date.now() / 1000) });
    else store.productRatings.push({ order_id: order.id, buyer_id: buyer.id, product_id: productId, rating, comment, created_at: Math.floor(Date.now() / 1000) });
    return save({ ok: true });
  }
  if (method === "POST" && route === "/api/messages") {
    const user = signedIn(store);
    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (!message || message.length > 2000) apiError("Messages must be between 1 and 2,000 characters.");
    let thread;
    if (data.threadId !== undefined) {
      const threadId = Number(data.threadId);
      thread = store.threads.find(item => item.id === threadId &&
        (item.buyer_id === user.id || item.seller_id === user.id));
      if (!thread) apiError("That conversation was not found.");
    } else {
      if (user.role !== "buyer") apiError("Start a product conversation from a buyer account.");
      const productId = Number(data.productId);
      const product = activeProducts.find(item => item.id === productId);
      if (!product) apiError("That product is no longer available.");
      if (product.seller_id === user.id) apiError("You cannot message yourself about your own listing.");
      thread = store.threads.find(item => item.product_id === product.id &&
        item.buyer_id === user.id && item.seller_id === product.seller_id);
      if (!thread) {
        const now = Math.floor(Date.now() / 1000);
        thread = { id: store.nextThreadId++, product_id: product.id, buyer_id: user.id,
          seller_id: product.seller_id, created_at: now, updated_at: now };
        store.threads.push(thread);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const created = { id: store.nextMessageId++, thread_id: thread.id, sender_id: user.id, body: message, created_at: now };
    store.messages.push(created);
    thread.updated_at = now;
    return save({ ok: true, threadId: thread.id });
  }
  if (method === "POST" && route === "/api/orders") {
    const buyer = signedIn(store, "buyer");
    const fullName = String(data.fullName || "").trim(), phone = String(data.phone || "").trim(), address = String(data.address || "").trim();
    const methodName = data.paymentMethod;
    if (!fullName || !phone || !address || !["Cash on delivery", "GCash (demo)", "Maya (demo)"].includes(methodName)) apiError("Complete your delivery details and choose a payment method.");
    const cart = (store.carts[buyer.id] || []).map(entry => ({ entry, product: activeProducts.find(item => item.id === entry.productId) })).filter(item => item.product);
    if (!cart.length) apiError("Your bag is empty.");
    for (const { entry, product } of cart) if (entry.quantity > product.stock) apiError(`${product.name} has only ${product.stock} left.`);
    const groups = new Map();
    for (const item of cart) {
      const group = groups.get(item.product.seller_id) || [];
      group.push(item); groups.set(item.product.seller_id, group);
    }
    const now = Math.floor(Date.now() / 1000), orderIds = [];
    for (const [sellerId, items] of groups) {
      const total = items.reduce((sum, item) => sum + item.product.price * item.entry.quantity, 0);
      const paymentStatus = methodName === "Cash on delivery" ? "Pending" : "Awaiting payment";
      const order = { id: store.nextOrderId++, buyer_id: buyer.id, seller_id: sellerId, full_name: fullName.slice(0, 100),
        phone: phone.slice(0, 40), address: address.slice(0, 500), currency: "PHP", status: "Pending", total, created_at: now,
        payment_method: methodName, payment_status: paymentStatus, transaction_ref: `CL-${Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
        items: items.map(({ entry, product }) => ({ product_id: product.id, product_name: product.name, size: product.size, price: product.price, quantity: entry.quantity })) };
      store.orders.push(order); orderIds.push(order.id);
      for (const { entry, product } of items) product.stock -= entry.quantity;
    }
    store.carts[buyer.id] = [];
    return save({ ok: true, orderIds });
  }
  if (method === "POST" && route === "/api/orders/cancel") {
    const buyer = signedIn(store, "buyer"), order = store.orders.find(item => item.id === Number(data.orderId) && item.buyer_id === buyer.id);
    if (!order) apiError("That order was not found.");
    if (order.status !== "Pending") apiError("Only pending orders can be cancelled.");
    if (Date.now() / 1000 > order.created_at + 24 * 60 * 60) apiError("The 24-hour cancellation period has expired.");
    order.status = "Cancelled"; order.payment_status = "Cancelled";
    for (const item of order.items) {
      const product = products.find(entry => entry.id === item.product_id && entry.active);
      if (product) product.stock += item.quantity;
    }
    return save({ ok: true });
  }
  if (method === "POST" && route === "/api/seller/products") {
    const seller = signedIn(store, "seller");
    const product = makeProduct(store, data, seller);
    products.push(product);
    return save({ ok: true, productId: product.id });
  }
  if (method === "POST" && route === "/api/seller/orders/status") {
    const seller = signedIn(store, "seller"), order = store.orders.find(item => item.id === Number(data.orderId) && item.seller_id === seller.id && item.status !== "Cancelled");
    if (!["Pending", "Confirmed", "Shipped", "Completed"].includes(data.status)) apiError("Choose a valid order status.");
    if (!order) apiError("That order was not found in your shop.");
    order.status = data.status;
    if (data.status === "Completed" && order.payment_method === "Cash on delivery") order.payment_status = "Paid";
    else if (["Confirmed", "Shipped"].includes(data.status) && order.payment_method === "Cash on delivery" && order.payment_status !== "Paid") order.payment_status = "Pending";
    return save({ ok: true });
  }
  if (method === "PUT" && route === "/api/profile") {
    const user = signedIn(store), name = String(data.name || "").trim(), phone = String(data.phone || "").trim();
    const email = String(data.email || "").trim().toLowerCase(), address = String(data.address || "").trim();
    const bio = String(data.bio || "").trim();
    if (!name || !phone || !address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) apiError("Enter a valid name, phone, email, and delivery address.");
    if (bio.length > 500) apiError("Your bio must be 500 characters or fewer.");
    if (bio.length > 500) apiError("Your bio must be 500 characters or fewer.");
    if (store.users.some(item => item.id !== user.id && item.email.toLowerCase() === email)) apiError("That email address is already in use.");
    const avatar = Object.hasOwn(data, "avatar") ? validateAvatar(data.avatar) : user.avatar || null;
    Object.assign(user, { name: name.slice(0, 100), phone: phone.slice(0, 40), email, address: address.slice(0, 500), avatar, bio });
    return save({ user: publicUser(user) });
  }
  if (method === "PUT" && route === "/api/cart") {
    const user = signedIn(store, "buyer"), productId = Number(data.productId), quantity = Number(data.quantity);
    const product = activeProducts.find(item => item.id === productId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) apiError("Choose a quantity between 1 and 100.");
    if (!product || quantity > product.stock) apiError("That quantity is no longer available.");
    const entry = (store.carts[user.id] || []).find(item => item.productId === productId);
    if (!entry) apiError("That item is not in your bag.");
    entry.quantity = quantity;
    return save({ ok: true });
  }
  if (method === "PUT" && route.startsWith("/api/seller/products/")) {
    const seller = signedIn(store, "seller"), id = Number(route.split("/").pop());
    const product = products.find(item => item.id === id && item.seller_id === seller.id);
    if (!product) apiError("That piece was not found in your shop.");
    Object.assign(product, makeProduct(store, data, seller, product));
    return save({ ok: true });
  }
  if (method === "DELETE" && route === "/api/cart") {
    const user = signedIn(store, "buyer"), id = Number(url.searchParams.get("productId"));
    store.carts[user.id] = (store.carts[user.id] || []).filter(item => item.productId !== id);
    return save({ ok: true });
  }
  if (method === "DELETE" && route.startsWith("/api/orders/")) {
    const buyer = signedIn(store, "buyer"), id = Number(route.split("/").pop());
    const orderIndex = store.orders.findIndex(item => item.id === id && item.buyer_id === buyer.id);
    if (orderIndex < 0) apiError("That order was not found.");
    if (store.orders[orderIndex].status !== "Cancelled") apiError("Only cancelled orders can be removed.");
    store.orders.splice(orderIndex, 1);
    return save({ ok: true });
  }
  if (method === "DELETE" && route.startsWith("/api/seller/products/")) {
    const seller = signedIn(store, "seller"), id = Number(route.split("/").pop());
    const product = products.find(item => item.id === id && item.seller_id === seller.id);
    if (!product) apiError("That piece was not found in your shop.");
    product.active = false; product.stock = 0;
    for (const cart of Object.values(store.carts)) {
      const index = cart.findIndex(item => item.productId === id);
      if (index >= 0) cart.splice(index, 1);
    }
    return save({ ok: true });
  }
  apiError("This marketplace action is not available.");
}
function makeProduct(store, data, seller, existing = null) {
  const required = ["name", "description", "size", "condition", "style"];
  const values = Object.fromEntries(required.map(key => [key, String(data[key] ?? existing?.[key] ?? "").trim()]));
  if (required.some(key => !values[key])) apiError("Please complete all product details.");
  const price = Number(data.price ?? existing?.price), stock = Number(data.stock ?? existing?.stock ?? 1);
  if (!Number.isFinite(price) || !Number.isInteger(stock) || price < 0 || price > 1_000_000 || stock < 0 || stock > 10_000) apiError("Price or quantity is outside the allowed range.");
  if (!["New", "Pre-loved"].includes(values.condition) || !styles.includes(values.style)) apiError("Choose a valid condition and fashion style.");
  const images = data.images ? data.images.map(image => image.data) : existing?.images || [];
  if (images.length > 6 || images.some(image => typeof image !== "string" || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image))) apiError("Choose up to 6 valid product images.");
  return { ...(existing || {}), id: existing?.id || store.nextProductId++, seller_id: seller.id, seller_name: seller.name,
    ...values, name: values.name.slice(0, 100), description: values.description.slice(0, 2000), size: values.size.slice(0, 30),
    price: Math.round(price * 100) / 100, currency: "PHP", images, stock, active: existing?.active ?? true,
    created_at: existing?.created_at || Math.floor(Date.now() / 1000) };
}
function validateAvatar(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") apiError("Choose a valid profile photo.");
  const match = value.match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) apiError("Profile photos must be JPG, PNG, WEBP, or GIF.");
  let bytes;
  try { bytes = atob(match[2]).length; }
  catch { apiError("That profile photo could not be decoded."); }
  if (bytes > 2 * 1024 * 1024) apiError("Your profile photo must be smaller than 2 MB.");
  return value;
}
function notify(message, error = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}
async function loadProducts() {
  const params = new URLSearchParams();
  if (state.style) params.set("style", state.style);
  if (state.search) params.set("q", state.search);
  for (const [key, value] of Object.entries(state.filters)) if (value) params.set(key, value);
  const data = await api(`/api/products?${params}`);
  state.products = data.products;
}
async function loadUserData() {
  if (!state.user) return;
  if (state.user.role === "buyer") {
    const [cart, orders, messages] = await Promise.all([api("/api/cart"), api("/api/orders"), api("/api/messages")]);
    state.cart = cart.items;
    state.orders = orders.orders;
    state.messages = messages.threads;
  } else {
    const [products, summary, orders, messages] = await Promise.all([
      api("/api/seller/products"), api("/api/seller/summary"), api("/api/orders"), api("/api/messages"),
    ]);
    state.sellerProducts = products.products;
    state.summary = summary;
    state.orders = orders.orders;
    state.messages = messages.threads;
  }
}
async function refresh({ products = true, userData = true } = {}) {
  const tasks = [];
  if (products) tasks.push(loadProducts());
  if (userData && state.user) tasks.push(loadUserData());
  await Promise.all(tasks);
  render();
}
function header() {
  const nav = state.user?.role === "seller"
    ? [["seller", "My shop"], ["orders", "Orders"], ["messages", "Messages"], ["profile", "Profile"]]
    : [["home", "Home"], ["styles", "Styles"], ...(state.user ? [["orders", "My orders"]] : [])];
  if (state.user?.role === "buyer") nav.push(["messages", "Messages"]);
  return `<div class="topline">${location.protocol === "file:" ? "Standalone demo · saved only in this browser" : "A little more you, a little less waste&nbsp; ✳"}</div>
    <header class="header"><div class="header-inner">
      <a class="brand" href="#" data-page="home"><span class="brand-mark">a.</span><span class="brand-name">AesthEra</span></a>
      <nav class="nav" id="main-nav">${nav.map(([page, label]) => `<button data-page="${page}" class="${state.page === page ? "active" : ""}">${label}</button>`).join("")}</nav>
      <div class="header-actions">
        ${state.user?.role === "buyer" ? `<button class="icon-button" aria-label="Shopping bag" data-page="cart">♡<span class="cart-count">${state.cart.reduce((sum, item) => sum + item.quantity, 0)}</span></button>` : ""}
        ${state.user ? `<button class="button button-light button-small" data-page="profile">${safe(state.user.name.split(" ")[0])}</button><button class="mobile-menu icon-button" data-action="menu" aria-label="Open menu">☰</button>` : `<button class="button button-light button-small" data-action="login">Sign in</button><button class="button button-small" data-action="register">Join us</button><button class="mobile-menu icon-button" data-action="menu" aria-label="Open menu">☰</button>`}
      </div>
    </div></header>`;
}
function footer() {
  return `<footer class="footer"><div class="wrap footer-inner"><a class="brand" href="#" data-page="home"><span class="brand-mark">a.</span><span class="brand-name">AesthEra</span></a><p>Good clothes, good stories, better together.</p><p>© ${new Date().getFullYear()} AesthEra · Made for your kind of lovely</p></div></footer>`;
}
function productCard(product) {
  const productRating = product.product_rating_count
    ? `★ ${Number(product.product_rating).toFixed(1)} (${product.product_rating_count})`
    : "No product ratings yet";
  return `<article class="product-card" data-product="${product.id}">
    <div class="product-image"><img src="${safe(imageOf(product) || placeholder)}" onerror="this.src='${placeholder}'" alt="${safe(product.name)}">
      <span class="badge">${safe(product.style)}</span><button class="quick-add" data-action="add-cart" data-id="${product.id}">Add to bag&nbsp; +</button>
    </div><div class="product-info"><div class="product-meta"><span>${safe(product.condition)} · Size ${safe(product.size)}</span><span>♡</span></div>
      <h3>${safe(product.name)}</h3><div class="product-price">${money(product.price)}</div>
      <div class="seller-line"><span class="seller-name">${safe(product.seller_name)}</span><span class="product-rating">${productRating}</span></div></div>
  </article>`;
}
function productsSection(title, subtitle, items = state.products, extra = "") {
  return `<section class="section"><div class="section-heading"><div><span class="eyebrow">${safe(subtitle)}</span><h2>${safe(title)}</h2></div>${extra}</div>
    ${items.length ? `<div class="product-grid">${items.map(productCard).join("")}</div>` : `<div class="empty"><h3>No pieces found just yet</h3><p>Try another style or search term.</p></div>`}
  </section>`;
}
function homePage() {
  const newPieces = [...state.products].sort((a, b) => b.created_at - a.created_at);
  return `<main class="wrap">
    <section class="hero"><div class="hero-copy"><span class="eyebrow">Your style, your story</span><h1>Find your kind<br>of <em>lovely.</em></h1>
      <p>One-of-a-kind pieces from closets like yours. Shop the feeling, find the fit, and give good clothes another story.</p>
      <button class="button button-rose" data-page="styles">Explore the edits&nbsp; ↗</button></div>
      <div class="hero-image"><div class="hero-note">pre-loved looks good on you ♡</div></div></section>
    <section class="section"><div class="section-heading"><div><span class="eyebrow">Find your feeling</span><h2>Shop the aesthetics</h2></div><p>Five moods, a million ways to wear them.</p></div>
      <div class="styles-grid">${styles.map((style, i) => `<button class="style-tile" data-style="${style}"><span class="style-number">0${i + 1} / 05</span><strong>${style}</strong><span class="style-arrow">↗</span></button>`).join("")}</div>
    </section>
    ${productsSection("Fresh from the closet", "Just listed", newPieces.slice(0, 8), `<button class="text-button" data-page="search">View everything&nbsp; ↗</button>`)}
    <section class="soft-banner"><div class="soft-banner-copy"><span class="eyebrow">Good things go around</span><h2>Your closet has a next chapter.</h2><p>List the pieces you loved. Find someone who will love them next.</p>
      <button class="button button-light" data-action="sell">Start selling&nbsp; ↗</button></div><div class="soft-banner-art"></div></section>
  </main>`;
}
function searchPage() {
  return `<main class="wrap"><div class="page-title"><span class="eyebrow">The whole closet</span><h1>${state.style ? `${safe(state.style)} pieces` : "Find your next favorite"}</h1><p>Thoughtful finds from closets with a story to tell.</p></div>
    <form class="filter-bar" id="filter-form"><input type="search" name="q" value="${safe(state.search)}" placeholder="Search a piece, color, or feeling..." aria-label="Search products">
      <select name="size" aria-label="Filter by size"><option value="">All sizes</option>${["XS","S","M","L","XL","One size"].map(s => `<option value="${s}" ${state.filters.size === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <select name="condition" aria-label="Filter by condition"><option value="">Any condition</option>${["New","Pre-loved"].map(s => `<option value="${s}" ${state.filters.condition === s ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input type="number" name="min" min="0" step="0.01" placeholder="Min ₱" value="${safe(state.filters.min)}" aria-label="Minimum price">
      <input type="number" name="max" min="0" step="0.01" placeholder="Max ₱" value="${safe(state.filters.max)}" aria-label="Maximum price">
      <button class="button button-small" type="submit">Search</button>
      <button class="text-button" type="button" data-action="clear-filters">Clear filters</button>
      ${state.style ? `<button class="text-button" type="button" data-action="clear-style">Clear style</button>` : ""}
    </form>${productsSection("The good finds", "Made for your mood", state.products)}</main>`;
}
async function applyFilters(form) {
  clearTimeout(state.filterTimer);
  state.filterTimer = null;
  const values = Object.fromEntries(new FormData(form));
  const min = values.min === "" ? null : Number(values.min);
  const max = values.max === "" ? null : Number(values.max);
  if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))) {
    throw new Error("Enter non-negative minimum and maximum prices.");
  }
  if (min !== null && max !== null && min > max) throw new Error("Minimum price cannot be greater than maximum price.");
  state.search = String(values.q || "").trim();
  state.filters = { size: values.size, condition: values.condition, min: values.min, max: values.max };
  state.style = "";
  state.page = "search";
  await refresh({ userData: false });
}
function authPage() {
  const register = state.authMode === "register";
  const role = state.authRole;
  return `<main class="auth-layout"><div class="auth-art"><h2>Get dressed like you mean it.</h2></div>
    <section class="auth-panel"><span class="eyebrow">${register ? "Make yourself at home" : "Welcome back"}</span><h1>${register ? "Join the club." : "Good to see you."}</h1>
      <p>${register ? "Create your AesthEra account and find your people." : "Sign in and pick up right where you left off."}</p>
      <div class="role-switch"><button class="${role === "buyer" ? "selected" : ""}" data-role="buyer">I'm shopping</button><button class="${role === "seller" ? "selected" : ""}" data-role="seller">I'm selling</button></div>
      <form id="auth-form">
        ${register ? `<div class="form-grid"><div class="field"><label for="auth-name">Full name</label><input id="auth-name" name="name" autocomplete="name" required></div>
          <div class="field"><label for="auth-phone">Phone number</label><input id="auth-phone" name="phone" autocomplete="tel" required></div></div>` : ""}
        <div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="auth-password">Password</label><div class="password-field"><input id="auth-password" name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="${register ? "8" : "1"}" required><button class="password-toggle" type="button" data-action="toggle-password" aria-controls="auth-password" aria-pressed="false">Show</button></div></div>
        ${register ? `<div class="field"><label for="auth-address">Complete address</label><textarea id="auth-address" name="address" autocomplete="street-address" required></textarea></div>` : ""}
        <button class="button button-rose button-full" type="submit">${register ? `Create ${role} account` : `Sign in as ${role}`}</button>
      </form><p class="auth-foot">${register ? "Already part of the club?" : "New around here?"} <button data-action="${register ? "login" : "register"}">${register ? "Sign in" : "Create an account"}</button></p>
      ${!register ? `<p class="auth-foot">Demo ${role}: ${role === "buyer" ? "buyer" : "seller"}@closet.test · closet123</p>` : ""}
    </section></main>`;
}
function statusClass(status) { return status.toLowerCase(); }
function estimatedDelivery(order) {
  return new Date((order.estimated_delivery_at || order.created_at + 7 * 24 * 60 * 60) * 1000).toLocaleDateString();
}
function orderCard(order, seller = false) {
  const items = order.items.map(item => {
    const rating = seller || order.status !== "Completed" || !item.product_id ? "" :
      `<section class="order-review" data-order="${order.id}" data-product="${item.product_id}" data-rating="${item.buyer_rating || 0}">
        <span class="review-prompt">${item.buyer_rating ? "Your review · edit anytime" : "Rate this product"}</span>
        <div class="order-rating-stars" role="group" aria-label="Rate ${safe(item.product_name)} from 1 to 5 stars">${[1, 2, 3, 4, 5].map(rating => `<button type="button" class="order-rating-star ${item.buyer_rating >= rating ? "selected" : ""}" data-action="select-order-rating" data-rating="${rating}" aria-label="${rating} star${rating === 1 ? "" : "s"}" aria-pressed="${item.buyer_rating === rating}">★</button>`).join("")}</div>
        <label class="review-label" for="order-review-${order.id}-${item.product_id}">Your comment <span>(optional)</span></label>
        <textarea id="order-review-${order.id}-${item.product_id}" class="review-comment order-review-comment" maxlength="2000" placeholder="How did this piece work out for you?">${safe(item.buyer_comment || "")}</textarea>
        <button type="button" class="button button-small button-rose" data-action="save-order-review">Save review</button>
      </section>`;
    return `<div>${safe(item.product_name)} · ${safe(item.size)} × ${item.quantity} <span class="muted">(${money(item.price * item.quantity)})</span>${rating}</div>`;
  }).join("");
  const cancelExpiresAt = (order.created_at + 24 * 60 * 60) * 1000;
  const cancellationAvailable = !seller && order.status === "Pending" && Date.now() <= cancelExpiresAt;
  const cancellationExpired = !seller && order.status === "Pending" && !cancellationAvailable;
  const removable = !seller && order.status === "Cancelled";
  const personId = seller ? order.buyer_id : order.seller_id;
  const personLabel = seller ? order.buyer_name : order.seller_name || "Seller";
  const personAction = seller ? "View buyer profile" : "View seller profile";
  return `<article class="order-card"><div class="order-top"><div><strong>${safe(order.items[0]?.product_name || "Marketplace order")}</strong><div class="order-detail">${new Date(order.created_at * 1000).toLocaleDateString()} · ${seller ? `from ${safe(order.buyer_name)}` : "Purchase"}</div></div>
      <span class="status ${statusClass(order.status)}">${safe(order.status)}</span><button class="subtle-button" data-action="view-order" data-id="${order.id}">View order</button></div>
    <div class="order-meta-row"><span class="order-detail">${order.status === "Completed" ? "Delivered" : order.status === "Cancelled" ? "Delivery cancelled" : `Estimated delivery: ${estimatedDelivery(order)}`}</span>
      <button class="text-button profile-link" data-action="view-profile" data-id="${personId}">${personAction}: ${safe(personLabel)}</button></div>
    <div class="order-items">${items}</div><div class="order-bottom"><div><strong>${money(order.total)}</strong> <span class="order-detail">· ${safe(order.payment_method)} · ${safe(order.payment_status)}</span></div>
      ${seller ? `<div class="row-actions"><span class="order-detail">${safe(order.full_name)} · ${safe(order.phone)} · ${safe(order.address)}</span>
      ${order.status !== "Completed" && order.status !== "Cancelled" ? `<select class="order-status" data-order="${order.id}" aria-label="Update order status">${["Pending","Confirmed","Shipped","Completed"].map(s => `<option ${s === order.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : ""}</div>` : cancellationAvailable
        ? `<div class="row-actions"><span class="order-detail">Cancel before ${new Date(cancelExpiresAt).toLocaleString()}</span><button class="subtle-button danger-button" data-action="cancel-order" data-id="${order.id}">Cancel order</button></div>`
        : removable ? `<button class="subtle-button danger-button" data-action="remove-order" data-id="${order.id}">Remove order</button>`
          : cancellationExpired ? `<span class="order-detail">Cancellation period expired</span>` : ""}</div>
  </article>`;
}
function sellerPage() {
  const summary = state.summary || {
    products: { total: 0, available: 0 },
    orders: { total: 0, pending: 0, completed: 0, sales: 0 },
    rating: { average: null, count: 0 },
  };
  const orders = state.orders;
  const products = state.sellerProducts;
  const listedProducts = products.filter(product => product.active);
  const averageRating = summary.rating?.average;
  const ratingValue = summary.rating?.count
    ? `${Number(averageRating).toFixed(1)} / 5`
    : "No ratings yet";
  return `<main class="wrap"><div class="dashboard-head"><div><span class="eyebrow">Your own little corner</span><h1>Hey, ${safe(state.user.name.split(" ")[0])}.</h1><p>Here's what's happening in your shop today.</p></div>
    <button class="button button-rose" data-action="new-product">+ List a piece</button></div>
    <div class="stat-grid">${[
      ["Listed pieces", summary.products.total || 0, "Active listings in your shop"],
      ["Available listings", summary.products.available || 0, "Active pieces with stock"],
      ["Total orders", summary.orders.total || 0, "Including pending and completed"],
      ["Pending orders", summary.orders.pending || 0, "Orders waiting for an update"],
      ["Completed sales", summary.orders.completed || 0, "Orders marked completed"],
      ["Sales revenue", money(summary.orders.sales || 0), "From completed orders"],
      ["Product rating", ratingValue, `${summary.rating?.count || 0} product ratings`],
    ].map(([label, value, note]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("")}</div>
    <div class="seller-tabs"><button class="${state.sellerTab === "products" ? "active" : ""}" data-seller-tab="products">My pieces (${listedProducts.length})</button>
      <button class="${state.sellerTab === "orders" ? "active" : ""}" data-seller-tab="orders">Orders (${orders.length})</button></div>
    ${state.sellerTab === "products" ? (listedProducts.length ? listedProducts.map(product => `<article class="seller-product-row"><img src="${safe(imageOf(product) || placeholder)}" onerror="this.src='${placeholder}'" alt="">
      <div><h3>${safe(product.name)}</h3><p>${safe(product.style)} · Size ${safe(product.size)} · ${money(product.price)} · ${product.stock ? `${product.stock} available` : "Sold out"}</p></div>
      <div class="row-actions"><button class="subtle-button" data-action="edit-product" data-id="${product.id}">Edit</button><button class="subtle-button danger-button" data-action="delete-product" data-id="${product.id}">Remove</button></div></article>`).join("") : `<div class="empty"><h3>Your next favorite listing starts here.</h3><p>Add a piece and give it a new story.</p><button class="button button-rose" data-action="new-product">List your first piece</button></div>`)
      : (orders.length ? orders.map(order => orderCard(order, true)).join("") : `<div class="empty"><h3>No orders just yet</h3><p>Your next customer is out there.</p></div>`)}
  </main>`;
}
function ordersPage() {
  const orders = state.orders;
  return `<main class="wrap"><div class="page-title"><span class="eyebrow">${state.user.role === "seller" ? "Your shop" : "Your closet, in progress"}</span><h1>${state.user.role === "seller" ? "Orders" : "Your orders"}</h1><p>Every good find, all in one place.</p></div>
    ${orders.length ? orders.map(order => orderCard(order, state.user.role === "seller")).join("") : `<div class="empty"><h3>Nothing in the post yet</h3><p>${state.user.role === "buyer" ? "When you find your next favorite, your orders will live here." : "Your shop orders will appear here."}</p>${state.user.role === "buyer" ? `<button class="button" data-page="search">Find a favorite</button>` : ""}</div>`}
  </main>`;
}
function messagesPage() {
  const selected = state.messages.find(thread => thread.id === Number(state.selectedThreadId));
  const conversationList = state.messages.length ? state.messages.map(thread => {
    const lastMessage = thread.messages[thread.messages.length - 1];
    return `<button class="conversation-item ${selected?.id === thread.id ? "active" : ""}" data-action="open-thread" data-id="${thread.id}">
      <strong>${safe(thread.counterpart_name)}</strong><span>${safe(thread.product_name)}</span>
      <small>${safe(lastMessage?.body || "Start your conversation")}</small></button>`;
  }).join("") : `<p class="muted conversation-empty">No conversations yet. Open a product and message its seller to start.</p>`;
  const conversation = selected ? `<section class="conversation-panel">
    <header class="conversation-header"><div><strong>${safe(selected.counterpart_name)}</strong><span>About ${safe(selected.product_name)}</span></div>
      <button class="subtle-button" data-action="view-profile" data-id="${selected.counterpart_id}">View profile</button></header>
    <div class="conversation-messages">${selected.messages.length ? selected.messages.map(message => `<article class="chat-message ${message.sender_id === state.user.id ? "mine" : ""}">
      <strong>${safe(message.sender_name)}</strong><p>${safe(message.body)}</p><time>${new Date(message.created_at * 1000).toLocaleString()}</time></article>`).join("") : `<p class="muted">Say hello to start the conversation.</p>`}</div>
    <form class="message-form" id="message-form"><input type="hidden" name="threadId" value="${selected.id}">
      <label class="sr-only" for="reply-message">Your message</label><textarea id="reply-message" name="message" maxlength="2000" placeholder="Write a private message..." required></textarea>
      <button class="button button-rose" type="submit">Send message</button></form></section>`
    : `<section class="conversation-panel conversation-placeholder"><span class="eyebrow">Private conversations</span><h2>Choose a conversation</h2><p>Discuss a piece directly with its buyer or seller. Messages are only visible to the two people in the conversation.</p></section>`;
  return `<main class="wrap"><div class="page-title"><span class="eyebrow">Just between you</span><h1>Messages</h1><p>Private product conversations with buyers and sellers.</p></div>
    <section class="messages-layout"><aside class="conversation-list">${conversationList}</aside>${conversation}</section></main>`;
}
function profilePage() {
  return `<main class="wrap"><div class="page-title"><span class="eyebrow">The person behind the style</span><h1>Your profile</h1><p>Keep your details up to date.</p></div>
    <section class="profile-card"><aside class="profile-aside"><div class="profile-avatar" id="profile-avatar">${state.user.avatar ? `<img src="${safe(state.user.avatar)}" alt="Profile photo">` : safe(state.user.name.slice(0, 1).toUpperCase())}</div><h2>${safe(state.user.name)}</h2><p>${safe(state.user.email)}</p><span class="badge">${safe(state.user.role)}</span><p class="profile-bio-display">${safe(state.user.bio || "Add a short bio to tell people a little about yourself.")}</p><div style="margin-top:24px"><button class="subtle-button danger-button" data-action="logout">Sign out</button></div></aside>
    <form class="profile-form" id="profile-form"><div class="section-heading"><div><span class="eyebrow">Your details</span><h2>Account information</h2></div></div>
      <div class="field full"><label for="profile-photo">Profile photo · JPG, PNG, WEBP, or GIF · max 2 MB</label><input id="profile-photo" name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><div class="avatar-preview" id="avatar-preview">${state.user.avatar ? `<img src="${safe(state.user.avatar)}" alt="Profile photo preview">` : `<span>No photo selected</span>`}</div><button class="text-button avatar-remove" type="button" data-action="remove-avatar" ${state.user.avatar ? "" : "disabled"}>Remove photo</button></div>
      <div class="form-grid"><div class="field"><label for="profile-name">Full name</label><input id="profile-name" name="name" value="${safe(state.user.name)}" required></div>
      <div class="field"><label for="profile-phone">Phone number</label><input id="profile-phone" name="phone" value="${safe(state.user.phone)}" required></div>
      <div class="field full"><label for="profile-email">Email address</label><input id="profile-email" name="email" type="email" value="${safe(state.user.email)}" required></div>
      <div class="field full"><label for="profile-bio">Bio · up to 500 characters</label><textarea id="profile-bio" name="bio" maxlength="500" placeholder="Tell people a little about yourself...">${safe(state.user.bio || "")}</textarea></div>
      <div class="field full"><label for="profile-address">Complete address</label><textarea id="profile-address" name="address" required>${safe(state.user.address)}</textarea></div></div>
      <button class="button button-rose" type="submit">Save changes</button></form></section></main>`;
}
function cartPage() {
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = state.cart.length ? total : 0;
  return `<main class="wrap"><div class="page-title"><span class="eyebrow">The good finds</span><h1>Your bag</h1><p>${state.cart.length} ${state.cart.length === 1 ? "piece" : "pieces"} waiting for a new home.</p></div>
    ${state.cart.length ? `<div class="cart-layout"><div>${state.cart.map(item => `<article class="cart-row"><img src="${safe(imageOf(item) || placeholder)}" onerror="this.src='${placeholder}'" alt="${safe(item.name)}"><div><h3>${safe(item.name)}</h3><p>${safe(item.style)} · Size ${safe(item.size)} · ${money(item.price)}</p></div>
      <div class="cart-actions"><div class="quantity"><button data-action="quantity" data-id="${item.id}" data-change="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-action="quantity" data-id="${item.id}" data-change="1" aria-label="Increase quantity">+</button></div>
      <button class="text-button" data-action="remove-cart" data-id="${item.id}">Remove</button><strong>${money(item.price * item.quantity)}</strong></div></article>`).join("")}
      <button class="text-button" data-page="search">← Keep browsing</button></div>
      <aside class="summary-card"><h2>A little total</h2><div class="summary-line total"><span>Order subtotal</span><span>${money(subtotal)}</span></div>
        <button class="button button-rose button-full" data-action="checkout">Make it yours&nbsp; ↗</button><p class="muted" style="font-size:10px;line-height:1.6;margin:13px 0 0">Arrange delivery and cash-on-delivery payment with your seller.</p></aside></div>` :
      `<div class="empty"><h3>Your bag is taking a little break.</h3><p>Something lovely is only a scroll away.</p><button class="button button-rose" data-page="search">Find your next favorite</button></div>`}</main>`;
}
function pageContent() {
  if (state.page === "auth") return authPage();
  if (state.page === "seller") return sellerPage();
  if (state.page === "profile") return profilePage();
  if (state.page === "orders") return ordersPage();
  if (state.page === "messages") return messagesPage();
  if (state.page === "cart") return cartPage();
  if (state.page === "search" || state.page === "styles") return searchPage();
  return homePage();
}
function render() {
  app.innerHTML = `${header()}${pageContent()}${footer()}`;
}
function setPage(page) {
  if (page === "seller" && state.user?.role !== "seller") return openAuth("login", "seller");
  if (page === "cart" && !state.user) return openAuth("login", "buyer");
  if ((page === "profile" || page === "orders" || page === "messages") && !state.user) return openAuth("login", "buyer");
  if (page === "seller" && state.user?.role !== "seller") return;
  state.page = page;
  state.style = page === "styles" ? state.style : state.style;
  if (page === "home") state.style = "";
  if (page === "search" || page === "styles" || page === "home") loadProducts().then(render).catch(error => notify(error.message, true));
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openAuth(mode = "login", role = state.user?.role || "buyer") {
  state.authMode = mode;
  state.authRole = role;
  state.page = "auth";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function closeModal() { modalRoot.innerHTML = ""; }
function openOrder(id) {
  const order = state.orders.find(item => item.id === Number(id));
  if (!order) throw new Error("That order is no longer available.");
  const items = order.items.map(item => `<div class="order-detail-line"><span>${safe(item.product_name)} · ${safe(item.size)} × ${item.quantity}</span><strong>${money(item.price * item.quantity)}</strong></div>`).join("");
  const profileId = state.user?.role === "buyer" ? order.seller_id : order.buyer_id;
  const profileLabel = state.user?.role === "buyer" ? "View seller profile" : "View buyer profile";
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="order-detail-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
    <span class="eyebrow">Order details</span><h2 id="order-modal-title">${safe(order.items[0]?.product_name || "Marketplace order")}</h2>
    <div class="order-modal-status"><span class="status ${statusClass(order.status)}">${safe(order.status)}</span><span class="order-detail">${new Date(order.created_at * 1000).toLocaleString()}</span></div>
    <p class="order-detail">${order.status === "Completed" ? "Delivered" : order.status === "Cancelled" ? "Delivery cancelled" : `Estimated delivery: ${estimatedDelivery(order)}`}</p>
    <section class="order-modal-section"><h3>Items</h3>${items}<div class="order-detail-line order-detail-total"><strong>Total</strong><strong>${money(order.total)}</strong></div></section>
    <section class="order-modal-section"><h3>${state.user?.role === "seller" ? "Buyer delivery details" : "Delivery details"}</h3><p>${safe(order.full_name)}<br>${safe(order.phone)}<br>${safe(order.address)}</p></section>
    <section class="order-modal-section"><h3>Payment</h3><p>${safe(order.payment_method)} · ${safe(order.payment_status)}</p></section>
    <section class="order-modal-section"><button class="subtle-button" data-action="view-profile" data-id="${profileId}">${profileLabel}</button>
      ${state.user?.role === "buyer" && order.items[0]?.product_id ? `<button class="subtle-button" data-action="message-seller" data-product="${order.items[0].product_id}">Message seller</button>` : ""}</section>
    </section></div>`;
}
async function openProfile(id) {
  const { profile } = await api(`/api/profiles/${id}`);
  const avatar = profile.avatar
    ? `<img src="${safe(profile.avatar)}" alt="${safe(profile.name)}'s profile photo">`
    : safe(profile.name.slice(0, 1).toUpperCase());
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="public-profile-modal" role="dialog" aria-modal="true" aria-label="${safe(profile.name)}'s profile">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="profile-avatar">${avatar}</div>
    <span class="eyebrow">${safe(profile.role)} profile</span><h2>${safe(profile.name)}</h2>
    <p>${safe(profile.bio || "This member hasn't added a bio yet.")}</p>
    </section></div>`;
}
function openMessageComposer(productId) {
  const product = state.products.find(item => item.id === Number(productId));
  if (!product) throw new Error("That product is no longer available.");
  if (state.user?.role !== "buyer") return openAuth("login", "buyer");
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="message-compose-modal" role="dialog" aria-modal="true" aria-labelledby="compose-message-title">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><span class="eyebrow">Private message</span>
    <h2 id="compose-message-title">Ask about ${safe(product.name)}</h2><p>Only you and ${safe(product.seller_name)} can see this conversation.</p>
    <form id="message-form"><input type="hidden" name="productId" value="${product.id}">
      <label class="review-label" for="first-message">Your message</label><textarea id="first-message" name="message" maxlength="2000" placeholder="Ask a question about this piece..." required></textarea>
      <button class="button button-rose button-full" type="submit">Send message</button></form></section></div>`;
}
async function openProduct(id) {
  const product = state.products.find(item => item.id === Number(id));
  if (!product) return;
  const { reviews } = await api(`/api/products/${product.id}/reviews`);
  const purchasedItem = state.user?.role === "buyer"
    ? state.orders.flatMap(order => order.items.map(item => ({ ...item, order })))
      .find(item => item.product_id === product.id && item.order.status === "Completed")
    : null;
  const ratingControl = state.user?.role !== "buyer" ? "" : purchasedItem
    ? `<section class="detail-review" data-order="${purchasedItem.order.id}" data-product="${product.id}" data-rating="${purchasedItem.buyer_rating || 0}">
        <h3>${purchasedItem.buyer_rating ? "Your review · edit anytime" : "Rate this product"}</h3>
        <span class="review-prompt">Choose 1 to 5 stars</span>
        <div class="detail-rating-stars" role="group" aria-label="Choose a rating from 1 to 5 stars">${[1, 2, 3, 4, 5].map(rating => `<button type="button" class="detail-rating-star ${purchasedItem.buyer_rating >= rating ? "selected" : ""}" data-action="select-product-rating" data-rating="${rating}" aria-label="${rating} star${rating === 1 ? "" : "s"}" aria-pressed="${purchasedItem.buyer_rating === rating}">★</button>`).join("")}</div>
        <label class="review-label" for="product-review-comment">Your comment <span>(optional)</span></label>
        <textarea id="product-review-comment" class="review-comment" maxlength="2000" placeholder="How did this piece work out for you?">${safe(purchasedItem.buyer_comment || "")}</textarea>
        <button type="button" class="button button-rose button-full" data-action="save-product-review">Save review</button>
      </section>`
    : `<p class="detail-rating-hint">Complete an order for this item to rate it.</p>`;
  const reviewList = reviews.length
    ? reviews.map(review => `<article class="product-review"><div class="product-review-stars" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</div><p>${safe(review.comment)}</p></article>`).join("")
    : `<p class="no-product-reviews">No comments yet.</p>`;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="product-modal" role="dialog" aria-modal="true" aria-label="${safe(product.name)}">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="modal-image"><img src="${safe(imageOf(product) || placeholder)}" onerror="this.src='${placeholder}'" alt="${safe(product.name)}"></div>
    <div class="modal-copy"><span class="eyebrow">${safe(product.style)} · ${safe(product.condition)}</span><h2>${safe(product.name)}</h2><div class="modal-price">${money(product.price)}</div>
      <p>${safe(product.description)}</p><div class="modal-details">Size ${safe(product.size)}<br>${product.stock} ${product.stock === 1 ? "piece" : "pieces"} left<br>Seller: ${safe(product.seller_name)}<br>${product.product_rating_count ? `★ ${Number(product.product_rating).toFixed(1)} from ${product.product_rating_count} product rating${product.product_rating_count === 1 ? "" : "s"}` : "No product ratings yet"}</div>
      <div class="product-contact-actions"><button class="subtle-button" data-action="view-profile" data-id="${product.seller_id}">View seller profile</button>
        ${state.user?.role !== "seller" ? `<button class="subtle-button" data-action="message-seller" data-product="${product.id}">Message seller</button>` : ""}</div>
      ${ratingControl}
      <section class="product-reviews"><h3>Buyer comments</h3>${reviewList}</section>
      <button class="button button-rose button-full" data-action="add-cart" data-id="${product.id}">Add to your bag&nbsp; +</button></div></section></div>`;
}
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ filename: file.name, data: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
function productForm(product = null) {
  state.editingProduct = product;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.dataset.action = "backdrop-close";
  modal.innerHTML = `<section class="auth-panel" style="position:relative;background:var(--white);width:min(650px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:35px" role="dialog" aria-modal="true">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><span class="eyebrow">${product ? "A little refresh" : "Your next listing"}</span><h1 style="font:500 30px var(--serif);margin:8px 0 20px">${product ? "Edit your piece" : "List a piece"}</h1>
    <form id="product-form"><div class="form-grid"><div class="field full"><label>Piece name</label><input name="name" maxlength="100" value="${safe(product?.name || "")}" required></div>
      <div class="field full"><label>Tell its story</label><textarea name="description" maxlength="2000" required>${safe(product?.description || "")}</textarea></div>
      <div class="field"><label>Price (₱)</label><input name="price" type="number" min="0" step="0.01" value="${safe(product?.price ?? "")}" required></div>
      <div class="field"><label>Available quantity</label><input name="stock" type="number" min="0" max="10000" value="${safe(product?.stock ?? 1)}" required></div>
      <div class="field"><label>Size</label><input name="size" value="${safe(product?.size || "")}" placeholder="XS, S, M, L, One size" required></div>
      <div class="field"><label>Condition</label><select name="condition" required>${["New","Pre-loved"].map(s => `<option ${product?.condition === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field full"><label>Aesthetic</label><select name="style" required>${styles.map(s => `<option ${product?.style === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="field full"><label>Product photos · up to 6 (JPG, PNG, WEBP, GIF; max 3 MB each)</label><input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/gif" multiple><div class="image-preview">${(product?.images || []).map(src => `<img src="${safe(src)}" alt="Current photo">`).join("")}</div></div>
    </div><button class="button button-rose button-full" type="submit">${product ? "Save changes" : "Publish your piece"}</button></form></section>`;
  modalRoot.innerHTML = "";
  modalRoot.append(modal);
}
function checkoutModal() {
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop-close"><section class="auth-panel" style="position:relative;background:var(--white);width:min(590px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;padding:35px" role="dialog" aria-modal="true">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><span class="eyebrow">One last little thing</span><h1 style="font:500 30px var(--serif);margin:8px 0">Delivery & payment</h1><p class="muted">Coordinate delivery directly with the seller.</p>
    <form id="checkout-form"><div class="form-grid"><div class="field"><label for="checkout-name">Full name</label><input id="checkout-name" name="fullName" value="${safe(state.user.name)}" required></div><div class="field"><label for="checkout-phone">Phone</label><input id="checkout-phone" name="phone" value="${safe(state.user.phone)}" required></div>
      <div class="field full"><label>Complete delivery address</label><textarea name="address" required>${safe(state.user.address)}</textarea></div></div>
      <fieldset class="payment-methods"><legend>Choose payment</legend>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Cash on delivery" checked><span class="payment-logo cod-logo" aria-hidden="true">₱</span><span class="payment-copy"><strong>Cash on delivery</strong><small>Pay your seller when it arrives</small></span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="GCash (demo)"><span class="payment-logo gcash-logo" aria-hidden="true">G</span><span class="payment-copy"><strong>GCash</strong><small>Demo option · no payment processed</small></span></label>
        <label class="payment-option"><input type="radio" name="paymentMethod" value="Maya (demo)"><span class="payment-logo maya-logo" aria-hidden="true">M</span><span class="payment-copy"><strong>Maya</strong><small>Demo option · no payment processed</small></span></label>
      </fieldset>
      <p class="payment-note">GCash and Maya are display-only demo choices. This page does not connect to either wallet or transfer money.</p>
      <p class="delivery-estimate">Estimated delivery: about one week, around ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}.</p>
      <div class="order-items">${state.cart.map(item => `<div>${safe(item.name)} × ${item.quantity} · ${money(item.price * item.quantity)}</div>`).join("")}</div>
      <div class="summary-line total"><span>Total</span><span>${money(total)}</span></div><button class="button button-rose button-full" type="submit">Confirm order · ${money(total)}</button>
      </form></section></div>`;
}
function openSell() {
  if (state.user?.role === "seller") setPage("seller");
  else openAuth("login", "seller");
}

document.addEventListener("click", async event => {
  const target = event.target;
  const button = target.closest("[data-action],[data-page],[data-style],[data-role],[data-seller-tab]");

  if (target.classList.contains("modal-backdrop") && target.dataset.action === "backdrop-close") {
    closeModal();
    return;
  }

  if (button) {
    if (button.dataset.page) { setPage(button.dataset.page); return; }
    if (button.dataset.style) {
      state.style = button.dataset.style; state.search = ""; state.page = "styles";
      await refresh({ products: true, userData: false }); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    if (button.dataset.role) { state.authRole = button.dataset.role; render(); return; }
    if (button.dataset.sellerTab) { state.sellerTab = button.dataset.sellerTab; render(); return; }
    const action = button.dataset.action;
    try {
      if (action === "menu") document.querySelector("#main-nav").classList.toggle("open");
      if (action === "login") openAuth("login");
      if (action === "register") openAuth("register");
      if (action === "sell") openSell();
      if (action === "toggle-password") {
        const input = document.getElementById(button.getAttribute("aria-controls"));
        if (!input) throw new Error("Password field is unavailable.");
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.textContent = visible ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(visible));
      }
      if (action === "select-product-rating") {
        const review = button.closest(".detail-review");
        const rating = Number(button.dataset.rating);
        review.dataset.rating = String(rating);
        review.querySelectorAll(".detail-rating-star").forEach(star => {
          const selected = Number(star.dataset.rating) <= rating;
          star.classList.toggle("selected", selected);
          star.setAttribute("aria-pressed", String(Number(star.dataset.rating) === rating));
        });
      }
      if (action === "select-order-rating") {
        const review = button.closest(".order-review");
        const rating = Number(button.dataset.rating);
        review.dataset.rating = String(rating);
        review.querySelectorAll(".order-rating-star").forEach(star => {
          const selected = Number(star.dataset.rating) <= rating;
          star.classList.toggle("selected", selected);
          star.setAttribute("aria-pressed", String(Number(star.dataset.rating) === rating));
        });
      }
      if (action === "save-order-review") {
        const review = button.closest(".order-review");
        const rating = Number(review?.dataset.rating);
        if (!rating) { notify("Choose a star rating from 1 to 5 first.", true); return; }
        await api("/api/ratings", { method: "POST", body: JSON.stringify({
          orderId: Number(review.dataset.order), productId: Number(review.dataset.product),
          rating, comment: review.querySelector(".order-review-comment").value,
        }) });
        await refresh({ products: true });
        notify("Your review has been saved ♡");
      }
      if (action === "save-product-review") {
        const review = button.closest(".detail-review");
        const rating = Number(review?.dataset.rating);
        if (!rating) { notify("Choose a star rating from 1 to 5 first.", true); return; }
        await api("/api/ratings", { method: "POST", body: JSON.stringify({
          orderId: Number(review.dataset.order), productId: Number(review.dataset.product),
          rating, comment: review.querySelector(".review-comment").value,
        }) });
        await refresh({ products: true });
        await openProduct(Number(review.dataset.product));
        notify("Your review has been saved ♡");
      }
      if (action === "view-order") openOrder(button.dataset.id);
      if (action === "view-profile") await openProfile(button.dataset.id);
      if (action === "message-seller") openMessageComposer(button.dataset.product);
      if (action === "open-thread") {
        state.selectedThreadId = Number(button.dataset.id);
        render();
      }
      if (action === "remove-avatar") {
        const form = button.closest("#profile-form");
        if (!form) return;
        form.dataset.removeAvatar = "true";
        form.elements.profilePhoto.value = "";
        document.querySelector("#avatar-preview").innerHTML = "<span>No photo selected</span>";
        document.querySelector("#profile-avatar").textContent = state.user.name.slice(0, 1).toUpperCase();
        button.disabled = true;
      }
      if (action === "clear-style") { state.style = ""; await refresh({ userData: false }); }
      if (action === "clear-filters") {
        state.style = ""; state.search = "";
        state.filters = { size: "", condition: "", min: "", max: "" };
        state.page = "search";
        await refresh({ userData: false });
      }
      if (action === "close-modal") closeModal();
      if (action === "add-cart") {
        if (state.user?.role !== "buyer") { closeModal(); openAuth("login", "buyer"); return; }
        await api("/api/cart", { method: "POST", body: JSON.stringify({ productId: Number(button.dataset.id), quantity: 1 }) });
        closeModal(); await refresh({ products: false }); notify("Added to your bag ♡");
      }
      if (action === "checkout") checkoutModal();
      if (action === "cancel-order") {
        if (!window.confirm("Cancel this order? The items will be returned to the shop's stock.")) return;
        await api("/api/orders/cancel", { method: "POST", body: JSON.stringify({ orderId: Number(button.dataset.id) }) });
        await refresh({ products: false }); notify("Your order has been cancelled.");
      }
      if (action === "remove-order") {
        if (!window.confirm("Remove this cancelled order from your order history?")) return;
        await api(`/api/orders/${button.dataset.id}`, { method: "DELETE" });
        await refresh({ products: false }); notify("Cancelled order removed.");
      }
      if (action === "remove-cart") {
        await api(`/api/cart?productId=${button.dataset.id}`, { method: "DELETE" });
        await refresh({ products: false }); notify("Removed from your bag.");
      }
      if (action === "quantity") {
        const item = state.cart.find(entry => entry.id === Number(button.dataset.id));
        if (!item) return;
        const quantity = item.quantity + Number(button.dataset.change);
        if (quantity < 1) await api(`/api/cart?productId=${item.id}`, { method: "DELETE" });
        else await api("/api/cart", { method: "PUT", body: JSON.stringify({ productId: item.id, quantity }) });
        await refresh({ products: false });
      }
      if (action === "logout") {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
        state.user = null; state.cart = []; state.orders = []; state.page = "home";
        await refresh(); notify("You’re signed out. See you soon ♡");
      }
      if (action === "new-product") productForm();
      if (action === "edit-product") productForm(state.sellerProducts.find(item => item.id === Number(button.dataset.id)));
      if (action === "delete-product") {
        if (!window.confirm("Remove this piece from your shop? It won't appear in the marketplace anymore.")) return;
        await api(`/api/seller/products/${button.dataset.id}`, { method: "DELETE" });
        await refresh({ products: true }); notify("Piece removed from your shop.");
      }
    } catch (error) { notify(error.message, true); }
    return;
  }

  const card = target.closest(".product-card");
  if (card && !target.closest("[data-action]")) openProduct(card.dataset.product).catch(error => notify(error.message, true));
});
document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "filter-form") {
      await applyFilters(form); return;
    }
    if (form.id === "auth-form") {
      const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api(path, { method: "POST", body: JSON.stringify({ ...values, role: state.authRole }) });
      state.user = result.user;
      state.page = result.user.role === "seller" ? "seller" : "home";
      await refresh(); notify(`Welcome ${state.authMode === "register" ? "to the club" : "back"} ♡`); return;
    }
    if (form.id === "profile-form") {
      delete values.profilePhoto;
      const photo = form.elements.profilePhoto.files[0];
      if (photo) {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(photo.type)) throw new Error("Profile photos must be JPG, PNG, WEBP, or GIF.");
        if (photo.size > 2 * 1024 * 1024) throw new Error("Your profile photo must be smaller than 2 MB.");
        values.avatar = (await fileToImage(photo)).data;
      } else if (form.dataset.removeAvatar === "true") values.avatar = null;
      const result = await api("/api/profile", { method: "PUT", body: JSON.stringify(values) });
      state.user = result.user; render(); notify("Your details are all up to date ♡"); return;
    }
    if (form.id === "checkout-form") {
      await api("/api/orders", { method: "POST", body: JSON.stringify(values) });
      closeModal(); state.page = "orders"; await refresh();
      notify(values.paymentMethod === "Cash on delivery"
        ? "Order placed. Your sellers will take it from here ♡"
        : "Demo order placed; no e-wallet payment was processed.");
      return;
    }
    if (form.id === "message-form") {
      const result = await api("/api/messages", { method: "POST", body: JSON.stringify(values) });
      closeModal();
      state.selectedThreadId = result.threadId;
      state.page = "messages";
      await refresh({ products: false });
      notify("Your private message was sent.");
      return;
    }
    if (form.id === "product-form") {
      const files = [...form.elements.images.files];
      if (files.some(file => file.size > 3 * 1024 * 1024)) throw new Error("Each image must be smaller than 3 MB.");
      if (files.length > 6) throw new Error("Choose up to 6 product images.");
      const payload = { ...values };
      delete payload.images;
      if (files.length) payload.images = await Promise.all(files.map(fileToImage));
      const productId = state.editingProduct?.id;
      const url = productId ? `/api/seller/products/${productId}` : "/api/seller/products";
      await api(url, { method: productId ? "PUT" : "POST", body: JSON.stringify(payload) });
      closeModal(); state.editingProduct = null; await refresh(); notify(productId ? "Your piece has been updated ♡" : "Your piece is live ♡");
    }
  } catch (error) { notify(error.message, true); }
});
app.addEventListener("change", async event => {
  if (event.target.matches("#profile-photo")) {
    const form = event.target.form, photo = event.target.files[0];
    if (!photo) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(photo.type)) {
      event.target.value = ""; notify("Profile photos must be JPG, PNG, WEBP, or GIF.", true); return;
    }
    if (photo.size > 2 * 1024 * 1024) {
      event.target.value = ""; notify("Your profile photo must be smaller than 2 MB.", true); return;
    }
    try {
      const image = await fileToImage(photo);
      form.dataset.removeAvatar = "false";
      document.querySelector("#avatar-preview").innerHTML = `<img src="${safe(image.data)}" alt="Profile photo preview">`;
      document.querySelector("#profile-avatar").innerHTML = `<img src="${safe(image.data)}" alt="Profile photo">`;
      form.querySelector('[data-action="remove-avatar"]').disabled = false;
    } catch (error) { notify(error.message, true); }
    return;
  }
  const filterForm = event.target.closest("#filter-form");
  if (filterForm && event.target.name !== "q") {
    const update = () => applyFilters(filterForm).catch(error => notify(error.message, true));
    if (event.target.type === "number") {
      clearTimeout(state.filterTimer);
      state.filterTimer = setTimeout(update, 300);
    } else update();
    return;
  }
  if (event.target.matches(".order-status")) {
    try {
      await api("/api/seller/orders/status", { method: "POST", body: JSON.stringify({ orderId: Number(event.target.dataset.order), status: event.target.value }) });
      await refresh({ products: false }); notify("Order status updated.");
    } catch (error) { notify(error.message, true); }
  }
});

async function start() {
  try {
    const session = await api("/api/session");
    state.user = session.user;
    state.page = state.user?.role === "seller" ? "seller" : "home";
    await refresh();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<main class="empty"><h3>We couldn't open the closet.</h3><p>${safe(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></main>`;
  }
}
start();
