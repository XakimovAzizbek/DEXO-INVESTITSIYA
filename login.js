// ============================================
// DEXO INVEST — Login Logic (Google Sign-In)
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
  const stepWelcome = document.getElementById("step-welcome");
  const stepBlocked = document.getElementById("step-blocked");
  const blockedMessage = document.getElementById("blocked-message");

  const btnGoogle = document.getElementById("btn-google-signin");
  const btnBlockedBack = document.getElementById("btn-blocked-back");

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

  function setStep(stepName) {
    [stepWelcome, stepBlocked].forEach((el) => el.classList.add("hidden"));
    if (stepName === "welcome") stepWelcome.classList.remove("hidden");
    if (stepName === "blocked") stepBlocked.classList.remove("hidden");
  }

  function setButtonLoading(btn, loading) {
    const text = btn.querySelector(".btn-text");
    const loader = btn.querySelector(".btn-loader");
    btn.disabled = loading;
    if (loader) loader.hidden = !loading;
    if (text) text.style.opacity = loading ? "0.55" : "1";
  }

  function handleFirebaseError(err) {
    const code = err && err.code;
    switch (code) {
      case "auth/popup-closed-by-user":
        // Foydalanuvchi oynani o'zi yopdi — xato emas, hech narsa ko'rsatmaymiz
        return;
      case "auth/cancelled-popup-request":
        return;
      case "auth/popup-blocked":
        showToast("Brauzer popup oynani bloklamoqda. Ruxsat bering va qaytadan urining", "error");
        break;
      case "auth/network-request-failed":
        showToast("Internet aloqasi yo‘q. Qaytadan urining", "error");
        break;
      default:
        showToast("Xatolik yuz berdi. Qaytadan urining", "error");
    }
  }

  // ---------- GOOGLE SIGN-IN ----------
  btnGoogle.addEventListener("click", async () => {
    setButtonLoading(btnGoogle, true);

    const provider = new firebase.auth.GoogleAuthProvider();

    try {
      const result = await auth.signInWithPopup(provider);
      const user = result.user;

      await saveUserIfNew(user);

      showToast("Muvaffaqiyatli kirdingiz!", "success");
      setTimeout(() => {
        window.location.href = "home.html";
      }, 500);
    } catch (err) {
      console.error(err);
      handleFirebaseError(err);
    } finally {
      setButtonLoading(btnGoogle, false);
    }
  });

  // Yangi foydalanuvchini Firestore'ga yozish (balans = 0 so'm bilan boshlash)
  async function saveUserIfNew(user) {
    try {
      const userRef = db.collection("users").doc(user.uid);
      const docSnap = await userRef.get();

      if (!docSnap.exists) {
        await userRef.set({
          name: user.displayName || "",
          email: user.email || "",
          photoURL: user.photoURL || "",
          balance: 0,
          currency: "UZS",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Foydalanuvchi ma'lumotini Firestore'ga saqlashda muammo:", e);
    }
  }

  // ---------- NAVIGATION ----------
  btnBlockedBack.addEventListener("click", () => {
    setStep("welcome");
  });

  // ---------- AGAR FOYDALANUVCHI ALLAQACHON TIZIMGA KIRGAN BO'LSA ----------
  // Sahifa ochilganda, agar sessiya mavjud bo'lsa, to'g'ridan-to'g'ri home.html'ga o'tkazadi
  auth.onAuthStateChanged((user) => {
    if (user) {
      window.location.href = "home.html";
    }
  });

  // ---------- INIT ----------
  setStep("welcome");
})();
