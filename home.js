// ============================================
// DEXO INVEST — Home Logic
// Ma'lumotlar bazasi: Firestore
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

(function () {
  "use strict";

  // ---------- DOM ----------
  const investList = document.getElementById("active-investments-list");
  const emptyState = document.getElementById("empty-state");
  const toastEl = document.getElementById("toast");

  let currentUser = null;

  // ---------- HELPERS ----------
  function showToast(message, type) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = "toast show" + (type ? " " + type : "");
    clearTimeout(toastEl._hideTimeout);
    toastEl._hideTimeout = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 3200);
  }

  function formatSom(n) {
    return Math.round(n).toLocaleString("ru-RU") + " so‘m";
  }

  // Balans raqamini sanab o'tib (count-up) chiqaradigan animatsiya
  function animateBalance(from, to) {
    const el = document.getElementById("balance-amount");
    if (!el) return;

    const duration = 700;
    const startTime = performance.now();

    function tick(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from + (to - from) * eased;

      el.innerHTML = value.toFixed(4) + "<span>USDT</span>";

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.innerHTML = to.toFixed(4) + "<span>USDT</span>";
      }
    }

    requestAnimationFrame(tick);
  }

  // ---------- AUTH GUARD + BALANCE ----------
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;

    // Google profil ma'lumotlarini ko'rsatish (ism yoki email, va avatar)
    const userDisplayEl = document.getElementById("user-display");
    if (userDisplayEl) {
      userDisplayEl.textContent = user.displayName || user.email || "Foydalanuvchi";
    }
    const avatarEl = document.getElementById("user-avatar");
    if (avatarEl && user.photoURL) {
      avatarEl.src = user.photoURL;
      avatarEl.alt = user.displayName || "Profil";
      avatarEl.hidden = false;
    }

    // Firestore'dagi users/{uid} hujjatini real vaqtda kuzatish
    let displayedBalance = null;
    db.collection("users").doc(user.uid).onSnapshot(
      (doc) => {
        const data = doc.data();
        const balance = (data && typeof data.balance === "number") ? data.balance : 0;
        animateBalance(displayedBalance === null ? 0 : displayedBalance, balance);
        displayedBalance = balance;
      },
      (error) => console.error("Balansni o'qishda xatolik:", error)
    );

    // Foydalanuvchining investitsiyalarini real vaqtda kuzatish (agar shu elementlar mavjud bo'lsa)
    if (investList) {
      db.collection("investments")
        .where("uid", "==", user.uid)
        .onSnapshot(
          (snapshot) => {
            renderInvestments(snapshot.docs);
            checkAndCompleteMatured(snapshot.docs);
          },
          (error) => console.error("Investitsiyalarni o'qishda xatolik:", error)
        );
    }
  });

  // ---------- RENDER LIST ----------
  function renderInvestments(docs) {
    const activeDocs = docs.filter((d) => d.data().status === "active");

    Array.from(investList.querySelectorAll(".invest-item")).forEach((el) => el.remove());

    if (activeDocs.length === 0) {
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    if (emptyState) emptyState.style.display = "none";

    activeDocs
      .sort((a, b) => b.data().startAt.toMillis() - a.data().startAt.toMillis())
      .forEach((docSnap) => {
        const inv = docSnap.data();
        const now = Date.now();
        const startMs = inv.startAt.toMillis();
        const endMs = inv.endAt.toMillis();
        const totalMs = endMs - startMs;
        const elapsedMs = Math.min(Math.max(now - startMs, 0), totalMs);
        const progressPercent = totalMs > 0 ? Math.round((elapsedMs / totalMs) * 100) : 100;

        const msLeft = Math.max(endMs - now, 0);
        const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
        const profitAmount = inv.amount * (inv.profitPercent / 100);

        const item = document.createElement("div");
        item.className = "invest-item";
        item.innerHTML = `
          <div class="invest-item-top">
            <span class="invest-item-amount">${formatSom(inv.amount)}</span>
            <span class="invest-item-badge">+${inv.profitPercent}%</span>
          </div>
          <div class="invest-item-bar"><div class="invest-item-bar-fill" style="width:${progressPercent}%"></div></div>
          <div class="invest-item-foot">
            <span>${daysLeft > 0 ? daysLeft + " kun qoldi" : "Yakunlanmoqda..."}</span>
            <span>+${formatSom(profitAmount)}</span>
          </div>
        `;
        investList.appendChild(item);
      });
  }

  // ---------- AUTO-COMPLETE MATURED INVESTMENTS ----------
  // Sahifa ochilganda muddati (10 kun) tugagan "active" investitsiyalarni
  // tekshiradi va balansga summa+foizni avtomatik qaytaradi.
  // Faqat Firestore orqali ishlaydi, hech qanday tashqi server kerak emas.
  async function checkAndCompleteMatured(docs) {
    const now = Date.now();
    const maturedDocs = docs.filter((d) => {
      const data = d.data();
      return data.status === "active" && data.endAt.toMillis() <= now;
    });

    for (const docSnap of maturedDocs) {
      await completeInvestment(docSnap.id);
    }
  }

  async function completeInvestment(investmentId) {
    const investRef = db.collection("investments").doc(investmentId);
    const userRef = db.collection("users").doc(currentUser.uid);

    try {
      await db.runTransaction(async (tx) => {
        const investSnap = await tx.get(investRef);
        if (!investSnap.exists) return;

        const inv = investSnap.data();
        if (inv.status !== "active") return;
        if (inv.endAt.toMillis() > Date.now()) return;

        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const oldBalance = typeof userData.balance === "number" ? userData.balance : 0;

        const profit = inv.amount * (inv.profitPercent / 100);
        const returnAmount = inv.amount + profit;

        tx.update(userRef, { balance: oldBalance + returnAmount });
        tx.update(investRef, {
          status: "completed",
          completedAt: firebase.firestore.FieldValue.serverTimestamp(),
          returnedAmount: returnAmount,
        });
      });

      showToast("Investitsiya yakunlandi, mablag‘ balansga qaytdi", "success");
    } catch (e) {
      console.error("Investitsiyani yakunlashda xatolik:", e);
    }
  }

  // ---------- LOGOUT ----------
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      auth.signOut().then(() => {
        window.location.href = "login.html";
      });
    });
  }
})();
