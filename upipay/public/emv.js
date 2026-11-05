// EMVCo merchant-presented QR parser (used by PIX, QRIS and EMV-style UPI QRs). Works in browser and Node.
(function (root) {
  const CURRENCY = { 356: 'INR', 986: 'BRL', 360: 'IDR', 840: 'USD', 702: 'SGD', 764: 'THB', 458: 'MYR' };

  function tlv(str) {
    const out = [];
    for (let i = 0; i + 4 <= str.length;) {
      const tag = str.slice(i, i + 2), len = parseInt(str.slice(i + 2, i + 4), 10);
      if (!Number.isFinite(len) || i + 4 + len > str.length) return null;
      out.push([tag, str.slice(i + 4, i + 4 + len)]);
      i += 4 + len;
    }
    return out;
  }

  function crc16(s) {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function parseEmv(text) {
    text = String(text).trim();
    if (!text.startsWith('000201')) return null;
    const fields = tlv(text);
    if (!fields) return null;
    const m = new Map(fields);
    const crc = m.get('63');
    const crcOk = !!crc && crc16(text.slice(0, text.length - 4)) === crc.toUpperCase();
    let gui = '';
    for (const [tag, val] of fields) {
      if (+tag >= 26 && +tag <= 51) { const inner = tlv(val); const g = inner && inner.find(([t]) => t === '00'); if (g) { gui = g[1]; break; } }
    }
    const g = gui.toLowerCase();
    const scheme = g.includes('pix') ? 'PIX' : g.includes('qris') ? 'QRIS' : g.includes('upi') ? 'UPI' : 'EMV';
    const amount = parseFloat(m.get('54') || '');
    return {
      scheme, crcOk,
      name: m.get('59') || '', city: m.get('60') || '', country: m.get('58') || '',
      currency: CURRENCY[m.get('53')] || m.get('53') || '',
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    };
  }

  const api = { parseEmv, crc16 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Emv = api;
})(typeof self !== 'undefined' ? self : this);
