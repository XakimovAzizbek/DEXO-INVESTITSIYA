// ============================================
// DEXO INVEST — Cloud Functions
// 1) verifyTopup: foydalanuvchi yuborgan Tx hash'ni
//    TronGrid (TRC20) yoki BscScan (BEP20) orqali
//    serverda tekshiradi va, agar haqiqiy bo'lsa,
//    balansni Admin SDK orqali xavfsiz to'ldiradi.
//    Foydalanuvchi buni hech qanday yo'l bilan
//    chetlab o'tolmaydi, chunki tekshiruv va balans
//    yozish to'liq server tomonida bajariladi.
// 2) completeMaturedInvestments: har soatda ishga
//    tushadigan scheduled function — muddati (10 kun)
//    tugagan investitsiyalarni avtomatik yakunlaydi.
// ============================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const fetch = require("node-fetch");

initializeApp();
const db = getFirestore();

// ---------- CONFIG ----------
// TODO: bu yerga o'zingizning haqiqiy USDT hamyon manzillaringizni yozing
const WALLET_ADDRESSES = {
  trc20: "YOUR_TRC20_ADDRESS_HERE",
  bep20: "YOUR_BEP20_ADDRESS_HERE",
};

const USDT_CONTRACTS = {
  trc20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  bep20: "0x55d398326f99059fF775485246999027B3197955",
};

const TRONGRID_API = "https://api.trongrid.io";
const BSCSCAN_API = "https://api.bscscan.com/api";
const AMOUNT_TOLERANCE = 0.000001;
const DURATION_MS = 10 * 24 * 60 * 60 * 1000; // 10 kun

// ============================================
// VERIFY TOPUP (callable function)
// ============================================
exports.verifyTopup = onCall(async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Tizimga kirish talab qilinadi");
  }

  const uid = auth.uid;
  const { network, txHash, amount } = request.data || {};

  if (!network || !["trc20", "bep20"].includes(network)) {
    throw new HttpsError("invalid-argument", "Tarmoq noto'g'ri ko'rsatilgan");
  }
  if (!txHash || typeof txHash !== "string") {
    throw new HttpsError("invalid-argument", "Tx hash kiritilmagan");
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    throw new HttpsError("invalid-argument", "Summa noto'g'ri");
  }

  // 1) Tx hash avval ishlatilganmi tekshirish (qayta ishlatishni oldini olish)
  const existingSnap = await db.collection("topups").where("txHash", "==", txHash).limit(1).get();
  if (!existingSnap.empty) {
    throw new HttpsError("already-exists", "Bu tranzaksiya hash allaqachon ishlatilgan");
  }

  // 2) Blokcheynda tranzaksiyani tekshirish
  const verification = network === "trc20"
    ? await verifyTronTx(txHash, amount)
    : await verifyBscTx(txHash, amount);

  const topupRef = db.collection("topups").doc();

  if (!verification.ok) {
    await topupRef.set({
      uid,
      amount,
      network,
      txHash,
      status: "rejected",
      rejectReason: verification.reason,
      createdAt: Date.now(),
    });
    throw new HttpsError("failed-precondition", verification.reason);
  }

  // 3) Tasdiqlandi — balansni Admin SDK orqali xavfsiz to'ldirish
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const userData = userSnap.data() || {};
    const oldBalance = typeof userData.balance === "number" ? userData.balance : 0;

    tx.set(userRef, { balance: oldBalance + verification.amount }, { merge: true });
    tx.set(topupRef, {
      uid,
      amount: verification.amount,
      network,
      txHash,
      status: "approved",
      createdAt: Date.now(),
      approvedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, amount: verification.amount };
});

// ---------- TRON (TRC20) VERIFICATION ----------
async function verifyTronTx(txHash, expectedAmount) {
  try {
    const res = await fetch(`${TRONGRID_API}/v1/transactions/${txHash}/events`);
    if (!res.ok) return { ok: false, reason: "Tranzaksiya topilmadi" };

    const data = await res.json();
    const transferEvent = (data.data || []).find(
      (ev) => ev.event_name === "Transfer" && ev.contract_address === USDT_CONTRACTS.trc20
    );

    if (!transferEvent) return { ok: false, reason: "USDT transfer topilmadi" };

    const toAddressHex = transferEvent.result.to;
    const amountUsdt = Number(transferEvent.result.value) / 1e6; // 6 decimal
    const toAddressBase58 = hexToTronBase58(toAddressHex);

    if (toAddressBase58 !== WALLET_ADDRESSES.trc20) {
      return { ok: false, reason: "Mablag' boshqa manzilga yuborilgan" };
    }
    if (Math.abs(amountUsdt - expectedAmount) > AMOUNT_TOLERANCE) {
      return { ok: false, reason: `Summasi mos kelmadi (tranzaksiyada: ${amountUsdt} USDT)` };
    }

    return { ok: true, amount: amountUsdt };
  } catch (e) {
    console.error("Tron tekshirishda xatolik:", e);
    return { ok: false, reason: "Tekshirishda texnik xatolik" };
  }
}

