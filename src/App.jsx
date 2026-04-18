import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, collection,
  onSnapshot, deleteDoc, updateDoc, getDoc, getDocs
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

const app        = initializeApp(firebaseConfig);
const auth       = getAuth(app);
const db         = getFirestore(app);
const appHelper  = initializeApp(firebaseConfig, "helper");
const authHelper = getAuth(appHelper);

// ─── ADMIN EMAILS ────────────────────────────────────────────────────────────
const ADMIN_EMAILS = [
  "thomas@meilinger.net",
  "kira@meilinger.net",
  "joerg.bonkowski@web.de",
  "dominik.horz@gmx.de",
  "christina@rohschuermann.de",
  // weitere Trainer hier hinzufügen:
  // "trainer2@ttc-niederzeuzheim.de",
];
function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(a => a.toLowerCase().trim() === email.toLowerCase().trim());
}

// ─── TRAINING DATES 2026 ─────────────────────────────────────────────────────
// Hessische Schulferien 2026 — exakte Termine laut Kultusministerium
const FERIEN = [
  // Weihnachtsferien 2025/26: 22.12.2025–09.01.2026
  // → Nur der Teil in 2026 ist relevant: 01.01–09.01.2026
  ["2026-01-01","2026-01-09"],

  // Osterferien: 30.03.–10.04.2026
  ["2026-03-30","2026-04-10"],

  // Sommerferien: 29.06.–07.08.2026
  ["2026-06-29","2026-08-07"],

  // Herbstferien: 05.10.–17.10.2026
  ["2026-10-05","2026-10-17"],

  // Weihnachtsferien 2026/27: 23.12.2026–12.01.2027
  // → Nur der Teil in 2026: 23.12.–31.12.2026
  ["2026-12-23","2026-12-31"],
];

// Hessische Feiertage 2026 die auf Dienstag oder Freitag fallen
// + bewegliche Schulfreie Tage (Brückentage)
const FEIERTAGE = new Set([
  // Feiertage auf Di/Fr:
  "2026-05-01", // Tag der Arbeit (Fr)
  "2026-12-25", // 1. Weihnachtstag (Fr)

  // Bewegliche Ferientage Hessen 2026 (schulfreie Brückentage):
  "2026-05-15", // Fr nach Christi Himmelfahrt (Do 14.05.)
  "2026-06-05", // Fr nach Fronleichnam (Do 04.06.)
]);

function inFerien(dateStr) {
  const d = new Date(dateStr);
  for (const [start, end] of FERIEN) {
    if (d >= new Date(start) && d <= new Date(end)) return true;
  }
  return false;
}

function pad(n) { return String(n).padStart(2,"0"); }
function dateStr(y,m,d) { return `${y}-${pad(m)}-${pad(d)}`; }

function generateTrainingDays() {
  const tuesdays = [], fridays = [];
  for (let m = 1; m <= 12; m++) {
    const days = new Date(2026, m, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const ds = dateStr(2026, m, d);
      const dow = new Date(ds).getDay();
      if (inFerien(ds) || FEIERTAGE.has(ds)) continue;
      if (dow === 2) tuesdays.push(ds); // Tuesday
      if (dow === 5) fridays.push(ds);  // Friday
    }
  }
  return { tuesdays, fridays };
}

const { tuesdays: ALL_TUESDAYS, fridays: ALL_FRIDAYS } = generateTrainingDays();

function getTrainingDaysForGroup(group) {
  if (group === "Leistungsgruppe") return [...ALL_TUESDAYS, ...ALL_FRIDAYS].sort();
  return ALL_TUESDAYS;
}

function getTrainingTime(group, dateStr) {
  const dow = new Date(dateStr).getDay();
  if (group === "Anfänger") return "17:00–18:00";
  if (group === "Fortgeschrittene") return "17:00–18:30";
  if (group === "Leistungsgruppe") return dow === 5 ? "16:00–18:00" : "17:00–19:00";
  return "";
}

// Find nearest training day to today
function getNearestTrainingDay(days) {
  if (!days.length) return "";
  const today = new Date();
  today.setHours(0,0,0,0);
  let best = days[0];
  let bestDiff = Infinity;
  for (const d of days) {
    const diff = Math.abs(new Date(d) - today);
    if (diff < bestDiff) { bestDiff = diff; best = d; }
  }
  return best;
}

function formatDateDE(ds) {
  const [y,m,d] = ds.split("-");
  return `${d}.${m}.${y}`;
}
function formatDayDE(ds) {
  return ["So","Mo","Di","Mi","Do","Fr","Sa"][new Date(ds).getDay()];
}

