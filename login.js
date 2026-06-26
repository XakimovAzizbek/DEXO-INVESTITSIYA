// ============================================
// DEXO INVEST — Login Logic (Phone + SMS OTP)
// Faqat O'zbekiston (+998) raqamlari uchun
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
  const stepPhone = document.getElementById("step-phone");
  const stepOtp = document.getElementById("step-otp");
  const stepBlocked = document.getElementById("step-blocked");

  const phoneInput = document.getElementById("phone-input");
  const phoneHint = document.getElementById("phone-hint");
  const btnSendCode = document.getElementById("btn-send-code");

  const sentPhoneLabel = document.getElementById("sent-phone-label");
  const otpBoxes = Array.from(document.querySelectorAll(".otp-box"));
  const otpError = document.getElementById("otp-error");
  const btnVerifyCode = document.getElementById("btn-verify-code");
  const btnResend = document.getElementById("btn-resend");
  const btnBack = document.getElementById("btn-back");
  const btnBlockedBack = document.getElementById("btn-blocked-back");

  const otpRingProgress = document.getElementById("otp-ring-progress");
  const otpTimerLabel = document.getElementById("otp-timer");

  const toastEl = document.getElementById("toast");

  // ---------- STATE ----------
  let confirmationResult = null;
  let resendTimerInterval = null;
  const RESEND_SECONDS = 60;
  const RING_CIRCUMFERENCE = 326.7; // 2 * PI * r(52)

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
    [stepPhone, stepOtp, stepBlocked].forEach((el) => el.classList.add("hidden"));
    if (stepName === "phone") stepPhone.classList.remove("hidden");
    if (stepName === "otp") stepOtp.classList.remove("hidden");
    if (stepName === "blocked") stepBlocked.classList.remove("hidden");
  }

  function setButtonLoading(btn, loading) {
    const text = btn.querySelector(".btn-text");
    const loader = btn.querySelector(".btn-loader");
    btn.disabled = loading;
    if (loader) loader.hidden = !loading;
    if (text) text.style.opacity = loading ? "0.55" : "1";
  }

  // Faqat raqamlarni qoldiradi va O'zbekiston formatiga moslab formatlaydi: 90 123 45 67
  function formatUzPhoneInput(value) {
    let digits = value.replace(/\D/g, "");
    digits = digits.slice(0, 9); // 9 ta raqam: 9X XXX XX XX
    let out = "";
    if (digits.length > 0) out += digits.slice(0, 2);
    if (digits.length > 2) out += " " + digits.slice(2, 5);
    if (digits.length > 5) out += " " + digits.slice(5, 7);
    if (digits.length > 7) out += " " + digits.slice(7, 9);
    return out;
  }

  function getRawDigits(value) {
    return value.replace(/\D/g, "");
  }

  // O'zbekiston operator kodlari
  const UZ_OPERATOR_PREFIXES = [
    "90", "91", "93", "94", "95", "97", "98", "99", "33", "88", "20", "77"
  ];

  function isValidUzPhone(rawDigits) {
    if (rawDigits.length !== 9) return false;
    const prefix = rawDigits.slice(0, 2);
    return UZ_OPERATOR_PREFIXES.includes(prefix);
  }

  // ---------- PHONE INPUT EVENTS ----------
  phoneInput.addEventListener("input", (e) => {
    const cursorWasAtEnd = e.target.selectionEnd === e.target.value.length;
    e.target.value = formatUzPhoneInput(e.target.value);
    if (cursorWasAtEnd) {
      e.target.selectionStart = e.target.selectionEnd = e.target.value.length;
    }
    phoneInput.classList.remove("invalid");
    phoneHint.textContent = "Faqat O‘zbekiston raqamlari (+998) qabul qilinadi";
    phoneHint.classList.remove("error");
  });

  // ---------- RECAPTCHA ----------
  let recaptchaVerifier = null;

  function ensureRecaptcha() {
    if (recaptchaVerifier) return recaptchaVerifier;
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
      size: "invisible",
      callback: () => {},
    });
    return recaptchaVerifier;
  }

  // ---------- SEND CODE ----------
  btnSendCode.addEventListener("click", async () => {
    const raw = getRawDigits(phoneInput.value);

    if (!isValidUzPhone(raw)) {
      phoneInput.classList.add("invalid");
      phoneHint.textContent = "Telefon raqamni to‘liq va to‘g‘ri kiriting (masalan: 90 123 45 67)";
      phoneHint.classList.add("error");
      phoneInput.focus();
      return;
    }

    const fullPhone = "+998" + raw;

    setButtonLoading(btnSendCode, true);

    try {
      const verifier = ensureRecaptcha();
      confirmationResult = await auth.signInWithPhoneNumber(fullPhone, verifier);

      sentPhoneLabel.textContent = "+998 " + formatUzPhoneInput(raw);
      otpBoxes.forEach((b) => { b.value = ""; b.classList.remove("filled"); });
      otpError.hidden = true;

      setStep("otp");
      startResendTimer();
      otpBoxes[0].focus();
      showToast("Tasdiqlash kodi yuborildi", "success");
    } catch (err) {
      console.error(err);
      handleFirebaseError(err);
      // reCAPTCHA xato bo'lganda qayta yaratish kerak bo'ladi
      if (recaptchaVerifier) {
        recaptchaVerifier.clear();
        recaptchaVerifier = null;
      }
    } finally {
      setButtonLoading(btnSendCode, false);
    }
  });

  function handleFirebaseError(err) {
    const code = err && err.code;
    switch (code) {
      case "auth/invalid-phone-number":
        showToast("Telefon raqam formati noto‘g‘ri", "error");
        break;
      case "auth/too-many-requests":
        showToast("Urinishlar soni ko‘p. Birozdan so‘ng qayta urining", "error");
        break;
      case "auth/quota-exceeded":
        showToast("SMS yuborish limiti tugadi. Keyinroq urining", "error");
        break;
      case "auth/code-expired":
        showToast("Kod muddati tugadi. Qaytadan so‘rang", "error");
        break;
      case "auth/invalid-verification-code":
        showToast("Kod noto‘g‘ri", "error");
        break;
      default:
        showToast("Xatolik yuz berdi. Qaytadan urining", "error");
    }
  }

  // ---------- OTP INPUT BEHAVIOR ----------
  otpBoxes.forEach((box, idx) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "").slice(0, 1);
      box.classList.toggle("filled", box.value !== "");
      if (box.value && idx < otpBoxes.length - 1) {
        otpBoxes[idx + 1].focus();
      }
      if (otpBoxes.every((b) => b.value !== "")) {
        btnVerifyCode.click();
      }
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && idx > 0) {
        otpBoxes[idx - 1].focus();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      pasted.split("").forEach((digit, i) => {
        if (otpBoxes[i]) {
          otpBoxes[i].value = digit;
          otpBoxes[i].classList.add("filled");
        }
      });
      const nextEmpty = otpBoxes.findIndex((b) => !b.value);
      (nextEmpty === -1 ? otpBoxes[otpBoxes.length - 1] : otpBoxes[nextEmpty]).focus();
      if (otpBoxes.every((b) => b.value !== "")) {
        btnVerifyCode.click();
      }
    });
  });

  // ---------- VERIFY CODE ----------
  btnVerifyCode.addEventListener("click", async () => {
    const code = otpBoxes.map((b) => b.value).join("");

    if (code.length !== 6) {
      showToast("6 xonali kodni to‘liq kiriting", "error");
      return;
    }

    if (!confirmationResult) {
      showToast("Avval kod so‘rang", "error");
      setStep("phone");
      return;
    }

    setButtonLoading(btnVerifyCode, true);
    otpError.hidden = true;

    try {
      const result = await confirmationResult.confirm(code);
      const user = result.user;

      // Yangi foydalanuvchi bo'lsa, Firestore'ga asosiy ma'lumotlarni saqlash
      await saveUserIfNew(user);

      stopResendTimer();
      showToast("Muvaffaqiyatli tasdiqlandi!", "success");

      setTimeout(() => {
        window.location.href = "home.html";
      }, 600);

    } catch (err) {
      console.error(err);
      otpBoxes.forEach((b) => b.classList.add("shake"));
      setTimeout(() => otpBoxes.forEach((b) => b.classList.remove("shake")), 400);
      otpError.hidden = false;
      handleFirebaseError(err);
    } finally {
      setButtonLoading(btnVerifyCode, false);
    }
  });

  // Yangi foydalanuvchini Firestore'ga yozish (balans = 0 so'm bilan boshlash)
  async function saveUserIfNew(user) {
    try {
      const userRef = db.collection("users").doc(user.uid);
      const docSnap = await userRef.get();

      if (!docSnap.exists) {
        await userRef.set({
          phone: user.phoneNumber,
          balance: 0,
          currency: "UZS",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn("Foydalanuvchi ma'lumotini Firestore'ga saqlashda muammo:", e);
    }
  }

  // ---------- RESEND TIMER + RING ----------
  function startResendTimer() {
    let remaining = RESEND_SECONDS;
    btnResend.disabled = true;
    otpTimerLabel.textContent = remaining;
    otpRingProgress.style.strokeDashoffset = "0";

    clearInterval(resendTimerInterval);
    resendTimerInterval = setInterval(() => {
      remaining -= 1;
      otpTimerLabel.textContent = remaining > 0 ? remaining : "0";
      const offset = RING_CIRCUMFERENCE * (1 - remaining / RESEND_SECONDS);
      otpRingProgress.style.strokeDashoffset = offset.toFixed(1);

      if (remaining <= 0) {
        clearInterval(resendTimerInterval);
        btnResend.disabled = false;
        otpTimerLabel.textContent = "SMS";
      }
    }, 1000);
  }

  function stopResendTimer() {
    clearInterval(resendTimerInterval);
  }

  btnResend.addEventListener("click", async () => {
    if (btnResend.disabled) return;
    const raw = getRawDigits(phoneInput.value);
    const fullPhone = "+998" + raw;

    btnResend.disabled = true;
    try {
      const verifier = ensureRecaptcha();
      confirmationResult = await auth.signInWithPhoneNumber(fullPhone, verifier);
      showToast("Kod qayta yuborildi", "success");
      otpBoxes.forEach((b) => { b.value = ""; b.classList.remove("filled"); });
      otpBoxes[0].focus();
      startResendTimer();
    } catch (err) {
      console.error(err);
      handleFirebaseError(err);
      btnResend.disabled = false;
    }
  });

  // ---------- NAVIGATION ----------
  btnBack.addEventListener("click", () => {
    stopResendTimer();
    setStep("phone");
  });

  btnBlockedBack.addEventListener("click", () => {
    setStep("phone");
    phoneInput.value = "";
    phoneInput.focus();
  });

  // ---------- INIT ----------
  setStep("phone");
  phoneInput.focus();
})();
