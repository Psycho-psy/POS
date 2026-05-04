console.log("app.js loaded — Multi-Tenant POS");

// ===========================
//  Firebase Configuration
// ===========================
const firebaseConfig = {
  apiKey: "AIzaSyA0aznyzcOXafrwRxBYAnVLvKEPG5HNkiY",
  authDomain: "point-of-sale-ff9dc.firebaseapp.com",
  databaseURL: "https://point-of-sale-ff9dc-default-rtdb.firebaseio.com",
  projectId: "point-of-sale-ff9dc",
  storageBucket: "point-of-sale-ff9dc.firebasestorage.app",
  messagingSenderId: "18097584449",
  appId: "1:18097584449:web:fdd8c12fd453784ebfc9c0"
};

let db = null;
if (typeof firebase !== "undefined") {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  console.log("Firestore initialized.");
} else {
  console.error("Firebase SDK not found.");
}

// ===========================
//  Global State
// ===========================
let cart = [];
let currentUser = null;   // { username, shopId, role }
let currentShopId = null; // active tenant scope

// ===========================
//  Utility
// ===========================
function shopRef(col) {
  return db.collection("shops").doc(currentShopId).collection(col);
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function generateSKU(name, prefix = "") {
  // Take first 3 letters and convert to Uppercase
  const letters = (name || "").trim().substring(0, 3).toUpperCase() || "XXX";
  // Remove the random number so "Rice" always generates "P-RIC" 
  // unless you manually change it.
  return `${prefix}${letters}`; 
}

// ===========================
//  Auth — Login / Logout
// ===========================
async function login() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!username || !password) { alert("Please enter username and password."); return; }

  try {
    // 1. Check hardcoded superadmin credentials
    if (username === "Debrah" && password === "Tw1st20@4") {
      currentUser = { username, shopId: null, role: "superadmin" };
      localStorage.setItem("posUser", JSON.stringify(currentUser));
      bootSuperAdmin();
      return;
    }

    // 2. Check per-user accounts in shops/{shopId}/users/{username}
    let matched = null;
    const usersQuery = await db.collectionGroup("users")
      .where("username", "==", username)
      .where("password", "==", password)
      .get();
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      const shopId = userDoc.ref.parent.parent.id;
      matched = { shopId, role: userDoc.data().role || "staff" };
    }

    // 3. Fallback: top-level shop username/password (legacy)
    if (!matched) {
      const shopsSnap = await db.collection("shops").get();
      shopsSnap.forEach(doc => {
        const d = doc.data();
        if (d.username === username && d.password === password) {
          matched = { shopId: doc.id, role: d.role || "staff" };
        }
      });
    }

    if (matched) {
      currentUser = { username, shopId: matched.shopId, role: matched.role };
      currentShopId = matched.shopId;
      localStorage.setItem("posUser", JSON.stringify(currentUser));
      bootShopUser();
    } else {
      alert("Invalid credentials.");
    }
  } catch (err) {
    console.error("Login error:", err);
    alert("Login failed. Check console.");
  }
}

function bootShopUser() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  document.getElementById("superAdminPanel").classList.add("hidden");
  document.getElementById("saBackBtn").classList.add("hidden");
  document.getElementById("currentUser").textContent =
    `${currentUser.username} — ${currentShopId} [${currentUser.role}]`;

  const isAdmin = ["admin","owner","superadmin"].includes(currentUser.role);
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = isAdmin ? "" : "none";
  });

  loadInventory();
  loadSales();
  loadDebtors();
  loadInbound();
  loadOutbound();
  loadAdjustments();
  loadWarehouseInventory();
  loadWarehouseReports();
  loadCreditors();
  populateProductSelect();
  populateWarehouseSelects();
}

function bootSuperAdmin() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("superAdminPanel").classList.remove("hidden");
  document.getElementById("saCurrentUser").textContent = `Superadmin: ${currentUser.username}`;
  loadSAShops();
}

function logout() {
  localStorage.removeItem("posUser");
  currentUser = null;
  currentShopId = null;
  cart = [];
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("superAdminPanel").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("posUser");
  if (saved) {
    currentUser = JSON.parse(saved);
    if (currentUser.role === "superadmin") {
      bootSuperAdmin();
    } else {
      currentShopId = currentUser.shopId;
      bootShopUser();
    }
  }

  document.getElementById("productName").addEventListener("input", function () {
    if (this.value.length >= 3)
      document.getElementById("productId").value = generateSKU(this.value, "P-");
  });
  document.getElementById("warehouseProductName").addEventListener("input", function () {
    if (this.value.length >= 3)
      document.getElementById("warehouseProductId").value = generateSKU(this.value, "W-");
  });
  document.getElementById("inProductName").addEventListener("input", function () {
    if (this.value.length >= 3)
      document.getElementById("inProductId").value = generateSKU(this.value, "IN-");
  });
});

// ===========================
//  Sidebar Navigation
// ===========================
function showSection(sectionId, event = null) {
  // 1. Hide all sections and make sure they have the 'hidden' class
  document.querySelectorAll(".section").forEach(s => {
    s.classList.remove("active");
    s.classList.add("hidden"); 
  });

  // 2. Target the specific section
  const target = document.getElementById(sectionId);
  if (target) {
    // Remove 'hidden' so the !important display:none is gone
    target.classList.remove("hidden"); 
    // Add 'active' to trigger the display
    target.classList.add("active");
  }

  // 3. Update sidebar buttons
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  if (event && event.target) {
    event.target.classList.add("active");
  } else {
    const btn = document.querySelector(`button[onclick*="${sectionId}"]`);
    if (btn) btn.classList.add("active");
  }
}

// ===========================
//  Inventory
// ===========================
function showAddProductModal() {
  document.getElementById("posProductModal").classList.remove("hidden");
  ["productName","productId","productCategory","sellingPrice","costPrice","stockQuantity","stockLimit","productExpiryDate"]
    .forEach(id => document.getElementById(id).value = "");
}

async function saveProduct() {
  const productName = document.getElementById("productName").value.trim();
  const category = document.getElementById("productCategory").value.trim();
  const sellingPrice = parseFloat(document.getElementById("sellingPrice").value) || 0;
  const costPrice = parseFloat(document.getElementById("costPrice").value) || 0;
  const newStockAmount = parseInt(document.getElementById("stockQuantity").value) || 0;
  const stockLimit = parseInt(document.getElementById("stockLimit").value) || 0;
  const expiryDate = document.getElementById("productExpiryDate").value || "";

  if (!productName || !category) { 
    alert("Please fill in all required fields!"); 
    return; 
  }

  try {
    // 1. Search for an existing product with the EXACT same name
    const inventoryRef = shopRef("inventory");
    const nameMatch = await inventoryRef.where("name", "==", productName).get();

    if (!nameMatch.empty) {
      // PRODUCT EXISTS: Update the existing document
      const existingDoc = nameMatch.docs[0];
      const existingData = existingDoc.data();
      const updatedStock = (existingData.stockQuantity || 0) + newStockAmount;

      await inventoryRef.doc(existingDoc.id).update({
        stockQuantity: updatedStock,
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        stockLimit: stockLimit,
        category: category,
        ...(expiryDate && { expiryDate })
      });
      alert(`Stock updated! ${productName} total is now: ${updatedStock}`);
    } else {
      // NEW PRODUCT: Generate a new SKU and save
      // Ensure we use the ID from the input if provided, otherwise generate
      const manualSku = document.getElementById("productId").value.trim();
      const finalSku = manualSku || generateSKU(productName, "P-");

      await inventoryRef.doc(finalSku).set({
        name: productName,
        category: category,
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        stockQuantity: newStockAmount,
        stockLimit: stockLimit,
        expiryDate: expiryDate,
        status: "active",
        createdAt: new Date().toISOString()
      });
      alert("New product added successfully!");
    }

    closeModal("posProductModal");
    loadInventory();
    populateProductSelect();
  } catch (err) {
    console.error("Save error:", err);
    alert("Error saving product.");
  }
}

async function loadInventory() {
  try {
    const snap = await shopRef("inventory").get();
    const tbody = document.getElementById("inventoryTableBody");
    tbody.innerHTML = "";
    const today = new Date(); today.setHours(0,0,0,0);
    const fourMonthsLater = new Date(today); fourMonthsLater.setMonth(fourMonthsLater.getMonth() + 4);
    snap.forEach(doc => {
      const p = doc.data();
      const low = (parseInt(p.stockQuantity) || 0) <= (parseInt(p.stockLimit) || 0);
      let expiryDisplay = p.expiryDate || "—";
      let expiryStyle = "";
      if (p.expiryDate) {
        const exp = parseLocalDate(p.expiryDate);
        if (exp < today) { expiryStyle = 'style="color:#e53e3e;font-weight:bold"'; expiryDisplay = `&#128308; ${p.expiryDate} (Expired)`; }
        else if (exp <= fourMonthsLater) { expiryStyle = 'style="color:#dd6b20;font-weight:bold"'; expiryDisplay = `&#9203; ${p.expiryDate} (Soon)`; }
      }
      let rowStyle = low ? ' style="background:#fff5f5"' : "";
      tbody.innerHTML += `<tr${rowStyle}>
        <td>${doc.id}</td><td>${p.name}</td><td>${p.category}</td>
        <td>GH₵${p.sellingPrice}</td><td>GH${p.costPrice}</td>
        <td>${p.stockQuantity}${low ? " &#9888;" : ""}</td>
        <td>${p.stockLimit}</td>
        <td ${expiryStyle}>${expiryDisplay}</td>
        <td>${p.status}</td>
        <td>
        <button class="btn btn-primary btn-sm" onclick="editProduct('${doc.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${doc.id}')">Delete</button>
        </td>
      </tr>`;
    });
  } catch (err) { console.error("loadInventory:", err); }
}

