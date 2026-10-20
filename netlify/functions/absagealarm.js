// === TTC-App · Version 548 · netlify/functions/absagealarm.js · erstellt 20.10.2026 ===
// Sofort-Benachrichtigung, wenn Eltern (oder das Kind selbst) in der App ein Training
// absagen. Empfänger: alle aktiven Trainer und Admins (Funktion „Trainer" bzw. „Admin"
// im Personendatensatz). Es wird Web-Push an deren angemeldete Geräte verschickt und
// eine In-App-Nachricht (appNachrichten, Kategorie „trainingsabsagen") abgelegt, damit
// die Meldung auch hinter der Glocke erscheint.
//
// Aufruf aus der App per POST mit JSON-Body:
//   { verein, playerId, datum }
// Die Angaben werden serverseitig gegen die gespeicherte Absage geprüft
// (absagen/<datum>_<playerId>, höchstens 15 Minuten alt) – Name und Grund stammen aus
// den gespeicherten Daten, nicht aus dem Aufruf.
//
// Benötigte Umgebungsvariablen wie bei pushversand.js (Service-Account + VAPID).

const { sendePush } = require("./webpush.js");
const { getDocData, getCollection, patchDoc, setzeVerein } = require("./pushversand.js");

exports.handler = async (event) => {
  if(event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
  if(event.httpMethod !== "POST") return { statusCode:405, headers:cors(), body:"Nur POST." };

  let body;
  try { body = JSON.parse(event.body||"{}"); }
  catch(e){ return { statusCode:400, headers:cors(), body:"Ungültiger Body." }; }
  setzeVerein(body.verein||null);

  const playerId = String(body.playerId||"").trim();
  const datum    = String(body.datum||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !/^[A-Za-z0-9_-]{1,128}$/.test(playerId)){
    return antwort({ ok:true, ausgeloest:false, grund:"unvollständige Angaben" });
  }

  try{
    // Absage muss existieren und frisch sein (Schutz vor beliebigen Aufrufen).
    const absage = await getDocData(`absagen/${datum}_${playerId}`);
    if(!absage || absage.playerId !== playerId || absage.date !== datum){
      return antwort({ ok:true, ausgeloest:false, grund:"keine Absage gespeichert" });
    }
    const alter = Date.now() - Number(absage.zeit||0);
    if(!(alter >= -60000 && alter <= 15*60000)){
      return antwort({ ok:true, ausgeloest:false, grund:"Absage nicht aktuell" });
    }

    const players = (await getCollection("players")) || [];
    const kind = players.find(p=>p.id===playerId);
    const kindName = kind ? `${kind.firstName||""} ${kind.lastName||""}`.trim() : "Ein Spieler";
    const gruppe = kind && kind.group ? String(kind.group) : "";

    // Empfänger: alle aktiven Trainer und Admins.
    const ids = players
      .filter(p => p.status !== "passiv" && (p.roles?.trainer === true || p.roles?.admin === true))
      .map(p => p.id);
    if(ids.length === 0) return antwort({ ok:true, ausgeloest:false, grund:"keine Empfänger" });

    // Push-Abos laden
    const abos = (await getCollection("pushAbos")) || [];
    const aboMap = {};
    for(const a of abos){
      if(a.aktiv === false) continue;
      const liste = Object.values(a.geraete || {}).filter(g=>g&&g.endpoint&&g.p256dh&&g.auth);
      if(liste.length) aboMap[a.id || a.playerId] = liste;
    }
    const vapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY || "",
      privateKey: process.env.VAPID_PRIVATE_KEY || "",
      subject: process.env.VAPID_SUBJECT || "mailto:admin@ttc-niederzeuzheim.de"
    };

    const grund = String(absage.grund||"").trim();
    const titel = `📩 Training abgesagt: ${kindName}`;
    const text  = `${deDatumMitTag(datum)}${gruppe?` · ${gruppe}`:""}${grund?` · Grund: ${grund}`:""}`;
    const sendeId = `trainingsabsage_${datum}_${playerId}_${Date.now()}`;

    let gesendet = 0, fehler = 0;
    for(const pid of ids){
      for(const g of (aboMap[pid] || [])){
        try{
          const r = await sendePush({ endpoint:g.endpoint, p256dh:g.p256dh, auth:g.auth },
            { titel, text, url:"/", tag:sendeId }, vapid);
          if(r && r.ok) gesendet++; else fehler++;
        }catch(e){ fehler++; }
      }
    }

    // In-App-Nachricht (auch für Empfänger ohne Push-Abo sichtbar)
    try{
      await patchDoc("appNachrichten/"+sendeId, {
        titel, text, empfaenger: ids, kategorie: "trainingsabsagen",
        erstellt: new Date().toISOString().slice(0,10), ts: Date.now()
      });
    }catch(e){ /* Anzeige ist Zusatz */ }

    return antwort({ ok:true, ausgeloest:true, empfaenger:ids.length, gesendet, fehler });
  }catch(e){
    return { statusCode:500, headers:cors(), body: JSON.stringify({ ok:false, fehler:(e&&e.message)||String(e) }) };
  }
};

function antwort(o){ return { statusCode:200, headers:cors(), body: JSON.stringify(o) }; }
function cors(){
  return {
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type"
  };
}
// „Di. 20.10.2026" aus JJJJ-MM-TT
function deDatumMitTag(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso||"");
  if(!m) return iso||"";
  const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  return `${["So.","Mo.","Di.","Mi.","Do.","Fr.","Sa."][d.getUTCDay()]} ${m[3]}.${m[2]}.${m[1]}`;
}
