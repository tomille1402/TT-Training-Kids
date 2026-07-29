// === TTC-App · Version 272 · netlify/functions/calendar.js · erstellt 29.07.2026 ===
// Netlify Function: /.netlify/functions/calendar.ics
// Liefert einen personalisierten iCalendar-Feed zum Abonnieren.
// Query-Parameter:
//   teams   = kommagetrennte Mannschaftsnamen (z.B. "Herren 1,Herren 3"); leer = alle
//   vorlauf = Erinnerung in Minuten vor dem Spiel (Default 60)
//   dauer   = Dauer pro Spiel in Minuten (Default 180)
//   termine = "1" → Vereinstermine mit einbeziehen
//
// Datenquelle: Firestore REST API (öffentlich lesbar für die betreffenden config-Dokumente).
// WICHTIG: Damit der Feed ohne Login funktioniert, müssen die Firestore-Rules für die
// gelesenen Dokumente (config/spielplan_* und config/vereinstermine) öffentliches Lesen
// erlauben ODER es wird ein API-Key/Token genutzt. Siehe KALENDER_SETUP.md.

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "DEIN_PROJECT_ID";
const API_KEY    = process.env.FIREBASE_API_KEY || ""; // optional

function icsEscape(s){return String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");}
// Muss identisch zur App sein, damit der spielKey exakt übereinstimmt.
function normName(s){return (s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,]/g,"");}
function icsDateTime(isoDate,uhrzeit){const p=(isoDate||"").split("-");const t=((uhrzeit||"00:00").split(":"));if(p.length<3)return null;return `${p[0]}${p[1]}${p[2]}T${(t[0]||"00").padStart(2,"0")}${(t[1]||"00").padStart(2,"0")}00`;}
function icsAddMinutes(isoDate,uhrzeit,minutes){const[y,m,d]=(isoDate||"").split("-").map(Number);const[hh,mi]=((uhrzeit||"00:00").split(":")).map(Number);const dt=new Date(y,(m||1)-1,d||1,hh||0,mi||0);dt.setMinutes(dt.getMinutes()+minutes);const p=n=>String(n).padStart(2,"0");return `${dt.getFullYear()}${p(dt.getMonth()+1)}${p(dt.getDate())}T${p(dt.getHours())}${p(dt.getMinutes())}00`;}
function icsUid(parts){return parts.map(x=>String(x||"").replace(/[^A-Za-z0-9]/g,"")).join("-")+"@ttc-niederzeuzheim";}

