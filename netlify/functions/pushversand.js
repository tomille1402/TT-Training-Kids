// Netlify Scheduled Function: täglicher Versand der Termin-Erinnerungen.
// Liest die Push-Regeln (config/pushRegeln) und ermittelt, welche Spiele und
// Vereinstermine heute eine Erinnerung auslösen, bestimmt die Empfänger und
// verschickt Web-Push an deren angemeldete Geräte (pushAbos). Eine Historie
// (config/pushVersand) verhindert, dass dieselbe Erinnerung doppelt rausgeht.
//
// Benötigte Umgebungsvariablen (Netlify):
//   FIREBASE_PROJECT_ID   – Projekt-ID
//   FIREBASE_API_KEY      – (optional) Web-API-Key für Firestore-REST
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT – für Web-Push
//   PUSH_ADMIN_TOKEN      – (optional) schützt den manuellen Testaufruf

const { sendePush } = require("./webpush.js");

const crypto = require("crypto");
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const SAISON     = "spielplan_2026_2027";
const AUF_KEY    = "aufstellung_2026_2027_V";

// ── Service-Account-Authentifizierung ──
// Die Funktion läuft ohne eingeloggten Nutzer, muss aber geschützte Daten
// (Spieler, Abos, Einsätze) lesen und die Historie schreiben. Statt diese Daten
// öffentlich zu machen (Datenschutz!), authentifiziert sie sich mit einem
// Firebase-Service-Account und erhält damit serverseitig vollen Zugriff.
// Der Service-Account-Schlüssel (JSON) steht als Netlify-Umgebungsvariable
// FIREBASE_SERVICE_ACCOUNT (der komplette JSON-Inhalt als eine Zeile).
let _tokenCache = { token:"", exp:0 };
function b64url(buf){ return Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }

async function getAccessToken(){
  const now = Math.floor(Date.now()/1000);
  if(_tokenCache.token && _tokenCache.exp > now+60) return _tokenCache.token;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  if(!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt");
  const sa = JSON.parse(raw);

  const header = { alg:"RS256", typ:"JWT" };
  const scope = "https://www.googleapis.com/auth/datastore";
  const claim = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claim));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key);
  const jwt = signingInput + "." + b64url(sig);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  if(!res.ok) throw new Error("Token-Abruf fehlgeschlagen: "+res.status);
  const j = await res.json();
  _tokenCache = { token: j.access_token, exp: now + (j.expires_in||3600) };
  return _tokenCache.token;
}

// ── Firestore REST mit Service-Account-Token ──
function fsBase(){
  return `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
}
async function getDocData(path){
  const token = await getAccessToken();
  const r = await fetch(`${fsBase()}/${path}`, { headers:{ Authorization:`Bearer ${token}` } });
  if(!r.ok) return null;
  const j = await r.json();
  return j.fields ? convertFields(j.fields) : {};
}
async function getCollection(path){
  const token = await getAccessToken();
  const out = [];
  let pageToken = "";
  do{
    const url = `${fsBase()}/${path}?pageSize=300${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:""}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    if(!r.ok) break;
    const j = await r.json();
    for(const d of (j.documents||[])){
      const id = d.name.split("/").pop();
      out.push({ id, ...(d.fields?convertFields(d.fields):{}) });
    }
    pageToken = j.nextPageToken || "";
  } while(pageToken);
  return out;
}
function convertFields(fields){ const o={}; for(const k in fields) o[k]=convertValue(fields[k]); return o; }
function convertValue(v){
  if(v.stringValue!==undefined) return v.stringValue;
  if(v.integerValue!==undefined) return Number(v.integerValue);
  if(v.doubleValue!==undefined) return v.doubleValue;
  if(v.booleanValue!==undefined) return v.booleanValue;
  if(v.arrayValue!==undefined) return (v.arrayValue.values||[]).map(convertValue);
  if(v.mapValue!==undefined) return convertFields(v.mapValue.fields||{});
  if(v.nullValue!==undefined) return null;
  return null;
}