async function editProduct(sku) {
  try {
    // 1. Fetch data from the active shop's inventory
    const doc = await shopRef("inventory").doc(sku).get();
    
    if (!doc.exists) {
      alert("Product not found!");
      return;
    }
    
    const p = doc.data();

    // 2. Open the Modal (Matches the ID in your screenshots)
    const modal = document.getElementById("posProductModal");
    if (modal) modal.classList.remove("hidden");

    // 3. Fill the inputs (Ensure these IDs match your HTML <input> tags)
    document.getElementById("productId").value = sku;
    document.getElementById("productId").readOnly = true; // Lock the SKU so it can't be changed
    document.getElementById("productName").value = p.name || "";
    document.getElementById("productCategory").value = p.category || "";
    document.getElementById("sellingPrice").value = p.sellingPrice || 0;
    document.getElementById("costPrice").value = p.costPrice || 0;
    document.getElementById("stockQuantity").value = p.stockQuantity || 0;
    document.getElementById("stockLimit").value = p.stockLimit || 0;
    document.getElementById("productExpiryDate").value = p.expiryDate || "";

    // 4. Transform the "Save" button into an "Update" button
    const actionBtn = document.querySelector("#posProductModal .btn-primary");
    if (actionBtn) {
      actionBtn.textContent = "Update Product";
      // Point the button to the update function instead of the add function
      actionBtn.onclick = () => saveProductUpdate(sku);
    }
  } catch (err) {
    console.error("editProduct error:", err);
    alert("Error loading product.");
  }
}

async function saveProductUpdate(sku) {
  const updatedData = {
    name: document.getElementById("productName").value.trim(),
    category: document.getElementById("productCategory").value.trim(),
    sellingPrice: parseFloat(document.getElementById("sellingPrice").value) || 0,
    costPrice: parseFloat(document.getElementById("costPrice").value) || 0,
    stockQuantity: parseInt(document.getElementById("stockQuantity").value) || 0,
    stockLimit: parseInt(document.getElementById("stockLimit").value) || 0,
    expiryDate: document.getElementById("productExpiryDate").value || "",
    lastUpdated: new Date().toISOString()
  };

  try {
    // Update the specific document using the SKU
    await shopRef("inventory").doc(sku).update(updatedData);
    
    alert("Product updated successfully!");

    // Clean up: Close modal and unlock SKU field
    closeModal("posProductModal");
    document.getElementById("productId").readOnly = false;
    
    // Reset the button back to its original "Save Product" state
    const actionBtn = document.querySelector("#posProductModal .btn-primary");
    if (actionBtn) {
      actionBtn.textContent = "Save Product";
      // Point back to your original function that handles adding new products
      actionBtn.onclick = saveProduct; 
    }

    // Refresh the table to show changes
    loadInventory();
  } catch (err) {
    console.error("saveProductUpdate error:", err);
    alert("Update failed.");
  }
}


async function deleteProduct(sku) {
  if (!confirm(`Delete product ${sku}?`)) return;
  await shopRef("inventory").doc(sku).delete();
  loadInventory();
  populateProductSelect();
}