// Firestore REST: ein Dokument lesen und in JS-Objekt wandeln
async function getDocData(path){
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}${API_KEY?`?key=${API_KEY}`:""}`;
  const r=await fetch(url);
  if(!r.ok) return null;
  const j=await r.json();
  return j.fields ? convertFields(j.fields) : null;
}
function convertFields(fields){
  const out={};
  for(const k in fields) out[k]=convertValue(fields[k]);
  return out;
}
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

function buildICS(opts){
  const {teams=[],vorlaufMin=60,dauerMin=180,includeTermine=false,spiele=[],vereinstermine=[],
    puffer=false,heimVor=60,heimNach=30,auswVor=60,auswNach=30,einsaetzeData={},
    betreuerName=""}=opts;
  const SENTINEL_BETREUT="__betreut__";
  const echteTeams=teams.filter(t=>t!==SENTINEL_BETREUT);
  const betreutAktiv=teams.includes(SENTINEL_BETREUT);
  const teamSet=echteTeams.length>0?new Set(echteTeams):(betreutAktiv?new Set():null);
  const eigenBetreuer=normName(betreuerName||"");
  function istBetreutesSpiel(s){
    if(!betreutAktiv||!eigenBetreuer) return false;
    const sk=`${s.datum}_${s.mannschaft}_${normName(s.gegner)}`.replace(/[.#$/\[\]]/g,"_");
    const ei=einsaetzeData[sk]||{};
    return normName(ei.b1||"")===eigenBetreuer || normName(ei.b2||"")===eigenBetreuer;
  }
  const teamPasst=s=>(teamSet===null)?true:(teamSet.has(s.mannschaft)||istBetreutesSpiel(s));
  const L=[];
  L.push("BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//TTC Niederzeuzheim//Trainings-App//DE",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:TTC Niederzeuzheim – Spieltermine","X-WR-TIMEZONE:Europe/Berlin");
  const d=new Date();const p=n=>String(n).padStart(2,"0");
  const stamp=`${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  for(const s of spiele){
    if(!teamPasst(s)) continue;
    const spielStart=icsDateTime(s.datum,s.uhrzeit); if(!spielStart) continue;
    const heim=/heim/i.test(s.ort||""); const auswaerts=/ausw/i.test(s.ort||"");
    let vorMin=0,nachMin=0;
    if(puffer){ if(heim){vorMin=heimVor;nachMin=heimNach;} else if(auswaerts){vorMin=auswVor;nachMin=auswNach;} }
    const start=vorMin>0?icsAddMinutes(s.datum,s.uhrzeit,-vorMin):spielStart;
    const end=icsAddMinutes(s.datum,s.uhrzeit,dauerMin+nachMin);
    const titel=`🏓 ${s.mannschaft} vs. ${s.gegner||"?"}`;
    const ortText=s.ort&&!/heim|ausw/i.test(s.ort)?s.ort:(heim?"Heimspiel":"Auswärtsspiel");
    const descParts=[`Spielbeginn: ${s.uhrzeit} Uhr`];
    if(puffer&&heim&&(vorMin||nachMin)) descParts.push(`inkl. Aufbau ${vorMin} Min vorher, Abbau ${nachMin} Min nachher`);
    if(puffer&&auswaerts&&(vorMin||nachMin)) descParts.push(`inkl. Hinfahrt ${vorMin} Min, Rückfahrt ${nachMin} Min`);
    if(s.ergebnis) descParts.push(`Ergebnis: ${s.ergebnis}`);
    // Fahrer/Betreuer aus dem Spiegeldokument (Struktur {b1,b2,f}). spielKey identisch zur App.
    const sk=`${s.datum}_${s.mannschaft}_${normName(s.gegner)}`.replace(/[.#$/\[\]]/g,"_");
    const ei=einsaetzeData[sk]||{};
    // Betreuer/Fahrer als eigene Zeilen GANZ UNTEN anfügen, rollenabhängig:
    //  Auswärts: "Fahrer: …" dann "Betreuer: …"
    //  Heim:     "Betreuer 1: …" dann "Betreuer 2: …"
    const bfZeilen=[];
    if(heim){
      if(ei.b1) bfZeilen.push(`Betreuer 1: ${ei.b1}`);
      if(ei.b2) bfZeilen.push(`Betreuer 2: ${ei.b2}`);
    } else {
      if(ei.f)  bfZeilen.push(`Fahrer: ${ei.f}`);
      if(ei.b1) bfZeilen.push(`Betreuer: ${ei.b1}`);
    }
    let descText=descParts.join(" · ");
    if(bfZeilen.length>0) descText+="\n"+bfZeilen.join("\n");
    L.push("BEGIN:VEVENT",`UID:${icsUid([s.datum,s.uhrzeit,s.mannschaft,s.gegner])}`,`DTSTAMP:${stamp}`,
      `DTSTART:${start}`,`DTEND:${end}`,`SUMMARY:${icsEscape(titel)}`,`LOCATION:${icsEscape(ortText)}`,`CATEGORIES:${icsEscape(s.mannschaft)}`,
      `DESCRIPTION:${icsEscape(descText)}`);
    if(vorlaufMin>0) L.push("BEGIN:VALARM","ACTION:DISPLAY",`DESCRIPTION:${icsEscape(titel)}`,`TRIGGER:-PT${vorlaufMin}M`,"END:VALARM");
    L.push("END:VEVENT");
  }
  if(includeTermine){
    for(const t of vereinstermine){
      const start=icsDateTime(t.datumStart,t.uhrzeitStart||"00:00"); if(!start) continue;
      let end;
      if(t.datumEnde&&t.uhrzeitEnde) end=icsDateTime(t.datumEnde,t.uhrzeitEnde);
      else if(t.uhrzeitEnde) end=icsDateTime(t.datumStart,t.uhrzeitEnde);
      else end=icsAddMinutes(t.datumStart,t.uhrzeitStart||"00:00",dauerMin);
      const titel=`📌 ${t.veranstaltung||"Vereinstermin"}`;
      L.push("BEGIN:VEVENT",`UID:${icsUid([t.datumStart,t.uhrzeitStart,t.veranstaltung])}`,`DTSTAMP:${stamp}`,`DTSTART:${start}`);
      if(end) L.push(`DTEND:${end}`);
      L.push(`SUMMARY:${icsEscape(titel)}`);
      if(t.ort) L.push(`LOCATION:${icsEscape(t.ort)}`);
      L.push("CATEGORIES:Vereinstermin");
      if(vorlaufMin>0) L.push("BEGIN:VALARM","ACTION:DISPLAY",`DESCRIPTION:${icsEscape(titel)}`,`TRIGGER:-PT${vorlaufMin}M`,"END:VALARM");
      L.push("END:VEVENT");
    }
  }
  L.push("END:VCALENDAR");
  return L.map(foldIcsLine).join("\r\n");
}
// Faltet eine ICS-Zeile auf max. 75 Oktette (UTF-8); Folgezeilen mit führendem
// Leerzeichen (RFC 5545). Ohne Faltung ignorieren strikte Kalender lange Zeilen.
function foldIcsLine(line){
  const enc = s => Buffer.byteLength(s,"utf8");
  if(enc(line) <= 75) return line;
  let out="", cur="", curBytes=0;
  for(const ch of line){
    const b = enc(ch);
    const limit = out==="" ? 75 : 74;
    if(curBytes + b > limit){ out += (out==="" ? "" : "\r\n ") + cur; cur=ch; curBytes=b; }
    else { cur+=ch; curBytes+=b; }
  }
  out += (out==="" ? "" : "\r\n ") + cur;
  return out;
}

exports.handler = async (event) => {
  try {
    // Frühe, klare Diagnose: ohne Project-ID kann Firestore nicht gelesen werden.
    if(!PROJECT_ID || PROJECT_ID==="DEIN_PROJECT_ID"){
      const hinweis=[
        "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//TTC Niederzeuzheim//Trainings-App//DE",
        "CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:TTC Niederzeuzheim – Einrichtung nötig",
        "BEGIN:VEVENT","UID:setup-hinweis@ttc-niederzeuzheim","DTSTAMP:20260101T000000Z",
        "DTSTART:20260101T000000Z","DTEND:20260101T010000Z",
        "SUMMARY:Kalender-Feed: FIREBASE_PROJECT_ID in Netlify setzen",
        "DESCRIPTION:In Netlify unter Site settings > Environment variables die Variable FIREBASE_PROJECT_ID auf die Firebase-Project-ID setzen und neu deployen.",
        "END:VEVENT","END:VCALENDAR"
      ].join("\r\n");
      return {statusCode:200,headers:{"Content-Type":"text/calendar; charset=utf-8","Access-Control-Allow-Origin":"*"},body:hinweis};
    }
    const q=event.queryStringParameters||{};
    const teams=q.teams?q.teams.split(",").map(s=>s.trim()).filter(Boolean):[];
    const vorlaufMin=q.vorlauf!=null?parseInt(q.vorlauf):60;
    const dauerMin=q.dauer!=null?parseInt(q.dauer):180;
    const includeTermine=q.termine==="1";
    const puffer=q.puffer==="1";

    // Saison aus Parameter (Default aktuelle Saison)
    const saisonKey=q.saison||"spielplan_2026_2027";
    const spielplanDoc=await getDocData("config/"+saisonKey);
    let spiele=(spielplanDoc&&spielplanDoc.spiele)||[];
    // Fallback auf Vorsaison, falls leer
    if(spiele.length===0){
      const alt=await getDocData("config/spielplan_2025_2026");
      spiele=(alt&&alt.spiele)||[];
    }
    let vereinstermine=[];
    if(includeTermine){
      const vt=await getDocData("config/vereinstermine");
      vereinstermine=(vt&&vt.termine)||[];
      // nach Rubriken filtern, falls der Parameter gesetzt ist (leer = keine Termine)
      if(q.rubriken!=null){
        const rub=q.rubriken?q.rubriken.split(",").map(s=>s.trim()).filter(Boolean):[];
        vereinstermine=vereinstermine.filter(t=>rub.includes(t.rubrik||"Alle"));
      }
    }
    // Betreuer/Fahrer aus dem datensparsamen, öffentlich lesbaren Spiegeldokument
    // laden (nur Namen, keine Verfügbarkeiten). Doc: config/betreuerFahrer_{saison}.
    // Beim Abo wird der Feed bei jedem Abruf neu gebaut → Änderungen sind automatisch aktuell.
    let einsaetzeData={};
    const bfDoc=await getDocData("config/betreuerFahrer_"+saisonKey);
    if(bfDoc&&bfDoc.data) einsaetzeData=bfDoc.data;

    const ics=buildICS({teams,vorlaufMin,dauerMin,includeTermine,puffer,spiele,vereinstermine,einsaetzeData,
      betreuerName:q.betreuer||""});
    return {
      statusCode:200,
      headers:{
        "Content-Type":"text/calendar; charset=utf-8",
        "Content-Disposition":'inline; filename="ttc-termine.ics"',
        // Kurze Cache-Zeit statt komplettem no-store: Google Kalender ruft abonnierte
        // Feeds nach eigenem Rhythmus ab (typisch alle paar Stunden) und kommt mit einer
        // kurzen, positiven Cache-Angabe besser zurecht als mit "no-store" (das manche
        // Abo-Dienste vom Aktualisieren abhält). 1 Stunde ist frisch genug, da der Feed
        // ohnehin bei jedem echten Abruf neu aus Firestore gebaut wird.
        "Cache-Control":"public, max-age=3600",
        "Access-Control-Allow-Origin":"*",
      },
      body:ics,
    };
  } catch(e){
    return {statusCode:500,body:"Fehler: "+e.message};
  }
};