// ── Firestore REST: schreiben (für die Versand-Historie) ──
async function patchDoc(path, dataObj){
  const token = await getAccessToken();
  const fields = toFields(dataObj);
  const r = await fetch(`${fsBase()}/${path}`, {
    method:"PATCH",
    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
    body: JSON.stringify({ fields })
  });
  return r.ok;
}
function toFields(obj){
  const f = {};
  for(const k in obj) f[k] = toValue(obj[k]);
  return f;
}
function toValue(v){
  if(v===null||v===undefined) return { nullValue:null };
  if(typeof v==="boolean") return { booleanValue:v };
  if(typeof v==="number") return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v)) return { arrayValue:{ values:v.map(toValue) } };
  if(typeof v==="object") return { mapValue:{ fields:toFields(v) } };
  return { stringValue:String(v) };
}

// ── Datums-Helfer (lokale Zeit Europe/Berlin ausreichend genau über Offset) ──
function heuteISO(offsetTage=0){
  // Berlin = UTC+1/+2. Für die Tagesbestimmung reicht UTC+2 als Näherung am
  // Vormittag (Versand 8 Uhr). Wir arbeiten datumsbasiert, nicht sekundengenau.
  const d = new Date(Date.now() + 2*3600000 + offsetTage*86400000);
  return d.toISOString().slice(0,10);
}
function normName(s){ return (s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,]/g,""); }
function spielKeyOf(s){ return `${s.datum}_${s.mannschaft}_${normName(s.gegner)}`.replace(/[.#$/\[\]]/g,"_"); }

module.exports = { getDocData, getCollection, patchDoc, heuteISO, normName, spielKeyOf, convertFields, convertValue };

// ── Fachlogik: Empfänger ──
function istNachwuchsMannschaft(mannschaft, nachwuchsListe){
  return (nachwuchsListe||[]).includes(mannschaft);
}
function stammspielerIds(mannschaft, aufSpieler, players){
  const zeilen = aufSpieler.filter(r=>r.mannschaft===mannschaft && !/NES/i.test(r.bem||""));
  const ids = [];
  for(const row of zeilen){
    const p = players.find(pl =>
      normName((pl.lastName||"")+","+(pl.firstName||""))===normName(row.name) ||
      normName((pl.firstName||"")+(pl.lastName||""))===normName(row.name) ||
      normName((pl.lastName||"")+(pl.firstName||""))===normName(row.name));
    if(p) ids.push(p.id);
  }
  return ids;
}
function zusageIds(spielKey, einsaetzeData){
  const e = einsaetzeData[spielKey] || {};
  const ids = [];
  for(const pid in e){
    if(pid.startsWith("_")) continue;
    if(e[pid] && e[pid].status==="ja") ids.push(pid);
  }
  return ids;
}
function spielEmpfaenger(opts, mannschaft, spielKey, aufSpieler, einsaetzeData, players){
  const set = new Set();
  const wollen = opts && opts.length ? opts : ["stammPlusZusage"];
  if(wollen.includes("stammPlusZusage")){
    stammspielerIds(mannschaft,aufSpieler,players).forEach(id=>set.add(id));
    zusageIds(spielKey,einsaetzeData).forEach(id=>set.add(id));
  }
  if(wollen.includes("zusage")) zusageIds(spielKey,einsaetzeData).forEach(id=>set.add(id));
  if(wollen.includes("trainer")) players.filter(p=>p.roles&&p.roles.trainer).forEach(p=>set.add(p.id));
  if(wollen.includes("admin"))   players.filter(p=>p.roles&&p.roles.admin).forEach(p=>set.add(p.id));
  return [...set];
}
function terminEmpfaenger(funktionen, players){
  const set = new Set();
  const hatFunktion = (p,fk)=>{
    const r = p.roles||{}; const g = p.group||"";
    if(fk==="player") return r.player===true || g==="Profis"||g==="Fortgeschrittene"||g==="Anfänger";
    if(fk==="erwachsene") return r.erwachsene===true || g==="Erwachsene";
    if(fk==="trainer") return r.trainer===true;
    if(fk==="admin") return r.admin===true;
    if(fk==="mannschaftsfuehrer") return r.mannschaftsfuehrer===true;
    if(fk==="vorstand") return r.vorstand===true;
    return false;
  };
  for(const p of players){
    if(p.status==="passiv") continue;
    if((funktionen||[]).some(fk=>hatFunktion(p,fk))) set.add(p.id);
  }
  return [...set];
}
function tageBis(terminISO, heute){
  const a=new Date(terminISO+"T12:00:00Z"), b=new Date(heute+"T12:00:00Z");
  return Math.round((a-b)/86400000);
}

// ── Handler ──
module.exports.handler = async (event) => {
  try{
    if(!PROJECT_ID) return { statusCode:500, body:"FIREBASE_PROJECT_ID fehlt" };
    const vapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY || "",
      privateKey: process.env.VAPID_PRIVATE_KEY || "",
      subject: process.env.VAPID_SUBJECT || "mailto:admin@ttc-niederzeuzheim.de"
    };
    if(!vapid.publicKey || !vapid.privateKey) return { statusCode:500, body:"VAPID-Schlüssel fehlen" };

    // Optional: Testlauf ohne echten Versand (?dry=1) und Datum überschreiben (?datum=YYYY-MM-DD)
    const q = (event && event.queryStringParameters) || {};
    const dryRun = q.dry==="1";
    const heute = q.datum || heuteISO(0);

    const regelnDoc = await getDocData("config/pushRegeln");
    const regeln = (regelnDoc && regelnDoc.regeln) || null;
    if(!regeln) return { statusCode:200, body:"Keine Push-Regeln konfiguriert – nichts zu tun." };

    const spielplan = await getDocData("config/"+SAISON);
    const spiele = (spielplan && spielplan.spiele) || [];
    const vtDoc = await getDocData("config/vereinstermine");
    const vereinstermine = (vtDoc && vtDoc.termine) || [];
    const aufDoc = await getDocData("config/"+AUF_KEY);
    const aufSpieler = (aufDoc && aufDoc.spieler) || [];
    const einsaetzeDoc = await getDocData("einsaetze/"+SAISON);
    const einsaetzeData = (einsaetzeDoc && einsaetzeDoc.data) || {};
    const players = await getCollection("players");
    const abos = await getCollection("pushAbos");

    const histDoc = await getDocData("config/pushVersand");
    const historie = (histDoc && histDoc.gesendet) || {};

    const aboMap = {};
    for(const a of abos){
      if(a.aktiv===false) continue;
      const geraete = a.geraete || {};
      const liste = Object.values(geraete).filter(g=>g&&g.endpoint&&g.p256dh&&g.auth);
      if(liste.length) aboMap[a.playerId||a.id] = liste;
    }

    const zuSenden = [];

    // 1) Spiele
    for(const s of spiele){
      if(!s.datum) continue;
      const nachwuchs = istNachwuchsMannschaft(s.mannschaft, regeln.nachwuchsMannschaften);
      const regel = nachwuchs ? regeln.spiele.nachwuchs : regeln.spiele.erwachsene;
      if(!regel || !regel.aktiv) continue;
      const diff = tageBis(s.datum, heute);
      if(!(regel.tage||[]).includes(diff)) continue;

      const sk = spielKeyOf(s);
      const ids = spielEmpfaenger(regel.empfaenger, s.mannschaft, sk, aufSpieler, einsaetzeData, players);
      if(!ids.length) continue;

      const wann = diff===0 ? "heute" : `in ${diff} Tag${diff===1?"":"en"}`;
      const gegen = s.gegner ? ` gegen ${s.gegner}` : "";
      const ort = /heim/i.test(s.ort||"") ? " (Heim)" : (/ausw/i.test(s.ort||"") ? " (Auswärts)" : "");
      zuSenden.push({
        sendeId: `spiel_${sk}_d${diff}`,
        empfaengerIds: ids,
        titel: `🏓 ${s.mannschaft} – Spiel ${wann}`,
        text: `${s.datum}${s.uhrzeit?` ${s.uhrzeit} Uhr`:""}${gegen}${ort}`,
        url: "/"
      });
    }

    // 2) Vereinstermine je Rubrik
    for(const t of vereinstermine){
      const datum = t.datumStart || t.datum;
      if(!datum) continue;
      const rubrik = t.rubrik || "Alle";
      const regel = (regeln.vereinstermine||{})[rubrik];
      if(!regel || !regel.aktiv) continue;
      const diff = tageBis(datum, heute);
      if(!(regel.tage||[]).includes(diff)) continue;

      const ids = terminEmpfaenger(regel.empfaenger, players);
      if(!ids.length) continue;

      const wann = diff===0 ? "heute" : `in ${diff} Tag${diff===1?"":"en"}`;
      const uhr = (t.uhrzeitStart||t.uhrzeit) ? ` ${t.uhrzeitStart||t.uhrzeit} Uhr` : "";
      const ort = t.ort ? ` · ${t.ort}` : "";
      zuSenden.push({
        sendeId: `termin_${datum}_${normName(t.veranstaltung||t.titel||rubrik)}_d${diff}`,
        empfaengerIds: ids,
        titel: `📌 ${t.veranstaltung||t.titel||"Vereinstermin"} ${wann}`,
        text: `${datum}${uhr}${ort}`,
        url: "/"
      });
    }

    // Versand ausführen
    let gesendet=0, uebersprungen=0, fehler=0;
    const neuHistorie = {};
    for(const job of zuSenden){
      if(historie[job.sendeId]===heute){ uebersprungen++; continue; }
      let irgendwasGesendet = false;
      for(const pid of job.empfaengerIds){
        const geraete = aboMap[pid];
        if(!geraete) continue;
        for(const g of geraete){
          if(dryRun){ irgendwasGesendet=true; continue; }
          try{
            const r = await sendePush(
              { endpoint:g.endpoint, p256dh:g.p256dh, auth:g.auth },
              { titel:job.titel, text:job.text, url:job.url, tag:job.sendeId },
              vapid
            );
            if(r.ok){ gesendet++; irgendwasGesendet=true; }
            else fehler++;
          }catch(e){ fehler++; }
        }
      }
      if(irgendwasGesendet) neuHistorie[job.sendeId]=heute;
    }

    if(!dryRun && Object.keys(neuHistorie).length){
      const zusammen = { ...historie, ...neuHistorie };
      await patchDoc("config/pushVersand", { gesendet: zusammen, lastRun: Date.now() });
    }

    // Gesendete Nachrichten zusätzlich für die Anzeige in der App ablegen.
    // Jede Person sieht beim Öffnen der App die neuen, sie betreffenden Meldungen.
    // Gespeichert wird je Nachricht ein Dokument mit Empfänger-IDs und Zeitpunkt.
    if(!dryRun){
      for(const job of zuSenden){
        if(!neuHistorie[job.sendeId]) continue; // nur tatsächlich Verschicktes
        try{
          await patchDoc("appNachrichten/"+job.sendeId, {
            titel: job.titel, text: job.text,
            empfaenger: job.empfaengerIds,
            erstellt: heute, ts: Date.now()
          });
        }catch(e){ /* Anzeige ist Zusatz – Fehler hier nicht kritisch */ }
      }
    }

    const bericht = {
      datum: heute, dryRun,
      jobs: zuSenden.length,
      gesendet, uebersprungen, fehler,
      details: zuSenden.map(j=>({ sendeId:j.sendeId, empfaenger:j.empfaengerIds.length, titel:j.titel }))
    };
    return { statusCode:200, headers:{"Content-Type":"application/json"}, body: JSON.stringify(bericht,null,2) };

  }catch(e){
    return { statusCode:500, body:"Fehler: "+(e&&e.message||e) };
  }
};
