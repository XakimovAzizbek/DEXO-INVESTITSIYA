// ============================================
// DEXO INVEST — Invest Logic
// Ma'lumotlar bazasi: Firestore
// Shart: +1% / 10 kun. Min miqdor: 50 000 so'm
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
const MIN_AMOUNT = 50000;
const PROFIT_PERCENT = 1; // 1%
const DURATION_DAYS = 10;
const DURATION_MS = DURATION_DAYS * 24 * 60 * 60 * 1000;

(function () {
  "use strict";

  // ---------- DOM ----------
  const amountInput = document.getElementById("amount-input");
  const amountRow = amountInput.closest(".amount-row");
  const amountHint = document.getElementById("amount-hint");
  const chips = Array.from(document.querySelectorAll(".chip"));

  const summaryBalance = document.getElementById("summary-balance");
  const summaryProfit = document.getElementById("summary-profit");
  const summaryTotal = document.getElementById("summary-total");

  const btnCreate = document.getElementById("btn-create-investment");
  const investList = document.getElementById("active-investments-list");
  const emptyState = document.getElementById("empty-state");

  const toastEl = document.getElementById("toast");

  // ---------- STATE ----------
  let currentUser = null;
  let currentBalance = 0;

  // ---------- HELPERS ----------
  function showToast(message, type) {
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

  function getRawDigits(value) {
    return value.replace(/\D/g, "");
  }

  function formatThousands(rawDigits) {
    if (!rawDigits) return "";
    return Number(rawDigits).toLocaleString("ru-RU");
  }

  function getAmountValue() {
    return Number(getRawDigits(amountInput.value)) || 0;
  }

  function setButtonLoading(loading) {
    const text = btnCreate.querySelector(".btn-text");
    const loader = btnCreate.querySelector(".btn-loader");
    btnCreate.disabled = loading;
    if (loader) loader.hidden = !loading;
    if (text) text.style.opacity = loading ? "0.55" : "1";
  }

  function updateSummary() {
    const amount = getAmountValue();
    const profit = amount * (PROFIT_PERCENT / 100);
    const total = amount + profit;

    summaryBalance.textContent = formatSom(currentBalance);
    summaryProfit.textContent = amount > 0 ? formatSom(profit) : "0 so‘m";
    summaryTotal.textContent = amount > 0 ? formatSom(total) : "0 so‘m";

    chips.forEach((chip) => {
      chip.classList.toggle("active", Number(chip.dataset.amount) === amount);
    });
  }

  // ---------- AMOUNT INPUT ----------
  amountInput.addEventListener("input", (e) => {
    const raw = getRawDigits(e.target.value).slice(0, 12);
    e.target.value = formatThousands(raw);
    amountRow.classList.remove("invalid");
    amountHint.textContent = "Minimal miqdor — 50 000 so‘m";
    amountHint.classList.remove("error");
    updateSummary();
  });

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      amountInput.value = formatThousands(chip.dataset.amount);
      amountRow.classList.remove("invalid");
      amountHint.textContent = "Minimal miqdor — 50 000 so‘m";
      amountHint.classList.remove("error");
      updateSummary();
    });
  });

  // ---------- AUTH GUARD + LIVE DATA ----------
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;

    // Balansni real vaqtda kuzatish
    db.collection("users").doc(user.uid).onSnapshot(
      (doc) => {
        const data = doc.data();
        currentBalance = (data && typeof data.balance === "number") ? data.balance : 0;
        updateSummary();
      },
      (error) => console.error("Balansni o'qishda xatolik:", error)
    );

    // Foydalanuvchining barcha investitsiyalarini real vaqtda kuzatish
    db.collection("investments")
      .where("uid", "==", user.uid)
      .onSnapshot(
        (snapshot) => {
          renderInvestments(snapshot.docs);
          checkAndCompleteMatured(snapshot.docs);
        },
        (error) => console.error("Investitsiyalarni o'qishda xatolik:", error)
      );
  });

  // ---------- RENDER LIST ----------
  function renderInvestments(docs) {
    const activeDocs = docs.filter((d) => d.data().status === "active");

    if (activeDocs.length === 0) {
      emptyState.style.display = "block";
      // faol bo'lmaganlarni tozalash (faqat empty-state qoladi)
      Array.from(investList.querySelectorAll(".invest-item")).forEach((el) => el.remove());
      return;
    }

    emptyState.style.display = "none";
    Array.from(investList.querySelectorAll(".invest-item")).forEach((el) => el.remove());

    // Eng yangisi tepada
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
        if (inv.status !== "active") return; // boshqa tab/oyna allaqachon yopgan bo'lishi mumkin
        if (inv.endAt.toMillis() > Date.now()) return; // hali muddati tugamagan

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

  // ---------- CREATE INVESTMENT ----------
  btnCreate.addEventListener("click", async () => {
    const amount = getAmountValue();

    if (amount < MIN_AMOUNT) {
      amountRow.classList.add("invalid");
      amountHint.textContent = "Miqdor kamida 50 000 so‘m bo‘lishi kerak";
      amountHint.classList.add("error");
      amountInput.focus();
      return;
    }

    if (amount > currentBalance) {
      amountRow.classList.add("invalid");
      amountHint.textContent = "Balansingizda yetarli mablag‘ yo‘q";
      amountHint.classList.add("error");
      return;
    }

    setButtonLoading(true);

    const userRef = db.collection("users").doc(currentUser.uid);
    const newInvestRef = db.collection("investments").doc();

    const startAt = firebase.firestore.Timestamp.now();
    const endAt = firebase.firestore.Timestamp.fromMillis(startAt.toMillis() + DURATION_MS);

    try {
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        const userData = userSnap.data() || {};
        const balanceNow = typeof userData.balance === "number" ? userData.balance : 0;

        if (amount > balanceNow) {
          throw new Error("insufficient-balance");
        }

        tx.update(userRef, { balance: balanceNow - amount });
        tx.set(newInvestRef, {
          uid: currentUser.uid,
          amount: amount,
          profitPercent: PROFIT_PERCENT,
          durationDays: DURATION_DAYS,
          startAt: startAt,
          endAt: endAt,
          status: "active",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });

      showToast("Investitsiya muvaffaqiyatli yaratildi", "success");
      amountInput.value = "";
      updateSummary();
    } catch (err) {
      console.error(err);
      if (err.message === "insufficient-balance") {
        showToast("Balansingizda yetarli mablag‘ yo‘q", "error");
      } else {
        showToast("Xatolik yuz berdi. Qaytadan urining", "error");
      }
    } finally {
      setButtonLoading(false);
    }
  });

  // ---------- INIT ----------
  updateSummary();
})();