// ---------- BSC (BEP20) VERIFICATION ----------
async function verifyBscTx(txHash, expectedAmount) {
  try {
    const res = await fetch(
      `${BSCSCAN_API}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}`
    );
    if (!res.ok) return { ok: false, reason: "Tranzaksiya topilmadi" };

    const data = await res.json();
    const receipt = data.result;
    if (!receipt || receipt.status !== "0x1") {
      return { ok: false, reason: "Tranzaksiya muvaffaqiyatsiz yoki topilmadi" };
    }

    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const log = (receipt.logs || []).find(
      (l) => l.address.toLowerCase() === USDT_CONTRACTS.bep20.toLowerCase() &&
             l.topics[0] === transferTopic
    );

    if (!log) return { ok: false, reason: "USDT transfer topilmadi" };

    const toAddressHex = "0x" + log.topics[2].slice(26);
    const amountUsdt = Number(BigInt(log.data)) / 1e18; // 18 decimal

    if (toAddressHex.toLowerCase() !== WALLET_ADDRESSES.bep20.toLowerCase()) {
      return { ok: false, reason: "Mablag' boshqa manzilga yuborilgan" };
    }
    if (Math.abs(amountUsdt - expectedAmount) > AMOUNT_TOLERANCE) {
      return { ok: false, reason: `Summasi mos kelmadi (tranzaksiyada: ${amountUsdt} USDT)` };
    }

    return { ok: true, amount: amountUsdt };
  } catch (e) {
    console.error("BSC tekshirishda xatolik:", e);
    return { ok: false, reason: "Tekshirishda texnik xatolik" };
  }
}

// Tron hex manzilini (41...) standart Base58 (T...) formatga o'tkazish
function hexToTronBase58(hexAddress) {
  const crypto = require("crypto");
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let hex = hexAddress.startsWith("41") ? hexAddress : "41" + hexAddress;
  const byteArray = Buffer.from(hex, "hex");

  const hash1 = crypto.createHash("sha256").update(byteArray).digest();
  const hash2 = crypto.createHash("sha256").update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  const fullBytes = Buffer.concat([byteArray, checksum]);

  let num = BigInt("0x" + fullBytes.toString("hex"));
  let encoded = "";
  while (num > 0n) {
    const rem = num % 58n;
    encoded = ALPHABET[Number(rem)] + encoded;
    num = num / 58n;
  }
  for (const b of fullBytes) {
    if (b === 0) encoded = "1" + encoded;
    else break;
  }
  return encoded;
}

// ============================================
// AUTO-COMPLETE MATURED INVESTMENTS (scheduled)
// Har soatda ishga tushadi, muddati tugagan
// "active" investitsiyalarni avtomatik yakunlaydi
// va balansga summa+foizni qaytaradi.
// ============================================
exports.completeMaturedInvestments = onSchedule("every 60 minutes", async () => {
  const now = Date.now();
  const snapshot = await db.collection("investments")
    .where("status", "==", "active")
    .where("endAt", "<=", Timestamp.fromMillis(now))
    .get();

  if (snapshot.empty) {
    console.log("Yakunlash uchun investitsiya topilmadi");
    return;
  }

  for (const docSnap of snapshot.docs) {
    await completeOneInvestment(docSnap.id);
  }

  console.log(`${snapshot.size} ta investitsiya yakunlandi`);
});

async function completeOneInvestment(investmentId) {
  const investRef = db.collection("investments").doc(investmentId);

  try {
    await db.runTransaction(async (tx) => {
      const investSnap = await tx.get(investRef);
      if (!investSnap.exists) return;

      const inv = investSnap.data();
      if (inv.status !== "active") return;
      if (inv.endAt.toMillis() > Date.now()) return;

      const userRef = db.collection("users").doc(inv.uid);
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data() || {};
      const oldBalance = typeof userData.balance === "number" ? userData.balance : 0;

      const profit = inv.amount * (inv.profitPercent / 100);
      const returnAmount = inv.amount + profit;

      tx.set(userRef, { balance: oldBalance + returnAmount }, { merge: true });
      tx.update(investRef, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        returnedAmount: returnAmount,
      });

      tx.set(db.collection("notifications").doc(), {
        uid: inv.uid,
        source: "invest",
        type: "approved",
        message: `Investitsiyangiz (${inv.amount.toFixed(4)} USDT) yakunlandi, ${returnAmount.toFixed(4)} USDT balansingizga qaytdi.`,
        seen: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    console.error(`Investitsiyani yakunlashda xatolik (${investmentId}):`, e);
  }
}
