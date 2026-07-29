// === TTC-App · Version 268 · netlify/functions/webpush.js · erstellt 29.07.2026 ===
// Web-Push mit Node-Bordmitteln (ohne externe Bibliothek).
// Umsetzt: VAPID-Authentifizierung (JWT, ES256) und Payload-Verschlüsselung
// nach RFC 8291 (aes128gcm). Reicht für Chrome/Firefox/Edge/Safari-Web-Push.

const crypto = require("crypto");

// ── Base64URL-Helfer ──
function b64url(buf){
  return Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlToBuf(str){
  str = String(str||"").replace(/-/g,"+").replace(/_/g,"/");
  while(str.length%4) str += "=";
  return Buffer.from(str,"base64");
}

// ── VAPID: signiertes JWT für den Authorization-Header erzeugen ──
// Wandelt den privaten VAPID-Schlüssel (base64url, 32 Byte "raw") in ein
// PEM-EC-Schlüsselobjekt, mit dem ES256 signiert werden kann.
function privateKeyObjectFromRaw(privRaw, pubRaw){
  // JWK aus rohen Koordinaten bauen (d = privater Skalar, x/y = öffentl. Punkt)
  const pub = b64urlToBuf(pubRaw); // 65 Byte: 0x04 || X(32) || Y(32)
  const x = pub.subarray(1,33), y = pub.subarray(33,65);
  const jwk = {
    kty:"EC", crv:"P-256",
    d: b64url(b64urlToBuf(privRaw)),
    x: b64url(x), y: b64url(y),
    ext:true
  };
  return crypto.createPrivateKey({ key:jwk, format:"jwk" });
}

function vapidAuthHeader(endpoint, vapidPublic, vapidPrivate, subject){
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now()/1000) + 12*60*60; // max 24h; hier 12h
  const header = { typ:"JWT", alg:"ES256" };
  const payload = { aud, exp, sub: subject || "mailto:admin@example.com" };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));

  const keyObj = privateKeyObjectFromRaw(vapidPrivate, vapidPublic);
  const derSig = crypto.sign("sha256", Buffer.from(signingInput), { key:keyObj, dsaEncoding:"ieee-p1363" });
  const jwt = signingInput + "." + b64url(derSig);
  return { jwt, publicKey: vapidPublic };
}

// ── Payload-Verschlüsselung nach RFC 8291 (aes128gcm) ──
function encryptPayload(plaintextBuf, clientP256dh, clientAuth){
  const clientPub = b64urlToBuf(clientP256dh);   // 65 Byte
  const clientAuthSecret = b64urlToBuf(clientAuth); // 16 Byte

  // Ephemeres Server-Schlüsselpaar
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey(); // 65 Byte (0x04||X||Y)
  const sharedSecret = ecdh.computeSecret(clientPub);

  const salt = crypto.randomBytes(16);

  // PRK-Kombination gemäß RFC 8291
  const authInfo = Buffer.concat([Buffer.from("WebPush: info\0"), clientPub, serverPub]);
  const ikm = crypto.hkdfSync("sha256", sharedSecret, clientAuthSecret, authInfo, 32);
  const ikmBuf = Buffer.from(ikm);

  const cekInfo = Buffer.from("Content-Encoding: aes128gcm\0");
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikmBuf, salt, cekInfo, 16));
  const nonceInfo = Buffer.from("Content-Encoding: nonce\0");
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikmBuf, salt, nonceInfo, 12));

  // Inhalt: plaintext + 0x02 (letzter Record-Delimiter), dann AES-128-GCM
  const withDelim = Buffer.concat([plaintextBuf, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(withDelim), cipher.final()]);
  const tag = cipher.getAuthTag();

  // aes128gcm-Header: salt(16) || rs(4, =4096) || idlen(1) || keyid(serverPub 65)
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([serverPub.length]);
  const header = Buffer.concat([salt, rs, idlen, serverPub]);

  return Buffer.concat([header, encrypted, tag]);
}

// ── Eine Push-Nachricht an ein Abo senden ──
// abo = { endpoint, p256dh, auth }; nachricht = beliebiges JSON-Objekt
async function sendePush(abo, nachricht, vapid){
  const body = encryptPayload(Buffer.from(JSON.stringify(nachricht)), abo.p256dh, abo.auth);
  const { jwt, publicKey } = vapidAuthHeader(abo.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject);

  const res = await fetch(abo.endpoint, {
    method:"POST",
    headers:{
      "TTL":"86400",
      "Content-Encoding":"aes128gcm",
      "Content-Type":"application/octet-stream",
      "Authorization":`vapid t=${jwt}, k=${publicKey}`
    },
    body
  });
  return { ok: res.status>=200 && res.status<300, status: res.status };
}

module.exports = { sendePush, encryptPayload, vapidAuthHeader, b64url, b64urlToBuf };
