// === TTC-App · Version 519 · netlify/functions/tabellen.js · erstellt 07.10.2026 (V519: Tabellenabruf für alle Vereine) ===
// Ruft für jede Mannschaft der aktuellen Saison die Tabelle bei myTischtennis ab und
// speichert Platz, Punkte und die komplette Tabelle in config/tabellen. Läuft täglich
// früh morgens (netlify.toml) und kann aus der App über „Tabellen jetzt aktualisieren“
// ausgelöst werden.
//
// Quelle: https://www.mytischtennis.de/click-tt/<Verband>/<Saisoncode>/ligen/<Liga>/gruppe/<Gruppe>/tabelle/gesamt
// (robots.txt von myTischtennis erlaubt den Abruf). Die eigene Zeile wird über die
// Mannschafts-ID im Link erkannt, ersatzweise über den Vereinsnamen.
//
// Wichtig: Schlägt der Abruf/das Auslesen einer Mannschaft fehl, bleibt deren letzter
// Stand erhalten; nur der Fehler wird vermerkt. Benötigte Umgebungsvariablen wie bei
// pushversand.js (FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT).

const pv = require("./pushversand.js");

const BASIS = "https://www.mytischtennis.de/click-tt";
const MIN_ABSTAND_MS = 5 * 60 * 1000;   // manueller Aufruf höchstens alle 5 Minuten

function cors(){
  return { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS", "Content-Type":"application/json; charset=utf-8" };
}

// ── HTML-Helfer (ohne Bibliothek) ──
function entities(t){
  return String(t||"")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}
function textVon(html){
  return entities(String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
}
// Zerlegt eine HTML-Tabelle in Zeilen mit Zellen-Text und den Links der Zeile.
function tabellenAus(html){
  const tabellen=[];
  const reT=/<table[\s\S]*?<\/table>/gi; let mt;
  while((mt=reT.exec(html))){
    const t=mt[0]; const zeilen=[];
    const reR=/<tr[\s\S]*?<\/tr>/gi; let mr;
    while((mr=reR.exec(t))){
      const tr=mr[0];
      const zellen=[]; const reC=/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi; let mc;
      while((mc=reC.exec(tr))) zellen.push({ kopf: mc[1].toLowerCase()==="th", text: textVon(mc[2]) });
      const links=[]; const reA=/href="([^"]+)"/gi; let ma;
      while((ma=reA.exec(tr))) links.push(entities(ma[1]));
      if(zellen.length) zeilen.push({ zellen, links });
    }
    tabellen.push(zeilen);
  }
  return tabellen;
}
// Wählt die Liga-Tabelle (V503). Auf der Seite stehen zwei Tabellen: die Ligatabelle
// (Rang, Mannschaft, Beg., S, U, N, Spiele, +/-, Punkte) und der Spielplan (Datum, Zeit,
// Halle, Heimmannschaft, Gastmannschaft …). Entscheidend sind die Überschriften:
// Spielplan-Tabellen werden ausgeschlossen. Ohne erkennbare Überschriften gilt als
// Ligatabelle die Tabelle, deren Zeilen genau EINE Mannschaft verlinken und mit dem Rang beginnen.
const norm = t => String(t||"").toLowerCase().replace(/\s+/g," ").trim();
function istSpielplanKopf(kopf){ return kopf.some(h=>/^(datum|zeit|heim|heimmannschaft|gast|gastmannschaft|halle)$/.test(norm(h))); }
function istLigaKopf(kopf){
  const k=kopf.map(norm);
  return k.some(h=>/^(rang|platz|pl\.?)$/.test(h)) && k.some(h=>/mannschaft/.test(h)) && k.some(h=>/^punkte$/.test(h));
}
function idsDerZeile(r){ return [...new Set(r.links.map(l=>(/\/mannschaft\/(\d+)/.exec(l)||[])[1]).filter(Boolean))]; }
function ligaTabelle(html){
  const kandidaten = tabellenAus(html).map(z=>{
    const kopfZeile = z.find(r=>r.zellen.length && r.zellen.every(c=>c.kopf)) || null;
    const kopf = kopfZeile ? kopfZeile.zellen.map(c=>c.text) : [];
    const daten = z.filter(r=>idsDerZeile(r).length>0 && r.zellen.length>=3);
    return { kopf, daten };
  }).filter(t=>t.daten.length>=2 && !istSpielplanKopf(t.kopf));
  let beste = kandidaten.find(t=>istLigaKopf(t.kopf));
  if(!beste){
    beste = kandidaten.find(t=>t.daten.every(r=>idsDerZeile(r).length===1 && /^\d{1,2}\.?$/.test((r.zellen[0]||{}).text||"")));
  }
  if(!beste) return null;
  const daten = beste.daten;
  let kopf = beste.kopf;
  // Zellen ohne Inhalt (Icons, Pfeile) in allen Zeilen weglassen, damit die Anzeige schlank bleibt.
  const breite=Math.max(...daten.map(r=>r.zellen.length));
  const leer=[...Array(breite).keys()].filter(i=>daten.every(r=>!(r.zellen[i]&&r.zellen[i].text)));
  const zeilen=daten.map(r=>({
    z: r.zellen.map(c=>c.text).filter((_,i)=>!leer.includes(i)),
    mannschaftId: idsDerZeile(r)[0] || "",
  }));
  if(kopf.length===breite) kopf=kopf.filter((_,i)=>!leer.includes(i));
  else kopf=[];
  return { kopf, zeilen };
}
// Platz und Punkte aus einer Zeile: Platz = erste Zahl, Punkte = letzte „x:y“-Angabe.
function rangUndPunkte(z){
  const rang = (/^\d{1,2}\.?$/.test(z[0]||"") ? z[0] : (z.find(t=>/^\d{1,2}\.?$/.test(t))||"")).replace(".","");
  const paare = z.filter(t=>/^\d+\s*:\s*\d+$/.test(t));
  const punkte = paare.length ? paare[paare.length-1].replace(/\s+/g,"") : "";
  return { rang, punkte };
}

