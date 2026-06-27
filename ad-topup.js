// ============================================
// DEXO INVEST — Admin Top-up Verification Logic
// Ma'lumotlar bazasi: Firestore
// Har bir so'rov uchun blokcheyn explorer havolasi
// beriladi — admin Tx hash'ni shu yerda qo'lda
// tekshiradi (summasi, manzili, holati to'g'riligini)
// va shundan keyingina tasdiqlaydi.
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

// Blokcheyn explorer manzillari — Tx hash shu yerga qo'shiladi
const EXPLORER_URLS = {
  trc20: "https://tronscan.org/#/transaction/",
  bep20: "https://bscscan.com/tx/",
};
const NETWORK_LABELS = {
  trc20: "TRC20 (Tron)",
  bep20: "BEP20 (BSC)",
};

(function () {
  "use strict";

  // ---------- DOM ----------
  const pendingList = document.getElementById("pending-list");
  const emptyState = document.getElementById("empty-state");
  const pendingCount = document.getElementById("pending-count");
  const toastEl = document.getElementById("toast");

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

  function formatDate(ms) {
    return new Date(ms).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // ---------- AUTH ----------
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    listenPendingTopups();
  });

  // ---------- LISTEN PENDING TOPUPS ----------
  function listenPendingTopups() {
    db.collection("topups")
      .where("status", "==", "pending")
      .onSnapshot(
        async (snapshot) => {
          pendingCount.textContent = snapshot.size;

          if (snapshot.empty) {
            emptyState.style.display = "block";
            Array.from(pendingList.querySelectorAll(".request-card")).forEach((el) => el.remove());
            return;
          }

          emptyState.style.display = "none";
          Array.from(pendingList.querySelectorAll(".request-card")).forEach((el) => el.remove());

          const docs = snapshot.docs.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));

          for (const docSnap of docs) {
            const card = await buildRequestCard(docSnap);
            pendingList.appendChild(card);
          }
        },
        (error) => console.error("So'rovlarni o'qishda xatolik:", error)
      );
  }

  // ---------- BUILD CARD ----------
  async function buildRequestCard(docSnap) {
    const t = docSnap.data();
    const topupId = docSnap.id;

    let userInfo = { name: "Noma'lum foydalanuvchi", email: "", photoURL: "" };
    try {
      const userDoc = await db.collection("users").doc(t.uid).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        userInfo = {
          name: u.name || "Noma'lum foydalanuvchi",
          email: u.email || "",
          photoURL: u.photoURL || "",
        };
      }
    } catch (e) {
      console.warn("Foydalanuvchi ma'lumotini olishda xatolik:", e);
    }

    const explorerBase = EXPLORER_URLS[t.network] || EXPLORER_URLS.trc20;
    const explorerHref = explorerBase + encodeURIComponent(t.txHash);
    const networkLabel = NETWORK_LABELS[t.network] || t.network;

    const card = document.createElement("div");
    card.className = "request-card";
    card.innerHTML = `
      <div class="request-top">
        <div class="request-user">
          <img class="request-avatar" src="${userInfo.photoURL}" alt="" onerror="this.style.visibility='hidden'">
          <div class="request-user-info">
            <span class="request-name">${escapeHtml(userInfo.name)}</span>
            <span class="request-email">${escapeHtml(userInfo.email)}</span>
          </div>
        </div>
        <span class="request-amount">${formatUsdt(t.amount)}</span>
      </div>

      <span class="request-network">${escapeHtml(networkLabel)}</span>
      <div class="request-hash">Tx: ${escapeHtml(t.txHash)}</div>
      <a class="explorer-link" href="${explorerHref}" target="_blank" rel="noopener noreferrer">
        Explorer'da ko‘rish →
      </a>

      <div class="request-meta">So‘rov vaqti: ${formatDate(t.createdAt || Date.now())}</div>
      <div class="request-actions">
        <button class="btn-reject" data-action="reject">Rad etish</button>
        <button class="btn-approve" data-action="approve">Tasdiqlash</button>
      </div>
    `;

    card.querySelector('[data-action="approve"]').addEventListener("click", (e) => {
      handleApprove(topupId, e.target);
    });
    card.querySelector('[data-action="reject"]').addEventListener("click", (e) => {
      handleReject(topupId, e.target);
    });

    return card;
  }

  function setCardButtonsDisabled(button, disabled) {
    const card = button.closest(".request-card");
    card.querySelectorAll("button").forEach((b) => { b.disabled = disabled; });
  }

  // ---------- APPROVE (balansga USDT qo'shiladi) ----------
  async function handleApprove(topupId, button) {
    setCardButtonsDisabled(button, true);
    const topupRef = db.collection("topups").doc(topupId);

    try {
      let topupUid = null;
      let topupAmount = 0;

      await db.runTransaction(async (tx) => {
        const topupSnap = await tx.get(topupRef);
        if (!topupSnap.exists) throw new Error("not-found");

        const t = topupSnap.data();
        if (t.status !== "pending") throw new Error("already-handled");

        topupUid = t.uid;
        topupAmount = t.amount;

        const userRef = db.collection("users").doc(t.uid);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const oldBalance = typeof userData.balance === "number" ? userData.balance : 0;

        tx.update(userRef, { balance: oldBalance + t.amount });
        tx.update(topupRef, {
          status: "approved",
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      await db.collection("notifications").add({
        uid: topupUid,
        source: "topup",
        type: "approved",
        message: `Hamyonni to‘ldirish so‘rovingiz (${formatUsdt(topupAmount)}) tasdiqlandi va balansingizga qo‘shildi.`,
        seen: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      showToast("So‘rov tasdiqlandi, balans yangilandi", "success");
    } catch (err) {
      console.error(err);
      showToast("Xatolik yuz berdi yoki so‘rov allaqachon ko‘rib chiqilgan", "error");
      setCardButtonsDisabled(button, false);
    }
  }

  // ---------- REJECT ----------
  async function handleReject(topupId, button) {
    setCardButtonsDisabled(button, true);
    const topupRef = db.collection("topups").doc(topupId);

    try {
      let topupUid = null;
      let topupAmount = 0;

      await db.runTransaction(async (tx) => {
        const topupSnap = await tx.get(topupRef);
        if (!topupSnap.exists) throw new Error("not-found");

        const t = topupSnap.data();
        if (t.status !== "pending") throw new Error("already-handled");

        topupUid = t.uid;
        topupAmount = t.amount;

        tx.update(topupRef, {
          status: "rejected",
          rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      await db.collection("notifications").add({
        uid: topupUid,
        source: "topup",
        type: "rejected",
        message: `Hamyonni to‘ldirish so‘rovingiz (${formatUsdt(topupAmount)}) rad etildi. Tx hash yoki summa noto‘g‘ri bo‘lishi mumkin.`,
        seen: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      showToast("So‘rov rad etildi", "success");
    } catch (err) {
      console.error(err);
      showToast("Xatolik yuz berdi yoki so‘rov allaqachon ko‘rib chiqilgan", "error");
      setCardButtonsDisabled(button, false);
    }
  }
})();
