// === TTC-App · Version 297 · netlify/functions/turnieralarm.js · erstellt 06.08.2026 ===
// Benachrichtigt die beiden Spieler einer anstehenden Turnier-Begegnung per Web-Push:
// „Bitte an Tisch X zum Spiel gegen Y einfinden.“ Zusätzlich wird eine In-App-Nachricht
// (appNachrichten) abgelegt, damit die Meldung auch hinter der Glocke erscheint.
//
// Aufruf aus der App per POST mit JSON-Body:
//   { turnier, konkurrenz, tisch, spielerA:{id,name}, spielerB:{id,name} }
//
// Benötigte Umgebungsvariablen wie bei pushversand.js (Service-Account + VAPID).

const { sendePush } = require("./webpush.js");
const { getCollection, patchDoc, normName } = require("./pushversand.js");

exports.handler = async (event) => {
  if(event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
  if(event.httpMethod !== "POST")   return { statusCode:405, headers:cors(), body:"Nur POST." };

  let body;
  try { body = JSON.parse(event.body||"{}"); }
  catch(e){ return { statusCode:400, headers:cors(), body:"Ungültiger Body." }; }

  const turnier    = String(body.turnier||"").trim();
  const konkurrenz = String(body.konkurrenz||"").trim();
  const tisch      = body.tisch!=null ? String(body.tisch) : "";
  const spielerA   = body.spielerA || {};
  const spielerB   = body.spielerB || {};

  // Beide Seiten müssen mindestens eine Empfänger-ID haben. Im Doppel liefert die App
  // je Seite eine „empfaenger"-Liste (beide Team-Mitglieder); sonst ist es die eine id.
  const empfA = Array.isArray(spielerA.empfaenger) && spielerA.empfaenger.length ? spielerA.empfaenger : (spielerA.id ? [spielerA.id] : []);
  const empfB = Array.isArray(spielerB.empfaenger) && spielerB.empfaenger.length ? spielerB.empfaenger : (spielerB.id ? [spielerB.id] : []);
  const paare = [
    ...empfA.map(id=>({ id, name: spielerA.name || "", gegner: spielerB.name || "dein Gegner" })),
    ...empfB.map(id=>({ id, name: spielerB.name || "", gegner: spielerA.name || "dein Gegner" })),
  ].filter(p=>p.id);

  if(paare.length === 0){
    return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ausgeloest:false, grund:"keine Spieler-IDs" }) };
  }

  try{
    // Abos laden und je Spieler die aktiven Geräte sammeln.
    const abosDoc = await getCollection("pushAbos");
    const aboMap = {};
    for(const a of (abosDoc||[])){
      if(a.aktiv === false) continue;
      const geraete = a.geraete || {};
      const liste = Object.values(geraete).filter(g=>g&&g.endpoint&&g.p256dh&&g.auth);
      if(liste.length) aboMap[a.id || a.playerId] = liste;
    }

    const vapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY || "",
      privateKey: process.env.VAPID_PRIVATE_KEY || "",
      subject: process.env.VAPID_SUBJECT || "mailto:admin@ttc-niederzeuzheim.de"
    };

    const tischTeil = tisch ? `Tisch ${tisch}` : "dein Tisch steht bereit";
    const turnierTeil = turnier ? ` (${turnier}${konkurrenz?" · "+konkurrenz:""})` : "";
    const sendeId = `turnieralarm_${normName(turnier)}_${normName(konkurrenz)}_${tisch}_${Date.now()}`;

    let gesendet=0, fehler=0;
    const empfaengerStatus = [];
    const empfaengerIds = [];
    for(const p of paare){
      empfaengerIds.push(p.id);
      const titel = `🏓 ${tischTeil}: Spiel gegen ${p.gegner}`;
      const text  = `Bitte an ${tischTeil} einfinden – Spiel gegen ${p.gegner}${turnierTeil}.`;
      const geraete = aboMap[p.id] || [];
      if(geraete.length === 0){
        empfaengerStatus.push({ id:p.id, name:p.name, abo:false, zugestellt:false });
        continue;
      }
      let erfolg=false;
      for(const g of geraete){
        try{
          const r = await sendePush(
            { endpoint:g.endpoint, p256dh:g.p256dh, auth:g.auth },
            { titel, text, url:"/", tag:sendeId },
            vapid
          );
          if(r && r.ok){ gesendet++; erfolg=true; } else { fehler++; }
        }catch(e){ fehler++; }
      }
      empfaengerStatus.push({ id:p.id, name:p.name, abo:true, zugestellt:erfolg });
    }

    // In-App-Nachricht ablegen (auch ohne aktives Push-Abo sichtbar).
    try{
      const titelIn = tisch ? `🏓 Aufruf an Tisch ${tisch}` : "🏓 Nächstes Spiel";
      const textIn  = `${spielerA.name||"?"} vs ${spielerB.name||"?"}${tisch?` an Tisch ${tisch}`:""}${turnierTeil}.`;
      await patchDoc("appNachrichten/"+sendeId, {
        titel: titelIn, text: textIn, empfaenger: empfaengerIds,
        erstellt: new Date().toISOString().slice(0,10), ts: Date.now()
      });
    }catch(e){ /* Anzeige ist Zusatz */ }

    return {
      statusCode:200, headers:cors(),
      body: JSON.stringify({ ok:true, ausgeloest:true, gesendet, fehler, empfaenger:empfaengerStatus })
    };
  }catch(e){
    return { statusCode:500, headers:cors(), body: JSON.stringify({ ok:false, fehler:String(e&&e.message||e) }) };
  }
};

function cors(){
  return {
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type"
  };
}