async function abrufen(url){
  const r = await fetch(url, { headers:{
    "User-Agent":"Mozilla/5.0 (compatible; TTC-App-Tabellen/1.0; Vereins-App)",
    "Accept":"text/html,application/xhtml+xml", "Accept-Language":"de-DE,de;q=0.9" } });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

async function aktualisieren(){
  // Saison, Mannschaften und Vereinsdaten aus der Datenbank
  const saisonsDoc = await pv.getDocData("config/saisons");
  const liste = (saisonsDoc && Array.isArray(saisonsDoc.saisons)) ? saisonsDoc.saisons : [];
  const akt = liste.find(x=>x && x.current) || null;
  const club = await pv.getDocData("config/clubConfig") || {};
  const verein = club.verein || {};
  const verband = String(verein.verbandKuerzel||"HeTTV").trim() || "HeTTV";
  const suchname = String(verein.suchname||verein.kurzname||"").toLowerCase();   // V519: kein TTC-Rückfall mehr
  if(!akt || !Array.isArray(akt.teams) || !akt.code){
    return { ok:false, meldung:"Keine aktuelle Saison mit Mannschaften und Saison-Code in „Saisons & Mannschaften“ gespeichert." };
  }
  const bisher = (await pv.getDocData("config/tabellen")) || {};
  const alt = (bisher.saison===akt.key && bisher.teams) ? bisher.teams : {};
  const teams = {}; const bericht = [];
  const jetzt = Date.now();
  // V502: alle Mannschaften gleichzeitig abrufen (Netlify-Zeitlimit beim manuellen Aufruf: 10 s)
  async function eineMannschaft(t){
    if(!t || !t.id) return null;
    if(!t.ligaPath || !t.gruppe){
      return { id:t.id, daten: alt[t.id]||null, bericht:{ team:t.name, ok:false, info:"Liga im Link / Gruppen-ID fehlt" } };
    }
    const url = `${BASIS}/${verband}/${akt.code}/ligen/${t.ligaPath}/gruppe/${t.gruppe}/tabelle/gesamt`;
    try{
      const html = await abrufen(url);
      const tab = ligaTabelle(html);
      if(!tab) throw new Error("Tabelle im Seiteninhalt nicht gefunden");
      // Eigene Zeile: über die Mannschafts-ID, sonst über Vereinsname + römische Ziffer
      let idx = t.mannschaft ? tab.zeilen.findIndex(r=>r.mannschaftId===String(t.mannschaft)) : -1;
      if(idx<0){
        const nr = (/\b([IVX]{1,4})$/.exec(String(t.name||""))||[])[1] || "";
        const kandidaten = tab.zeilen.map((r,i)=>({i,txt:r.z.join(" ").toLowerCase()})).filter(x=>x.txt.includes(suchname));
        const passend = kandidaten.filter(x=> nr && nr!=="I" ? new RegExp(`\\b${nr.toLowerCase()}\\b`).test(x.txt)
                                                          : !/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/.test(x.txt));
        idx = (passend.length===1 ? passend[0].i : (kandidaten.length===1 ? kandidaten[0].i : -1));
      }
      const { rang, punkte } = idx>=0 ? rangUndPunkte(tab.zeilen[idx].z) : { rang:"", punkte:"" };
      return { id:t.id,
        daten:{ name:t.name, rang, punkte, kopf:tab.kopf, zeilen:tab.zeilen.map(r=>({z:r.z})),
          eigeneZeile: idx, stand: jetzt, quelle: url, fehler: idx<0 ? "Eigene Zeile nicht erkannt" : "" },
        bericht:{ team:t.name, ok: idx>=0, info: idx>=0 ? `Platz ${rang||"?"}, ${punkte||"?"} Punkte` : "Tabelle gelesen, eigene Zeile nicht erkannt" } };
    }catch(e){
      const fehler = String(e && e.message || e);
      return { id:t.id, daten: alt[t.id] ? { ...alt[t.id], fehler } : { name:t.name, fehler, stand:0, quelle:url },
        bericht:{ team:t.name, ok:false, info:fehler } };
    }
  }
  const ergebnisse = await Promise.all(akt.teams.map(eineMannschaft));
  for(const e of ergebnisse){ if(!e) continue; if(e.daten) teams[e.id]=e.daten; bericht.push(e.bericht); }
  await pv.patchDoc("config/tabellen", { saison: akt.key, stand: jetzt, teams, bericht });
  return { ok:true, saison: akt.key, bericht };
}

// Geplanter täglicher Lauf (netlify.toml). Geplante Funktionen lassen sich bei Netlify
// nicht direkt per URL aufrufen – der Knopf in der App nutzt deshalb tabellenjetzt.js.
module.exports.handler = async () => {
  try{
    // V519: nacheinander für alle Vereine
    const ergebnisse = {};
    for(const vid of await pv.alleVereinsIds()){
      pv.setzeVerein(vid);
      try{ ergebnisse[vid||"standard"] = await aktualisieren(); }
      catch(e){ ergebnisse[vid||"standard"] = { ok:false, meldung:String(e && e.message || e) }; }
    }
    pv.setzeVerein(null);
    const erg = { ok:true, vereine:ergebnisse };
    return { statusCode:200, headers:cors(), body:JSON.stringify(erg) };
  }catch(e){
    return { statusCode:500, headers:cors(), body:JSON.stringify({ ok:false, meldung:String(e && e.message || e) }) };
  }
};
module.exports.aktualisieren = aktualisieren;
module.exports.MIN_ABSTAND_MS = MIN_ABSTAND_MS;
module.exports.cors = cors;
// Für Tests
module.exports._intern = { ligaTabelle, rangUndPunkte, textVon };
