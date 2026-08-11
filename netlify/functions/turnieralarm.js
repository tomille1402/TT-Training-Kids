// === TTC-App · Version 326 · netlify/functions/turnieralarm.js · erstellt 06.08.2026 ===
// Benachrichtigt die beiden Seiten einer anstehenden Turnier-Begegnung per Web-Push:
// „Bitte an Tisch X zum Spiel gegen Y einfinden.“ Zusätzlich wird eine In-App-Nachricht
// (appNachrichten) abgelegt, damit die Meldung auch hinter der Glocke erscheint.
//
// Aufruf aus der App per POST mit JSON-Body, ENTWEDER als Spieler-Ruf:
//   { turnier, konkurrenz, tisch, spielerA:{id,name,empfaenger?}, spielerB:{id,name,empfaenger?} }
// Im Doppel enthält jede Seite ein optionales „empfaenger“-Array mit den Spieler-IDs
// beider Team-Mitglieder; sonst wird die eine „id“ als Empfänger verwendet.
// ODER als Schiedsrichter-Ruf:
//   { turnier, konkurrenz, tisch, schiri:{id,name,empfaenger?}, begegnung:{a,b} }
// Dann wird NUR der Schiedsrichter benachrichtigt, an welchem Tisch er welche
// Begegnung zu leiten hat.
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
  const schiri     = body.schiri || null;

  const tischTeil   = tisch ? `Tisch ${tisch}` : "dein Tisch steht bereit";
  const turnierTeil = turnier ? ` (${turnier}${konkurrenz?" · "+konkurrenz:""})` : "";

  // Empfängerliste je nach Ruf-Typ. Jeder Eintrag: { id, name, titel, text }.
  let paare = [];
  let inApp = null;   // { titel, text } für die In-App-Nachricht

  if(schiri && schiri.id){
    // ── Schiedsrichter-Ruf: nur der Schiedsrichter wird benachrichtigt ──
    const ids = Array.isArray(schiri.empfaenger) && schiri.empfaenger.length ? schiri.empfaenger : [schiri.id];
    const beg = body.begegnung || {};
    const paarung = (beg.a || beg.b) ? `${beg.a||"?"} – ${beg.b||"?"}` : "";
    const titel = `🎽 Schiedsrichter an ${tischTeil}`;
    const text  = `Bitte leite an ${tischTeil}${paarung?` die Begegnung ${paarung}`:""}${turnierTeil}.`;
    paare = ids.filter(Boolean).map(id=>({ id, name: schiri.name||"", titel, text }));
    inApp = {
      titel: tisch ? `🎽 Schiedsrichter an Tisch ${tisch}` : "🎽 Schiedsrichter-Einsatz",
      text : `${schiri.name||"Schiedsrichter"}${paarung?`: ${paarung}`:""}${tisch?` an Tisch ${tisch}`:""}${turnierTeil}.`
    };
  } else {
    // ── Spieler-Ruf (an den Tisch) – Verhalten wie bisher ──
    // Beide Seiten müssen mindestens eine Empfänger-ID haben. Im Doppel liefert die App
    // je Seite eine „empfaenger"-Liste (beide Team-Mitglieder); sonst ist es die eine id.
    const empfA = Array.isArray(spielerA.empfaenger) && spielerA.empfaenger.length ? spielerA.empfaenger : (spielerA.id ? [spielerA.id] : []);
    const empfB = Array.isArray(spielerB.empfaenger) && spielerB.empfaenger.length ? spielerB.empfaenger : (spielerB.id ? [spielerB.id] : []);
    paare = [
      ...empfA.map(id=>({ id, name: spielerA.name || "", gegner: spielerB.name || "dein Gegner" })),
      ...empfB.map(id=>({ id, name: spielerB.name || "", gegner: spielerA.name || "dein Gegner" })),
    ].filter(p=>p.id).map(p=>({
      id:p.id, name:p.name,
      titel: `🏓 ${tischTeil}: Spiel gegen ${p.gegner}`,
      text : `Bitte an ${tischTeil} einfinden – Spiel gegen ${p.gegner}${turnierTeil}.`
    }));
    inApp = {
      titel: tisch ? `🏓 Aufruf an Tisch ${tisch}` : "🏓 Nächstes Spiel",
      text : `${spielerA.name||"?"} vs ${spielerB.name||"?"}${tisch?` an Tisch ${tisch}`:""}${turnierTeil}.`
    };
  }

  if(paare.length === 0){
    return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ausgeloest:false, grund:"keine Empfänger-IDs" }) };
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

    const sendeId = `turnieralarm_${normName(turnier)}_${normName(konkurrenz)}_${tisch}_${schiri&&schiri.id?"sr_"+schiri.id+"_":""}${Date.now()}`;

    let gesendet=0, fehler=0;
    const empfaengerStatus = [];
    const empfaengerIds = [];
    for(const p of paare){
      empfaengerIds.push(p.id);
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
            { titel:p.titel, text:p.text, url:"/", tag:sendeId },
            vapid
          );
          if(r && r.ok){ gesendet++; erfolg=true; } else { fehler++; }
        }catch(e){ fehler++; }
      }
      empfaengerStatus.push({ id:p.id, name:p.name, abo:true, zugestellt:erfolg });
    }

    // In-App-Nachricht ablegen (auch ohne aktives Push-Abo sichtbar).
    try{
      await patchDoc("appNachrichten/"+sendeId, {
        titel: inApp.titel, text: inApp.text, empfaenger: empfaengerIds,
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
