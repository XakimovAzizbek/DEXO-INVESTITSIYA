// ============================================
// DEXO INVEST — Wallet (Top-up) Logic
// Ma'lumotlar bazasi: Firestore
// Foydalanuvchi USDT yuborib, Tx hash kiritadi.
// So'rov "pending" holatda yaratiladi va admin
// tomonidan ad-topup.html'da blokcheyn explorer
// orqali qo'lda tekshirilib tasdiqlanadi/rad etiladi.
// Firebase config va init shu faylning o'zida
// ============================================

// ---------- FIREBASE CONFIG + INIT ----------
const firebaseConfig = {
  apiKey: "AIzaSyBPTYL-3jOhcLi9UkjQWmSG6ArRVio5QKE",
  authDomain: "loyiha-98a22.firebaseapp.com",
  databaseURL: "https://loyiha-98a22-default-rtdb.firebaseio.com",
  projectId: "loyiha-98a22",
  storageBucket: "loyiha-98a22.firebasestorage.app",
  messagingSenderId: "1022023262123",
  appId: "1:1022023262123:web:5dd858cc8afea3a880fcee",
  measurementId: "G-Y2CZRH3P4W"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// ---------- CONSTANTS ----------
const MIN_AMOUNT = 1; // USDT

// TODO: bu yerga o'zingizning haqiqiy USDT hamyon manzillaringizni yozing
const WALLET_ADDRESSES = {
  trc20: "YOUR_TRC20_ADDRESS_HERE",
  bep20: "YOUR_BEP20_ADDRESS_HERE",
};
const NETWORK_NAMES = {
  trc20: "TRC20 (Tron)",
  bep20: "BEP20 (BSC)",
};

(function () {
  "use strict";

  // ---------- DOM ----------
  const networkTabs = Array.from(document.querySelectorAll(".network-tab"));
  const walletAddressEl = document.getElementById("wallet-address");
  const networkNameHint = document.getElementById("network-name-hint");
  const btnCopyAddress = document.getElementById("btn-copy-address");

  const amountInput = document.getElementById("amount-input");
  const amountRow = amountInput.closest(".amount-row");
  const amountHint = document.getElementById("amount-hint");

  const txHashInput = document.getElementById("txhash-input");
  const txHashHint = document.getElementById("txhash-hint");

  const btnSubmit = document.getElementById("btn-submit-topup");
  const topupList = document.getElementById("topup-list");
  const emptyState = document.getElementById("empty-state");

  const toastEl = document.getElementById("toast");
  const notifBanner = document.getElementById("notif-banner");

  // ---------- STATE ----------
  let currentUser = null;
  let selectedNetwork = "trc20";

  // ---------- HELPERS ----------
  function showToast(message, type) {
    toastEl.textContent = message;
    toastEl.className = "toast show" + (type ? " " + type : "");
    clearTimeout(toastEl._hideTimeout);
    toastEl._hideTimeout = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3200);
  }

  function formatUsdt(n) {
    return Number(n).toFixed(4) + " USDT";
  }

  function getAmountValue() {
    return Number(amountInput.value.replace(",", ".")) || 0;
  }

  function setButtonLoading(loading) {
    const text = btnSubmit.querySelector(".btn-text");
    const loader = btnSubmit.querySelector(".btn-loader");
    btnSubmit.disabled = loading;
    if (loader) loader.hidden = !loading;
    if (text) text.style.opacity = loading ? "0.55" : "1";
  }

  // ---------- NETWORK TABS ----------
  function renderWalletAddress() {
    walletAddressEl.textContent = WALLET_ADDRESSES[selectedNetwork];
    networkNameHint.textContent = NETWORK_NAMES[selectedNetwork];
  }

  networkTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      networkTabs.forEach((t) => t.classList.remove("network-tab--active"));
      tab.classList.add("network-tab--active");
      selectedNetwork = tab.dataset.network;
      renderWalletAddress();
    });
  });

  btnCopyAddress.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(WALLET_ADDRESSES[selectedNetwork]);
      btnCopyAddress.textContent = "Nusxalandi";
      btnCopyAddress.classList.add("copied");
      setTimeout(() => {
        btnCopyAddress.textContent = "Nusxalash";
        btnCopyAddress.classList.remove("copied");
      }, 1800);
    } catch (e) {
      showToast("Nusxalashda xatolik", "error");
    }
  });

  // ---------- AMOUNT INPUT ----------
  amountInput.addEventListener("input", (e) => {
    let val = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "");
    const parts = val.split(".");
    if (parts.length > 2) val = parts[0] + "." + parts.slice(1).join("");
    e.target.value = val;
    amountRow.classList.remove("invalid");
    amountHint.textContent = "Minimal miqdor — 1 USDT";
    amountHint.classList.remove("error");
  });

  txHashInput.addEventListener("input", () => {
    txHashInput.classList.remove("invalid");
    txHashHint.textContent = "To‘lovni amalga oshirgandan so‘ng tranzaksiya ID raqamini shu yerga kiriting";
    txHashHint.classList.remove("error");
  });

  // ---------- AUTH GUARD + LIVE DATA ----------
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;

    db.collection("topups")
      .where("uid", "==", user.uid)
      .onSnapshot(
        (snapshot) => renderTopups(snapshot.docs),
        (error) => console.error("So'rovlarni o'qishda xatolik:", error)
      );

    listenForNotifications(user.uid);
  });

  // ---------- NOTIFICATIONS (sahifa ichi bildirishnoma) ----------
  function listenForNotifications(uid) {
    db.collection("notifications")
      .where("uid", "==", uid)
      .where("seen", "==", false)
      .onSnapshot((snapshot) => {
        const topupNotifs = snapshot.docs.filter((d) => d.data().source === "topup");
        if (topupNotifs.length === 0) {
          notifBanner.classList.add("hidden");
          return;
        }

        const docSnap = topupNotifs[0];
        const notif = docSnap.data();

        notifBanner.textContent = notif.message;
        notifBanner.classList.remove("hidden");
        notifBanner.classList.toggle("notif-banner--rejected", notif.type === "rejected");

        db.collection("notifications").doc(docSnap.id).update({ seen: true }).catch(() => {});
      });
  }

  // ---------- RENDER TOPUP HISTORY ----------
  function renderTopups(docs) {
    if (docs.length === 0) {
      emptyState.style.display = "block";
      Array.from(topupList.querySelectorAll(".topup-item")).forEach((el) => el.remove());
      return;
    }

    emptyState.style.display = "none";
    Array.from(topupList.querySelectorAll(".topup-item")).forEach((el) => el.remove());

    const badgeText = { pending: "Tekshirilmoqda", approved: "Tasdiqlandi", rejected: "Rad etildi" };

    docs
      .sort((a, b) => (b.data().createdAt || 0) - (a.data().createdAt || 0))
      .forEach((docSnap) => {
        const t = docSnap.data();
        const item = document.createElement("div");
        item.className = "topup-item";
        item.innerHTML = `
          <div class="topup-item-top">
            <span class="topup-item-amount">${formatUsdt(t.amount)}</span>
            <span class="topup-item-badge topup-item-badge--${t.status}">${badgeText[t.status] || t.status}</span>
          </div>
          <div class="topup-item-hash">Tx: ${escapeHtml(t.txHash)}</div>
        `;
        topupList.appendChild(item);
      });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // ---------- SUBMIT TOPUP REQUEST ----------
  btnSubmit.addEventListener("click", async () => {
    const amount = getAmountValue();
    const txHash = txHashInput.value.trim();

    let hasError = false;

    if (amount < MIN_AMOUNT) {
      amountRow.classList.add("invalid");
      amountHint.textContent = "Miqdor kamida 1 USDT bo‘lishi kerak";
      amountHint.classList.add("error");
      hasError = true;
    }

    if (!txHash) {
      txHashInput.classList.add("invalid");
      txHashHint.textContent = "Tranzaksiya hash kiritilishi shart";
      txHashHint.classList.add("error");
      hasError = true;
    }

    if (hasError) return;

    setButtonLoading(true);

    try {
      await db.collection("topups").add({
        uid: currentUser.uid,
        amount: amount,
        network: selectedNetwork,
        txHash: txHash,
        status: "pending",
        createdAt: Date.now(),
      });

      showToast("So‘rov yuborildi, tasdiqlanishini kuting", "success");
      amountInput.value = "";
      txHashInput.value = "";
    } catch (err) {
      console.error(err);
      showToast("Xatolik yuz berdi. Qaytadan urining", "error");
    } finally {
      setButtonLoading(false);
    }
  });

  // ---------- INIT ----------
  renderWalletAddress();
})();
