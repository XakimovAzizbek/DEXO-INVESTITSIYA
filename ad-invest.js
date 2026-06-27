// ============================================
// DEXO INVEST — Admin Panel Logic
// Ma'lumotlar bazasi: Firestore
// Pending investitsiyalarni tasdiqlash/rad etish
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

const DURATION_MS = 10 * 24 * 60 * 60 * 1000; // 10 kun

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

  // ---------- AUTH (admin Google orqali kirgan bo'lishi kerak) ----------
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    listenPendingRequests();
  });

  // ---------- LISTEN PENDING REQUESTS ----------
  function listenPendingRequests() {
    db.collection("investments")
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
    const inv = docSnap.data();
    const investmentId = docSnap.id;

    let userInfo = { name: "Noma'lum foydalanuvchi", email: "", photoURL: "" };
    try {
      const userDoc = await db.collection("users").doc(inv.uid).get();
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
        <span class="request-amount">${formatUsdt(inv.amount)}</span>
      </div>
      <div class="request-meta">So‘rov vaqti: ${formatDate(inv.createdAt || Date.now())}</div>
      <div class="request-actions">
        <button class="btn-reject" data-action="reject">Rad etish</button>
        <button class="btn-approve" data-action="approve">Tasdiqlash</button>
      </div>
    `;

    card.querySelector('[data-action="approve"]').addEventListener("click", (e) => {
      handleApprove(investmentId, e.target);
    });
    card.querySelector('[data-action="reject"]').addEventListener("click", (e) => {
      handleReject(investmentId, e.target);
    });

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function setCardButtonsDisabled(button, disabled) {
    const card = button.closest(".request-card");
    card.querySelectorAll("button").forEach((b) => { b.disabled = disabled; });
  }

  // ---------- APPROVE ----------
  async function handleApprove(investmentId, button) {
    setCardButtonsDisabled(button, true);
    const investRef = db.collection("investments").doc(investmentId);

    try {
      let investUid = null;
      let investAmount = 0;

      await db.runTransaction(async (tx) => {
        const investSnap = await tx.get(investRef);
        if (!investSnap.exists) throw new Error("not-found");

        const inv = investSnap.data();
        if (inv.status !== "pending") throw new Error("already-handled");

        investUid = inv.uid;
        investAmount = inv.amount;

        const startAt = firebase.firestore.Timestamp.now();
        const endAt = firebase.firestore.Timestamp.fromMillis(startAt.toMillis() + DURATION_MS);

        tx.update(investRef, {
          status: "active",
          startAt: startAt,
          endAt: endAt,
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Foydalanuvchiga sahifa-ichi bildirishnoma qoldirish
      await db.collection("notifications").add({
        uid: investUid,
        type: "approved",
        message: `Investitsiyangiz (${formatUsdt(investAmount)}) tasdiqlandi va faollashtirildi. 10 kundan so‘ng mablag‘ +1% foyda bilan balansga qaytadi.`,
        seen: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      showToast("So‘rov tasdiqlandi", "success");
    } catch (err) {
      console.error(err);
      showToast("Xatolik yuz berdi yoki so‘rov allaqachon ko‘rib chiqilgan", "error");
      setCardButtonsDisabled(button, false);
    }
  }

  // ---------- REJECT ----------
  async function handleReject(investmentId, button) {
    setCardButtonsDisabled(button, true);
    const investRef = db.collection("investments").doc(investmentId);

    try {
      let investUid = null;
      let investAmount = 0;

      await db.runTransaction(async (tx) => {
        const investSnap = await tx.get(investRef);
        if (!investSnap.exists) throw new Error("not-found");

        const inv = investSnap.data();
        if (inv.status !== "pending") throw new Error("already-handled");

        investUid = inv.uid;
        investAmount = inv.amount;

        const userRef = db.collection("users").doc(inv.uid);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const oldBalance = typeof userData.balance === "number" ? userData.balance : 0;

        // Mablag'ni balansga qaytarish
        tx.update(userRef, { balance: oldBalance + inv.amount });
        tx.update(investRef, {
          status: "rejected",
          rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      await db.collection("notifications").add({
        uid: investUid,
        type: "rejected",
        message: `Investitsiya so‘rovingiz (${formatUsdt(investAmount)}) rad etildi. Mablag‘ balansingizga qaytarildi.`,
        seen: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      showToast("So‘rov rad etildi, mablag‘ qaytarildi", "success");
    } catch (err) {
      console.error(err);
      showToast("Xatolik yuz berdi yoki so‘rov allaqachon ko‘rib chiqilgan", "error");
      setCardButtonsDisabled(button, false);
    }
  }
})();