// ─── AWARDS ──────────────────────────────────────────────────────────────────
const EXERCISES_BEGINNER = [
  {id:1,name:"Seilspringen",description:"Anzahl Sprünge in 1 Minute",thresholds:["25 Sprünge","50 Sprünge","75 Sprünge","100 Sprünge","125 Sprünge"]},
  {id:2,name:"Wandsitzen",description:"Oberschenkel & Unterschenkel im rechten Winkel",thresholds:["1 Minute","2 Minuten","3 Minuten","4 Minuten","5 Minuten"]},
  {id:3,name:"Vorhand tippen",description:"Ball ohne Fehler auf Vorhand tippen",thresholds:["10×","25×","50×","100×","150×"]},
  {id:4,name:"Rückhand tippen",description:"Ball ohne Fehler auf Rückhand tippen",thresholds:["10×","25×","50×","100×","150×"]},
  {id:5,name:"Vorhand/Rückhand abwechselnd tippen",description:"Abwechselnd Vorhand & Rückhand tippen",thresholds:["5×","15×","25×","50×","100×"]},
  {id:6,name:"Vorhand balancieren",description:"Ball auf Vorhand balancieren (Strecke)",thresholds:["10 m","25 m","50 m","100 m","200 m"]},
  {id:7,name:"Rückhand balancieren",description:"Ball auf Rückhand balancieren (Strecke)",thresholds:["10 m","25 m","50 m","100 m","200 m"]},
  {id:8,name:"Vorhand prellen",description:"Ball mit Vorhand auf Boden prellen",thresholds:["10×","25×","50×","100×","150×"]},
  {id:9,name:"Rückhand prellen",description:"Ball mit Rückhand auf Boden prellen",thresholds:["10×","25×","50×","100×","150×"]},
  {id:10,name:"Vorhand/Rückhand abwechselnd prellen",description:"Abwechselnd VH & RH auf Boden prellen",thresholds:["10×","25×","50×","75×","100×"]},
];
const EXERCISES_ADVANCED = [
  {id:11,name:"Roll-Aufschlag Vorhand diagonal",description:"Von 20 Aufschlägen im Ziel (diagonal)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:12,name:"Roll-Aufschlag Vorhand parallel",description:"Von 20 Aufschlägen im Ziel (parallel)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:13,name:"Roll-Aufschlag Rückhand diagonal",description:"Von 20 Aufschlägen im Ziel (diagonal)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:14,name:"Roll-Aufschlag Rückhand parallel",description:"Von 20 Aufschlägen im Ziel (parallel)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:15,name:"Roll-Aufschlag VH diagonal/parallel im Wechsel",description:"VH diagonal/parallel im Wechsel",thresholds:["5×","10×","15×","18×","20×"]},
  {id:16,name:"Roll-Aufschlag RH diagonal/parallel im Wechsel",description:"RH diagonal/parallel im Wechsel",thresholds:["5×","10×","15×","18×","20×"]},
  {id:17,name:"Roll-Aufschlag VH diagonal auf 6 Becher",description:"6 Becher mit VH diagonal räumen",thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:18,name:"Roll-Aufschlag VH parallel auf 6 Becher",description:"6 Becher mit VH parallel räumen",thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:19,name:"Roll-Aufschlag RH diagonal auf 6 Becher",description:"6 Becher mit RH diagonal räumen",thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:20,name:"Roll-Aufschlag RH parallel auf 6 Becher",description:"6 Becher mit RH parallel räumen",thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:21,name:"Unterschnitt-Aufschlag Vorhand diagonal",description:"US-Aufschlag VH diagonal (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:22,name:"Unterschnitt-Aufschlag Vorhand parallel",description:"US-Aufschlag VH parallel (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:23,name:"Unterschnitt-Aufschlag Rückhand diagonal",description:"US-Aufschlag RH diagonal (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:24,name:"Unterschnitt-Aufschlag Rückhand parallel",description:"US-Aufschlag RH parallel (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:25,name:"Unterschnitt-AS Vorhand diagonal / Ball zurück",description:"Ball rollt nach US-AS zurück (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:26,name:"Unterschnitt-AS Vorhand parallel / Ball zurück",description:"Ball rollt nach US-AS zurück (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:27,name:"Unterschnitt-AS Rückhand diagonal / Ball zurück",description:"Ball rollt nach US-AS zurück (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:28,name:"Unterschnitt-AS Rückhand parallel / Ball zurück",description:"Ball rollt nach US-AS zurück (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:29,name:"Vorhand Schupf diagonal",description:"Schupf-Schläge korrekt (beide Spieler)",thresholds:["10×","25×","50×","100×","200×"]},
  {id:30,name:"Rückhand Schupf diagonal",description:"Schupf-Schläge korrekt (beide Spieler)",thresholds:["10×","25×","50×","100×","200×"]},
  {id:31,name:"Vorhand Kontern diagonal",description:"Konterschläge korrekt (beide Spieler)",thresholds:["10×","25×","50×","100×","200×"]},
  {id:32,name:"Rückhand Kontern diagonal",description:"Konterschläge korrekt (beide Spieler)",thresholds:["10×","25×","50×","100×","200×"]},
  {id:33,name:"Vorhand auf Rückhand Kontern parallel",description:"VH auf RH Kontern parallel",thresholds:["10×","25×","50×","100×","200×"]},
  {id:34,name:"Rückhand auf Vorhand Kontern parallel",description:"RH auf VH Kontern parallel",thresholds:["10×","25×","50×","100×","200×"]},
  {id:35,name:"Vorhand-Topspin diagonal auf Balleimer (Unterschnitt)",description:"VH-Topspin diagonal auf US (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:36,name:"Vorhand-Topspin parallel auf Balleimer (Unterschnitt)",description:"VH-Topspin parallel auf US (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:37,name:"Vorhand-Topspin diagonal/parallel Wechsel auf Balleimer",description:"VH-Topspin dia/para Wechsel (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:38,name:"Rückhand-Topspin diagonal auf Balleimer (Unterschnitt)",description:"RH-Topspin diagonal auf US (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:39,name:"Rückhand-Topspin parallel auf Balleimer (Unterschnitt)",description:"RH-Topspin parallel auf US (20)",thresholds:["5×","10×","15×","18×","20×"]},
  {id:40,name:"Rückhand-Topspin diagonal/parallel Wechsel auf Balleimer",description:"RH-Topspin dia/para Wechsel (20)",thresholds:["5×","10×","15×","18×","20×"]},
];
const ALL_EXERCISES = [...EXERCISES_BEGINNER, ...EXERCISES_ADVANCED];

const BEGINNER_AWARDS = [
  {stars:10,label:"Bronze Anfänger",emoji:"🥉",color:"#cd7f32",note:""},
  {stars:25,label:"Silber Anfänger",emoji:"🥈",color:"#b8b8b8",note:""},
  {stars:40,label:"Gold Anfänger",emoji:"🥇",color:"#ffd700",note:"→ Aufstieg!"},
  {stars:45,label:"Platin Anfänger",emoji:"💎",color:"#7dd3e8",note:""},
  {stars:50,label:"Diamant Anfänger",emoji:"💠",color:"#00bfff",note:""},
];
const ADVANCED_AWARDS = [
  {stars:75,label:"Bronze Fortgeschrittene",emoji:"🥉",color:"#cd7f32",note:""},
  {stars:100,label:"Silber Fortgeschrittene",emoji:"🥈",color:"#b8b8b8",note:""},
  {stars:125,label:"Gold Fortgeschrittene",emoji:"🥇",color:"#ffd700",note:""},
  {stars:150,label:"Platin Fortgeschrittene",emoji:"💎",color:"#7dd3e8",note:""},
  {stars:175,label:"Diamant Fortgeschrittene",emoji:"💠",color:"#00bfff",note:""},
];
const PLAYER_COLORS = ["#10b981","#3b82f6","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#a3e635","#e879f9"];
const AVATARS = [
  "🏓","🐯","🦁","🐻","🦊","🐼","🐸","🦋","🐬","🦄",
  "🐙","🦅","🦈","🐲","🌟","🔥","⚡","🎯","🚀","🏆",
  "💎","🎸","🤖","👾","🦸","🧙","🎃","🌈","🐺","🦝",
  "🐧","🦜","🦩","🐊","🐝","🦔","🐴","🦌","🐿","🦦",
  "🎽","⚽","🏀","🎾","🥊","🎮","🎲","🎪","🎭","🏅",
  // 20 weitere Tier-Avatare
  "🐘","🦒","🦓","🐆","🦁","🐃","🦬","🦏","🐪","🦘",
  "🦙","🐐","🐑","🐖","🐓","🦃","🦢","🦚","🦜","🐇",
];
const GROUPS = ["Leistungsgruppe","Fortgeschrittene","Anfänger","Trainer"];
const ABSENCE_REASONS = [
  "Halle zu",
  "Punktspiel",
  "Schlechtes Wetter",
  "Teilnahme < 50%",
  "Trainer verhindert",
  "Sonstiges",
];

function getAward(player) {
  const bs = EXERCISES_BEGINNER.reduce((s,ex)=>s+(player.stars?.[ex.id]||0),0);
  const as = EXERCISES_ADVANCED.reduce((s,ex)=>s+(player.stars?.[ex.id]||0),0);
  const ts = bs+as;
  const isAdv = bs>=40;
  let cur = null;
  if (isAdv) { for (const a of ADVANCED_AWARDS) if (as>=a.stars) cur=a; if (!cur) for (const a of BEGINNER_AWARDS) if (bs>=a.stars) cur=a; }
  else { for (const a of BEGINNER_AWARDS) if (bs>=a.stars) cur=a; }
  return {currentAward:cur,beginnerStars:bs,advancedStars:as,totalStars:ts,isAdvanced:isAdv};
}

// Punkt 11: Zeigt immer zuerst nächste Anfänger-Urkunde, dann nächste Fortgeschrittenen-Urkunde
function nextAwards(player) {
  const {beginnerStars:bs,advancedStars:as}=getAward(player);
  const results=[];
  // Nächste Anfänger-Urkunde (solange < 50 Punkte)
  if (bs<50) {
    for (const a of BEGINNER_AWARDS) {
      if (bs<a.stars) { results.push({...a,needed:a.stars-bs,type:"beginner"}); break; }
    }
  }
  // Nächste Fortgeschrittene-Urkunde
  for (const a of ADVANCED_AWARDS) {
    if (as<a.stars) { results.push({...a,needed:a.stars-as,type:"advanced"}); break; }
  }
  return results;
}
// Einzelnes nächstes Ziel (für Kompatibilität)
function nextAward(player) {
  const awards=nextAwards(player);
  return awards.length>0?awards[0]:null;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function StarRating({stars,onRate,readonly=false}) {
  const [hov,setHov]=useState(null);
  const disp=hov!==null?hov:stars;
  return <div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(v=>(
    <span key={v} onClick={()=>!readonly&&onRate&&onRate(v===stars?0:v)}
      onMouseEnter={()=>!readonly&&setHov(v)} onMouseLeave={()=>!readonly&&setHov(null)}
      style={{fontSize:readonly?17:22,cursor:readonly?"default":"pointer",color:v<=disp?"#f59e0b":"#374151",
        transition:"color .12s,transform .1s",transform:(!readonly&&hov===v)?"scale(1.3)":"scale(1)",
        userSelect:"none",display:"inline-block"}}>★</span>
  ))}</div>;
}
function AwardBadge({award,small}) {
  if (!award) return null;
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,background:award.color+"22",
    border:`1px solid ${award.color}88`,borderRadius:20,padding:small?"2px 8px":"4px 12px",
    fontSize:small?11:13,fontWeight:700,color:award.color,whiteSpace:"nowrap"}}>
    {award.emoji} {award.label}{award.note&&<span style={{fontSize:10,opacity:.8,marginLeft:2}}>{award.note}</span>}
  </span>;
}
function ProgressBar({value,max,color}) {
  return <div style={{background:"#1f2937",borderRadius:6,height:7,overflow:"hidden",width:"100%"}}>
    <div style={{width:`${Math.min(100,Math.round((value/max)*100))}%`,height:"100%",
      background:`linear-gradient(90deg,${color},${color}bb)`,borderRadius:6,transition:"width .5s"}}/>
  </div>;
}
function Avatar({avatar,color,size=40}) {
  return <div style={{width:size,height:size,borderRadius:"50%",flexShrink:0,background:`${color}22`,
    border:`2px solid ${color}66`,display:"flex",alignItems:"center",justifyContent:"center",
    fontSize:size*.5,userSelect:"none"}}>{avatar||"🏓"}</div>;
}
function Modal({children,onClose}) {
  return <div style={{position:"fixed",inset:0,background:"#000b",zIndex:500,display:"flex",
    alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
    <div style={{background:"#111827",border:"1px solid #374151",borderRadius:18,padding:22,
      maxWidth:400,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      {children}
    </div>
  </div>;
}
function AvatarPicker({current,onSelect,onClose}) {
  return <Modal onClose={onClose}>
    <div style={{fontSize:16,fontWeight:800,marginBottom:14,color:"#e5e7eb"}}>Avatar wählen</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
      {AVATARS.map(av=><button key={av} onClick={()=>onSelect(av)} style={{
        background:av===current?"#10b98133":"#1f2937",border:`2px solid ${av===current?"#10b981":"#374151"}`,
        borderRadius:10,padding:"7px 3px",fontSize:24,cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center"}}>{av}</button>)}
    </div>
    <button onClick={onClose} style={{width:"100%",padding:10,background:"#1f2937",border:"1px solid #374151",
      borderRadius:9,color:"#9ca3af",fontSize:14,fontWeight:600,cursor:"pointer"}}>Schließen</button>
  </Modal>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({onLogin,error,loading,successMessage}) {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [resetMode,setResetMode]=useState(false);
  const [resetEmail,setResetEmail]=useState("");
  const [resetSent,setResetSent]=useState(false);
  const [resetErr,setResetErr]=useState("");
  const [resetLoad,setResetLoad]=useState(false);

  async function doReset() {
    if (!resetEmail.trim()) {setResetErr("Bitte E-Mail eingeben.");return;}
    setResetLoad(true);setResetErr("");
    try { await sendPasswordResetEmail(auth,resetEmail.trim()); setResetSent(true); }
    catch(e) { setResetErr(e.code==="auth/user-not-found"?"Kein Konto gefunden.":"Fehler: "+e.message); }
    setResetLoad(false);
  }

  return <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{maxWidth:360,width:"100%"}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:56,marginBottom:12}}>🏓</div>
        <div style={{fontSize:22,fontWeight:800,color:"#e5e7eb"}}>TTC Niederzeuzheim</div>
        <div style={{fontSize:13,color:"#6b7280",marginTop:4}}>Nachwuchs Trainingsheft</div>
      </div>
      {!resetMode ? (
        <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
          <div style={{fontSize:15,fontWeight:700,color:"#e5e7eb",marginBottom:18}}>Anmelden</div>
          {successMessage&&<div style={{background:"#10b98122",border:"1px solid #10b98166",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#10b981",marginBottom:14}}>✅ {successMessage}</div>}
          {error&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:14}}>{error}</div>}
          {[{l:"E-Mail",v:email,s:setEmail,t:"email",p:"deine@email.de"},{l:"Passwort",v:pass,s:setPass,t:"password",p:"••••••••"}].map(f=>(
            <div key={f.l} style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>{f.l}</label>
              <input type={f.t} value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p}
                onKeyDown={e=>e.key==="Enter"&&onLogin(email,pass)}
                style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:15,outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}
          <button onClick={()=>onLogin(email,pass)} disabled={loading||!email||!pass} style={{
            width:"100%",padding:12,background:(!email||!pass||loading)?"#1f2937":"linear-gradient(135deg,#10b981,#059669)",
            border:"none",borderRadius:9,color:(!email||!pass||loading)?"#6b7280":"#fff",
            fontSize:15,fontWeight:700,cursor:(!email||!pass||loading)?"not-allowed":"pointer"}}>{loading?"Anmelden…":"Anmelden"}</button>
          <button onClick={()=>{setResetMode(true);setResetEmail(email);}} style={{width:"100%",marginTop:12,padding:8,background:"transparent",border:"none",color:"#6b7280",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>🔑 Passwort vergessen?</button>
        </div>
      ) : (
        <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
          {!resetSent ? <>
            <div style={{fontSize:15,fontWeight:700,color:"#e5e7eb",marginBottom:8}}>🔑 Passwort zurücksetzen</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:16,lineHeight:1.5}}>Gib deine E-Mail ein. Du bekommst einen Reset-Link.</div>
            {resetErr&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{resetErr}</div>}
            <input type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="deine@email.de"
              style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
            <button onClick={doReset} disabled={resetLoad||!resetEmail.trim()} style={{width:"100%",padding:12,background:(resetLoad||!resetEmail.trim())?"#1f2937":"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",borderRadius:9,color:(resetLoad||!resetEmail.trim())?"#6b7280":"#fff",fontSize:15,fontWeight:700,cursor:(resetLoad||!resetEmail.trim())?"not-allowed":"pointer",marginBottom:10}}>{resetLoad?"Wird gesendet…":"Reset-E-Mail senden"}</button>
            <button onClick={()=>{setResetMode(false);setResetErr("");}} style={{width:"100%",padding:10,background:"transparent",border:"1px solid #374151",borderRadius:9,color:"#6b7280",fontSize:13,cursor:"pointer"}}>← Zurück</button>
          </> : (
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:48,marginBottom:14}}>📬</div>
              <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:8}}>E-Mail gesendet!</div>
              <div style={{fontSize:13,color:"#9ca3af",marginBottom:20,lineHeight:1.6}}>Bitte prüfe dein Postfach und klicke auf den Link.</div>
              <button onClick={()=>{setResetMode(false);setResetSent(false);}} style={{width:"100%",padding:12,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>← Zur Anmeldung</button>
            </div>
          )}
        </div>
      )}
      <div style={{textAlign:"center",fontSize:12,color:"#4b5563",marginTop:16}}>Noch kein Konto? Wende dich an deinen Trainer.</div>
    </div>
  </div>;
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────
function AdminPanel({user,players,attendance,rackets,onSignOut,onPlayerAdded}) {
  const TABS=[
    {key:"uebungen",  label:"Übungen",    icon:"🏋️"},
    {key:"training",  label:"Training",   icon:"📅"},
    {key:"teilnahme", label:"Teilnahme",  icon:"📊"},
    {key:"rangliste", label:"Rangliste",  icon:"🏆"},
    {key:"schlaeger", label:"Schläger",   icon:"🏏"},
    {key:"geburtstage",label:"Geburtstage",icon:"🎂"},
    {key:"verwaltung",label:"Verwaltung", icon:"⚙️"},
  ];
  const [activeTab,setActiveTab]=useState("uebungen");
  const [selectedPlayer,setSelectedPlayer]=useState(null);
  const [exerciseFilter,setExerciseFilter]=useState("all");
  const [expandedEx,setExpandedEx]=useState(null);
  const [toast,setToast]=useState(null);
  const [saving,setSaving]=useState(false);
  const [groupFilters,setGroupFilters]=useState({Leistungsgruppe:true,Fortgeschrittene:true,Anfänger:true});
  // Punkt 7: Teilnahme-Drilldown
  const [teilnahmePlayer,setTeilnahmePlayer]=useState(null);
  // Punkt 6: Geburtstags-Popup
  const [birthdayPopupDismissed,setBirthdayPopupDismissed]=useState(false);

  function toggleGroupFilter(g){setGroupFilters(f=>({...f,[g]:!f[g]}));}
  function showToast(msg,emoji="✅"){setToast({msg,emoji});setTimeout(()=>setToast(null),2200);}

  const activePlayers = players.filter(p=>p.status!=="passiv");
  const visiblePlayers = activePlayers
    .filter(p=>p.group!=="Trainer" && groupFilters[p.group||"Anfänger"])
    .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"","de"));
  const curPlayer = visiblePlayers.find(p=>p.id===selectedPlayer)||visiblePlayers[0];
  const filteredEx = exerciseFilter==="beginner"?EXERCISES_BEGINNER:exerciseFilter==="advanced"?EXERCISES_ADVANCED:ALL_EXERCISES;
  const sortedRanking = [...visiblePlayers].sort((a,b)=>getAward(b).totalStars-getAward(a).totalStars);

  async function setStars(playerId,exId,value) {
    setSaving(true);
    try { await updateDoc(doc(db,"players",String(playerId)),{[`stars.${exId}`]:value}); showToast("Gespeichert","💾"); }
    catch(e){showToast("Fehler","❌");}
    setSaving(false);
  }

  // Punkt 6: Geburtstage seit letztem Training ermitteln
  const today = new Date(); today.setHours(0,0,0,0);
  const allTrainingDays = [...new Set([...ALL_TUESDAYS,...ALL_FRIDAYS])].sort();
  const lastTraining = [...allTrainingDays].reverse().find(d=>new Date(d)<=today) || null;
  const birthdaySince = lastTraining ? new Date(lastTraining) : today;

  function getBirthdaysSince(since) {
    const result = [];
    const allPeople = players.filter(p=>p.birthdate);
    for (const p of allPeople) {
      const bd = new Date(p.birthdate);
      // Geburtstag dieses Jahr
      const thisYear = new Date(2026, bd.getMonth(), bd.getDate());
      thisYear.setHours(0,0,0,0);
      if (thisYear >= since && thisYear <= today) {
        const age = 2026 - bd.getFullYear();
        result.push({...p, age, bday: thisYear});
      }
    }
    return result;
  }
  const recentBirthdays = getBirthdaysSince(birthdaySince);
  const showBirthdayPopup = recentBirthdays.length > 0 && !birthdayPopupDismissed;

  return <div style={{minHeight:"100vh",background:"#0d1117",color:"#e5e7eb",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:720,margin:"0 auto",paddingBottom:80}}>
    {toast&&<div style={{position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",background:"#1f2937",border:"1px solid #374151",borderRadius:12,padding:"10px 20px",display:"flex",alignItems:"center",gap:8,fontSize:15,fontWeight:600,zIndex:400,boxShadow:"0 8px 32px #0008",animation:"fadeIn .2s ease"}}><span style={{fontSize:20}}>{toast.emoji}</span>{toast.msg}</div>}

    {/* Punkt 6: Geburtstags-Popup */}
    {showBirthdayPopup&&<Modal onClose={()=>setBirthdayPopupDismissed(true)}>
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:40,marginBottom:8}}>🎂</div>
        <div style={{fontSize:17,fontWeight:800,color:"#e5e7eb",marginBottom:4}}>Geburtstage seit letztem Training</div>
        <div style={{fontSize:12,color:"#6b7280"}}>seit {lastTraining?formatDateDE(lastTraining):"heute"}</div>
      </div>
      {recentBirthdays.map(p=>(
        <div key={p.id} style={{background:"#1f2937",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24}}>{p.avatar||"🎂"}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:"#e5e7eb"}}>{p.firstName} {p.lastName}</div>
            <div style={{fontSize:12,color:"#f59e0b"}}>🎂 {formatDateDE(p.birthdate)} — {p.age} Jahre</div>
          </div>
        </div>
      ))}
      <button onClick={()=>setBirthdayPopupDismissed(true)} style={{width:"100%",marginTop:8,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Schließen</button>
    </Modal>}

    {/* Punkt 7: Teilnahme-Drilldown Modal */}
    {teilnahmePlayer&&<Modal onClose={()=>setTeilnahmePlayer(null)}>
      <div style={{fontSize:15,fontWeight:800,color:"#e5e7eb",marginBottom:14}}>
        📅 {teilnahmePlayer.firstName} {teilnahmePlayer.lastName}
      </div>
      <PlayerTrainingDetail player={teilnahmePlayer} attendance={attendance} showToast={showToast}/>
      <button onClick={()=>setTeilnahmePlayer(null)} style={{width:"100%",marginTop:12,padding:10,background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Schließen</button>
    </Modal>}

    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",borderBottom:"1px solid #1f2937",padding:"14px 14px 10px",position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:38,height:38,background:"linear-gradient(135deg,#10b981,#3b82f6)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏓</div>
          <div>
            <div style={{fontSize:15,fontWeight:800}}>TTC Niederzeuzheim</div>
            <div style={{fontSize:11,color:"#10b981",fontWeight:600}}>🛡️ Trainer-Bereich</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {recentBirthdays.length>0&&<button onClick={()=>setBirthdayPopupDismissed(false)} style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:8,color:"#f59e0b",fontSize:12,padding:"4px 8px",cursor:"pointer"}}>🎂 {recentBirthdays.length}</button>}
          {saving&&<span style={{fontSize:11,color:"#f59e0b"}}>💾</span>}
          <button onClick={onSignOut} style={{padding:"5px 10px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer"}}>Abmelden</button>
        </div>
      </div>
      {/* Gruppenfilter-Buttons */}
      <div style={{display:"flex",gap:5,marginBottom:8}}>
        {["Leistungsgruppe","Fortgeschrittene","Anfänger"].map(g=>{
          const colors={Leistungsgruppe:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981"};
          const c=colors[g]; const on=groupFilters[g];
          return <button key={g} onClick={()=>toggleGroupFilter(g)} style={{
            padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
            border:`2px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:c+"66",transition:"all .15s",
          }}>{g}</button>;
        })}
      </div>
      {/* Spieler-Chips */}
      <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
        {visiblePlayers.map(p=>(
          <button key={p.id} onClick={()=>{setSelectedPlayer(p.id);setActiveTab("uebungen");}} style={{
            flexShrink:0,padding:"3px 9px 3px 5px",borderRadius:20,
            border:`2px solid ${curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"#374151"}`,
            background:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color+"22":"transparent",
            color:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"#9ca3af",
            fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:14}}>{p.avatar||"🏓"}</span>{p.firstName||p.name}
          </button>
        ))}
      </div>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",borderBottom:"1px solid #1f2937",background:"#0d1117",position:"sticky",top:118,zIndex:99,overflowX:"auto"}}>
      {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{
        flexShrink:0,flex:1,padding:"10px 4px",background:"transparent",border:"none",
        borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,
        color:activeTab===t.key?"#10b981":"#6b7280",fontSize:11,fontWeight:600,cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>{t.icon} {t.label}</button>)}
    </div>

    {/* ── ÜBUNGEN TAB ── */}
    {activeTab==="uebungen"&&curPlayer&&(()=>{
      const {currentAward,beginnerStars,advancedStars,totalStars}=getAward(curPlayer);
      const nexts=nextAwards(curPlayer);
      return <div style={{padding:"13px 13px 0"}}>
        <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",border:`1px solid ${curPlayer.color}44`,borderRadius:14,padding:14,marginBottom:13}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
            <Avatar avatar={curPlayer.avatar} color={curPlayer.color} size={50}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div>
                  <div style={{fontSize:17,fontWeight:800,color:curPlayer.color}}>{curPlayer.firstName} {curPlayer.lastName}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{curPlayer.group||"Anfänger"} · {totalStars} Sterne</div>
                </div>
                {currentAward?<AwardBadge award={currentAward} small/>:<span style={{fontSize:11,color:"#6b7280"}}>Noch keine Urkunde</span>}
              </div>
            </div>
          </div>
          <div style={{marginBottom:7}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Anfänger (1–10)</span><span>{beginnerStars}/50 ★</span></div>
            <ProgressBar value={beginnerStars} max={50} color={curPlayer.color}/>
          </div>
          <div style={{marginBottom:nexts.length?10:0}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Fortgeschrittene (11–40)</span><span>{advancedStars}/150 ★</span></div>
            <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
          </div>
          {/* Punkt 11: Alle nächsten Ziele anzeigen */}
          {nexts.length>0&&<div style={{background:"#0d1117",borderRadius:8,padding:"8px 10px",display:"flex",flexDirection:"column",gap:5}}>
            {nexts.map((a,i)=>(
              <div key={i} style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"#4b5563"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
                <AwardBadge award={a} small/>
                <span>— noch <b style={{color:"#e5e7eb"}}>{a.needed} Sterne</b></span>
              </div>
            ))}
          </div>}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {[{key:"all",label:"Alle"},{key:"beginner",label:"Anfänger"},{key:"advanced",label:"Fortgeschrittene"}].map(f=>(
            <button key={f.key} onClick={()=>setExerciseFilter(f.key)} style={{padding:"4px 11px",borderRadius:20,border:`1px solid ${exerciseFilter===f.key?"#10b981":"#374151"}`,background:exerciseFilter===f.key?"#10b98122":"transparent",color:exerciseFilter===f.key?"#10b981":"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{f.label}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7,paddingBottom:20}}>
          {filteredEx.map(ex=>{
            const stars=curPlayer.stars?.[ex.id]||0;
            const isExp=expandedEx===ex.id;
            const isBeg=ex.id<=10;
            return <div key={ex.id} style={{background:"#111827",border:`1px solid ${stars>0?"#2d3748":"#1f2937"}`,borderRadius:11,overflow:"hidden"}}>
              <div onClick={()=>setExpandedEx(isExp?null:ex.id)} style={{padding:"11px 13px",display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
                <div style={{width:28,height:28,borderRadius:7,flexShrink:0,marginTop:2,background:isBeg?"#10b98122":"#3b82f622",border:`1px solid ${isBeg?"#10b98144":"#3b82f644"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:isBeg?"#10b981":"#3b82f6"}}>{ex.id}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#e5e7eb",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div>
                  <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{ex.description}</div>
                </div>
                <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                  <StarRating stars={stars} readonly/>
                  <span style={{color:"#6b7280",fontSize:12}}>{isExp?"▲":"▼"}</span>
                </div>
              </div>
              {isExp&&<div style={{borderTop:"1px solid #1f2937",padding:13,background:"#0d1117"}}>
                <div style={{marginBottom:11,fontSize:12,color:"#9ca3af"}}>⚙️ Sterne vergeben:</div>
                <div style={{marginBottom:13}}><StarRating stars={stars} onRate={v=>setStars(curPlayer.id,ex.id,v)}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {ex.thresholds.map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,background:stars>=i+1?"#f59e0b11":"#1f2937",border:`1px solid ${stars>=i+1?"#f59e0b44":"#374151"}`}}>
                      <span style={{color:stars>=i+1?"#f59e0b":"#6b7280",fontSize:13}}>{"★".repeat(i+1)}{"☆".repeat(4-i)}</span>
                      <span style={{fontSize:13,color:stars>=i+1?"#e5e7eb":"#9ca3af",flex:1}}>{t}</span>
                      {stars>=i+1&&<span style={{color:"#10b981"}}>✓</span>}
                    </div>
                  ))}
                </div>
              </div>}
            </div>;
          })}
        </div>
      </div>;
    })()}

    {/* ── TRAINING TAB ── */}
    {activeTab==="training"&&<AdminTrainingTab players={activePlayers} groupFilters={groupFilters} attendance={attendance} showToast={showToast}/>}

    {/* ── TEILNAHME TAB (Punkt 7: klickbar) ── */}
    {activeTab==="teilnahme"&&<TeilnahmeTab players={visiblePlayers} attendance={attendance} onPlayerClick={p=>setTeilnahmePlayer(p)}/>}

    {/* ── RANGLISTE TAB ── */}
    {activeTab==="rangliste"&&<div style={{padding:13}}>
      <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>🏆 Rangliste</div>
      {sortedRanking.map((player,idx)=>{
        const {currentAward,beginnerStars,advancedStars,totalStars}=getAward(player);
        const nexts=nextAwards(player);
        const rankEmoji=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
        return <div key={player.id} style={{background:"#111827",border:`1px solid ${idx===0?"#f59e0b55":"#1f2937"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
          {idx===0&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#f59e0b,#fbbf24)"}}/>}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <span style={{fontSize:18,minWidth:28}}>{rankEmoji}</span>
            <Avatar avatar={player.avatar} color={player.color} size={38}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                <span style={{fontSize:14,fontWeight:800,color:"#e5e7eb"}}>{player.firstName} {player.lastName}</span>
                {currentAward&&<AwardBadge award={currentAward} small/>}
              </div>
              <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{player.group||"Anfänger"}</div>
            </div>
            <div style={{textAlign:"center",background:"linear-gradient(135deg,#1f2937,#111827)",border:`2px solid ${player.color}66`,borderRadius:12,padding:"8px 14px",minWidth:60}}>
              <div style={{fontSize:26,fontWeight:900,color:player.color,lineHeight:1}}>{totalStars}</div>
              <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>★ Sterne</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:nexts.length?9:0}}>
            <div style={{background:"#0d1117",borderRadius:8,padding:"7px 9px"}}>
              <div style={{fontSize:10,color:"#6b7280",marginBottom:3}}>Anfänger (1–10)</div>
              <div style={{display:"flex",alignItems:"baseline",gap:3}}><span style={{fontSize:17,fontWeight:800,color:player.color}}>{beginnerStars}</span><span style={{fontSize:10,color:"#6b7280"}}>/ 50 ★</span></div>
              <ProgressBar value={beginnerStars} max={50} color={player.color}/>
            </div>
            <div style={{background:"#0d1117",borderRadius:8,padding:"7px 9px"}}>
              <div style={{fontSize:10,color:"#6b7280",marginBottom:3}}>Fortgeschr. (11–40)</div>
              <div style={{display:"flex",alignItems:"baseline",gap:3}}><span style={{fontSize:17,fontWeight:800,color:"#3b82f6"}}>{advancedStars}</span><span style={{fontSize:10,color:"#6b7280"}}>/ 150 ★</span></div>
              <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
            </div>
          </div>
          {nexts.length>0&&<div style={{background:"#0d1117",borderRadius:8,padding:"7px 10px",display:"flex",flexDirection:"column",gap:4}}>
            {nexts.map((a,i)=>(
              <div key={i} style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"#4b5563"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
                <AwardBadge award={a} small/>
                <span>noch {a.needed} ★</span>
              </div>
            ))}
          </div>}
        </div>;
      })}
    </div>}

    {/* ── SCHLÄGER TAB ── */}
    {activeTab==="schlaeger"&&<SchlaegerTab rackets={rackets} players={activePlayers} showToast={showToast}/>}

    {/* ── GEBURTSTAGE TAB ── */}
    {activeTab==="geburtstage"&&<GeburtstageTab players={players} showToast={showToast}/>}

    {/* ── VERWALTUNG TAB ── */}
    {activeTab==="verwaltung"&&<VerwaltungTab players={players} rackets={rackets} onPlayerAdded={onPlayerAdded} showToast={showToast}/>}

    <style>{`@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}*{box-sizing:border-box}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#0d1117}::-webkit-scrollbar-thumb{background:#374151;border-radius:4px}input::placeholder{color:#4b5563}select{background:#0d1117;color:#e5e7eb;border:1px solid #374151;border-radius:9px;padding:10px 13px;font-size:14px;width:100%;outline:none}`}</style>
  </div>;
}

// ─── ADMIN TRAINING TAB ───────────────────────────────────────────────────────
function AdminTrainingTab({players,groupFilters,attendance,showToast}) {
  const allDays = [...new Set([...ALL_TUESDAYS,...ALL_FRIDAYS])].sort();
  const nearest = getNearestTrainingDay(allDays);
  const [selDate,setSelDate]=useState(nearest);
  const [sessionData,setSessionData]=useState(null);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    if (!selDate) return;
    const existing = attendance[selDate];
    if (existing) {
      setSessionData(existing);
    } else {
      const defaults = {};
      players.forEach(p=>{ defaults[p.id]="a"; });
      setSessionData({took_place:true,reason:"",attendances:defaults});
    }
  },[selDate,attendance,players]);

  async function save() {
    setLoading(true);
    try {
      await setDoc(doc(db,"attendance",selDate),{...sessionData,date:selDate,updatedAt:Date.now()});
      showToast("Gespeichert","💾");
    } catch(e){showToast("Fehler: "+e.message,"❌");}
    setLoading(false);
  }

  function setAll(val) {
    setSessionData(prev=>({...prev,attendances:{...Object.fromEntries(players.map(p=>[p.id,val]))}}));
  }

  const isFriday = selDate ? new Date(selDate).getDay()===5 : false;
  // Punkt 8: Nur Spieler anzeigen deren trainingStart <= selDate
  const relevantPlayers = players.filter(p=>{
    if (p.group==="Trainer") return true;
    if (isFriday && p.group!=="Leistungsgruppe") return false;
    if (groupFilters && !groupFilters[p.group||"Anfänger"]) return false;
    // Punkt 8: trainingStart-Filter
    if (p.trainingStart && selDate && p.trainingStart > selDate) return false;
    return true;
  });
  const groupOrder = ["Leistungsgruppe","Fortgeschrittene","Anfänger","Trainer"];

  // Punkt 9: Spaltenköpfe mit Kreisen
  const COL_HEADERS = [
    {key:"a", label:"✓", color:"#10b981", title:"Anwesend"},
    {key:"e", label:"E", color:"#f59e0b", title:"Entschuldigt"},
    {key:"u", label:"U", color:"#ef4444", title:"Unentschuldigt"},
  ];

  return <div style={{padding:13}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>📅 Training erfassen</div>

    {/* Date selector */}
    <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,padding:14,marginBottom:14}}>
      <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:6}}>Trainingstag auswählen</label>
      <select value={selDate} onChange={e=>setSelDate(e.target.value)}>
        {allDays.map(d=>{
          const dow=new Date(d).getDay();
          const label=`${formatDayDE(d)}, ${formatDateDE(d)}${dow===5?" (Fr – nur Leistungsgruppe)":""}`;
          return <option key={d} value={d}>{label}</option>;
        })}
      </select>
    </div>

    {sessionData&&<>
      {/* Training stattgefunden? */}
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,padding:14,marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:"#e5e7eb",marginBottom:12}}>Training stattgefunden?</div>
        <div style={{display:"flex",gap:8,marginBottom:sessionData.took_place?0:12}}>
          {[{v:true,l:"✅ Ja"},{v:false,l:"❌ Nein"}].map(opt=>(
            <button key={String(opt.v)} onClick={()=>setSessionData(p=>({...p,took_place:opt.v}))} style={{
              flex:1,padding:"9px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",
              border:`2px solid ${sessionData.took_place===opt.v?"#10b981":"#374151"}`,
              background:sessionData.took_place===opt.v?"#10b98122":"#1f2937",
              color:sessionData.took_place===opt.v?"#10b981":"#6b7280"}}>{opt.l}</button>
          ))}
        </div>
        {/* Punkt 5: Alphabetisch sortierte Dropdown-Liste */}
        {!sessionData.took_place&&<div style={{marginTop:12}}>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:6}}>Grund</label>
          <select value={sessionData.reason||""} onChange={e=>setSessionData(p=>({...p,reason:e.target.value}))}>
            <option value="">Bitte wählen…</option>
            {ABSENCE_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
        </div>}
      </div>

      {/* Anwesenheit */}
      {sessionData.took_place&&<div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,padding:14,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"#e5e7eb"}}>Anwesenheit</div>
          <button onClick={()=>setAll("a")} style={{padding:"4px 10px",borderRadius:7,background:"#10b98122",border:"1px solid #10b98144",color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer"}}>Alle ✓ anwesend</button>
        </div>

        {/* Punkt 9: Spaltenköpfe als Kreise */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 52px 52px 52px",gap:6,marginBottom:8,padding:"0 4px"}}>
          <div style={{fontSize:11,color:"#6b7280",fontWeight:700}}>Name</div>
          {COL_HEADERS.map(h=>(
            <div key={h.key} style={{display:"flex",justifyContent:"center"}}>
              <div style={{
                width:36,height:36,borderRadius:"50%",
                background:h.color+"22",border:`2px solid ${h.color}88`,
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:14,fontWeight:800,color:h.color,
              }} title={h.title}>{h.label}</div>
            </div>
          ))}
        </div>

        {groupOrder.map(group=>{
          const groupPlayers = relevantPlayers.filter(p=>(p.group||"Anfänger")===group)
            .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"","de"));
          if (!groupPlayers.length) return null;
          return <div key={group} style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,paddingLeft:4}}>{group}</div>
            {groupPlayers.map(p=>{
              const val=sessionData.attendances?.[p.id]||"a";
              return <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr 52px 52px 52px",gap:6,marginBottom:6,alignItems:"center",background:"#0d1117",borderRadius:8,padding:"8px 10px"}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:16}}>{p.avatar||"🏓"}</span>
                  <span style={{fontSize:13,fontWeight:600,color:"#e5e7eb"}}>{p.firstName} {p.lastName}</span>
                </div>
                {COL_HEADERS.map(opt=>(
                  <div key={opt.key} style={{display:"flex",justifyContent:"center"}}>
                    <button onClick={()=>setSessionData(prev=>({...prev,attendances:{...prev.attendances,[p.id]:opt.key}}))} style={{
                      width:36,height:36,borderRadius:"50%",border:`2px solid ${val===opt.key?opt.color:opt.color+"33"}`,cursor:"pointer",
                      fontSize:15,fontWeight:800,
                      background:val===opt.key?opt.color+"33":"transparent",
                      color:val===opt.key?opt.color:"#4b5563",
                      boxShadow:val===opt.key?`0 0 8px ${opt.color}44`:"none",
                      transition:"all .15s",
                    }}>{opt.label}</button>
                  </div>
                ))}
              </div>;
            })}
          </div>;
        })}
      </div>}

      <button onClick={save} disabled={loading} style={{width:"100%",padding:12,background:loading?"#1f2937":"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:loading?"#6b7280":"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
        {loading?"Wird gespeichert…":"💾 Speichern"}
      </button>
    </>}
  </div>;
}

// ─── TEILNAHME TAB ────────────────────────────────────────────────────────────
function TeilnahmeTab({players,attendance,onPlayerClick}) {
  const nonTrainers = players.filter(p=>p.group!=="Trainer");

  // Punkt 4: Trainingszeitraum aus Firestore lesen
  const [trainingRange,setTrainingRange]=useState({start:"",end:""});
  useEffect(()=>{
    const unsub=onSnapshot(doc(db,"config","trainingRange"),snap=>{
      if (snap.exists()) setTrainingRange(snap.data());
    });
    return unsub;
  },[]);

  function getStats(player) {
    const group = player.group||"Anfänger";
    const days = getTrainingDaysForGroup(group);
    const today = new Date(); today.setHours(0,0,0,0);

    // Individuellen Zeitraum berücksichtigen, fallback auf globalen
    const pStart = player.trainingStart || trainingRange.start || null;
    const pEnd   = player.trainingEnd   || trainingRange.end   || null;
    const rangeStart = pStart ? new Date(pStart) : null;
    const rangeEnd   = pEnd   ? new Date(pEnd)   : null;

    // Nur vergangene Tage im erlaubten Zeitraum
    const pastDays = days.filter(d=>{
      const dt = new Date(d);
      if (dt > today) return false;
      if (rangeStart && dt < rangeStart) return false;
      if (rangeEnd   && dt > rangeEnd)   return false;
      return true;
    });

    if (!pastDays.length) return {pct:0,present:0,total:0,excused:0,unexcused:0};

    let present=0, excused=0, unexcused=0, total=0;

    for (const d of pastDays) {
      const session = attendance[d];

      // Kein Training an diesem Tag → überspringen
      if (session && session.took_place === false) continue;

      // Training hat stattgefunden (oder keine Session → Training angenommen)
      // Nur zählen wenn eine Session existiert (Trainer hat erfasst)
      if (!session) continue;

      total++;

      // Anwesenheit des Spielers auslesen
      const att = session.attendances;
      if (!att) {
        // Session existiert aber keine attendances → als anwesend werten
        present++;
        continue;
      }

      const val = att[player.id];
      if (val === undefined || val === null) {
        // Spieler nicht in dieser Session → als anwesend werten
        // (z.B. wenn Spieler später angelegt wurde oder "Alle anwesend" implizit)
        present++;
      } else if (val === "a") {
        present++;
      } else if (val === "e") {
        excused++;
      } else {
        unexcused++;
      }
    }

    const pct = total > 0 ? Math.round((present / total) * 100) : 0;
    return {pct, present, total, excused, unexcused};
  }

  const ranked = [...nonTrainers].map(p=>({...p,...getStats(p)})).sort((a,b)=>b.pct-a.pct);

  return <div style={{padding:13}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📊 Trainingsbeteiligung 2026</div>
    {trainingRange.start&&trainingRange.end&&(
      <div style={{fontSize:11,color:"#6b7280",marginBottom:14}}>
        Zeitraum: {formatDateDE(trainingRange.start)} – {formatDateDE(trainingRange.end)}
      </div>
    )}
    {ranked.map((player,idx)=>{
      const medal = player.pct>90?"🥇":player.pct>80?"🥈":player.pct>70?"🥉":null;
      return <div key={player.id} style={{background:"#111827",border:`1px solid ${idx===0?"#f59e0b44":"#1f2937"}`,borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
        <Avatar avatar={player.avatar} color={player.color} size={36}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
            <span
              onClick={()=>onPlayerClick&&onPlayerClick(player)}
              style={{fontSize:14,fontWeight:800,color:"#10b981",cursor:"pointer",textDecoration:"underline dotted"}}
            >{player.firstName} {player.lastName}</span>
            {medal&&<span style={{fontSize:18}}>{medal}</span>}
            <span style={{fontSize:11,color:"#6b7280"}}>{player.group||"Anfänger"}</span>
          </div>
          <div style={{background:"#1f2937",borderRadius:6,height:8,overflow:"hidden",marginBottom:4}}>
            <div style={{width:`${player.pct}%`,height:"100%",background:player.pct>90?"#ffd700":player.pct>80?"#b8b8b8":player.pct>70?"#cd7f32":"#10b981",borderRadius:6,transition:"width .5s"}}/>
          </div>
          <div style={{display:"flex",gap:12,fontSize:10,color:"#6b7280"}}>
            <span>✓ {player.present} anwesend</span>
            <span>{player.excused} entsch.</span>
            <span>{player.unexcused} unentsch.</span>
            <span>Gesamt: {player.total}</span>
          </div>
        </div>
        <div style={{flexShrink:0,textAlign:"center",background:"#0d1117",borderRadius:10,padding:"6px 10px",border:`1px solid ${player.color}44`,minWidth:52}}>
          <div style={{fontSize:20,fontWeight:900,color:player.pct>90?"#ffd700":player.pct>80?"#b8b8b8":player.pct>70?"#cd7f32":"#10b981",lineHeight:1}}>{player.pct}%</div>
          <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>Beteiligung</div>
        </div>
      </div>;
    })}
  </div>;
}

// ─── VERWALTUNG TAB ───────────────────────────────────────────────────────────
function VerwaltungTab({players,rackets,onPlayerAdded,showToast}) {
  const [editPlayer,setEditPlayer]=useState(null);
  const [showAdd,setShowAdd]=useState(false);
  const [avatarPickerFor,setAvatarPickerFor]=useState(null);
  const [deleteConfirmFor,setDeleteConfirmFor]=useState(null);
  const [saving,setSaving]=useState(false);
  const [loginUpgradeFor,setLoginUpgradeFor]=useState(null);
  const [upgradeEmail,setUpgradeEmail]=useState("");
  const [upgradePass,setUpgradePass]=useState("");
  const [upgradeErr,setUpgradeErr]=useState("");
  const [upgrading,setUpgrading]=useState(false);
  // Punkt 4: Trainingszeitraum
  const [trainingRange,setTrainingRange]=useState({start:"",end:""});
  const [rangeSaving,setRangeSaving]=useState(false);

  useEffect(()=>{
    const unsub=onSnapshot(doc(db,"config","trainingRange"),snap=>{
      if (snap.exists()) setTrainingRange(snap.data());
    });
    return unsub;
  },[]);

  async function saveTrainingRange() {
    setRangeSaving(true);
    try {
      await setDoc(doc(db,"config","trainingRange"),trainingRange);
      showToast("Zeitraum gespeichert","📅");
    } catch(e){showToast("Fehler","❌");}
    setRangeSaving(false);
  }

  const newData0={firstName:"",lastName:"",gender:"m",email:"",avatar:"🏓",group:"Anfänger",status:"aktiv",noLogin:false,pass:""};
  const [newData,setNewData]=useState(newData0);
  const groupOrder=["Leistungsgruppe","Fortgeschrittene","Anfänger","Trainer"];

  async function saveEdit() {
    if (!editPlayer) return;
    setSaving(true);
    try {
      await updateDoc(doc(db,"players",editPlayer.id),{
        firstName:     editPlayer.firstName||"",
        lastName:      editPlayer.lastName||"",
        gender:        editPlayer.gender||"m",
        email:         editPlayer.email||"",
        avatar:        editPlayer.avatar||"🏓",
        group:         editPlayer.group||"Anfänger",
        status:        editPlayer.status||"aktiv",
        birthdate:     editPlayer.birthdate||"",
        trainingStart: editPlayer.trainingStart||"",
        trainingEnd:   editPlayer.trainingEnd||"",
        trainingsheft: editPlayer.trainingsheft||"ja",
        racketType:    editPlayer.racketType||"",
        racketNr:      editPlayer.racketNr||"",
        racketStart:   editPlayer.racketStart||"",
        racketEnd:     editPlayer.racketEnd||"",
      });
      // Schläger-Status synchronisieren
      if (editPlayer.racketType==="TTC" && editPlayer.racketNr) {
        const rRef = doc(db,"rackets",String(editPlayer.racketNr));
        if (editPlayer.racketEnd) {
          await updateDoc(rRef,{status:"frei",vergebenAn:""}).catch(()=>{});
        } else if (editPlayer.racketStart) {
          await updateDoc(rRef,{
            status:"vergeben",
            vergebenAn:`${editPlayer.firstName} ${editPlayer.lastName}`,
          }).catch(()=>{});
        }
      }
      showToast("Gespeichert","💾"); setEditPlayer(null);
    } catch(e){showToast("Fehler: "+e.message,"❌");}
    setSaving(false);
  }

  // Login-Upgrade: Spieler ohne Login bekommt einen echten Account
  async function doUpgradeLogin() {
    if (!loginUpgradeFor||!upgradeEmail.trim()||!upgradePass.trim()) return;
    if (upgradePass.length<6){setUpgradeErr("Passwort mind. 6 Zeichen.");return;}
    setUpgrading(true); setUpgradeErr("");
    try {
      const {user:newUser} = await createUserWithEmailAndPassword(authHelper, upgradeEmail.trim(), upgradePass.trim());
      await signOut(authHelper);
      const oldId = loginUpgradeFor.id;
      const newId = newUser.uid;

      // 1) Neues Spieler-Dokument anlegen (alle Daten inkl. Sterne übernehmen)
      await setDoc(doc(db,"players", newId), {
        ...loginUpgradeFor,
        id: newId,
        email: upgradeEmail.trim(),
        noLogin: false,
        updatedAt: Date.now(),
      });

      // 2) Altes Spieler-Dokument löschen
      await deleteDoc(doc(db,"players", oldId));

      // 3) Punkt 3: Anwesenheiten migrieren
      const attSnap = await getDocs(collection(db,"attendance"));
      for (const attDoc of attSnap.docs) {
        const data = attDoc.data();
        if (data.attendances && data.attendances[oldId] !== undefined) {
          const newAttendances = {...data.attendances};
          newAttendances[newId] = newAttendances[oldId];
          delete newAttendances[oldId];
          await updateDoc(doc(db,"attendance",attDoc.id), {attendances: newAttendances});
        }
      }

      showToast(`${loginUpgradeFor.firstName} hat jetzt einen Login — Anwesenheiten migriert!`,"🎉");
      setLoginUpgradeFor(null); setUpgradeEmail(""); setUpgradePass("");
    } catch(e) {
      if (e.code==="auth/email-already-in-use") setUpgradeErr("Diese E-Mail wird bereits verwendet.");
      else if (e.code==="auth/weak-password")    setUpgradeErr("Passwort zu schwach.");
      else setUpgradeErr("Fehler: "+e.message);
    }
    setUpgrading(false);
  }

  async function doDelete(id) {
    try { await deleteDoc(doc(db,"players",id)); showToast("Gelöscht","🗑️"); }
    catch(e){showToast("Fehler","❌");}
    setDeleteConfirmFor(null);
  }

  async function addPlayer() {
    if (!newData.firstName.trim()) return;
    setSaving(true);
    try {
      let finalEmail = newData.email.trim();
      let uid;
      if (newData.noLogin||!finalEmail) {
        const safeName=(newData.firstName.trim()+"."+newData.lastName.trim()).toLowerCase().replace(/[^a-z0-9.]/g,"");
        const rand=Math.random().toString(36).slice(2,8);
        finalEmail=`${safeName||"spieler"}.${rand}@ttc-intern.de`;
        const dummyPass="Tt"+Math.random().toString(36).slice(2,12)+"1!";
        const {user:nu}=await createUserWithEmailAndPassword(authHelper,finalEmail,dummyPass);
        await signOut(authHelper); uid=nu.uid;
      } else {
        if (!newData.pass||newData.pass.length<6){showToast("Passwort mind. 6 Zeichen","❌");setSaving(false);return;}
        const {user:nu}=await createUserWithEmailAndPassword(authHelper,finalEmail,newData.pass);
        await signOut(authHelper); uid=nu.uid;
      }
      const color=PLAYER_COLORS[players.length%PLAYER_COLORS.length];
      await setDoc(doc(db,"players",uid),{
        id:uid,firstName:newData.firstName.trim(),lastName:newData.lastName.trim(),
        name:newData.firstName.trim()+" "+newData.lastName.trim(),
        gender:newData.gender,email:finalEmail,noLogin:newData.noLogin||!newData.email.trim(),
        avatar:newData.avatar,group:newData.group,status:newData.status,
        color,stars:{},createdAt:Date.now(),
      });
      if (onPlayerAdded) onPlayerAdded(newData.firstName.trim());
      setNewData({firstName:"",lastName:"",gender:"m",email:"",avatar:"🏓",group:"Anfänger",status:"aktiv",noLogin:false,pass:""});
      setShowAdd(false);
      showToast(`${newData.firstName} hinzugefügt!`,"🎉");
    } catch(e){
      if (e.code==="auth/email-already-in-use") showToast("E-Mail bereits verwendet","❌");
      else showToast("Fehler: "+e.message,"❌");
    }
    setSaving(false);
  }

  return <div style={{padding:13,paddingBottom:40}}>
    {avatarPickerFor&&<AvatarPicker current={editPlayer?.avatar||newData.avatar} onSelect={av=>{
      if (avatarPickerFor==="new") setNewData(p=>({...p,avatar:av}));
      else setEditPlayer(p=>({...p,avatar:av}));
      setAvatarPickerFor(null);
    }} onClose={()=>setAvatarPickerFor(null)}/>}

    {deleteConfirmFor&&<Modal onClose={()=>setDeleteConfirmFor(null)}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>🗑️</div>
        <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:8}}>Wirklich löschen?</div>
        <div style={{fontSize:13,color:"#9ca3af",marginBottom:20}}><b style={{color:"#e5e7eb"}}>{deleteConfirmFor.firstName} {deleteConfirmFor.lastName}</b> und alle Daten werden dauerhaft gelöscht.</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setDeleteConfirmFor(null)} style={{flex:1,padding:10,background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:14,fontWeight:600,cursor:"pointer"}}>Abbrechen</button>
          <button onClick={()=>doDelete(deleteConfirmFor.id)} style={{flex:1,padding:10,background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Löschen</button>
        </div>
      </div>
    </Modal>}

    {/* Login-Upgrade Modal */}
    {loginUpgradeFor&&<Modal onClose={()=>{setLoginUpgradeFor(null);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}}>
      <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:6}}>📧 Login einrichten</div>
      <div style={{fontSize:13,color:"#6b7280",marginBottom:16,lineHeight:1.5}}>
        Für <b style={{color:"#e5e7eb"}}>{loginUpgradeFor.firstName} {loginUpgradeFor.lastName}</b> wird ein Login-Account erstellt. Alle bisherigen Ergebnisse bleiben erhalten.
      </div>
      {upgradeErr&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{upgradeErr}</div>}
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>E-Mail</label>
        <input type="email" value={upgradeEmail} onChange={e=>setUpgradeEmail(e.target.value)}
          placeholder="spieler@email.de"
          style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Passwort (mind. 6 Zeichen)</label>
        <input type="password" value={upgradePass} onChange={e=>setUpgradePass(e.target.value)}
          placeholder="••••••••"
          style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={doUpgradeLogin} disabled={upgrading||!upgradeEmail.trim()||!upgradePass.trim()} style={{
          flex:1,padding:11,
          background:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"#1f2937":"linear-gradient(135deg,#10b981,#059669)",
          border:"none",borderRadius:9,
          color:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"#6b7280":"#fff",
          fontSize:14,fontWeight:700,cursor:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"not-allowed":"pointer",
        }}>{upgrading?"Wird eingerichtet…":"📧 Login erstellen"}</button>
        <button onClick={()=>{setLoginUpgradeFor(null);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}} style={{
          flex:1,padding:11,background:"#1f2937",border:"1px solid #374151",
          borderRadius:9,color:"#9ca3af",fontSize:13,fontWeight:600,cursor:"pointer",
        }}>Abbrechen</button>
      </div>
    </Modal>}

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
      <div style={{fontSize:17,fontWeight:800}}>⚙️ Spieler- & Trainerverwaltung</div>
      <button onClick={()=>setShowAdd(!showAdd)} style={{padding:"7px 14px",background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
        {showAdd?"✕ Abbrechen":"+ Neu anlegen"}
      </button>
    </div>

    {/* Punkt 4: Trainingszeitraum */}
    <div style={{background:"#111827",border:"1px solid #374151",borderRadius:14,padding:14,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"#e5e7eb",marginBottom:12}}>📅 Trainingszeitraum</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Start Training</label>
          <input type="date" value={trainingRange.start||""} min="2026-01-01" max="2026-12-31"
            onChange={e=>setTrainingRange(p=>({...p,start:e.target.value}))}
            style={{width:"100%",padding:"9px 11px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Ende Training</label>
          <input type="date" value={trainingRange.end||""} min="2026-01-01" max="2026-12-31"
            onChange={e=>setTrainingRange(p=>({...p,end:e.target.value}))}
            style={{width:"100%",padding:"9px 11px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
      </div>
      <div style={{fontSize:11,color:"#6b7280",marginBottom:10,lineHeight:1.5}}>
        Die Teilnahme-Auswertung bezieht sich nur auf Trainingstage innerhalb dieses Zeitraums. Beide Daten sind inklusiv.
      </div>
      <button onClick={saveTrainingRange} disabled={rangeSaving} style={{width:"100%",padding:9,background:rangeSaving?"#1f2937":"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",borderRadius:9,color:rangeSaving?"#6b7280":"#fff",fontSize:13,fontWeight:700,cursor:rangeSaving?"not-allowed":"pointer"}}>
        {rangeSaving?"Wird gespeichert…":"💾 Zeitraum speichern"}
      </button>
    </div>

    {/* Add form */}
    {showAdd&&<div style={{background:"#111827",border:"1px solid #10b98144",borderRadius:14,padding:16,marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700,color:"#10b981",marginBottom:14}}>Neue Person anlegen</div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:"#10b98122",border:"2px solid #10b98166",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{newData.avatar}</div>
        <button onClick={()=>setAvatarPickerFor("new")} style={{padding:"7px 12px",background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:12,fontWeight:600,cursor:"pointer"}}>Avatar ✏️</button>
      </div>
      {[
        {l:"Vorname *",k:"firstName",t:"text",p:"Max"},
        {l:"Nachname",k:"lastName",t:"text",p:"Mustermann"},
      ].map(f=><div key={f.k} style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>{f.l}</label>
        <input type={f.t} value={newData[f.k]} onChange={e=>setNewData(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p}
          style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>)}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Geschlecht</label>
          <select value={newData.gender} onChange={e=>setNewData(p=>({...p,gender:e.target.value}))}>
            <option value="m">Männlich</option><option value="w">Weiblich</option><option value="d">Divers</option>
          </select>
        </div>
        <div>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Gruppe</label>
          <select value={newData.group} onChange={e=>setNewData(p=>({...p,group:e.target.value}))}>
            {GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Status</label>
        <select value={newData.status} onChange={e=>setNewData(p=>({...p,status:e.target.value}))}>
          <option value="aktiv">Aktiv</option><option value="passiv">Passiv</option>
        </select>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:6}}>Login-Typ</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button onClick={()=>setNewData(p=>({...p,noLogin:false}))} style={{padding:"8px",borderRadius:9,fontSize:11,fontWeight:700,cursor:"pointer",border:`2px solid ${!newData.noLogin?"#10b981":"#374151"}`,background:!newData.noLogin?"#10b98122":"#1f2937",color:!newData.noLogin?"#10b981":"#6b7280"}}>📧 Mit Login</button>
          <button onClick={()=>setNewData(p=>({...p,noLogin:true}))} style={{padding:"8px",borderRadius:9,fontSize:11,fontWeight:700,cursor:"pointer",border:`2px solid ${newData.noLogin?"#f59e0b":"#374151"}`,background:newData.noLogin?"#f59e0b22":"#1f2937",color:newData.noLogin?"#f59e0b":"#6b7280"}}>👤 Ohne Login</button>
        </div>
      </div>
      {!newData.noLogin&&<>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>E-Mail</label>
          <input type="email" value={newData.email} onChange={e=>setNewData(p=>({...p,email:e.target.value}))} placeholder="spieler@email.de"
            style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Passwort (mind. 6 Zeichen)</label>
          <input type="password" value={newData.pass} onChange={e=>setNewData(p=>({...p,pass:e.target.value}))} placeholder="••••••••"
            style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
      </>}
      <button onClick={addPlayer} disabled={saving||!newData.firstName.trim()} style={{width:"100%",padding:11,background:(saving||!newData.firstName.trim())?"#1f2937":"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:(saving||!newData.firstName.trim())?"#6b7280":"#fff",fontSize:14,fontWeight:700,cursor:(saving||!newData.firstName.trim())?"not-allowed":"pointer"}}>
        {saving?"Wird erstellt…":"Person anlegen"}
      </button>
    </div>}

    {/* Players by group */}
    {groupOrder.map(group=>{
      const groupPlayers=[...players.filter(p=>(p.group||"Anfänger")===group)]
        .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||""));
      if (!groupPlayers.length) return null;
      return <div key={group} style={{marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8,paddingLeft:2}}>{group} ({groupPlayers.length})</div>
        {groupPlayers.map(p=>(
          editPlayer?.id===p.id ? (
            <div key={p.id} style={{background:"#111827",border:"1px solid #10b98144",borderRadius:12,padding:14,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setAvatarPickerFor("edit")}>
                  <Avatar avatar={editPlayer.avatar} color={p.color} size={44}/>
                  <span style={{position:"absolute",bottom:-2,right:-2,fontSize:12,background:"#1f2937",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #374151"}}>✏️</span>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:"#e5e7eb"}}>{editPlayer.firstName} {editPlayer.lastName} bearbeiten</div>
              </div>
              {[{l:"Vorname",k:"firstName"},{l:"Nachname",k:"lastName"},{l:"E-Mail",k:"email"}].map(f=>(
                <div key={f.k} style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>{f.l}</label>
                  <input type="text" value={editPlayer[f.k]||""} onChange={e=>setEditPlayer(prev=>({...prev,[f.k]:e.target.value}))}
                    style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Geschlecht</label>
                  <select value={editPlayer.gender||"m"} onChange={e=>setEditPlayer(prev=>({...prev,gender:e.target.value}))}>
                    <option value="m">Männlich</option><option value="w">Weiblich</option><option value="d">Divers</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Gruppe</label>
                  <select value={editPlayer.group||"Anfänger"} onChange={e=>setEditPlayer(prev=>({...prev,group:e.target.value}))}>
                    {GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Status</label>
                <select value={editPlayer.status||"aktiv"} onChange={e=>setEditPlayer(prev=>({...prev,status:e.target.value}))}>
                  <option value="aktiv">Aktiv</option><option value="passiv">Passiv</option>
                </select>
              </div>
              {/* Geburtsdatum */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Geburtstag</label>
                <input type="date" value={editPlayer.birthdate||""} onChange={e=>setEditPlayer(prev=>({...prev,birthdate:e.target.value}))}
                  style={{width:"100%",padding:"10px 12px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {/* Trainingsheft erhalten */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:4}}>Trainingsheft erhalten</label>
                <select value={editPlayer.trainingsheft||"ja"} onChange={e=>setEditPlayer(prev=>({...prev,trainingsheft:e.target.value}))}>
                  <option value="ja">Ja</option>
                  <option value="nein">Nein</option>
                </select>
              </div>
              {/* Schläger */}
              <div style={{background:"#0d1117",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"#9ca3af",marginBottom:8,fontWeight:600}}>🏏 Schläger</div>
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Typ</label>
                  <select value={editPlayer.racketType||""} onChange={e=>setEditPlayer(prev=>({...prev,racketType:e.target.value,racketNr:""}))}>
                    <option value="">— kein —</option>
                    <option value="eigener">Eigener</option>
                    <option value="TTC">TTC-Schläger</option>
                  </select>
                </div>
                {editPlayer.racketType==="TTC"&&<>
                  <div style={{marginBottom:8}}>
                    <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Schläger-Nr.</label>
                    <select value={editPlayer.racketNr||""} onChange={e=>setEditPlayer(prev=>({...prev,racketNr:e.target.value}))}>
                      <option value="">— wählen —</option>
                      {(rackets||[]).filter(r=>r.status==="frei"||r.nr===editPlayer.racketNr).sort((a,b)=>a.nr-b.nr).map(r=>(
                        <option key={r.nr} value={r.nr}>{String(r.nr).padStart(3,"0")} {r.status==="frei"?"(frei)":"(aktuell)"}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Start (Vergabe)</label>
                      <input type="date" value={editPlayer.racketStart||""} onChange={e=>setEditPlayer(prev=>({...prev,racketStart:e.target.value}))}
                        style={{width:"100%",padding:"7px 10px",background:"#111827",border:"1px solid #374151",borderRadius:8,color:"#e5e7eb",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                    </div>
                    <div>
                      <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Ende (Rückgabe)</label>
                      <input type="date" value={editPlayer.racketEnd||""} onChange={e=>setEditPlayer(prev=>({...prev,racketEnd:e.target.value}))}
                        style={{width:"100%",padding:"7px 10px",background:"#111827",border:"1px solid #374151",borderRadius:8,color:"#e5e7eb",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                    </div>
                  </div>
                </>}
              </div>
              {/* Individueller Trainingszeitraum */}
              <div style={{background:"#0d1117",borderRadius:9,padding:"10px 12px",marginBottom:14}}>
                <div style={{fontSize:12,color:"#9ca3af",marginBottom:8,fontWeight:600}}>📅 Individueller Trainingszeitraum</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Start Training</label>
                    <input type="date" value={editPlayer.trainingStart||""} min="2026-01-01" max="2026-12-31"
                      onChange={e=>setEditPlayer(prev=>({...prev,trainingStart:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",background:"#111827",border:"1px solid #374151",borderRadius:8,color:"#e5e7eb",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:"#6b7280",display:"block",marginBottom:3}}>Ende Training</label>
                    <input type="date" value={editPlayer.trainingEnd||""} min="2026-01-01" max="2026-12-31"
                      onChange={e=>setEditPlayer(prev=>({...prev,trainingEnd:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",background:"#111827",border:"1px solid #374151",borderRadius:8,color:"#e5e7eb",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                </div>
                <div style={{fontSize:10,color:"#4b5563",marginTop:6}}>Hat Vorrang vor dem globalen Trainingszeitraum</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={saveEdit} disabled={saving} style={{flex:1,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{saving?"Speichert…":"💾 Speichern"}</button>
                <button onClick={()=>setEditPlayer(null)} style={{flex:1,padding:10,background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:13,fontWeight:600,cursor:"pointer"}}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:9,background:"#111827",border:"1px solid #1f2937",borderRadius:10,padding:"9px 13px",marginBottom:6}}>
              <span style={{fontSize:18}}>{p.avatar||"🏓"}</span>
              <span style={{width:8,height:8,borderRadius:"50%",background:p.color,display:"inline-block",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:p.status==="passiv"?"#6b7280":"#e5e7eb"}}>{p.firstName} {p.lastName}{p.status==="passiv"&&<span style={{fontSize:10,color:"#6b7280",marginLeft:6}}>(passiv)</span>}</div>
                <div style={{fontSize:10,color:"#4b5563",display:"flex",alignItems:"center",gap:6}}>
                  {p.noLogin
                    ? <><span style={{color:"#f59e0b"}}>👤 Kein Login</span>
                        <button onClick={()=>{setLoginUpgradeFor(p);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}} style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:5,color:"#f59e0b",fontSize:10,fontWeight:600,cursor:"pointer",padding:"1px 6px"}}>→ Login einrichten</button>
                      </>
                    : <span style={{color:"#10b981"}}>📧 {p.email}</span>
                  }
                </div>
              </div>
              <span style={{fontSize:12,color:"#6b7280",flexShrink:0}}>{getAward(p).totalStars} ★</span>
              <button onClick={()=>setEditPlayer({...p})} style={{background:"transparent",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14}}>✏️</button>
              <button onClick={()=>setDeleteConfirmFor(p)} style={{background:"transparent",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14}}>🗑️</button>
            </div>
          )
        ))}
      </div>;
    })}
  </div>;
}

// ─── PLAYER TRAINING DETAIL (Punkt 7: editierbare Trainingsübersicht im Drilldown) ──
function PlayerTrainingDetail({player,attendance,showToast}) {
  const days = getTrainingDaysForGroup(player.group||"Anfänger");
  const today = new Date(); today.setHours(0,0,0,0);
  const pStart = player.trainingStart||null;
  const filteredDays = days.filter(d=>{
    if(pStart && d < pStart) return false;
    return true;
  });
  const [saving,setSaving]=useState(false);

  async function setVal(d, val) {
    setSaving(true);
    try {
      const ref = doc(db,"attendance",d);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? snap.data() : {took_place:true,attendances:{}};
      await setDoc(ref,{
        ...existing,
        attendances:{...(existing.attendances||{}), [player.id]:val},
      });
      showToast("Gespeichert","💾");
    } catch(e){showToast("Fehler","❌");}
    setSaving(false);
  }

  const COL=[
    {key:"a",label:"✓",color:"#10b981"},
    {key:"e",label:"E",color:"#f59e0b"},
    {key:"u",label:"U",color:"#ef4444"},
  ];

  return <div style={{maxHeight:"60vh",overflowY:"auto"}}>
    <div style={{display:"grid",gridTemplateColumns:"90px 32px 1fr 44px 44px 44px",gap:4,marginBottom:6,padding:"0 2px"}}>
      <div style={{fontSize:10,fontWeight:700,color:"#6b7280"}}>Datum</div>
      <div style={{fontSize:10,fontWeight:700,color:"#6b7280"}}>Tag</div>
      <div/>
      {COL.map(c=><div key={c.key} style={{display:"flex",justifyContent:"center"}}>
        <div style={{width:32,height:32,borderRadius:"50%",background:c.color+"22",border:`2px solid ${c.color}66`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:c.color}}>{c.label}</div>
      </div>)}
    </div>
    {filteredDays.map(d=>{
      const s=attendance[d];
      const noTraining=s&&s.took_place===false;
      const val=s?.attendances?.[player.id]||(s?"a":null);
      const isPast=new Date(d)<=today;
      return <div key={d} style={{display:"grid",gridTemplateColumns:"90px 32px 1fr 44px 44px 44px",gap:4,marginBottom:4,alignItems:"center",background:noTraining?"#1a1a1a":"#0d1117",borderRadius:7,padding:"5px 6px",opacity:noTraining?0.5:1}}>
        <div style={{fontSize:11,color:"#e5e7eb"}}>{formatDateDE(d)}</div>
        <div style={{fontSize:11,color:"#6b7280"}}>{formatDayDE(d)}</div>
        <div style={{fontSize:10,color:"#4b5563"}}>{noTraining?`❌ ${s.reason||""}`:""}</div>
        {COL.map(opt=>(
          <div key={opt.key} style={{display:"flex",justifyContent:"center"}}>
            <button
              disabled={noTraining||!isPast||saving}
              onClick={()=>setVal(d,opt.key)}
              style={{
                width:32,height:32,borderRadius:"50%",
                border:`2px solid ${val===opt.key?opt.color:opt.color+"33"}`,
                cursor:(noTraining||!isPast||saving)?"not-allowed":"pointer",
                background:val===opt.key?opt.color+"33":"transparent",
                color:val===opt.key?opt.color:"#4b5563",
                fontSize:13,fontWeight:800,
              }}>{opt.label}</button>
          </div>
        ))}
      </div>;
    })}
  </div>;
}

// ─── SCHLÄGER TAB ────────────────────────────────────────────────────────────
function SchlaegerTab({rackets,players,showToast}) {
  const [sortCol,setSortCol]=useState("nr");
  const [sortAsc,setSortAsc]=useState(true);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({});
  const [saving,setSaving]=useState(false);

  function sort(col){if(sortCol===col)setSortAsc(a=>!a);else{setSortCol(col);setSortAsc(true);}}

  // Alle 230 Nummern generieren; fehlende als leere Einträge
  const allNrs = Array.from({length:230},(_,i)=>i+1);
  const rMap = Object.fromEntries((rackets||[]).map(r=>[String(r.nr),r]));
  const rows = allNrs.map(nr=>{
    const r = rMap[String(nr)];
    return r || {nr,status:"frei",zustand:"",marke:"",art:"",griffform:"",farbeBelaege:"",vergebenAn:""};
  });

  const sorted = [...rows].sort((a,b)=>{
    const va=String(a[sortCol]||""), vb=String(b[sortCol]||"");
    return sortAsc?va.localeCompare(vb,"de",{numeric:true}):vb.localeCompare(va,"de",{numeric:true});
  });

  async function saveRow() {
    setSaving(true);
    try {
      await setDoc(doc(db,"rackets",String(form.nr)),{...form,nr:Number(form.nr)});
      showToast("Gespeichert","💾");
      setEditId(null);
    } catch(e){showToast("Fehler","❌");}
    setSaving(false);
  }

  const freeRacketNrs = rows.filter(r=>r.status==="frei").map(r=>r.nr);
  // Spieler ohne zugewiesenen TTC-Schläger
  const playersWithoutRacket = players.filter(p=>p.group!=="Trainer"&&p.racketType!=="TTC");

  const SH=({col,label})=><th onClick={()=>sort(col)} style={{padding:"7px 8px",fontSize:11,color:"#9ca3af",fontWeight:700,cursor:"pointer",userSelect:"none",whiteSpace:"nowrap",background:"#111827",position:"sticky",top:0,zIndex:2}}>
    {label}{sortCol===col?(sortAsc?" ▲":" ▼"):""}
  </th>;

  const statColor={frei:"#10b981",vergeben:"#f59e0b",kaputt:"#ef4444",offen:"#6b7280",verkauft:"#8b5cf6"};

  return <div style={{padding:13}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>🏏 Schlägerverwaltung</div>
    <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #1f2937"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr>
            <SH col="nr" label="Nr."/>
            <SH col="status" label="Status"/>
            <SH col="zustand" label="Zustand"/>
            <SH col="marke" label="Marke"/>
            <SH col="art" label="Art"/>
            <SH col="griffform" label="Griffform"/>
            <SH col="farbeBelaege" label="Beläge"/>
            <SH col="vergebenAn" label="Vergabe an"/>
            <th style={{padding:"7px 8px",background:"#111827",position:"sticky",top:0,zIndex:2}}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r=>(
            editId===r.nr ? (
              <tr key={r.nr} style={{background:"#111827"}}>
                <td style={{padding:"6px 8px",color:"#e5e7eb",fontWeight:700}}>{String(r.nr).padStart(3,"0")}</td>
                <td style={{padding:"4px"}}>
                  <select value={form.status||"frei"} onChange={e=>setForm(p=>({...p,status:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    {["frei","vergeben","kaputt","offen","verkauft"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.zustand||""} onChange={e=>setForm(p=>({...p,zustand:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>
                    {["neu","gut","mittel","schlecht"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <input list={`marke-${r.nr}`} value={form.marke||""} onChange={e=>setForm(p=>({...p,marke:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%",background:"#0d1117",border:"1px solid #374151",borderRadius:5,color:"#e5e7eb",outline:"none"}}/>
                  <datalist id={`marke-${r.nr}`}><option>Butterfly</option><option>Joola</option><option>GEWO</option></datalist>
                </td>
                <td style={{padding:"4px"}}>
                  <input value={form.art||""} onChange={e=>setForm(p=>({...p,art:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%",background:"#0d1117",border:"1px solid #374151",borderRadius:5,color:"#e5e7eb",outline:"none"}}/>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.griffform||""} onChange={e=>setForm(p=>({...p,griffform:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>
                    {["Anatomisch","Gerade","Konisch","Konkav"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.farbeBelaege||""} onChange={e=>setForm(p=>({...p,farbeBelaege:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>
                    {["Schwarz/rot","Schwarz/blau","Schwarz/grün","Schwarz/pink","Schwarz/violett"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.vergebenAn||""} onChange={e=>setForm(p=>({...p,vergebenAn:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">— frei —</option>
                    {playersWithoutRacket.sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"")).map(p=>(
                      <option key={p.id} value={`${p.firstName} ${p.lastName}`}>{p.firstName} {p.lastName}</option>
                    ))}
                  </select>
                </td>
                <td style={{padding:"4px",whiteSpace:"nowrap"}}>
                  <button onClick={saveRow} disabled={saving} style={{padding:"3px 8px",background:"#10b981",border:"none",borderRadius:5,color:"#fff",fontSize:11,cursor:"pointer",marginRight:3}}>💾</button>
                  <button onClick={()=>setEditId(null)} style={{padding:"3px 8px",background:"#374151",border:"none",borderRadius:5,color:"#9ca3af",fontSize:11,cursor:"pointer"}}>✕</button>
                </td>
              </tr>
            ) : (
              <tr key={r.nr} style={{borderTop:"1px solid #1f2937",background:r.vergebenAn?"#111827":"transparent"}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>
                <td style={{padding:"7px 8px",color:"#e5e7eb",fontWeight:700,cursor:"pointer"}}>{String(r.nr).padStart(3,"0")}</td>
                <td style={{padding:"7px 8px",cursor:"pointer"}}><span style={{color:statColor[r.status]||"#6b7280",fontWeight:600,fontSize:11}}>{r.status||"frei"}</span></td>
                <td style={{padding:"7px 8px",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{r.zustand||"—"}</td>
                <td style={{padding:"7px 8px",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{r.marke||"—"}</td>
                <td style={{padding:"7px 8px",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{r.art||"—"}</td>
                <td style={{padding:"7px 8px",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{r.griffform||"—"}</td>
                <td style={{padding:"7px 8px",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{r.farbeBelaege||"—"}</td>
                <td style={{padding:"7px 8px",color:"#e5e7eb",fontSize:11,cursor:"pointer"}}>{r.vergebenAn||""}</td>
                <td style={{padding:"7px 8px"}}><span style={{color:"#4b5563",fontSize:12,cursor:"pointer"}}>✏️</span></td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}

// ─── GEBURTSTAGE TAB ─────────────────────────────────────────────────────────
function GeburtstageTab({players,showToast}) {
  const [uploading,setUploading]=useState(false);

  // Alle Spieler mit Geburtstag, sortiert nach Monat+Tag (ohne Jahr)
  const withBirthday = players
    .filter(p=>p.birthdate)
    .map(p=>{
      const bd=new Date(p.birthdate);
      const age=new Date().getFullYear()-bd.getFullYear();
      return {...p,age,month:bd.getMonth(),day:bd.getDate(),
        sortKey:`${String(bd.getMonth()+1).padStart(2,"0")}-${String(bd.getDate()).padStart(2,"0")}`};
    })
    .sort((a,b)=>a.sortKey.localeCompare(b.sortKey));

  // Letztes Training ermitteln
  const today=new Date();today.setHours(0,0,0,0);
  const allDays=[...new Set([...ALL_TUESDAYS,...ALL_FRIDAYS])].sort();
  const lastTraining=([...allDays].reverse().find(d=>new Date(d)<=today))||null;

  function isRecentBirthday(p) {
    if (!lastTraining||!p.birthdate) return false;
    const bd=new Date(p.birthdate);
    const since=new Date(lastTraining);
    // Geburtstag dieses Jahr
    const thisYear=new Date(today.getFullYear(),bd.getMonth(),bd.getDate());
    return thisYear>=since && thisYear<=today;
  }

  // Excel-Upload
  async function handleExcelUpload(e) {
    const file=e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const {read,utils}=await import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs");
      const ab=await file.arrayBuffer();
      const wb=read(ab);
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=utils.sheet_to_json(ws);
      let count=0;
      for (const row of rows) {
        const vorname=row["Vorname"]||row["vorname"]||"";
        const nachname=row["Nachname"]||row["nachname"]||"";
        const geburt=row["Geburtsdatum"]||row["geburtsdatum"]||"";
        if (!vorname||!geburt) continue;
        // Spieler finden
        const p=players.find(pl=>(pl.firstName||"").toLowerCase()===vorname.toLowerCase()&&(pl.lastName||"").toLowerCase()===nachname.toLowerCase());
        if (p) {
          // Datum parsen (DD.MM.YYYY oder YYYY-MM-DD)
          let dateStr=String(geburt);
          if (dateStr.includes(".")) {
            const [d,m,y]=dateStr.split(".");
            dateStr=`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
          }
          await updateDoc(doc(db,"players",p.id),{birthdate:dateStr});
          count++;
        }
      }
      showToast(`${count} Geburtstage importiert!`,"🎂");
    } catch(err){showToast("Fehler: "+err.message,"❌");}
    setUploading(false);
    e.target.value="";
  }

  return <div style={{padding:13}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontSize:17,fontWeight:800}}>🎂 Geburtstage</div>
      <label style={{padding:"6px 12px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer"}}>
        {uploading?"Wird importiert…":"📥 Excel importieren"}
        <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleExcelUpload} disabled={uploading}/>
      </label>
    </div>
    <div style={{fontSize:11,color:"#6b7280",marginBottom:10}}>
      Geburtstage seit letztem Training ({lastTraining?formatDateDE(lastTraining):"—"}) sind hervorgehoben. Auf Namen klicken zum Sortieren.
    </div>
    <div style={{background:"#111827",borderRadius:12,border:"1px solid #1f2937",overflow:"hidden"}}>
      <div style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr 60px",gap:0,background:"#1f2937",padding:"8px 12px",position:"sticky",top:0}}>
        {["Geburtstag","Vorname","Nachname","Alter"].map(h=>(
          <div key={h} style={{fontSize:11,fontWeight:700,color:"#9ca3af"}}>{h}</div>
        ))}
      </div>
      {withBirthday.map(p=>{
        const highlight=isRecentBirthday(p);
        return <div key={p.id} style={{display:"grid",gridTemplateColumns:"100px 1fr 1fr 60px",gap:0,padding:"9px 12px",borderTop:"1px solid #1f2937",background:highlight?"#f59e0b11":"transparent"}}>
          <div style={{fontSize:12,color:highlight?"#f59e0b":"#e5e7eb",fontWeight:highlight?700:400}}>
            {highlight&&"🎂 "}{formatDateDE(p.birthdate).slice(0,5)}
          </div>
          <div style={{fontSize:12,color:"#e5e7eb",fontWeight:highlight?700:400}}>{p.firstName}</div>
          <div style={{fontSize:12,color:"#e5e7eb"}}>{p.lastName}</div>
          <div style={{fontSize:12,color:highlight?"#f59e0b":"#6b7280",fontWeight:highlight?700:400}}>{p.age}</div>
        </div>;
      })}
      {withBirthday.length===0&&<div style={{padding:20,textAlign:"center",color:"#6b7280",fontSize:13}}>Noch keine Geburtstage erfasst</div>}
    </div>
  </div>;
}

// ─── PLAYER VIEW ──────────────────────────────────────────────────────────────
function PlayerView({user,players,attendance,onSignOut}) {
  const myPlayer=players.find(p=>p.email===user.email);
  const activePlayers=players.filter(p=>p.status!=="passiv"&&p.group!=="Trainer");
  const [activeTab,setActiveTab]=useState("stats");
  const [expandedEx,setExpandedEx]=useState(null);
  const [showAvatarPicker,setShowAvatarPicker]=useState(false);
  // Punkt 6+7: Nur Spieler der eigenen Gruppe
  const myGroup = myPlayer?.group||"Anfänger";
  const groupPeers = activePlayers.filter(p=>p.group===myGroup);
  const sortedRanking=groupPeers.sort((a,b)=>getAward(b).totalStars-getAward(a).totalStars);
  const TABS=[
    {key:"stats",label:"Meine Stats",icon:"⭐"},
    {key:"training",label:"Training",icon:"📅"},
    {key:"teilnahme",label:"Teilnahme",icon:"📊"}, // Punkt 6
    {key:"ranking",label:"Rangliste",icon:"🏆"},
  ];

  // Punkt 6: Avatar selbst ändern
  async function changeMyAvatar(av) {
    if (!myPlayer) return;
    try {
      await updateDoc(doc(db,"players",myPlayer.id),{avatar:av});
      setShowAvatarPicker(false);
    } catch(e){}
  }

  if (!myPlayer) return <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:16}}>
    <div style={{fontSize:40}}>⏳</div>
    <div style={{fontSize:16,fontWeight:700,color:"#e5e7eb",textAlign:"center"}}>Dein Profil wird noch eingerichtet.</div>
    <div style={{fontSize:13,color:"#6b7280",textAlign:"center"}}>Bitte wende dich an deinen Trainer.</div>
    <button onClick={onSignOut} style={{padding:"8px 16px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Abmelden</button>
  </div>;

  const {currentAward,beginnerStars,advancedStars,totalStars}=getAward(myPlayer);
  const nexts=nextAwards(myPlayer);
  const myRank=sortedRanking.findIndex(p=>p.id===myPlayer.id)+1;
  const myDays=getTrainingDaysForGroup(myPlayer.group||"Anfänger");
  const today=new Date();today.setHours(0,0,0,0);
  const pastDays=myDays.filter(d=>new Date(d)<=today);
  let present=0,total=0;
  for (const d of pastDays) {
    const s=attendance[d];
    if (s&&s.took_place===false) continue; // kein Training
    if (!s) continue; // noch nicht erfasst → nicht zählen
    total++;
    const val = s.attendances?.[myPlayer.id];
    // undefined/null → implizit anwesend; "a" → anwesend
    if (val===undefined||val===null||val==="a") present++;
  }
  const pct=total>0?Math.round((present/total)*100):0;

  return <div style={{minHeight:"100vh",background:"#0d1117",color:"#e5e7eb",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:680,margin:"0 auto",paddingBottom:80}}>
    {/* Punkt 6: Avatar Picker Modal */}
    {showAvatarPicker&&<AvatarPicker current={myPlayer.avatar} onSelect={changeMyAvatar} onClose={()=>setShowAvatarPicker(false)}/>}

    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",borderBottom:"1px solid #1f2937",padding:"14px 14px 12px",position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Punkt 6: Avatar klickbar */}
          <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setShowAvatarPicker(true)}>
            <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={42}/>
            <span style={{position:"absolute",bottom:-1,right:-1,fontSize:10,background:"#1f2937",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #374151"}}>✏️</span>
          </div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:myPlayer.color}}>{myPlayer.firstName} {myPlayer.lastName}</div>
            <div style={{fontSize:11,color:"#6b7280"}}>TTC Niederzeuzheim · Rang #{myRank} · {pct}% Beteiligung</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{padding:"5px 10px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer"}}>Abmelden</button>
      </div>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",borderBottom:"1px solid #1f2937",background:"#0d1117",position:"sticky",top:70,zIndex:99}}>
      {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{flex:1,padding:"11px 0",background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,color:activeTab===t.key?"#10b981":"#6b7280",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>{t.icon} {t.label}</button>)}
    </div>

    {/* ── STATS ── */}
    {activeTab==="stats"&&<div style={{padding:14}}>
      <div style={{background:`linear-gradient(135deg,${myPlayer.color}11,#111827)`,border:`1px solid ${myPlayer.color}44`,borderRadius:16,padding:18,marginBottom:16,textAlign:"center"}}>
        {/* Punkt 6: Avatar klickbar im großen Profil */}
        <div style={{position:"relative",display:"inline-block",cursor:"pointer"}} onClick={()=>setShowAvatarPicker(true)}>
          <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={64}/>
          <span style={{position:"absolute",bottom:0,right:0,fontSize:12,background:"#1f2937",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #374151"}}>✏️</span>
        </div>
        <div style={{fontSize:22,fontWeight:900,color:myPlayer.color,marginTop:12}}>{myPlayer.firstName} {myPlayer.lastName}</div>
        <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>{myPlayer.group||"Anfänger"} · Rang #{myRank} von {activePlayers.filter(p=>p.group!=="Trainer").length}</div>
        {currentAward&&<div style={{marginBottom:12}}><AwardBadge award={currentAward}/></div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
          {[{label:"Gesamt",val:totalStars,color:myPlayer.color},{label:"Anfänger",val:beginnerStars,color:"#10b981"},{label:"Fortgeschr.",val:advancedStars,color:"#3b82f6"}].map(s=>(
            <div key={s.label} style={{background:"#0d1117",borderRadius:10,padding:"10px 6px"}}>
              <div style={{fontSize:22,fontWeight:900,color:s.color}}>{s.val}</div>
              <div style={{fontSize:10,color:"#6b7280"}}>★ {s.label}</div>
            </div>
          ))}
        </div>
        <div style={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Anfänger</span><span>{beginnerStars}/50</span></div>
          <ProgressBar value={beginnerStars} max={50} color={myPlayer.color}/>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Fortgeschrittene</span><span>{advancedStars}/150</span></div>
          <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
        </div>
        {/* Punkt 11: Alle nächsten Ziele */}
        {nexts.length>0&&<div style={{marginTop:12,background:"#0d1117",borderRadius:8,padding:"8px 12px",display:"flex",flexDirection:"column",gap:5,alignItems:"center"}}>
          {nexts.map((a,i)=>(
            <div key={i} style={{fontSize:12,color:"#9ca3af",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"center"}}>
              <span style={{fontSize:10,color:"#4b5563"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
              <AwardBadge award={a} small/>
              <span>— noch {a.needed} Sterne</span>
            </div>
          ))}
        </div>}
      </div>

      <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:"#e5e7eb"}}>Meine Übungen</div>
      {/* Punkt 8: Aufklappbare Übungen für Spieler */}
      <div style={{display:"flex",flexDirection:"column",gap:6,paddingBottom:20}}>
        {ALL_EXERCISES.map(ex=>{
          const stars=myPlayer.stars?.[ex.id]||0;
          const isBeg=ex.id<=10;
          const isExp=expandedEx===ex.id;
          return <div key={ex.id} style={{background:"#111827",border:`1px solid ${stars>0?"#2d3748":"#1f2937"}`,borderRadius:10,overflow:"hidden"}}>
            <div onClick={()=>setExpandedEx(isExp?null:ex.id)} style={{padding:"10px 12px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <div style={{width:26,height:26,borderRadius:6,flexShrink:0,background:isBeg?"#10b98122":"#3b82f622",border:`1px solid ${isBeg?"#10b98144":"#3b82f644"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:isBeg?"#10b981":"#3b82f6"}}>{ex.id}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#e5e7eb",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div></div>
              <StarRating stars={stars} readonly/>
              <span style={{color:"#6b7280",fontSize:12,marginLeft:4}}>{isExp?"▲":"▼"}</span>
            </div>
            {isExp&&<div style={{borderTop:"1px solid #1f2937",padding:"10px 12px",background:"#0d1117"}}>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {ex.thresholds.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 9px",borderRadius:7,background:stars>=i+1?"#f59e0b11":"#1f2937",border:`1px solid ${stars>=i+1?"#f59e0b44":"#374151"}`}}>
                    <span style={{color:stars>=i+1?"#f59e0b":"#6b7280",fontSize:12}}>{"★".repeat(i+1)}{"☆".repeat(4-i)}</span>
                    <span style={{fontSize:12,color:stars>=i+1?"#e5e7eb":"#9ca3af",flex:1}}>{t}</span>
                    {stars>=i+1&&<span style={{color:"#10b981",fontSize:12}}>✓</span>}
                  </div>
                ))}
              </div>
            </div>}
          </div>;
        })}
      </div>
    </div>}

    {/* ── TRAINING ── */}
    {activeTab==="training"&&<div style={{padding:14}}>
      <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📅 Meine Trainingstage</div>
      <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>{myPlayer.group||"Anfänger"} · {myDays.length} Trainingstage 2026</div>

      {/* Summary */}
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,padding:14,marginBottom:14}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,textAlign:"center"}}>
          {[{l:"Beteiligung",v:`${pct}%`,c:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981"},{l:"Anwesend",v:present,c:"#10b981"},{l:"Gesamt",v:total,c:"#6b7280"}].map(s=>(
            <div key={s.l} style={{background:"#0d1117",borderRadius:10,padding:"10px 6px"}}>
              <div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
              <div style={{fontSize:10,color:"#6b7280"}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Training days table */}
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"90px 36px 1fr",background:"#1f2937",padding:"8px 12px",gap:8}}>
          <div style={{fontSize:11,fontWeight:700,color:"#9ca3af"}}>Datum</div>
          <div style={{fontSize:11,fontWeight:700,color:"#9ca3af"}}>Tag</div>
          <div style={{fontSize:11,fontWeight:700,color:"#9ca3af"}}>Status</div>
        </div>
        {myDays.map(d=>{
          const s=attendance[d];
          const didNotTakePlace=s&&s.took_place===false;
          const val=s?.attendances?.[myPlayer.id]||"a";
          const isPast=new Date(d)<=today;
          let statusLabel="—";
          let statusColor="#6b7280";
          if (didNotTakePlace) {statusLabel=`Kein Training (${s.reason||"—"})`;statusColor="#6b7280";}
          else if (isPast) {
            if (val==="a"){statusLabel="✓ Anwesend";statusColor="#10b981";}
            else if (val==="e"){statusLabel="E Entschuldigt";statusColor="#f59e0b";}
            else {statusLabel="U Unentschuldigt";statusColor="#ef4444";}
          } else {statusLabel="Ausstehend";statusColor="#374151";}
          return <div key={d} style={{display:"grid",gridTemplateColumns:"90px 36px 1fr",padding:"9px 12px",gap:8,borderTop:"1px solid #1f2937",background:didNotTakePlace?"#1a1a1a":"transparent",opacity:didNotTakePlace?0.5:1}}>
            <div style={{fontSize:12,color:"#e5e7eb",fontWeight:500}}>{formatDateDE(d)}</div>
            <div style={{fontSize:12,color:"#6b7280"}}>{formatDayDE(d)}</div>
            <div style={{fontSize:12,color:statusColor,fontWeight:500}}>{statusLabel}</div>
          </div>;
        })}
      </div>
    </div>}

    {/* ── TEILNAHME (Spielerbereich) ── */}
    {activeTab==="teilnahme"&&(()=>{
      // Stats vorab berechnen, dann absteigend nach % sortieren
      const today2=new Date();today2.setHours(0,0,0,0);
      const rankedPeers=[...groupPeers].map(player=>{
        const days=getTrainingDaysForGroup(player.group||"Anfänger");
        const pStart=player.trainingStart||null;
        const pEnd=player.trainingEnd||null;
        const pastD=days.filter(d=>{
          const dt=new Date(d);
          if(dt>today2)return false;
          if(pStart&&dt<new Date(pStart))return false;
          if(pEnd&&dt>new Date(pEnd))return false;
          return true;
        });
        let pres=0,tot=0,exc=0,unex=0;
        for(const d of pastD){
          const s=attendance[d];
          if(s&&s.took_place===false)continue;
          if(!s)continue;
          tot++;
          const att=s.attendances;
          if(!att){pres++;continue;}
          const val=att[player.id];
          if(val===undefined||val===null||val==="a")pres++;
          else if(val==="e")exc++;
          else unex++;
        }
        const pct=tot>0?Math.round((pres/tot)*100):0;
        return {...player,pct,pres,tot,exc,unex};
      }).sort((a,b)=>b.pct-a.pct);

      return <div style={{padding:14}}>
        <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📊 Trainingsbeteiligung</div>
        <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Gruppe: {myGroup}</div>
        {rankedPeers.map((player,idx)=>{
          const {pct,pres,tot,exc,unex}=player;
          const isMe=player.id===myPlayer.id;
          const medal=pct>90?"🥇":pct>80?"🥈":pct>70?"🥉":null;
          return <div key={player.id} style={{background:isMe?"#10b98111":"#111827",border:`2px solid ${isMe?myPlayer.color+"88":idx===0?"#f59e0b44":"#1f2937"}`,borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,position:"relative"}}>
            {isMe&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:myPlayer.color,borderRadius:"12px 12px 0 0"}}/>}
            <Avatar avatar={player.avatar} color={player.color} size={36}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                <span style={{fontSize:14,fontWeight:800,color:isMe?myPlayer.color:"#e5e7eb"}}>{player.firstName} {player.lastName}{isMe&&" (Du)"}</span>
                {medal&&<span style={{fontSize:18}}>{medal}</span>}
              </div>
              <div style={{background:"#1f2937",borderRadius:6,height:8,overflow:"hidden",marginBottom:4}}>
                <div style={{width:`${pct}%`,height:"100%",background:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981",borderRadius:6}}/>
              </div>
              <div style={{display:"flex",gap:10,fontSize:10,color:"#6b7280"}}>
                <span>✓ {pres} anwesend</span>
                <span>{exc} entsch.</span>
                <span>{unex} unentsch.</span>
              </div>
            </div>
            <div style={{flexShrink:0,textAlign:"center",background:"#0d1117",borderRadius:10,padding:"6px 10px",border:`1px solid ${player.color}44`,minWidth:50}}>
              <div style={{fontSize:20,fontWeight:900,color:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981",lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>Beteiligung</div>
            </div>
          </div>;
        })}
      </div>;
    })()}

    {/* ── RANGLISTE (Punkt 7: nur eigene Gruppe) ── */}
    {activeTab==="ranking"&&<div style={{padding:14}}>
      <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>🏆 Rangliste</div>
      <div style={{fontSize:12,color:"#6b7280",marginBottom:14}}>Gruppe: {myGroup}</div>
      {sortedRanking.map((player,idx)=>{
        const {currentAward,totalStars,isAdvanced}=getAward(player);
        const isMe=player.id===myPlayer.id;
        const rankEmoji=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
        return <div key={player.id} style={{background:isMe?"#10b98111":"#111827",border:`2px solid ${isMe?myPlayer.color+"88":idx===0?"#f59e0b44":"#1f2937"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
          {isMe&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:myPlayer.color}}/>}
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18,minWidth:28}}>{rankEmoji}</span>
            <Avatar avatar={player.avatar} color={player.color} size={36}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                <span style={{fontSize:14,fontWeight:800,color:isMe?myPlayer.color:"#e5e7eb"}}>{player.firstName} {player.lastName}{isMe&&" (Du)"}</span>
                {currentAward&&<AwardBadge award={currentAward} small/>}
              </div>
              <div style={{fontSize:11,color:"#6b7280"}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · {totalStars} Sterne</div>
            </div>
          </div>
        </div>;
      })}
    </div>}

    <style>{`*{box-sizing:border-box}input::placeholder{color:#4b5563}select{background:#0d1117;color:#e5e7eb;border:1px solid #374151;border-radius:9px;padding:10px 13px;font-size:14px;width:100%;outline:none}`}</style>
  </div>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser,     setAuthUser]     = useState(undefined); // undefined = noch nicht geprüft
  const [players,      setPlayers]      = useState([]);
  const [attendance,   setAttendance]   = useState({});
  const [rackets,      setRackets]      = useState([]);
  const [loginErr,     setLoginErr]     = useState("");
  const [loginLoad,    setLoginLoad]    = useState(false);
  const [isAdmin,      setIsAdmin]      = useState(false);
  const [adminReady,   setAdminReady]   = useState(false);
  const [loginSuccess, setLoginSuccess] = useState("");

  // ── Auth listener mit robustem Admin-Check ──
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async u => {
      setAuthUser(u || null);
      if (!u) { setIsAdmin(false); setAdminReady(true); return; }

      // 1) E-Mail-Vergleich (lowercase, getrimmt)
      if (isAdminEmail(u.email)) {
        setIsAdmin(true); setAdminReady(true); return;
      }

      // 2) Firestore-Check (trainers-Collection)
      try {
        const snap = await getDoc(doc(db, "trainers", u.uid));
        if (snap.exists() && snap.data().role === "admin") {
          setIsAdmin(true); setAdminReady(true); return;
        }
      } catch(e) { /* ignorieren */ }

      // 3) Kein Admin
      setIsAdmin(false); setAdminReady(true);
    });
    return unsub;
  },[]);

  // ── Echtzeit-Listener für Spieler, Anwesenheit & Schläger ──
  useEffect(()=>{
    if (!authUser) return;
    const u1 = onSnapshot(collection(db,"players"),
      snap => setPlayers(snap.docs.map(d=>d.data())),
      () => {}
    );
    const u2 = onSnapshot(collection(db,"attendance"),
      snap => {
        const map = {};
        snap.docs.forEach(d => { map[d.id] = d.data(); });
        setAttendance(map);
      },
      () => {}
    );
    const u3 = onSnapshot(collection(db,"rackets"),
      snap => setRackets(snap.docs.map(d=>d.data())),
      () => {}
    );
    return () => { u1(); u2(); u3(); };
  },[authUser]);

  async function handleLogin(email, pass) {
    setLoginLoad(true); setLoginErr(""); setLoginSuccess("");
    try { await signInWithEmailAndPassword(auth, email.trim(), pass); }
    catch(e) {
      if (["auth/user-not-found","auth/wrong-password","auth/invalid-credential"].includes(e.code))
        setLoginErr("E-Mail oder Passwort falsch.");
      else if (e.code==="auth/invalid-email")
        setLoginErr("Ungültige E-Mail-Adresse.");
      else
        setLoginErr("Fehler: " + e.message);
    }
    setLoginLoad(false);
  }

  async function handleSignOut() {
    await signOut(auth);
    setPlayers([]); setAttendance({}); setRackets([]); setIsAdmin(false);
    setAdminReady(false); setLoginSuccess("");
  }

  // Trainer-Freischalt-Funktion (Notfall)
  async function makeAdminInFirestore() {
    if (!authUser) return;
    try {
      await setDoc(doc(db,"trainers", authUser.uid), {
        uid: authUser.uid, email: authUser.email, role: "admin"
      });
      setIsAdmin(true);
    } catch(e) { alert("Fehler: " + e.message); }
  }

  // ── Ladezustand ──
  if (authUser === undefined || !adminReady) return (
    <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>🏓</div>
      <div style={{fontSize:14,color:"#6b7280"}}>TTC Niederzeuzheim wird geladen…</div>
    </div>
  );

  // ── Nicht angemeldet → Login ──
  if (!authUser) return (
    <LoginScreen
      onLogin={handleLogin}
      error={loginErr}
      loading={loginLoad}
      successMessage={loginSuccess}
    />
  );

  // ── Angemeldet als Trainer ──
  if (isAdmin) return (
    <AdminPanel
      user={authUser}
      players={players}
      attendance={attendance}
      rackets={rackets}
      onSignOut={handleSignOut}
      onPlayerAdded={name => setLoginSuccess(`${name} wurde angelegt! Bitte melde dich neu an.`)}
    />
  );

  // ── Angemeldet, aber kein Spieler-Profil gefunden → Notfall-Bildschirm ──
  const myPlayer = players.find(p => p.email?.toLowerCase() === authUser.email?.toLowerCase());
  if (!myPlayer) return (
    <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{maxWidth:400,width:"100%"}}>
        <div style={{background:"#111827",border:"1px solid #374151",borderRadius:16,padding:24,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>🔑</div>
          <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:8}}>Bist du ein Trainer?</div>
          <div style={{fontSize:13,color:"#6b7280",marginBottom:6,lineHeight:1.6}}>
            Angemeldet als:<br/>
            <b style={{color:"#10b981"}}>{authUser.email}</b>
          </div>
          <div style={{fontSize:12,color:"#6b7280",marginBottom:20,lineHeight:1.6}}>
            Klicke auf den Button um den Trainer-Zugang dauerhaft freizuschalten.
          </div>
          <button onClick={makeAdminInFirestore} style={{
            width:"100%",padding:12,marginBottom:10,
            background:"linear-gradient(135deg,#10b981,#059669)",
            border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",
          }}>✅ Ja, ich bin Trainer — Zugang freischalten</button>
          <button onClick={handleSignOut} style={{
            width:"100%",padding:10,background:"transparent",border:"1px solid #374151",
            borderRadius:9,color:"#6b7280",fontSize:13,cursor:"pointer",
          }}>Abmelden</button>
        </div>
      </div>
    </div>
  );

  // ── Angemeldet als Spieler ──
  return (
    <PlayerView
      user={authUser}
      players={players}
      attendance={attendance}
      onSignOut={handleSignOut}
    />
  );
}
