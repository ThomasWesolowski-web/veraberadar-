// Entfernt den Rechteschutz (Standard Security Handler) aus PDFs ohne Öffnungspasswort,
// damit z. B. die eigene Rechnungs-PDF um die ZUGFeRD-Daten ergänzt werden kann.
// Unterstützt: RC4 40/128 Bit (R2/R3), AES-128 (R4/AESV2), AES-256 (R5/R6/AESV3).
// PDFs mit Öffnungspasswort werden nicht geöffnet.

// ------------------------------------------------------------------ MD5 (RFC 1321)
function md5(bytes) {
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padLen = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const bitLen = len * 8;
  buf[padLen - 8] = bitLen & 0xff; buf[padLen - 7] = (bitLen >>> 8) & 0xff;
  buf[padLen - 6] = (bitLen >>> 16) & 0xff; buf[padLen - 5] = (bitLen >>> 24) & 0xff;
  buf[padLen - 4] = Math.floor(bitLen / 2 ** 32) & 0xff;
  let a0 = 0x67452301; let b0 = 0xefcdab89 | 0; let c0 = 0x98badcfe | 0; let d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      M[i] = buf[j] | (buf[j + 1] << 8) | (buf[j + 2] << 16) | (buf[j + 3] << 24);
    }
    let A = a0; let B = b0; let C = c0; let D = d0;
    for (let i = 0; i < 64; i++) {
      let F; let g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D; D = C; C = B;
      const x = (A + F + K[i] + M[g]) | 0;
      B = (B + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (8 * k)) & 0xff; });
  return out;
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const PAD = new Uint8Array([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

const subtle = () => globalThis.crypto?.subtle;

async function aesCbcDecrypt(key, data) {
  if (data.length < 32 || data.length % 16) return data.slice(16); // nur IV / defekt
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: data.slice(0, 16) }, k, data.slice(16)));
}
async function aesCbcEncryptNoPad(key, iv, data) {
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  const enc = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv }, k, data));
  return enc.slice(0, data.length); // PKCS#7-Block am Ende verwerfen
}
async function aesEcbDecryptBlock(key, block) {
  // ECB über CBC mit Null-IV und angehängtem Padding-Block simulieren
  const k = await subtle().importKey('raw', key, 'AES-CBC', false, ['encrypt', 'decrypt']);
  const padBlock = new Uint8Array(16).fill(16);
  const encPad = new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: block }, k, padBlock)).slice(0, 16);
  const dec = new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, concat(block, encPad)));
  return dec.slice(0, 16);
}
const sha = async (alg, data) => new Uint8Array(await subtle().digest(alg, data));

/** ISO 32000-2, Algorithmus 2.B (R6) */
async function hash2B(password, salt, udata) {
  let K = await sha('SHA-256', concat(password, salt, udata));
  for (let round = 0; ; round++) {
    const K1 = concat(password, K, udata);
    const rep = new Uint8Array(K1.length * 64);
    for (let i = 0; i < 64; i++) rep.set(K1, i * K1.length);
    const E = await aesCbcEncryptNoPad(K.slice(0, 16), K.slice(16, 32), rep);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += E[i];
    const alg = ['SHA-256', 'SHA-384', 'SHA-512'][sum % 3];
    K = await sha(alg, E);
    if (round >= 63 && E[E.length - 1] <= round - 32) break;
  }
  return K.slice(0, 32);
}

/**
 * Entschlüsselt ein mit { ignoreEncryption: true } geladenes pdf-lib-Dokument in-place.
 * @returns {Promise<boolean>} true, wenn entschlüsselt wurde
 */
