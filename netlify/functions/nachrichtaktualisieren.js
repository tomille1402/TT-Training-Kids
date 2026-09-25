// === TTC-App · Version 485 · netlify/functions/nachrichtaktualisieren.js · erstellt 24.09.2026 ===
// Zieht die bereits angelegten Glocken-Nachrichten (appNachrichten) eines Nachwuchsspiels
// sofort nach, wenn in der App Betreuer oder Fahrer eingetragen bzw. geändert werden –
// z. B. ein zweiter Fahrer, nachdem die Erinnerung schon verschickt war. Ohne diesen
// Aufruf würde der Text erst beim nächsten täglichen Versandlauf aktualisiert.
//
// Es wird KEIN Push verschickt. Geändert werden nur vorhandene Nachrichten, und zwar
// ausschließlich aus den in Firestore gespeicherten Daten – der Aufrufer liefert nur
// den Spielschlüssel. Daher ist der Aufruf ohne Anmeldung unbedenklich.
//
// Aufruf aus der App per POST mit JSON-Body: { spielKey }
// Benötigte Umgebungsvariablen wie bei pushversand.js (Service-Account).

const pv = require("./pushversand.js");

function cors(){
  return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"POST, OPTIONS" };
}

exports.handler = async (event) => {
  if(event.httpMethod === "OPTIONS") return { statusCode:204, headers:cors(), body:"" };
  if(event.httpMethod !== "POST")   return { statusCode:405, headers:cors(), body:"Nur POST." };

  let body;
  try { body = JSON.parse(event.body||"{}"); }
  catch(e){ return { statusCode:400, headers:cors(), body:"Ungültiger Body." }; }
  const spielKey = String(body.spielKey||"").trim();
  if(!spielKey || spielKey.length>200) return { statusCode:400, headers:cors(), body:"spielKey fehlt." };

  try{
    const regelnDoc = await pv.getDocData("config/pushRegeln");
    const regeln = (regelnDoc && regelnDoc.regeln) || null;
    if(!regeln) return { statusCode:200, headers:cors(), body:JSON.stringify({aktualisiert:0}) };
    const spielplan = await pv.getDocData("config/"+pv.SAISON);
    const aufDoc = await pv.getDocData("config/"+pv.AUF_KEY);
    const einsaetzeDoc = await pv.getDocData("einsaetze/"+pv.SAISON);
    const verlegDoc = await pv.getDocData("config/verlegungen");
    const players = await pv.getCollection("players");
    const anzahl = await pv.nachwuchsNachrichtenNachziehen({
      spiele: (spielplan && spielplan.spiele) || [],
      regeln,
      einsaetzeData: (einsaetzeDoc && einsaetzeDoc.data) || {},
      aufSpieler: (aufDoc && aufDoc.spieler) || [],
      players,
      verlegungen: (verlegDoc && verlegDoc.data) || {},
      heute: pv.heuteISO(0),
      nurSpielKey: spielKey,
    });
    return { statusCode:200, headers:{...cors(),"Content-Type":"application/json"},
      body:JSON.stringify({aktualisiert:anzahl}) };
  }catch(e){
    return { statusCode:500, headers:cors(), body:"Fehler: "+((e&&e.message)||String(e)) };
  }
};