function filterInventory() {
  const q = document.getElementById("inventorySearch").value.toLowerCase();
  document.querySelectorAll("#inventoryTableBody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ===========================
//  POS / Cart
// ===========================
async function populateProductSelect() {
  try {
    const snap = await shopRef("inventory").get();
    const datalist = document.getElementById("productOptions");
    if (!datalist) return;
    
    datalist.innerHTML = ""; 
    snap.forEach(doc => {
      const p = doc.data();
      const option = document.createElement("option");
      option.value = p.name; 
      option.dataset.sku = doc.id;
      option.dataset.price = p.sellingPrice;
      option.dataset.cost = p.costPrice;
      datalist.appendChild(option);
    });
  } catch (err) { console.error("Error populating products:", err); }
}

function handleProductSearch() {
  const input = document.getElementById("productSearchInput");
  const val = input.value;
  const options = document.getElementById("productOptions").childNodes;
  const priceField = document.getElementById("unitPrice");
  const skuField = document.getElementById("selectedProductSku");

  skuField.value = "";
  priceField.value = "";

  for (let i = 0; i < options.length; i++) {
    if (options[i].value === val) {
      skuField.value = options[i].dataset.sku;
      priceField.value = options[i].dataset.price;
      break;
    }
  }
}

function updateProductInfo() {
  const sel = document.getElementById("productSelect");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("unitPrice").value = opt ? (opt.dataset.price || "") : "";
}

function addToCart() {
  // 1. Get values from the NEW searchable elements
  const sku = document.getElementById("selectedProductSku").value;
  const productName = document.getElementById("productSearchInput").value;
  const unitPrice = parseFloat(document.getElementById("unitPrice").value);
  const qty = parseInt(document.getElementById("quantity").value);

  // 2. Validation
  if (!sku || !productName) {
    alert("Please select a valid product from the list.");
    return;
  }
  if (isNaN(unitPrice) || qty <= 0) {
    alert("Please enter a valid quantity.");
    return;
  }

  // 3. Find the cost price from the datalist to keep profit tracking accurate
  const datalist = document.getElementById("productOptions");
  const option = Array.from(datalist.options).find(opt => opt.value === productName);
  const costPrice = option ? parseFloat(option.dataset.cost) : 0;

  // 4. Add to the global cart array
  cart.push({
    sku: sku,
    name: productName,
    price: unitPrice,
    costPrice: costPrice,
    qty: qty
  });

  // 5. Update UI
  renderCart();
  
  // 6. Clear fields for next item
  document.getElementById("productSearchInput").value = "";
  document.getElementById("selectedProductSku").value = "";
  document.getElementById("unitPrice").value = "";
  document.getElementById("quantity").value = "1";
}

function renderCart() {
  const cartItems = document.getElementById("cartItems");
  const subtotalDisplay = document.getElementById("cartSubtotal");
  const totalDisplay = document.getElementById("cartTotal");
  const discountInput = document.getElementById("cartDiscount");

  if (!cartItems) return;

  cartItems.innerHTML = "";
  let subtotal = 0;
  
  // 1. Loop through cart items and calculate subtotal
  cart.forEach((item, i) => {
    const lineTotal = item.price * item.qty;
    subtotal += lineTotal;
    
    // Keep your existing cart-item display style
    cartItems.innerHTML += `
      <div class="cart-item">
        <span>${item.name} x${item.qty}</span>
        <span>GH₵ ${lineTotal.toFixed(2)}</span>
        <button class="btn btn-danger btn-sm" onclick="removeFromCart(${i})">&#10005;</button>
      </div>`;
  });

  // 2. Get the discount value
  const discount = parseFloat(discountInput.value) || 0;
  
  // 3. Calculate final total (ensuring it doesn't go below 0)
  const finalTotal = Math.max(0, subtotal - discount);

  // 4. Update the text displays on the screen
  if (subtotalDisplay) subtotalDisplay.textContent = subtotal.toFixed(2);
  if (totalDisplay) totalDisplay.textContent = finalTotal.toFixed(2);
}
function removeFromCart(i) { cart.splice(i, 1); renderCart(); }
function clearCart() { cart = []; renderCart(); }

function updateCheckoutFields() {
  const type = document.getElementById("paymentType").value;
  const cashGroup = document.getElementById("cashAmountGroup");
  const dueGroup = document.getElementById("dueDateGroup");

  // 1. Reset everything to hidden first
  if (cashGroup) cashGroup.classList.add("hidden");
  if (dueGroup) dueGroup.classList.add("hidden");

  // 2. Show Cash Amount for both Cash and Mobile Money
  if (type === "cash" || type === "momo" || type === "card") {
    if (cashGroup) cashGroup.classList.remove("hidden");
  } 
  
  // 3. Show Due Date only for Credit
  else if (type === "credit") {
    if (dueGroup) dueGroup.classList.remove("hidden");
  }
}

async function processCheckout() {
  const customerName = document.getElementById("customerName").value.trim();
  const customerPhone = document.getElementById("customerPhone").value.trim();
  const paymentType = document.getElementById("paymentType").value;
  
  const subtotal = parseFloat(document.getElementById("cartSubtotal").textContent) || 0;
  const discount = parseFloat(document.getElementById("cartDiscount").value) || 0;
  const total = parseFloat(document.getElementById("cartTotal").textContent) || 0;
  const dueDate = document.getElementById("dueDateInput").value;
  
  if (cart.length === 0) { alert("Cart is empty!"); return; }

  if (paymentType === "credit" && !customerPhone) {
    alert("Customer Phone is required for credit sales.");
    return;
  }

  const saleData = {
    customerName, 
    customerPhone, 
    paymentType, 
    subtotal, discount, total,
    items: cart.map(i => ({ ...i })),
    date: new Date().toISOString(),
    status: paymentType === "credit" ? "pending" : "paid",
    servedBy: currentUser.username
  };

  try {
    // 1. Create the Sale record
    const saleRef = await shopRef("sales").add(saleData);

    // 2. Update Inventory (Batch)
    const batch = db.batch();
    for (const item of cart) {
      const invRef = shopRef("inventory").doc(item.sku);
      const invSnap = await invRef.get();
      if (invSnap.exists) {
        batch.update(invRef, { 
          stockQuantity: (invSnap.data().stockQuantity || 0) - item.qty 
        });
      }
    }
    await batch.commit();

    // 3. Update Debtor tracking
    if (paymentType === "credit") {
      const debtorsRef = shopRef("debtors");
      const querySnap = await debtorsRef.where("phone", "==", customerPhone).get();

      if (!querySnap.empty) {
        const debtorDoc = querySnap.docs[0];
        const currentDebt = debtorDoc.data().remainingDebt || 0;
        
        await debtorsRef.doc(debtorDoc.id).update({
          remainingDebt: currentDebt + total,
          // Update saleId to the latest receipt so Full Pay can find it
          saleId: saleRef.id, 
          name: customerName || debtorDoc.data().name,
          lastUpdate: new Date().toISOString(),
          status: "active"
        });
      } else {
        await debtorsRef.add({
          name: customerName || "Unknown", 
          phone: customerPhone,
          initialAmount: total, 
          remainingDebt: total,
          dateIssued: new Date().toISOString(),
          dueDate: dueDate || "", 
          saleId: saleRef.id, 
          status: "active"
        });
      }
    }

    alert("Sale recorded successfully!");
    clearCart();
    ["customerName", "customerPhone", "cartDiscount"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = (id === "cartDiscount") ? "0" : "";
    });

    loadInventory(); loadSales(); loadDebtors(); populateProductSelect();
    
  } catch (err) { 
    console.error("processCheckout Error:", err); 
    alert("Checkout failed."); 
  }
}

// ===========================
//  Sales
// ===========================
async function loadSales() {
  try {
    const snap = await shopRef("sales").orderBy("date", "desc").get();
    const tbody = document.getElementById("salesTableBody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    
    snap.forEach(doc => {
      const s = doc.data();
      
      // FIX: Skip this row if it's a debt collection/payment
      if (s.type === "debt_collection") {
        return; // This skips to the next iteration in the loop
      }

      const itemList = (s.items || []).map(i => `${i.name} x${i.qty}`).join(", ");
      
      tbody.innerHTML += `<tr>
        <td>${doc.id.substring(0,8)}</td>
        <td>${(s.date || "").split("T")[0]}</td>
        <td>${s.customerName || "Walk-in"}</td>
        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${itemList}">
          ${itemList}
        </td>
        <td>GH₵ ${parseFloat(s.total).toFixed(2)}</td>
        <td>${s.paymentType}</td>
        <td style="color:${s.status === "paid" ? "#38a169" : "#e53e3e"}">
          ${s.status.toUpperCase()}
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="viewSaleDetails('${doc.id}')">View</button>
        </td>
      </tr>`;
    });
  } catch (err) { 
    console.error("loadSales error:", err); 
  }
}

async function viewSaleDetails(saleId) {
  const doc = await shopRef("sales").doc(saleId).get();
  if (!doc.exists) { alert("Sale not found!"); return; }
  const s = doc.data();
  const itemRows = (s.items || []).map(i =>
    `<tr><td>${i.name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:right">GH&#8373;${parseFloat(i.price).toFixed(2)}</td><td style="text-align:right">GH&#8373;${(i.price*i.qty).toFixed(2)}</td></tr>`
  ).join("");
  const modal = document.getElementById("receiptModal");
  document.getElementById("receiptContent").innerHTML = `
    <div style="font-family:monospace;max-width:400px;margin:auto">
      <div style="text-align:center;border-bottom:2px dashed #ccc;padding-bottom:10px;margin-bottom:10px">
        <div style="font-size:18px;font-weight:bold">&#127978; POS RECEIPT</div>
        <div style="font-size:12px;color:#718096">${currentShopId}</div>
        <div style="font-size:12px;color:#718096">Receipt #${saleId.substring(0,8)}</div>
        <div style="font-size:12px;color:#718096">${new Date(s.date).toLocaleString()}</div>
      </div>
      <div style="margin-bottom:8px;font-size:13px">
        <strong>Customer:</strong> ${s.customerName||"Walk-in"}<br>
        <strong>Phone:</strong> ${s.customerPhone||"-"}<br>
        <strong>Served by:</strong> ${s.servedBy||"-"}<br>
        <strong>Payment:</strong> ${s.paymentType} &nbsp; <strong>Status:</strong> <span style="color:${s.status==="paid"?"#38a169":"#e53e3e"}">${s.status}</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:1px dashed #ccc"><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="border-top:2px dashed #ccc;margin-top:8px;padding-top:8px;text-align:right;font-size:15px;font-weight:bold">
        TOTAL: GH₵ ${parseFloat(s.total).toFixed(2)}
      </div>
      <div style="text-align:center;margin-top:12px;font-size:11px;color:#aaa">Thank you for your purchase!</div>
    </div>`;
  modal.classList.remove("hidden");
}

function printReceipt() {
  const content = document.getElementById("receiptContent").innerHTML;
  const win = window.open("", "_blank", "width=400,height=600");
  win.document.write(`<html><head><title>Receipt</title><style>body{font-family:monospace;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px}</style></head><body>${content}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

function showDebtorModal() {
  document.getElementById("addDebtorModal").classList.remove("hidden");
}

async function saveDebtor() {
  const name = document.getElementById("debtorCustomerName").value.trim();
  const phone = document.getElementById("debtorPhone").value.trim();
  const amount = parseFloat(document.getElementById("debtorAmount").value);
  const originalDate = document.getElementById("debtorOriginalDate").value;
  const dueDate = document.getElementById("debtorDueDate").value;
  if (!name || isNaN(amount)) { alert("Please fill in debtor details!"); return; }
  try {
    await shopRef("debtors").add({
      name, phone, initialAmount: amount, remainingDebt: amount,
      dateIssued: originalDate || new Date().toISOString(), dueDate, status: "active"
    });
    alert("Debtor added!");
    closeModal("addDebtorModal");
    loadDebtors();
  } catch (err) { console.error(err); }
}

async function loadDebtors() {
  try {
    const snap = await shopRef("debtors").get();
    const tbody = document.getElementById("debtorsTableBody");
    tbody.innerHTML = "";
    let totalDebt = 0, totalDebtors = 0;
    const today = new Date().toISOString().split("T")[0];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.status !== "paid") { totalDebt += d.remainingDebt || 0; totalDebtors++; }
      const overdue = d.dueDate && d.dueDate < today && d.status !== "paid";
      tbody.innerHTML += `<tr${overdue?' style="background:#fff5f5"':""}>
        <td>${d.name}</td><td>${d.phone||"-"}</td>
        <td>GH₵ ${d.initialAmount.toFixed(2)}</td><td>GH₵ ${d.remainingDebt.toFixed(2)}</td>
        <td>${(d.dateIssued||"").split("T")[0]}</td>
        <td>${d.dueDate||"-"}${overdue?" &#9888;":""}</td>
        <td>${d.status}</td>
        <td><button class="btn btn-success btn-sm" onclick="markDebtorPaid('${doc.id}')">Full Pay</button>
        <button class="btn btn-primary btn-sm" onclick="showPartialPayment('${doc.id}', ${d.remainingDebt||0})">Part Pay</button>
        <button class="btn btn-info btn-sm" onclick="editDebtorRecord('${doc.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteDebtorRecord('${doc.id}')">Delete</button>
        </td>
      </tr>`;
    });
    document.getElementById("totalDebtors").textContent = totalDebtors;
    document.getElementById("totalDebt").textContent = totalDebt.toFixed(2);
  } catch (err) { console.error("loadDebtors:", err); }
}

// Opens modal for a NEW entry
function openAddDebtorModal() {
  document.getElementById("editDebtorId").value = ""; // Clear any stored ID
  document.getElementById("debtorModalTitle").textContent = "Add Existing Debtor";
  document.getElementById("debtorSubmitBtn").textContent = "Add Debtor";
  
  // Clear inputs
  ["debtorName", "debtorPhone", "debtAmount", "debtDate", "debtDueDate"].forEach(id => {
    document.getElementById(id).value = "";
  });
  
  document.getElementById("addDebtorModal").classList.remove("hidden");
}

// Triggered by the "Edit" button in your table
async function editDebtorRecord(id) {
  try {
    const doc = await shopRef("debtors").doc(id).get();
    if (!doc.exists) return;
    const d = doc.data();

    document.getElementById("addDebtorModal").classList.remove("hidden");
    
    // Fill the fields
    document.getElementById("editDebtorId").value = id; 
    document.getElementById("debtorName").value = d.name || "";
    document.getElementById("debtorPhone").value = d.phone || "";
    document.getElementById("debtAmount").value = d.remainingDebt || 0;
    document.getElementById("debtDate").value = (d.dateIssued || "").split("T")[0];
    document.getElementById("debtDueDate").value = d.dueDate || "";

    // Update UI labels
    document.getElementById("debtorModalTitle").textContent = "Edit Debtor Record";
    document.getElementById("debtorSubmitBtn").textContent = "Update Details";
  } catch (err) { console.error(err); }
}

// Unified Submit Logic
async function handleDebtorSubmit() {
  const id = document.getElementById("editDebtorId").value;
  const data = {
    name: document.getElementById("debtorName").value.trim(),
    phone: document.getElementById("debtorPhone").value.trim(),
    remainingDebt: parseFloat(document.getElementById("debtAmount").value) || 0,
    dateIssued: document.getElementById("debtDate").value,
    dueDate: document.getElementById("debtDueDate").value,
    lastUpdate: new Date().toISOString()
  };

  try {
    if (id) {
      // MODE: UPDATE
      await shopRef("debtors").doc(id).update(data);
      alert("Updated!");
    } else {
      // MODE: CREATE
      data.initialAmount = data.remainingDebt;
      data.status = "active";
      await shopRef("debtors").add(data);
      alert("Added!");
    }
    closeModal("addDebtorModal");
    loadDebtors();
  } catch (err) { console.error(err); }
}

function closeDebtorModal() {
  const modal = document.getElementById("addDebtorModal");
  modal.classList.add("hidden");
  
  // RESET MODAL FOR NEXT TIME
  document.getElementById("editDebtorId").value = ""; 
  modal.querySelector("h2").textContent = "Add Existing Debtor";
  document.getElementById("debtorSubmitBtn").textContent = "Add Debtor";
  
  // Clear inputs
  ["debtorName", "debtorPhone", "debtAmount", "debtDate", "debtDueDate"].forEach(id => {
    document.getElementById(id).value = "";
  });
}


async function deleteDebtorRecord(id) {
  const confirmation = confirm("Are you sure you want to delete this debtor? This action cannot be undone.");
  
  if (!confirmation) return;

  try {
    await shopRef("debtors").doc(id).delete();
    alert("Debtor record deleted successfully.");
    
    // Refresh the table and totals
    loadDebtors();
  } catch (err) {
    console.error("deleteDebtorRecord error:", err);
    alert("Failed to delete the record.");
  }
}

async function markDebtorPaid(debtorId) {
  // 1. Ask for confirmation before clearing the debt
  if (!confirm("Are you sure you want to mark this as fully paid? This will also update the Sales History.")) return;

  try {
    const debtorRef = shopRef("debtors").doc(debtorId);
    const snap = await debtorRef.get();
    
    if (!snap.exists) {
      alert("Debtor record not found.");
      return;
    }
    
    const debtorData = snap.data();

    // 2. Update the Debtor record in the 'debtors' collection
    await debtorRef.update({
      remainingDebt: 0,
      status: "paid",
      lastUpdate: new Date().toISOString()
    });

    // 3. Update the linked Sale record in the 'sales' collection
    // This uses the 'saleId' bridge we saved during checkout
    if (debtorData.saleId) {
      await shopRef("sales").doc(debtorData.saleId).update({
        status: "paid"
      });
    }

    alert("Success! Debt cleared and Sales History updated to PAID.");
    
    // 4. Refresh both tables to reflect the changes instantly
    loadDebtors();
    loadSales(); 

  } catch (err) {
    console.error("markDebtorPaid error:", err);
    alert("An error occurred while processing the payment.");
  }
}

function showPartialPayment(id, remaining) {
  document.getElementById("partialPayDebtorId").value = id;
  document.getElementById("partialPayRemaining").textContent = parseFloat(remaining).toFixed(2);
  document.getElementById("partialPayAmount").value = "";
  document.getElementById("partialPaymentModal").classList.remove("hidden");
}

async function savePartialPayment() {
  const id = document.getElementById("partialPayDebtorId").value;
  const amount = parseFloat(document.getElementById("partialPayAmount").value);
  
  if (isNaN(amount) || amount <= 0) { 
    alert("Enter a valid payment amount."); 
    return; 
  }
  
  try {
    const debtorRef = shopRef("debtors").doc(id);
    const doc = await debtorRef.get();
    if (!doc.exists) { 
      alert("Debtor not found!"); 
      return; 
    }
    
    const debtorData = doc.data();
    const remaining = parseFloat(debtorData.remainingDebt) || 0;
    const newRemaining = Math.max(0, remaining - amount);
    
    // --- UPDATED STATUS LOGIC ---
    // If debt reaches 0, it is "paid". 
    // If money was paid but balance remains, it is "part".
    let newStatus = "part"; 
    if (newRemaining <= 0) {
      newStatus = "paid";
    }

    // 1. Update Debtor record
    await debtorRef.update({ 
      remainingDebt: newRemaining, 
      status: newStatus,
      lastUpdate: new Date().toISOString()
    });

    // 2. Update linked Sale record in Sales History
    if (debtorData.saleId) {
      await shopRef("sales").doc(debtorData.saleId).update({
        status: newStatus
      });
    }

    closeModal("partialPaymentModal");
    alert(`Payment recorded. Status updated to: ${newStatus.toUpperCase()}`);
    
    // Refresh both tables to show the "PART" or "PAID" labels
    loadDebtors();
    loadSales();
  } catch (err) { 
    console.error("savePartialPayment Error:", err); 
    alert("Failed to record payment."); 
  }
}

function filterSales() {
  const input = document.getElementById("salesSearchInput");
  const filter = input.value.toLowerCase();
  const tbody = document.getElementById("salesTableBody");
  const rows = tbody.getElementsByTagName("tr");

  for (let i = 0; i < rows.length; i++) {
    // Column index 2 is the 'Customer' column
    const customerCell = rows[i].getElementsByTagName("td")[2];
    
    if (customerCell) {
      const txtValue = customerCell.textContent || customerCell.innerText;
      
      // If the text matches, show the row; otherwise, hide it
      if (txtValue.toLowerCase().indexOf(filter) > -1) {
        rows[i].style.display = "";
      } else {
        rows[i].style.display = "none";
      }
    }
  }
}

async function processDebtorPayment(debtorId, amountPaid) {
  try {
    const debtorRef = shopRef("debtors").doc(debtorId);
    const debtorSnap = await debtorRef.get();
    
    if (!debtorSnap.exists) return;

    const data = debtorSnap.data();
    const newRemaining = (data.remainingDebt || 0) - amountPaid;
    const isFullyPaid = newRemaining <= 0;

    // 1. Update the Debtor record
    await debtorRef.update({
      remainingDebt: Math.max(0, newRemaining),
      status: isFullyPaid ? "paid" : "active",
      lastPaymentDate: new Date().toISOString()
    });

    // 2. NEW: Update the corresponding Sale record to "paid"
    if (isFullyPaid && data.saleId) {
      await shopRef("sales").doc(data.saleId).update({
        status: "paid"
      });
    }

    alert(isFullyPaid ? "Debt fully cleared and Sale updated!" : "Payment recorded.");
    
    // Refresh your tables
    loadSales();
    loadDebtors();
  } catch (err) {
    console.error("Payment error:", err);
  }
}

async function updateDebtor() {
  const debtorId = document.getElementById("editDebtorId").value;
  const name = document.getElementById("editDebtorName").value.trim();
  const phone = document.getElementById("editDebtorPhone").value.trim();
  const remainingDebt = parseFloat(document.getElementById("editRemainingDebt").value) || 0;
  const dueDate = document.getElementById("editDueDate").value;

  try {
    const debtorRef = shopRef("debtors").doc(debtorId);
    const snap = await debtorRef.get();
    
    if (!snap.exists) return;
    const debtorData = snap.data();

    // --- UPDATED STATUS LOGIC ---
    // 1. If balance is 0 or less, it's 'paid'
    // 2. If balance is less than what they originally owed, it's 'part'
    // 3. Otherwise, it remains 'active' (or 'pending' in sales)
    let newStatus = "active";
    let salesStatus = "pending";

    if (remainingDebt <= 0) {
      newStatus = "paid";
      salesStatus = "paid";
    } else if (remainingDebt < (debtorData.initialAmount || 0)) {
      newStatus = "partial";
      salesStatus = "part"; // This matches your requirement for 'part' label
    }

    // 2. Update the Debtor record
    await debtorRef.update({
      name, 
      phone, 
      remainingDebt, 
      dueDate,
      status: newStatus,
      lastUpdate: new Date().toISOString()
    });

    // 3. Update the linked Sales record in the Sales History
    if (debtorData.saleId) {
      await shopRef("sales").doc(debtorData.saleId).update({
        status: salesStatus 
      });
    }

    alert(remainingDebt <= 0 ? "Debt cleared and Sale marked as Paid!" : "Payment updated to Partial.");
    closeModal("editDebtorModal");
    
    // Refresh both tables to show updated status labels
    loadDebtors();
    loadSales(); 
  } catch (err) {
    console.error("updateDebtor error:", err);
    alert("Error updating debtor.");
  }
}


// ===========================
//  Receiving (Inbound) — updates Warehouse Inventory
// ===========================
async function populateWarehouseSelects() {
  try {
    const snap = await shopRef("warehouseInventory").get();
    const opts = `<option value="">-- Select existing or enter new below --</option>` +
      snap.docs.map(d => `<option value="${d.id}" data-name="${d.data().name}" data-cat="${d.data().category||""}" data-loc="${d.data().location||""}" data-cost="${d.data().costPrice||0}">${d.data().name} (${d.id})</option>`).join("");
    const dispOpts = `<option value="">-- Select Product --</option>` +
      snap.docs.map(d => `<option value="${d.id}" data-name="${d.data().name}" data-stock="${d.data().stockQuantity||0}">${d.data().name} — Stock: ${d.data().stockQuantity||0} (${d.id})</option>`).join("");
    const adjOpts = `<option value="">-- Select Product --</option>` +
      snap.docs.map(d => `<option value="${d.id}" data-name="${d.data().name}" data-stock="${d.data().stockQuantity||0}">${d.data().name} — Stock: ${d.data().stockQuantity||0} (${d.id})</option>`).join("");

    const inSel = document.getElementById("inWarehouseSelect");
    const outSel = document.getElementById("outWarehouseSelect");
    const adjSel = document.getElementById("adjustWarehouseSelect");
    if (inSel) inSel.innerHTML = opts;
    if (outSel) outSel.innerHTML = dispOpts;
    if (adjSel) adjSel.innerHTML = adjOpts;
  } catch (err) { console.error("populateWarehouseSelects:", err); }
}

function fillInboundFromWarehouse() {
  const sel = document.getElementById("inWarehouseSelect");
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    ["inProductId","inProductName","inCategory","inLocation"].forEach(id => document.getElementById(id).value = "");
    return;
  }
  document.getElementById("inProductId").value = opt.value;
  document.getElementById("inProductName").value = opt.dataset.name || "";
  document.getElementById("inCategory").value = opt.dataset.cat || "";
  document.getElementById("inLocation").value = opt.dataset.loc || "";
  document.getElementById("inCost").value = opt.dataset.cost || 0;
}

function fillOutboundFromWarehouse() {
  const sel = document.getElementById("outWarehouseSelect");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("outProductId").value = opt && opt.value ? opt.value : "";
}

function fillAdjustFromWarehouse() {
  const sel = document.getElementById("adjustWarehouseSelect");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("adjustProductId").value = opt && opt.value ? opt.value : "";
}

async function addInbound() {
  const sku = document.getElementById("inProductId").value.trim();
  const name = document.getElementById("inProductName").value.trim();
  const category = document.getElementById("inCategory").value.trim();
  const qty = parseInt(document.getElementById("inQty").value);
  const cost = parseFloat(document.getElementById("inCost").value);
  const location = document.getElementById("inLocation").value.trim();
  if (!name || !category || isNaN(qty) || qty <= 0 || isNaN(cost)) { alert("Please fill in all required fields!"); return; }
  const finalSku = sku || generateSKU(name, "IN-");
  try {
    // Record in receiving log
    await shopRef("receiving").add({ sku: finalSku, name, category, qty, cost, location, date: new Date().toISOString() });

    // Update or create in warehouseInventory
    const whRef = shopRef("warehouseInventory").doc(finalSku);
    const whSnap = await whRef.get();
    if (whSnap.exists) {
      const existing = whSnap.data();
      await whRef.update({
        stockQuantity: (parseInt(existing.stockQuantity) || 0) + qty,
        costPrice: cost, // update cost price to latest
        location: location || existing.location
      });
    } else {
      await whRef.set({ name, category, costPrice: cost, stockQuantity: qty, location, status: "active" });
    }

    alert(`✓ Inbound recorded! ${qty} x "${name}" added to Warehouse Inventory.`);
    ["inProductId","inProductName","inCategory","inLocation"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("inQty").value = 1;
    document.getElementById("inCost").value = 0;
    document.getElementById("inWarehouseSelect").value = "";
    loadInbound();
    loadWarehouseInventory();
    populateWarehouseSelects();
  } catch (err) { console.error(err); alert("Failed to record inbound."); }
}

async function loadInbound() {
  try {
    const snap = await shopRef("receiving").orderBy("date","desc").get();
    const tbody = document.getElementById("inboundTableBody");
    tbody.innerHTML = "";
    snap.forEach(doc => {
      const r = doc.data();
      tbody.innerHTML += `<tr>
        <td>${(r.date||"").split("T")[0]}</td><td>${r.sku}</td>
        <td>${r.name}</td><td>${r.qty}</td><td>GH₵ ${r.cost.toFixed(2)}</td><td>${r.location||"-"}</td>
      </tr>`;
    });
  } catch (err) { console.error("loadInbound:", err); }
}

// ===========================
//  Dispatch (Outbound) — deducts Warehouse, pushes to shop if valid Shop ID
// ===========================
async function addOutbound() {
  const sku = document.getElementById("outProductId").value.trim();
  const qty = parseInt(document.getElementById("outQty").value);
  const destination = document.getElementById("outDestination").value.trim();
  
  if (!sku || isNaN(qty) || qty <= 0 || !destination) { 
    alert("Please fill in all fields."); 
    return; 
  }

  try {
    // 1. Verify warehouse stock level
    const whRef = shopRef("warehouseInventory").doc(sku);
    const whSnap = await whRef.get();
    
    if (!whSnap.exists) { 
      alert(`SKU "${sku}" not found in Warehouse.`); 
      return; 
    }
    
    const whData = whSnap.data();
    const currentStock = parseInt(whData.stockQuantity) || 0;
    
    if (currentStock < qty) {
      alert(`Insufficient stock! Available: ${currentStock}, Requested: ${qty}`);
      return;
    }

    // 2. Deduct from Warehouse
    await whRef.update({ stockQuantity: currentStock - qty });

    // 3. Sync with Destination Shop Inventory
    let pushedToShop = false;
    const shopDoc = await db.collection("shops").doc(destination).get();
    
    if (shopDoc.exists) {
      // Reference to the inventory collection in the TARGET shop
      const targetInvRef = db.collection("shops").doc(destination).collection("inventory").doc(sku);
      const targetSnap = await targetInvRef.get();

      if (targetSnap.exists) {
        // Update existing stock in the shop
        const existingQty = parseInt(targetSnap.data().stockQuantity) || 0;
        await targetInvRef.update({ 
          stockQuantity: existingQty + qty,
          lastUpdated: new Date().toISOString() 
        });
      } else {
        // Create the product in the shop using Warehouse data
        await targetInvRef.set({
          name: whData.name,
          category: whData.category || "General",
          costPrice: whData.costPrice || 0,
          sellingPrice: whData.costPrice || 0, // Default selling price to cost price
          stockQuantity: qty,
          stockLimit: 5, // Default low stock warning
          status: "active",
          createdAt: new Date().toISOString()
        });
      }
      pushedToShop = true;
    }

    // 4. Log the dispatch event
    await shopRef("dispatch").add({
      sku, 
      name: whData.name, 
      qty, 
      destination,
      pushedToShop, 
      date: new Date().toISOString()
    });

    alert(pushedToShop 
      ? `✓ Success! ${qty} units of "${whData.name}" moved to shop "${destination}".` 
      : `✓ Dispatched ${qty} units to "${destination}" (External destination).`
    );

    // Reset UI
    document.getElementById("outProductId").value = "";
    document.getElementById("outQty").value = 1;
    document.getElementById("outDestination").value = "";
    document.getElementById("outWarehouseSelect").value = "";
    
    // Refresh data
    loadOutbound();
    loadWarehouseInventory();
    populateWarehouseSelects();
    
  } catch (err) { 
    console.error("Outbound Error:", err); 
    alert("Failed to complete dispatch."); 
  }
}

async function loadOutbound() {
  try {
    const snap = await shopRef("dispatch").orderBy("date","desc").get();
    const tbody = document.getElementById("outboundTableBody");
    tbody.innerHTML = "";
    snap.forEach(doc => {
      const o = doc.data();
      tbody.innerHTML += `<tr>
        <td>${(o.date||"").split("T")[0]}</td>
        <td>${o.sku}</td>
        <td>${o.name||"-"}</td>
        <td>${o.qty}</td>
        <td>${o.destination||"-"}</td>
        <td style="color:${o.pushedToShop?"#38a169":"#718096"}">${o.pushedToShop?"✓ Yes":"External"}</td>
      </tr>`;
    });
  } catch (err) { console.error("loadOutbound:", err); }
}

// ===========================
//  Adjustments — applies to Warehouse Inventory
// ===========================
async function applyAdjustment() {
  const sku = document.getElementById("adjustProductId").value.trim();
  const change = parseInt(document.getElementById("adjustQtyChange").value);
  const reason = document.getElementById("adjustReason").value;
  if (!sku || isNaN(change) || change === 0) { alert("Please select a product and enter a non-zero quantity."); return; }
  try {
    const whRef = shopRef("warehouseInventory").doc(sku);
    const whSnap = await whRef.get();
    if (!whSnap.exists) { alert(`SKU "${sku}" not found in Warehouse Inventory.`); return; }
    const currentQty = parseInt(whSnap.data().stockQuantity) || 0;
    const newQty = Math.max(0, currentQty + change);
    await whRef.update({ stockQuantity: newQty });
    await shopRef("adjustments").add({ sku, change, reason, date: new Date().toISOString(), by: currentUser.username });
    alert(`✓ Adjustment applied! "${whSnap.data().name}" stock: ${currentQty} → ${newQty}`);
    document.getElementById("adjustProductId").value = "";
    document.getElementById("adjustQtyChange").value = 0;
    document.getElementById("adjustWarehouseSelect").value = "";
    loadAdjustments();
    loadWarehouseInventory();
    populateWarehouseSelects();
  } catch (err) { console.error(err); alert("Failed to apply adjustment."); }
}

async function loadAdjustments() {
  try {
    const snap = await shopRef("adjustments").get();
    const tbody = document.getElementById("adjustmentsTableBody");
    tbody.innerHTML = "";
    snap.forEach(doc => {
      const a = doc.data();
      tbody.innerHTML += `<tr>
        <td>${(a.date||"").split("T")[0]}</td><td>${a.sku}</td>
        <td style="color:${a.change>=0?"#38a169":"#e53e3e"}">${a.change>0?"+":""}${a.change}</td>
        <td>${a.reason}</td><td>${a.by||"-"}</td>
      </tr>`;
    });
  } catch (err) { console.error("loadAdjustments:", err); }
}

// ===========================
//  Warehouse Inventory
// ===========================
function showWarehouseProductModal() {
  document.getElementById("warehouseProductModal").classList.remove("hidden");
  document.getElementById("warehouseProductName").value = "";
  document.getElementById("warehouseProductId").value = "";
}

async function saveWarehouseProduct() {
  const name = document.getElementById("warehouseProductName").value.trim();
  const category = document.getElementById("warehouseProductCategory").value.trim();
  const costPrice = parseFloat(document.getElementById("warehouseCostPrice").value) || 0;
  const stockQuantity = parseInt(document.getElementById("warehouseStockQuantity").value) || 0;
  const location = document.getElementById("warehouseProductLocation").value.trim();
  if (!name || !category) { alert("Please fill in all required fields!"); return; }
  const sku = document.getElementById("warehouseProductId").value || generateSKU(name, "W-");
  try {
    await shopRef("warehouseInventory").doc(sku).set({ name, category, costPrice, stockQuantity, location, status: "active" });
    alert("Warehouse product saved!");
    closeModal("warehouseProductModal");
    loadWarehouseInventory();
  } catch (err) { console.error(err); }
}

async function loadWarehouseInventory() {
  try {
    const snap = await shopRef("warehouseInventory").get();
    const tbody = document.getElementById("warehouseInventoryTableBody");
    tbody.innerHTML = "";
    snap.forEach(doc => {
      const p = doc.data();
      tbody.innerHTML += `<tr>
        <td>${doc.id}</td><td>${p.name}</td><td>${p.category}</td>
        <td>GH₵ ${p.costPrice.toFixed(2)}</td><td>${p.stockQuantity}</td>
        <td>${p.location||"-"}</td><td>${p.status}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="editWarehouseProduct('${doc.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteWarehouseProduct('${doc.id}')">Delete</button>
        </td>
      </tr>`;
    });
  } catch (err) { console.error("loadWarehouseInventory:", err); }
}

async function editWarehouseProduct(sku) {
  const doc = await shopRef("warehouseInventory").doc(sku).get();
  if (!doc.exists) { alert("Product not found!"); return; }
  const p = doc.data();
  document.getElementById("warehouseProductId").value = sku;
  document.getElementById("warehouseProductName").value = p.name || "";
  document.getElementById("warehouseProductCategory").value = p.category || "";
  document.getElementById("warehouseCostPrice").value = p.costPrice || 0;
  document.getElementById("warehouseStockQuantity").value = p.stockQuantity || 0;
  document.getElementById("warehouseProductLocation").value = p.location || "";
  document.getElementById("warehouseProductModal").classList.remove("hidden");
}

async function deleteWarehouseProduct(sku) {
  if (!confirm(`Delete warehouse product ${sku}?`)) return;
  await shopRef("warehouseInventory").doc(sku).delete();
  loadWarehouseInventory();
}

function filterWarehouseInventory() {
  const q = document.getElementById("warehouseInventorySearch").value.toLowerCase();
  document.querySelectorAll("#warehouseInventoryTableBody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ===========================
//  Warehouse Reports
// ===========================
async function loadWarehouseReports() {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [inSnap, outSnap] = await Promise.all([shopRef("receiving").get(), shopRef("dispatch").get()]);
    let todayIn = 0, todayOut = 0;
    const summary = {};
    inSnap.forEach(doc => {
      const r = doc.data(); const date = (r.date||"").split("T")[0];
      summary[date] = summary[date] || { inbound: 0, outbound: 0 };
      summary[date].inbound += r.qty || 0;
      if (date === today) todayIn += r.qty || 0;
    });
    outSnap.forEach(doc => {
      const o = doc.data(); const date = (o.date||"").split("T")[0];
      summary[date] = summary[date] || { inbound: 0, outbound: 0 };
      summary[date].outbound += o.qty || 0;
      if (date === today) todayOut += o.qty || 0;
    });
    document.getElementById("todayInbound").textContent = todayIn;
    document.getElementById("todayOutbound").textContent = todayOut;
    renderWarehouseReports(summary);
  } catch (err) { console.error("loadWarehouseReports:", err); }
}

function renderWarehouseReports(summary) {
  const tbody = document.getElementById("movementSummaryBody");
  tbody.innerHTML = "";
  for (const date in summary) {
    const m = summary[date];
    tbody.innerHTML += `<tr><td>${date}</td><td>${m.inbound}</td><td>${m.outbound}</td><td>${m.inbound - m.outbound}</td></tr>`;
  }
  const ctx = document.getElementById("stockMovementsChart").getContext("2d");
  if (window.stockChart) window.stockChart.destroy();
  window.stockChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Object.keys(summary),
      datasets: [
        { label: "Inbound", data: Object.values(summary).map(m => m.inbound), borderColor: "#38a169", fill: false },
        { label: "Outbound", data: Object.values(summary).map(m => m.outbound), borderColor: "#e53e3e", fill: false }
      ]
    }
  });
}

// ===========================
//  Creditors
// ===========================
// Add Creditor - Ensures remainingBalance is set on creation
async function addCreditor() {
  const name = document.getElementById("creditorName").value.trim();
  const amountInput = document.getElementById("creditorAmount").value;
  const amount = parseFloat(amountInput);
  const dueDate = document.getElementById("creditorDueDate").value;
  
  if (!name || isNaN(amount) || amount <= 0) { 
    alert("Please enter a valid name and amount!"); 
    return; 
  }
  
  try {
    await shopRef("creditors").add({ 
      name, 
      amount: amount,           // Original total
      remainingBalance: amount, // Start balance same as amount
      dueDate, 
      status: "unpaid",
      createdAt: new Date().toISOString()
    });
    
    alert("Creditor added successfully!");
    
    // Reset form fields
    document.getElementById("creditorName").value = "";
    document.getElementById("creditorAmount").value = "0";
    document.getElementById("creditorDueDate").value = "";
    
    loadCreditors();
  } catch (err) { 
    console.error("Error adding creditor:", err); 
  }
}

// Load Creditors - Renders the table with BOTH buttons and updates Dashboard
async function loadCreditors() {
  try {
    const snap = await shopRef("creditors").get();
    const tbody = document.getElementById("creditorsTableBody");
    tbody.innerHTML = "";
    let totalUnpaid = 0;

    snap.forEach(doc => {
      const c = doc.data();
      // Use remainingBalance if available, fallback to original amount
      const currentBalance = (c.remainingBalance !== undefined) ? Number(c.remainingBalance) : Number(c.amount || 0);
      
      if (c.status !== "paid") totalUnpaid += currentBalance;

      tbody.innerHTML += `
        <tr>
          <td>${doc.id.substring(0, 8)}</td>
          <td>${c.name}</td>
          <td style="font-weight: bold;">GH₵ ${currentBalance.toFixed(2)}</td>
          <td>${c.dueDate || "-"}</td>
          <td><span class="status-badge status-${c.status}">${c.status}</span></td>
          <td>
            <div style="display:flex; gap:5px; justify-content: center;">
              <button class="btn btn-success btn-sm" onclick="openCreditorPartPay('${doc.id}', ${currentBalance})">Part Pay</button>
              <button class="btn btn-primary btn-sm" onclick="markCreditorPaid('${doc.id}')">Full Paid</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCreditor('${doc.id}')">Delete</button>
            </div>
          </td>
        </tr>`;
    });

    // Update section total
    document.getElementById("totalCredits").textContent = totalUnpaid.toFixed(2);
    
    // Update main dashboard card
    const dashOwed = document.getElementById("dashCreditorsOwed");
    if (dashOwed) dashOwed.textContent = `GH₵ ${totalUnpaid.toFixed(2)}`;

  } catch (err) {
    console.error("loadCreditors error:", err);
  }
}

// Open Part Payment Modal
function openCreditorPartPay(id, currentBalance) {
    const modal = document.getElementById("creditorPartPayModal");
    const idInput = document.getElementById("partPayCreditorId");
    const balanceText = document.getElementById("creditorCurrentBalanceDisplay");
    
    if (modal && idInput && balanceText) {
        idInput.value = id;
        balanceText.textContent = currentBalance.toFixed(2);
        document.getElementById("creditorPartPayAmount").value = ""; // Clear previous input
        modal.classList.remove("hidden");
    }
}


async function saveCreditorPartPayment() {
    const id = document.getElementById("partPayCreditorId").value;
    const amountToDeduct = parseFloat(document.getElementById("creditorPartPayAmount").value);
    
    if (isNaN(amountToDeduct) || amountToDeduct <= 0) { 
        alert("Please enter a valid payment amount."); 
        return; 
    }

    try {
        const docRef = shopRef("creditors").doc(id);
        const doc = await docRef.get();
        const currentData = doc.data();
        
        const currentBalance = (currentData.remainingBalance !== undefined) ? currentData.remainingBalance : currentData.amount;
        const newBalance = Math.max(0, currentBalance - amountToDeduct);

        await docRef.update({
            remainingBalance: newBalance,
            status: newBalance <= 0 ? "paid" : "partial"
        });

        closeModal('creditorPartPayModal');
        loadCreditors(); // This refreshes the dashboard automatically
    } catch (err) {
        console.error("Payment failed:", err);
    }
}

// Mark as Full Paid
async function markCreditorPaid(id) {
  if (!confirm("Are you sure you want to mark this as fully paid?")) return;
  try {
    await shopRef("creditors").doc(id).update({ 
      remainingBalance: 0, 
      status: "paid",
      paidAt: new Date().toISOString()
    });
    loadCreditors();
  } catch (err) {
    console.error("Error marking as paid:", err);
  }
}

async function deleteCreditor(id) {
  if (!confirm("Are you sure you want to delete this creditor record? This cannot be undone.")) return;

  try {
    await shopRef("creditors").doc(id).delete();
    
    // Refresh the table and the dashboard totals
    loadCreditors(); 
    
    // Optional: If you have a separate dashboard refresh function, call it here
    if (typeof updateDashboardStats === "function") updateDashboardStats();
    
    alert("Creditor record deleted.");
  } catch (err) {
    console.error("Error deleting creditor:", err);
    alert("Failed to delete record.");
  }
}


// ===========================
//  Dashboard
// ===========================
function parseLocalDate(str) {
  const parts = str.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

async function loadDashboard() {
  if (!currentShopId) return;
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  let todayRevenue = 0, monthRevenue = 0, todayProfit = 0, monthProfit = 0;
  const itemSales = {};
  const last7Days = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    last7Days[d.toISOString().split("T")[0]] = 0;
  }
  try {
    const salesSnap = await shopRef("sales").get();
    salesSnap.forEach(doc => {
      const s = doc.data();
      const saleDate = (s.date||"").split("T")[0];
      const total = parseFloat(s.total) || 0;
      if (saleDate === today) todayRevenue += total;
      if (s.date >= firstOfMonth) monthRevenue += total;
      let saleCost = 0;
      (s.items||[]).forEach(item => {
        const qty = item.qty || 1;
        saleCost += (parseFloat(item.costPrice)||0) * qty;
        if (!itemSales[item.name]) itemSales[item.name] = { units: 0, revenue: 0 };
        itemSales[item.name].units += qty;
        itemSales[item.name].revenue += (item.price||0) * qty;
      });
      const profit = total - saleCost;
      if (saleDate === today) todayProfit += profit;
      if (s.date >= firstOfMonth) monthProfit += profit;
      if (last7Days.hasOwnProperty(saleDate)) last7Days[saleDate] += total;
    });
    document.getElementById("dashTodayRevenue").textContent = `GH₵ ${todayRevenue.toFixed(2)}`;
    document.getElementById("dashMonthRevenue").textContent = `GH₵ ${monthRevenue.toFixed(2)}`;
    document.getElementById("dashTodayProfit").textContent = `GH₵ ${todayProfit.toFixed(2)}`;
    document.getElementById("dashMonthProfit").textContent = `GH₵ ${monthProfit.toFixed(2)}`;

    const sorted = Object.entries(itemSales).sort((a,b) => b[1].units - a[1].units).slice(0,10);
    document.getElementById("dashTopItems").innerHTML = sorted.length === 0
      ? `<tr><td colspan="3" style="text-align:center;color:#718096">No sales data yet</td></tr>`
      : sorted.map(([name,d],i)=>{
        const m = i===0?"&#127941;":i===1?"&#127942;":i===2?"&#127943;":`${i+1}.`;
        return `<tr><td>${m} ${name}</td><td>${d.units}</td><td>GH₵ ${d.revenue.toFixed(2)}</td></tr>`;
      }).join("");

    const ctx = document.getElementById("dashRevenueChart").getContext("2d");
    if (window.dashChart) window.dashChart.destroy();
    window.dashChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: Object.keys(last7Days).map(d => new Date(d+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})),
        datasets: [{ label: "Revenue", data: Object.values(last7Days), backgroundColor: "#3182ce", borderRadius: 4 }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    const debtorsSnap = await shopRef("debtors").get();
    let totalDebtors = 0, outstandingDebt = 0, overdueItems = [];
    debtorsSnap.forEach(doc => {
      const d = doc.data();
      if (d.status !== "paid") {
        totalDebtors++; outstandingDebt += parseFloat(d.remainingDebt)||0;
        if (d.dueDate && d.dueDate < today) overdueItems.push(d);
      }
    });
    document.getElementById("dashTotalDebtors").textContent = totalDebtors;
    document.getElementById("dashOutstandingDebt").textContent = `GH₵ ${outstandingDebt.toFixed(2)}`;
    document.getElementById("dashOverdueList").innerHTML = overdueItems.length === 0
      ? `<p style="color:#38a169;font-size:13px">No overdue debtors</p>`
      : overdueItems.slice(0,5).map(d=>`<div class="dash-overdue-item"><span>${d.name}</span><span style="color:#e53e3e">GH₵${parseFloat(d.remainingDebt).toFixed(2)} — due ${d.dueDate}</span></div>`).join("");

    const creditorsSnap = await shopRef("creditors").get();
    let creditorsOwed = 0;
    creditorsSnap.forEach(doc => { const c = doc.data(); if (c.status!=="paid") creditorsOwed += parseFloat(c.amount)||0; });
    document.getElementById("dashCreditorsOwed").textContent = `GH₵ ${creditorsOwed.toFixed(2)}`;

    const invSnap = await shopRef("inventory").get();
    let lowCount = 0; const lowRows = [];
    invSnap.forEach(doc => {
      const p = doc.data();
      if ((parseInt(p.stockQuantity)||0) <= (parseInt(p.stockLimit)||0)) {
        lowCount++;
        const label = parseInt(p.stockQuantity)===0 ? "&#128308; Out of Stock" : "&#127997; Low Stock";
        lowRows.push(`<div class="dash-stock-item"><span>${p.name}</span><span>${label} (${p.stockQuantity} left)</span></div>`);
      }
    });
    document.getElementById("dashLowStockList").innerHTML = lowCount === 0
      ? `<p style="color:#38a169;font-size:13px">All items well stocked</p>`
      : lowRows.join("");

    // Expiry alerts — reuse invSnap already fetched above
    const expiryRows = [];
    const todayDate = new Date(); todayDate.setHours(0,0,0,0);
    const fourMonths = new Date(todayDate); fourMonths.setMonth(fourMonths.getMonth() + 4);
    invSnap.forEach(doc => {
      const p = doc.data();
      const raw = (p.expiryDate || "").trim();
      if (!raw) return;
      const exp = parseLocalDate(raw);
      if (isNaN(exp.getTime())) return;
      if (exp < todayDate) {
        expiryRows.push({ name: p.name, expiryDate: raw, label: "&#128308; EXPIRED", color: "#e53e3e" });
      } else if (exp <= fourMonths) {
        const daysLeft = Math.ceil((exp - todayDate) / (1000 * 60 * 60 * 24));
        expiryRows.push({ name: p.name, expiryDate: raw, label: `&#9203; ${daysLeft}d left`, color: "#dd6b20" });
      }
    });
    expiryRows.sort((a, b) => parseLocalDate(a.expiryDate) - parseLocalDate(b.expiryDate));
    document.getElementById("dashExpiryList").innerHTML = expiryRows.length === 0
      ? `<p style="color:#38a169;font-size:13px">No products expiring soon</p>`
      : expiryRows.map(e => `<div class="dash-stock-item"><span>${e.name}</span><span style="color:${e.color};font-weight:bold">${e.label} — ${e.expiryDate}</span></div>`).join("");
  } catch (err) { console.error("loadDashboard:", err); }
}

