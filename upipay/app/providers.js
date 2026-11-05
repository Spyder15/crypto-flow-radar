// Pluggable integrations. Defaults are MOCKS so the demo runs; each needs a real implementation before real money.

// Verifies that `inrPaise` really reached `upiId`, identified by `utr`. Return { ok, reason }.
// Real options: zkTLS proof of the bank/UPI app receipt, or a bank/PSP webhook attestation.
async function verifyPayout({ upiId, inrPaise, utr }) {
  return /^\w{6,32}$/.test(String(utr)) ? { ok: true } : { ok: false, reason: 'bad_utr' };
}

// Resolves the registered payee name for a UPI id (NPCI VPA validation via a licensed PSP/gateway).
// Return { name } or null when unknown.
async function validateVpa(upiId) {
  return null;
}

module.exports = { verifyPayout, validateVpa };
