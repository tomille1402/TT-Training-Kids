// === TTC-App · Version 269 · netlify/functions/einsatzalarm.js · erstellt 29.07.2026 ===
// Sofort-Benachrichtigung, wenn ein Spieler seinen Einsatz-Status von "verfügbar"
// (grüner Haken / "ja") auf einen anderen Status ändert. Empfänger: der zuständige
// Mannschaftsführer der betroffenen Mannschaft sowie alle Admins. Es wird sowohl
// Web-Push an deren angemeldete Geräte verschickt als auch eine In-App-Nachricht
// (appNachrichten) abgelegt, damit die Meldung auch hinter der Glocke erscheint.
//
// Aufruf aus der App per POST mit JSON-Body:
//   { spielerName, mannschaft, gegner, datum, alterStatus, neuerStatus }
//
// Benötigte Umgebungsvariablen wie bei pushversand.js (Service-Account + VAPID).

const { sendePush } = require("./webpush.js");
const {
  getDocData, getCollection, patchDoc, normName
} = require("./pushversand.js");

// Lesbarer Text je Status-Schlüssel.
const STATUS_TEXT = {
  ja: "verfügbar", nein: "verhindert", vielleicht: "vielleicht", verletzt: "verletzt", "": "ohne Angabe"
};

// Normalisiert einen Mannschaftsnamen für den Vergleich (MF-Zuordnung).
function normMann(s){ return String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,]/g,""); }

// Spielplan-Namen (z.B. "Herren 2") → Aufstellungs-/MF-Namen (z.B. "Erwachsene II").
// Muss zur Tabelle in der App (SPIELPLAN_TO_AUFSTELLUNG) passen.
const SPIELPLAN_TO_AUFSTELLUNG = {
  "Herren 1":"Erwachsene", "Herren 2":"Erwachsene II", "Herren 3":"Erwachsene III",
  "Herren 4":"Erwachsene IV", "Herren 5":"Erwachsene V", "Herren 6":"Erwachsene VI",
  "Mädchen 11":"Mädchen 11", "Mädchen 13":"Mädchen 13", "Mädchen 15":"Mädchen 15",
  "Jugend 11":"Jugend 11",
};