export async function removePdfEncryption(doc, PDFLib) {
  const { PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFNumber, PDFBool } = PDFLib;
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  if (!encRef) return false;
  const enc = ctx.lookup(encRef, PDFDict);
  const get = (d, k) => d.lookup(PDFName.of(k));
  const name = (d, k) => { const v = get(d, k); return v ? String(v) : ''; };
  const numv = (d, k, def) => { const v = get(d, k); return v instanceof PDFNumber ? v.asNumber() : def; };
  const bytesOf = (v) => (v ? v.asBytes() : new Uint8Array());

  if (name(enc, 'Filter') !== '/Standard') throw new Error('Unbekanntes PDF-Sicherheitsverfahren – die PDF kann nicht erweitert werden.');
  const V = numv(enc, 'V', 0);
  const R = numv(enc, 'R', 2);
  const O = bytesOf(get(enc, 'O'));
  const U = bytesOf(get(enc, 'U'));
  const P = numv(enc, 'P', 0);
  const encMeta = !(get(enc, 'EncryptMetadata') instanceof PDFBool && get(enc, 'EncryptMetadata').asBoolean() === false);

  // Verfahren für Streams/Strings bestimmen
  let method = 'RC4';
  let strMethod = 'RC4';
  if (V >= 4) {
    const cf = get(enc, 'CF');
    const methodOf = (filterName) => {
      if (!filterName || filterName === '/Identity') return 'None';
      const f = cf?.lookup(PDFName.of(filterName.slice(1)));
      const cfm = f ? name(f, 'CFM') : '/V2';
      return cfm === '/AESV2' ? 'AESV2' : cfm === '/AESV3' ? 'AESV3' : cfm === '/None' ? 'None' : 'RC4';
    };
    method = methodOf(name(enc, 'StmF') || '/Identity');
    strMethod = methodOf(name(enc, 'StrF') || '/Identity');
  }

  let fileKey;
  if (R <= 4) {
    const n = R === 2 ? 5 : (numv(enc, 'Length', 40) / 8);
    const idArr = ctx.trailerInfo.ID;
    const id0 = idArr ? bytesOf(ctx.lookup(idArr, PDFArray).lookup(0)) : new Uint8Array();
    const p = new Uint8Array([P & 0xff, (P >> 8) & 0xff, (P >> 16) & 0xff, (P >>> 24) & 0xff]);
    let h = md5(concat(PAD, O.slice(0, 32), p, id0, R >= 4 && !encMeta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array()));
    if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.slice(0, n));
    fileKey = h.slice(0, n);
    // leeres Benutzerpasswort prüfen (Algorithmus 4/5)
    let ok;
    if (R === 2) ok = rc4(fileKey, PAD).every((b, i) => b === U[i]);
    else {
      let x = rc4(fileKey, md5(concat(PAD, id0)));
      for (let i = 1; i <= 19; i++) x = rc4(fileKey.map((b) => b ^ i), x);
      ok = x.every((b, i) => b === U[i]);
    }
    if (!ok) throw new Error('Die PDF ist mit einem Öffnungspasswort geschützt und kann nicht verarbeitet werden.');
  } else {
    if (!subtle()) throw new Error('AES-256-geschützte PDFs werden in dieser Umgebung nicht unterstützt.');
    const UE = bytesOf(get(enc, 'UE'));
    const empty = new Uint8Array();
    const valSalt = U.slice(32, 40);
    const keySalt = U.slice(40, 48);
    const check = R === 5 ? await sha('SHA-256', concat(empty, valSalt)) : await hash2B(empty, valSalt, empty);
    if (!check.every((b, i) => b === U[i])) throw new Error('Die PDF ist mit einem Öffnungspasswort geschützt und kann nicht verarbeitet werden.');
    const ik = R === 5 ? await sha('SHA-256', concat(empty, keySalt)) : await hash2B(empty, keySalt, empty);
    // UE mit AES-256 (CBC, IV 0, ohne Padding) entschlüsseln: blockweise ECB + XOR
    fileKey = new Uint8Array(32);
    let prev = new Uint8Array(16);
    for (let b = 0; b < 2; b++) {
      const block = UE.slice(b * 16, b * 16 + 16);
      const dec = await aesEcbDecryptBlock(ik, block);
      for (let i = 0; i < 16; i++) fileKey[b * 16 + i] = dec[i] ^ prev[i];
      prev = block;
    }
  }

  const objKey = (ref, aes) => {
    if (R >= 5) return fileKey;
    const n = fileKey.length;
    const extra = new Uint8Array([ref.objectNumber & 0xff, (ref.objectNumber >> 8) & 0xff, (ref.objectNumber >> 16) & 0xff,
      ref.generationNumber & 0xff, (ref.generationNumber >> 8) & 0xff]);
    const k = md5(concat(fileKey, extra, aes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array()));
    return k.slice(0, Math.min(n + 5, 16));
  };
  const decrypt = async (data, ref, m) => {
    if (m === 'None') return data;
    if (m === 'RC4') return rc4(objKey(ref, false), data);
    return aesCbcDecrypt(objKey(ref, true), data);
  };
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  const walk = async (obj, ref) => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      return PDFHexString.of(toHex(await decrypt(obj.asBytes(), ref, strMethod)));
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) obj.set(i, await walk(obj.get(i), ref));
      return obj;
    }
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) obj.set(k, await walk(v, ref));
      return obj;
    }
    return obj;
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref === encRef || (encRef.objectNumber === ref.objectNumber)) continue;
    if (obj instanceof PDFRawStream) {
      const type = obj.dict.lookup(PDFName.of('Type'));
      const t = type ? String(type) : '';
      await walk(obj.dict, ref);
      if (t === '/XRef') continue;
      if (t === '/Metadata' && !encMeta) continue;
      const data = await decrypt(obj.contents, ref, method);
      ctx.assign(ref, PDFRawStream.of(obj.dict, data));
    } else {
      await walk(obj, ref);
    }
  }
  ctx.delete(encRef);
  ctx.trailerInfo.Encrypt = undefined;
  return true;
}

export const __test = { md5, rc4 };