// ===========================
//  Clear All Data
// ===========================
function showClearDataModal() {
  document.getElementById("clearDataConfirmInput").value = "";
  document.getElementById("clearDataModal").classList.remove("hidden");
}

async function confirmClearAllData() {
  if (document.getElementById("clearDataConfirmInput").value.trim() !== "DELETE") {
    alert("Type DELETE exactly to confirm.");
    return;
  }
  const collections = ["inventory","sales","debtors","creditors","receiving","dispatch","adjustments","warehouseInventory"];
  try {
    for (const col of collections) {
      const snap = await shopRef(col).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    closeModal("clearDataModal");
    alert("All shop data cleared!");
    loadInventory(); loadSales(); loadDebtors(); loadCreditors();
  } catch (err) { console.error(err); alert("Failed to clear data."); }
}

// ===========================
//  Add Shop User Modal
// ===========================
function showAddAdminModal() {
  ["adminShopId","adminUsername","adminPassword"].forEach(id => document.getElementById(id).value = "");
  const roleEl = document.getElementById("adminRole");
  if (roleEl) roleEl.value = "staff";
  // If a shop user opens this, lock the shopId to their own shop
  if (currentUser.role !== "superadmin" && currentShopId) {
    const shopField = document.getElementById("adminShopId");
    shopField.value = currentShopId;
    shopField.readOnly = true;
  } else {
    document.getElementById("adminShopId").readOnly = false;
  }
  document.getElementById("addAdminModal").classList.remove("hidden");
}

async function saveAdmin() {
  const shopId = document.getElementById("adminShopId").value.trim();
  const username = document.getElementById("adminUsername").value.trim();
  const password = document.getElementById("adminPassword").value.trim();
  const role = document.getElementById("adminRole").value;
  if (!shopId || !username || !password) { alert("All fields are required."); return; }
  try {
    const shopDoc = await db.collection("shops").doc(shopId).get();
    if (!shopDoc.exists) {
      await db.collection("shops").doc(shopId).set({ createdAt: new Date().toISOString(), name: shopId });
    }
    await db.collection("shops").doc(shopId).collection("users").doc(username).set({
      username, password, role, createdAt: new Date().toISOString()
    });
    // Keep top-level credentials for owner/admin (legacy login path)
    if (role === "owner" || role === "admin") {
      await db.collection("shops").doc(shopId).update({ username, password, role });
    }
    closeModal("addAdminModal");
    alert(`User "${username}" (${role}) added to shop "${shopId}"`);
    if (currentUser.role === "superadmin") loadSAShops();
  } catch (err) { console.error(err); alert("Failed to add user."); }
}

// ===========================
//  Super Admin Panel
// ===========================
async function loadSAShops() {
  try {
    const snap = await db.collection("shops").get();
    const tbody = document.getElementById("saShopsTableBody");
    tbody.innerHTML = "";
    let totalShops = 0, grandRevenue = 0, grandDebt = 0;

    for (const doc of snap.docs) {
      totalShops++;
      const shopId = doc.id;
      const [salesSnap, invSnap, debtorsSnap] = await Promise.all([
        db.collection("shops").doc(shopId).collection("sales").get(),
        db.collection("shops").doc(shopId).collection("inventory").get(),
        db.collection("shops").doc(shopId).collection("debtors").get()
      ]);
      let revenue = 0, debt = 0;
      salesSnap.forEach(s => revenue += parseFloat(s.data().total)||0);
      debtorsSnap.forEach(d => { if (d.data().status !== "paid") debt += parseFloat(d.data().remainingDebt)||0; });
      grandRevenue += revenue;
      grandDebt += debt;
      tbody.innerHTML += `<tr>
        <td><strong>${shopId}</strong></td>
        <td>${invSnap.size}</td>
        <td>${salesSnap.size}</td>
        <td>GH&#8373; ${revenue.toFixed(2)}</td>
        <td>GH&#8373; ${debt.toFixed(2)}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="saSwitchToShop('${shopId}')">&#128269; View</button>
          <button class="btn btn-danger btn-sm" onclick="saDeleteShop('${shopId}')">&#128465; Delete</button>
        </td>
      </tr>`;
    }
    document.getElementById("saTotalShops").textContent = totalShops;
    document.getElementById("saGrandRevenue").textContent = `GH₵ ${grandRevenue.toFixed(2)}`;
    document.getElementById("saGrandDebt").textContent = `GH₵ ${grandDebt.toFixed(2)}`;
  } catch (err) { console.error("loadSAShops:", err); }
}

function saSwitchToShop(shopId) {
  currentShopId = shopId;
  document.getElementById("superAdminPanel").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  document.getElementById("currentUser").textContent = `Superadmin viewing: ${shopId}`;
  document.getElementById("saBackBtn").classList.remove("hidden");
  document.querySelectorAll(".admin-only").forEach(el => el.style.display = "");
  loadInventory(); loadSales(); loadDebtors(); loadCreditors();
  loadWarehouseInventory(); loadWarehouseReports(); loadInbound(); loadOutbound(); loadAdjustments();
  populateProductSelect(); populateWarehouseSelects();
}

function saBackToPanel() {
  currentShopId = null;
  document.getElementById("mainApp").classList.add("hidden");
  document.getElementById("superAdminPanel").classList.remove("hidden");
  document.getElementById("saBackBtn").classList.add("hidden");
  loadSAShops();
}

async function saDeleteShop(shopId) {
  if (!confirm(`Permanently delete ALL data for shop "${shopId}"?`)) return;
  const collections = ["inventory","sales","debtors","creditors","receiving","dispatch","adjustments","warehouseInventory","users"];
  try {
    for (const col of collections) {
      const snap = await db.collection("shops").doc(shopId).collection(col).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
    await db.collection("shops").doc(shopId).delete();
    alert(`Shop "${shopId}" deleted.`);
    loadSAShops();
  } catch (err) { console.error(err); alert("Failed to delete shop."); }
}

function showSAAddShopModal() {
  ["adminShopId","adminUsername","adminPassword"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("adminRole").value = "owner";
  document.getElementById("adminShopId").readOnly = false;
  document.getElementById("addAdminModal").classList.remove("hidden");
}

// ===========================
//  Manage Shop Users
// ===========================
async function loadShopUsers() {
  document.getElementById("usersShopLabel").textContent = currentShopId;
  try {
    const snap = await db.collection("shops").doc(currentShopId).collection("users").get();
    const tbody = document.getElementById("usersTableBody");
    tbody.innerHTML = "";
    if (snap.empty) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#718096">No users found. Add one above.</td></tr>`;
      return;
    }
    snap.forEach(doc => {
      const u = doc.data();
      tbody.innerHTML += `<tr>
        <td>${u.username}</td>
        <td><span class="role-badge role-${u.role}">${u.role}</span></td>
        <td>${(u.createdAt||"").split("T")[0]}</td>
        <td><button class="btn btn-danger btn-sm" onclick="deleteShopUser('${doc.id}')">Remove</button></td>
      </tr>`;
    });
  } catch (err) { console.error("loadShopUsers:", err); }
}

async function deleteShopUser(username) {
  if (!confirm(`Remove user "${username}" from this shop?`)) return;
  await db.collection("shops").doc(currentShopId).collection("users").doc(username).delete();
  loadShopUsers();
}