exports.handler = async (event) => {
  // CORS/Preflight zulassen (die App ruft von derselben Domain, aber sicher ist sicher).
  if(event.httpMethod === "OPTIONS"){
    return { statusCode:204, headers:cors(), body:"" };
  }
  if(event.httpMethod !== "POST"){
    return { statusCode:405, headers:cors(), body:"Nur POST." };
  }

  let body;
  try { body = JSON.parse(event.body||"{}"); }
  catch(e){ return { statusCode:400, headers:cors(), body:"Ungültiger Body." }; }

  const spielerName = String(body.spielerName||"").trim();
  const mannschaft  = String(body.mannschaft||"").trim();
  // Für die MF-Zuordnung maßgeblich ist der Aufstellungs-Name (mannschaftsfuehrerTeam).
  // Die App sendet ihn als mannschaftAufstellung; fehlt er (ältere App), auf den
  // Spielplan-Namen zurückfallen und serverseitig übersetzen.
  const mannschaftAufstellung = String(body.mannschaftAufstellung || SPIELPLAN_TO_AUFSTELLUNG[mannschaft] || mannschaft).trim();
  const gegner      = String(body.gegner||"").trim();
  const datum       = String(body.datum||"").trim();
  const alterStatus = String(body.alterStatus||"").trim();
  const neuerStatus = String(body.neuerStatus||"").trim();

  // Kernbedingung serverseitig absichern: nur auslösen, wenn vorher "ja" war und
  // sich der Status auf etwas anderes geändert hat.
  if(alterStatus !== "ja" || neuerStatus === "ja"){
    return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ausgeloest:false, grund:"kein Wechsel von verfügbar" }) };
  }
  if(!spielerName || !mannschaft){
    return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ausgeloest:false, grund:"unvollständige Angaben" }) };
  }

  try{
    const playersDoc = await getCollection("players");
    const players = playersDoc || [];

    // Empfänger bestimmen: zuständiger MF dieser Mannschaft + alle aktiven Admins.
    // MF-Zuordnung über den Aufstellungs-Namen (entspricht mannschaftsfuehrerTeam).
    const ziel = normMann(mannschaftAufstellung);
    const empfaengerIds = new Set();
    for(const p of players){
      if(p.status === "passiv") continue;
      const istMFderMannschaft = p.roles?.mannschaftsfuehrer === true &&
        normMann(p.mannschaftsfuehrerTeam) === ziel;
      const istAdmin = p.roles?.admin === true;
      if(istMFderMannschaft || istAdmin) empfaengerIds.add(p.id);
    }
    const ids = [...empfaengerIds];
    if(ids.length === 0){
      return { statusCode:200, headers:cors(), body: JSON.stringify({ ok:true, ausgeloest:false, grund:"keine Empfänger" }) };
    }

    // Abos laden
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

    const gegnerTeil = gegner ? ` gegen ${gegner}` : "";
    const datumTeil  = datum ? ` am ${deDatum(datum)}` : "";
    const titel = `⚠️ ${spielerName} ist jetzt ${STATUS_TEXT[neuerStatus]||neuerStatus}`;
    const text  = `${mannschaft}${gegnerTeil}${datumTeil}: Status von „verfügbar“ auf „${STATUS_TEXT[neuerStatus]||neuerStatus}“ geändert.`;
    const sendeId = `einsatzalarm_${datum}_${normName(mannschaft)}_${normName(spielerName)}_${Date.now()}`;

    // Push-Dienst am Endpunkt erkennen (für die Diagnose).
    const dienstVon = (ep)=>{
      if(/fcm\.googleapis\.com|android\.googleapis\.com/.test(ep)) return "Android/FCM";
      if(/\.push\.apple\.com/.test(ep)) return "Apple";
      if(/mozilla|mozaws/.test(ep)) return "Firefox";
      if(/notify\.windows\.com|wns/.test(ep)) return "Windows";
      return "andere";
    };
    // Namen der Empfänger (für die App-Übersicht).
    const nameVon = (pid)=>{
      const p = players.find(x=>x.id===pid);
      return p ? `${p.firstName||""} ${p.lastName||""}`.trim() : pid;
    };

    // Push senden – je Empfänger den Zustellstatus festhalten.
    let gesendet=0, fehler=0;
    const zustellDetails = [];     // technische Diagnose (Dienst + HTTP-Status)
    const empfaengerStatus = [];   // je Empfänger: hatte Gerät? angekommen?
    for(const pid of ids){
      const geraete = aboMap[pid] || [];
      if(geraete.length===0){
        empfaengerStatus.push({ id:pid, name:nameVon(pid), abo:false, zugestellt:false });
        continue;
      }
      let einsErfolg=false;
      for(const g of geraete){
        try{
          const r = await sendePush(
            { endpoint:g.endpoint, p256dh:g.p256dh, auth:g.auth },
            { titel, text, url:"/", tag:sendeId },
            vapid
          );
          if(r && r.ok){ gesendet++; einsErfolg=true; }
          else { fehler++; zustellDetails.push({ name:nameVon(pid), dienst:dienstVon(g.endpoint||""), status:(r&&r.status)||"?" }); }
        }catch(e){ fehler++; zustellDetails.push({ name:nameVon(pid), dienst:dienstVon(g.endpoint||""), status:"Ausnahme" }); }
      }
      empfaengerStatus.push({ id:pid, name:nameVon(pid), abo:true, zugestellt:einsErfolg });
    }

    // In-App-Nachricht ablegen (auch für Empfänger ohne aktives Abo sichtbar).
    try{
      await patchDoc("appNachrichten/"+sendeId, {
        titel, text, empfaenger: ids,
        erstellt: (datum || new Date().toISOString().slice(0,10)),
        ts: Date.now()
      });
    }catch(e){ /* Anzeige ist Zusatz */ }

    // Protokoll für die App-Übersicht ablegen: was wurde ausgelöst, wer war Empfänger,
    // kam es an? So kann der Admin in der App nachvollziehen, ob MF informiert wurden.
    try{
      await patchDoc("einsatzalarmLog/"+sendeId, {
        ts: Date.now(),
        spielerName, mannschaft, mannschaftAufstellung, gegner, datum,
        neuerStatus,
        empfaenger: empfaengerStatus,
        gesendet, fehler
      });
    }catch(e){ /* Protokoll ist Zusatz */ }

    return { statusCode:200, headers:cors(), body: JSON.stringify({
      ok:true, ausgeloest:true, empfaenger:ids.length, gesendet, fehler,
      empfaengerStatus,
      zustellFehler: zustellDetails
    }, null, 2) };
  }catch(e){
    return { statusCode:500, headers:cors(), body: JSON.stringify({ ok:false, fehler: (e&&e.message)||String(e) }) };
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

// Wandelt ISO-Datum (JJJJ-MM-TT) in TT.MM.JJJJ. Andere Formate unverändert.
function deDatum(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso||"");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso||"");
}
