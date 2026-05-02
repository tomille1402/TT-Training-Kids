import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, collection, addDoc,
  onSnapshot, deleteDoc, updateDoc, getDoc, getDocs
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

const app        = initializeApp(firebaseConfig);
const auth       = getAuth(app);
const db         = getFirestore(app);
const appHelper  = initializeApp(firebaseConfig, "helper");
const authHelper = getAuth(appHelper);

// ─── ADMIN EMAILS ────────────────────────────────────────────────────────────
// Alle Trainer-E-Mails (sehen Trainer-Bereich, aber NICHT Verwaltung)
const ADMIN_EMAILS = [
  "thomas@meilinger.net",
  "kira@meilinger.net",
  "joerg.bonkowski@web.de",
  "dominik.horz@gmx.de",
  "christina@rohschuermann.de",
  // weitere Trainer hier hinzufügen:
  // "trainer2@ttc-niederzeuzheim.de",
];
// Super-Admin E-Mails (sehen zusätzlich den Verwaltungsbereich)
const SUPER_ADMIN_EMAILS = [
  "thomas@meilinger.net",
  // weitere Admins hier hinzufügen:
];
function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(a => a.toLowerCase().trim() === email.toLowerCase().trim());
}
function isSuperAdminEmail(email) {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.some(a => a.toLowerCase().trim() === email.toLowerCase().trim());
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

function getTrainingDaysForGroup(group, trainerDays) {
  if (group === "Profis") return [...ALL_TUESDAYS, ...ALL_FRIDAYS].sort();
  if (group === "Trainer") {
    // Trainer: days from their trainingDays field ("Di", "Fr", "Di+Fr")
    if (!trainerDays || trainerDays === "Di+Fr") return [...ALL_TUESDAYS, ...ALL_FRIDAYS].sort();
    if (trainerDays === "Fr") return ALL_FRIDAYS;
    return ALL_TUESDAYS; // default: Di only
  }
  return ALL_TUESDAYS;
}

function getTrainingTime(group, dateStr) {
  const dow = new Date(dateStr).getDay();
  const g = group;
  if (g === "Anfänger") return "17:00–18:00";
  if (g === "Fortgeschrittene") return "17:00–18:30";
  if (g === "Profis") return dow === 5 ? "16:00–18:00" : "17:00–19:00";
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
const GROUPS = ["Profis","Fortgeschrittene","Anfänger","Trainer"];
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
  // Fortgeschrittene-Urkunden basieren auf GESAMTSTERNEN (bs+as)
  if (isAdv) {
    for (const a of ADVANCED_AWARDS) if (ts>=a.stars) cur=a;
    if (!cur) for (const a of BEGINNER_AWARDS) if (bs>=a.stars) cur=a;
  } else {
    for (const a of BEGINNER_AWARDS) if (bs>=a.stars) cur=a;
  }
  return {currentAward:cur,beginnerStars:bs,advancedStars:as,totalStars:ts,isAdvanced:isAdv};
}

function nextAwards(player) {
  const {beginnerStars:bs,advancedStars:as,totalStars:ts}=getAward(player);
  const results=[];
  if (bs<50) {
    for (const a of BEGINNER_AWARDS) {
      if (bs<a.stars) { results.push({...a,needed:a.stars-bs,type:"beginner"}); break; }
    }
  }
  // Nächste Fortgeschrittene-Urkunde basiert auf Gesamtsternen
  for (const a of ADVANCED_AWARDS) {
    if (ts<a.stars) { results.push({...a,needed:a.stars-ts,type:"advanced"}); break; }
  }
  return results;
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────
function StarRating({stars,onRate,readonly=false}) {
  const [hov,setHov]=useState(null);
  const disp=hov!==null?hov:stars;
  return <div style={{display:"flex",gap:3}}>{[1,2,3,4,5].map(v=>(
    <span key={v} onClick={()=>!readonly&&onRate&&onRate(v===stars?0:v)}
      onMouseEnter={()=>!readonly&&setHov(v)} onMouseLeave={()=>!readonly&&setHov(null)}
      style={{fontSize:readonly?17:22,cursor:readonly?"default":"pointer",color:v<=disp?"#f59e0b":"var(--border2)",
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
  const pct = max>0 ? Math.min(100, Math.round((value/max)*100)) : 0;
  return <div style={{background:"var(--bg3)",borderRadius:6,height:7,overflow:"hidden",width:"100%"}}>
    <div style={{width:`${pct}%`,height:"100%",
      background:pct>=100?`linear-gradient(90deg,${color},#10b981)`:
        `linear-gradient(90deg,${color},${color}bb)`,
      borderRadius:6,transition:"width .5s"}}/>
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
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:18,padding:22,
      maxWidth:400,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
      {children}
    </div>
  </div>;
}
function AvatarPicker({current,onSelect,onClose}) {
  return <Modal onClose={onClose}>
    <div style={{fontSize:16,fontWeight:800,marginBottom:14,color:"var(--text)"}}>Avatar wählen</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
      {AVATARS.map(av=><button key={av} onClick={()=>onSelect(av)} style={{
        background:av===current?"#10b98133":"var(--border)",border:`2px solid ${av===current?"#10b981":"var(--border2)"}`,
        borderRadius:10,padding:"7px 3px",fontSize:24,cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center"}}>{av}</button>)}
    </div>
    <button onClick={onClose} style={{width:"100%",padding:10,background:"var(--bg3)",border:"1px solid var(--border2)",
      borderRadius:9,color:"var(--text2)",fontSize:14,fontWeight:600,cursor:"pointer"}}>Schließen</button>
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

  return <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{maxWidth:360,width:"100%"}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:56,marginBottom:12}}>🏓</div>
        <div style={{fontSize:22,fontWeight:800,color:"var(--text)"}}>TTC Niederzeuzheim</div>
        <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>Nachwuchs Trainingsheft</div>
      </div>
      {!resetMode ? (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:16,padding:24}}>
          <div style={{fontSize:15,fontWeight:700,color:"var(--text)",marginBottom:18}}>Anmelden</div>
          {successMessage&&<div style={{background:"#10b98122",border:"1px solid #10b98166",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#10b981",marginBottom:14}}>✅ {successMessage}</div>}
          {error&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:14}}>{error}</div>}
          {[{l:"E-Mail",v:email,s:setEmail,t:"email",p:"deine@email.de"},{l:"Passwort",v:pass,s:setPass,t:"password",p:"••••••••"}].map(f=>(
            <div key={f.l} style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:5}}>{f.l}</label>
              <input type={f.t} value={f.v} onChange={e=>f.s(e.target.value)} placeholder={f.p}
                onKeyDown={e=>e.key==="Enter"&&onLogin(email,pass)}
                style={{width:"100%",padding:"11px 13px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:15,outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}
          <button onClick={()=>onLogin(email,pass)} disabled={loading||!email||!pass} style={{
            width:"100%",padding:12,background:(!email||!pass||loading)?"var(--border)":"linear-gradient(135deg,#10b981,#059669)",
            border:"none",borderRadius:9,color:(!email||!pass||loading)?"#6b7280":"#fff",
            fontSize:15,fontWeight:700,cursor:(!email||!pass||loading)?"not-allowed":"pointer"}}>{loading?"Anmelden…":"Anmelden"}</button>
          <button onClick={()=>{setResetMode(true);setResetEmail(email);}} style={{width:"100%",marginTop:12,padding:8,background:"transparent",border:"none",color:"var(--text3)",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>🔑 Passwort vergessen?</button>
        </div>
      ) : (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:16,padding:24}}>
          {!resetSent ? <>
            <div style={{fontSize:15,fontWeight:700,color:"var(--text)",marginBottom:8}}>🔑 Passwort zurücksetzen</div>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:16,lineHeight:1.5}}>Gib deine E-Mail ein. Du bekommst einen Reset-Link.</div>
            {resetErr&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{resetErr}</div>}
            <input type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="deine@email.de"
              style={{width:"100%",padding:"11px 13px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
            <button onClick={doReset} disabled={resetLoad||!resetEmail.trim()} style={{width:"100%",padding:12,background:(resetLoad||!resetEmail.trim())?"var(--border)":"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",borderRadius:9,color:(resetLoad||!resetEmail.trim())?"#6b7280":"#fff",fontSize:15,fontWeight:700,cursor:(resetLoad||!resetEmail.trim())?"not-allowed":"pointer",marginBottom:10}}>{resetLoad?"Wird gesendet…":"Reset-E-Mail senden"}</button>
            <button onClick={()=>{setResetMode(false);setResetErr("");}} style={{width:"100%",padding:10,background:"transparent",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text3)",fontSize:13,cursor:"pointer"}}>← Zurück</button>
          </> : (
            <div style={{textAlign:"center",padding:"10px 0"}}>
              <div style={{fontSize:48,marginBottom:14}}>📬</div>
              <div style={{fontSize:16,fontWeight:800,color:"var(--text)",marginBottom:8}}>E-Mail gesendet!</div>
              <div style={{fontSize:13,color:"var(--text2)",marginBottom:20,lineHeight:1.6}}>Bitte prüfe dein Postfach und klicke auf den Link.</div>
              <button onClick={()=>{setResetMode(false);setResetSent(false);}} style={{width:"100%",padding:12,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>← Zur Anmeldung</button>
            </div>
          )}
        </div>
      )}
      <div style={{textAlign:"center",fontSize:12,color:"var(--text4)",marginTop:16}}>Noch kein Konto? Wende dich an deinen Trainer.</div>
    </div>
  </div>;
}

// ─── THEME TOGGLE ─────────────────────────────────────────────────────────────
function ThemeToggle({isDark,onSetUserTheme}) {
  return <button
    onClick={()=>onSetUserTheme(isDark?"light":"dark")}
    title={isDark?"Zu Light Mode wechseln":"Zu Dark Mode wechseln"}
    style={{
      padding:"6px 9px",
      background:isDark?"#1f2937":"#e5e7eb",
      border:"2px solid "+(isDark?"#f59e0b":"#374151"),
      borderRadius:20,
      color:isDark?"#f59e0b":"#374151",
      fontSize:17,
      cursor:"pointer",
      lineHeight:1,
      flexShrink:0,
    }}
  >{isDark?"☀️":"🌙"}</button>;
}
function AdminPanel({user,players,attendance,rackets,isSuperAdmin,isDark,onSetUserTheme,userTheme,globalTheme,onSignOut,onPlayerAdded,hideHeader}) {
  const ALL_TABS=[
    {key:"training",     label:"Training",      icon:"📅"},
    {key:"teilnahme",    label:"Teilnahme",     icon:"📊"},
    {key:"uebungen",     label:"Übungen",       icon:"🏋️"},
    {key:"rangliste",    label:"Rangliste",     icon:"🏆"},
    {key:"beobachtungen",label:"Beobachtungen", icon:"🔍"},
    {key:"spielbetrieb", label:"Spielbetrieb",  icon:"⚽"},
    {key:"schlaeger",    label:"Schläger",      icon:"🏓"},
    {key:"geburtstage",  label:"Geburtstage",   icon:"🎂"},
    {key:"verwaltung",   label:"Verwaltung",    icon:"⚙️", superAdminOnly:true},
  ];
  // Nur Super-Admins sehen Verwaltung
  const TABS = ALL_TABS.filter(t=>!t.superAdminOnly || isSuperAdmin);
  const [activeTab,setActiveTab]=useState("training");
  const [selectedPlayer,setSelectedPlayer]=useState(null);
  const [exerciseFilter,setExerciseFilter]=useState("all");
  const [expandedEx,setExpandedEx]=useState(null);
  const [toast,setToast]=useState(null);
  const [saving,setSaving]=useState(false);
  const [groupFilters,setGroupFilters]=useState({Profis:true,Fortgeschrittene:true,Anfänger:true,Trainer:true});
  // Punkt 7: Teilnahme-Drilldown
  const [teilnahmePlayer,setTeilnahmePlayer]=useState(null);
  // Punkt 6: Geburtstags-Popup
  const [birthdayPopupDismissed,setBirthdayPopupDismissed]=useState(false);

  function toggleGroupFilter(g){setGroupFilters(f=>({...f,[g]:!f[g]}));}
  function showToast(msg,emoji="✅"){setToast({msg,emoji});setTimeout(()=>setToast(null),2200);}

  const activePlayers = players.filter(p=>p.status!=="passiv");
  const visiblePlayers = activePlayers
    .filter(p=>{
      const g = p.group||"Anfänger";
      return groupFilters[g] !== false;
    })
    .sort((a,b)=>{
      const fa=(a.firstName||a.name||"").toLowerCase();
      const fb=(b.firstName||b.name||"").toLowerCase();
      if(fa!==fb) return fa.localeCompare(fb,"de");
      return (a.lastName||"").localeCompare(b.lastName||"","de");
    });
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

  return <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:720,margin:"0 auto",paddingBottom:80}}>
    {toast&&<div style={{position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:12,padding:"10px 20px",display:"flex",alignItems:"center",gap:8,fontSize:15,fontWeight:600,zIndex:400,boxShadow:"0 8px 32px #0008",animation:"fadeIn .2s ease"}}><span style={{fontSize:20}}>{toast.emoji}</span>{toast.msg}</div>}

    {/* Punkt 6: Geburtstags-Popup */}
    {showBirthdayPopup&&<Modal onClose={()=>setBirthdayPopupDismissed(true)}>
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:40,marginBottom:8}}>🎂</div>
        <div style={{fontSize:17,fontWeight:800,color:"var(--text)",marginBottom:4}}>Geburtstage seit letztem Training</div>
        <div style={{fontSize:12,color:"var(--text3)"}}>seit {lastTraining?formatDateDE(lastTraining):"heute"}</div>
      </div>
      {recentBirthdays.map(p=>(
        <div key={p.id} style={{background:"var(--bg3)",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24}}>{p.avatar||"🎂"}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:"var(--text)"}}>{p.firstName} {p.lastName}</div>
            <div style={{fontSize:12,color:"#f59e0b"}}>🎂 {formatDateDE(p.birthdate)} — {p.birthdate?new Date().getFullYear()-new Date(p.birthdate).getFullYear():""} Jahre</div>
          </div>
        </div>
      ))}
      <button onClick={()=>setBirthdayPopupDismissed(true)} style={{width:"100%",marginTop:8,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Schließen</button>
    </Modal>}

    {/* Punkt 7: Teilnahme-Drilldown Modal */}
    {teilnahmePlayer&&<Modal onClose={()=>setTeilnahmePlayer(null)}>
      <div style={{fontSize:15,fontWeight:800,color:"var(--text)",marginBottom:14}}>
        📅 {teilnahmePlayer.firstName} {teilnahmePlayer.lastName}
      </div>
      <PlayerTrainingDetail player={teilnahmePlayer} attendance={attendance} showToast={showToast}/>
      <button onClick={()=>setTeilnahmePlayer(null)} style={{width:"100%",marginTop:12,padding:10,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text2)",fontSize:13,cursor:"pointer"}}>Schließen</button>
    </Modal>}

    {/* Header-Titel — wird ausgeblendet wenn RoleSwitchWrapper den Header übernimmt */}
    {!hideHeader&&<div style={{background:"linear-gradient(135deg,var(--bg2),var(--bg))",borderBottom:"1px solid var(--border)",padding:"14px 14px 6px",flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
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
          <ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>
          <button onClick={onSignOut} title="Abmelden" style={{padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text2)",fontSize:16,cursor:"pointer",lineHeight:1}}>⏻</button>
        </div>
      </div>
    </div>}

    {/* Gruppenfilter + Spieler-Chips — IMMER sichtbar, sticky */}
    <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"8px 14px 6px",
      position:"sticky",top:hideHeader?44:0,zIndex:97,flexShrink:0}}>
      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
        {["Profis","Fortgeschrittene","Anfänger","Trainer"].map(g=>{
          const colors={Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6"};
          const c=colors[g]; const on=groupFilters[g];
          return <button key={g} onClick={()=>toggleGroupFilter(g)} style={{
            padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
            border:`2px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:c+"66",transition:"all .15s",
          }}>{g}</button>;
        })}
      </div>
      <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
        {visiblePlayers.map(p=>(
          <button key={p.id} onClick={()=>{setSelectedPlayer(p.id);setActiveTab("uebungen");}} style={{
            flexShrink:0,padding:"3px 9px 3px 5px",borderRadius:20,
            border:`2px solid ${curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"var(--border2)"}`,
            background:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color+"22":"transparent",
            color:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"var(--text2)",
            fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:14}}>{p.avatar||"🏓"}</span>{p.firstName||p.name}
          </button>
        ))}
        {visiblePlayers.length===0&&<span style={{fontSize:11,color:"var(--text4)",padding:"4px 0"}}>Keine Spieler sichtbar</span>}
      </div>
    </div>

    {/* Tabs */}
    <div style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--bg)",position:"sticky",top:hideHeader?44+62:62,zIndex:96,overflowX:"auto"}}>
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
        <div style={{background:"linear-gradient(135deg,var(--bg2),var(--bg))",border:`1px solid ${curPlayer.color}44`,borderRadius:14,padding:14,marginBottom:13}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
            <Avatar avatar={curPlayer.avatar} color={curPlayer.color} size={50}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div>
                  <div style={{fontSize:17,fontWeight:800,color:curPlayer.color}}>{curPlayer.firstName} {curPlayer.lastName}</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{curPlayer.group||"Anfänger"} · {totalStars} Sterne</div>
                </div>
                {currentAward?<AwardBadge award={currentAward} small/>:<span style={{fontSize:11,color:"var(--text3)"}}>Noch keine Urkunde</span>}
              </div>
            </div>
          </div>
          <div style={{marginBottom:7}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text2)",marginBottom:3}}><span>Anfänger (1–10)</span><span>{beginnerStars}/50 ★</span></div>
            <ProgressBar value={beginnerStars} max={50} color={curPlayer.color}/>
          </div>
          <div style={{marginBottom:nexts.length?10:0}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text2)",marginBottom:3}}><span>Fortgeschrittene (11–40)</span><span>{advancedStars}/150 ★</span></div>
            <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
          </div>
          {/* Punkt 11: Alle nächsten Ziele anzeigen */}
          {nexts.length>0&&<div style={{background:"var(--bg)",borderRadius:8,padding:"8px 10px",display:"flex",flexDirection:"column",gap:5}}>
            {nexts.map((a,i)=>(
              <div key={i} style={{fontSize:11,color:"var(--text2)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"var(--text4)"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
                <AwardBadge award={a} small/>
                <span>— noch <b style={{color:"var(--text)"}}>{a.needed} Sterne</b></span>
              </div>
            ))}
          </div>}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {[{key:"all",label:"Alle"},{key:"beginner",label:"Anfänger"},{key:"advanced",label:"Fortgeschrittene"}].map(f=>(
            <button key={f.key} onClick={()=>setExerciseFilter(f.key)} style={{padding:"4px 11px",borderRadius:20,border:`1px solid ${exerciseFilter===f.key?"#10b981":"var(--border2)"}`,background:exerciseFilter===f.key?"#10b98122":"transparent",color:exerciseFilter===f.key?"#10b981":"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{f.label}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:7,paddingBottom:20}}>
          {filteredEx.map(ex=>{
            const stars=curPlayer.stars?.[ex.id]||0;
            const isExp=expandedEx===ex.id;
            const isBeg=ex.id<=10;
            return <div key={ex.id} style={{background:"var(--bg2)",border:`1px solid ${stars>0?"#2d3748":"var(--border)"}`,borderRadius:11,overflow:"hidden"}}>
              <div onClick={()=>setExpandedEx(isExp?null:ex.id)} style={{padding:"11px 13px",display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
                <div style={{width:28,height:28,borderRadius:7,flexShrink:0,marginTop:2,background:isBeg?"#10b98122":"#3b82f622",border:`1px solid ${isBeg?"#10b98144":"#3b82f644"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:isBeg?"#10b981":"#3b82f6"}}>{ex.id}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--text)",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div>
                  <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{ex.description}</div>
                </div>
                <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                  <StarRating stars={stars} readonly/>
                  <span style={{color:"var(--text3)",fontSize:12}}>{isExp?"▲":"▼"}</span>
                </div>
              </div>
              {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:13,background:"var(--bg)"}}>
                <div style={{marginBottom:11,fontSize:12,color:"var(--text2)"}}>⚙️ Sterne vergeben:</div>
                <div style={{marginBottom:13}}><StarRating stars={stars} onRate={v=>setStars(curPlayer.id,ex.id,v)}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {ex.thresholds.map((t,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,background:stars>=i+1?"#f59e0b11":"var(--border)",border:`1px solid ${stars>=i+1?"#f59e0b44":"var(--border2)"}`}}>
                      <span style={{color:stars>=i+1?"#f59e0b":"#6b7280",fontSize:13}}>{"★".repeat(i+1)}{"☆".repeat(4-i)}</span>
                      <span style={{fontSize:13,color:stars>=i+1?"var(--text)":"#9ca3af",flex:1}}>{t}</span>
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
        return <div key={player.id} style={{background:"var(--bg2)",border:`1px solid ${idx===0?"#f59e0b55":"var(--border)"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
          {idx===0&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#f59e0b,#fbbf24)"}}/>}
          <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:12}}>
            <span style={{fontSize:18,minWidth:28,marginTop:4}}>{rankEmoji}</span>
            <Avatar avatar={player.avatar} color={player.color} size={38}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"var(--text)",marginBottom:2}}>{player.firstName} {player.lastName}</div>
              {currentAward&&<div style={{marginBottom:2}}><AwardBadge award={currentAward} small/></div>}
              <div style={{fontSize:11,color:"var(--text3)"}}>{player.group||"Anfänger"}</div>
            </div>
            <div style={{flexShrink:0,textAlign:"center",background:"linear-gradient(135deg,var(--bg3),var(--bg2))",border:`2px solid ${player.color}66`,borderRadius:12,padding:"8px 12px",minWidth:54}}>
              <div style={{fontSize:26,fontWeight:900,color:player.color,lineHeight:1}}>{totalStars}</div>
              <div style={{fontSize:9,color:"var(--text3)",marginTop:1}}>★ Sterne</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:nexts.length?9:0}}>
            <div style={{background:"var(--bg)",borderRadius:8,padding:"7px 9px"}}>
              <div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Anfänger (1–10)</div>
              <div style={{display:"flex",alignItems:"baseline",gap:3}}><span style={{fontSize:17,fontWeight:800,color:player.color}}>{beginnerStars}</span><span style={{fontSize:10,color:"var(--text3)"}}>/ 50 ★</span></div>
              <ProgressBar value={beginnerStars} max={50} color={player.color}/>
            </div>
            <div style={{background:"var(--bg)",borderRadius:8,padding:"7px 9px"}}>
              <div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Fortgeschr. (11–40)</div>
              <div style={{display:"flex",alignItems:"baseline",gap:3}}><span style={{fontSize:17,fontWeight:800,color:"#3b82f6"}}>{advancedStars}</span><span style={{fontSize:10,color:"var(--text3)"}}>/ 150 ★</span></div>
              <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
            </div>
          </div>
          {nexts.length>0&&<div style={{background:"var(--bg)",borderRadius:8,padding:"7px 10px",display:"flex",flexDirection:"column",gap:4}}>
            {nexts.map((a,i)=>(
              <div key={i} style={{fontSize:11,color:"var(--text2)",display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                <span style={{fontSize:10,color:"var(--text4)"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
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
    {activeTab==="beobachtungen"&&<BeobachtungenAdminTab players={visiblePlayers} user={user} showToast={showToast}/>}
    {activeTab==="spielbetrieb"&&<SpielbetrieblTab isSuperAdmin={isSuperAdmin}/>}
    {activeTab==="verwaltung"&&<VerwaltungTab players={players} rackets={rackets} onPlayerAdded={onPlayerAdded} showToast={showToast} isDark={isDark} onSetUserTheme={onSetUserTheme} userTheme={userTheme} globalTheme={globalTheme} user={user}/>}

    <style>{`
      @keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
      *{box-sizing:border-box}
      ::-webkit-scrollbar{width:4px;height:4px}
      ::-webkit-scrollbar-track{background:var(--bg)}
      ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
      input::placeholder{color:var(--text4)!important}
      input[type="text"],input[type="email"],input[type="password"],input[type="date"]{background:var(--input-bg)!important;color:var(--text)!important;border-color:var(--border2)!important}
      select{background:var(--sel-bg)!important;color:var(--text)!important;border:1px solid var(--border2)!important;border-radius:9px;padding:10px 13px;font-size:14px;width:100%;outline:none}
      table{background:var(--bg2)}
      table td,table th{color:var(--text)}
      tbody tr:hover{background:var(--bg3)!important}
    `}</style>
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
  const isTuesday = selDate ? new Date(selDate).getDay()===2 : false;
  const relevantPlayers = players.filter(p=>{
    if (p.group==="Trainer") {
      // Trainer nur an ihren Trainingstagen zeigen
      const td = p.trainingDays||"Di";
      if (isFriday && td==="Di") return false;  // Fr-Training aber nur Di-Trainer
      if (isTuesday && td==="Fr") return false; // Di-Training aber nur Fr-Trainer
      return true;
    }
    if (isFriday && p.group!=="Profis") return false;
    if (groupFilters && !groupFilters[p.group||"Anfänger"]) return false;
    if (p.trainingStart && selDate && p.trainingStart > selDate) return false;
    return true;
  });
  const groupOrder = ["Profis","Fortgeschrittene","Anfänger","Trainer"];

  // Punkt 9: Spaltenköpfe mit Kreisen
  const COL_HEADERS = [
    {key:"a", label:"✓", color:"#10b981", title:"Anwesend"},
    {key:"e", label:"E", color:"#f59e0b", title:"Entschuldigt"},
    {key:"u", label:"U", color:"#ef4444", title:"Unentschuldigt"},
  ];

  return <div style={{padding:13}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>📅 Training erfassen</div>

    {/* Date selector */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:14}}>
      <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:6}}>Trainingstag auswählen</label>
      <select value={selDate} onChange={e=>setSelDate(e.target.value)}>
        {allDays.map(d=>{
          const dow=new Date(d).getDay();
          const label=`${formatDayDE(d)}, ${formatDateDE(d)}${dow===5?" (Fr – nur Profis)":""}`;
          return <option key={d} value={d}>{label}</option>;
        })}
      </select>
    </div>

    {sessionData&&<>
      {/* Training stattgefunden? */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:12}}>Training stattgefunden?</div>
        <div style={{display:"flex",gap:8,marginBottom:sessionData.took_place?0:12}}>
          {[{v:true,l:"✅ Ja"},{v:false,l:"❌ Nein"}].map(opt=>(
            <button key={String(opt.v)} onClick={()=>setSessionData(p=>({...p,took_place:opt.v}))} style={{
              flex:1,padding:"9px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",
              border:`2px solid ${sessionData.took_place===opt.v?"#10b981":"var(--border2)"}`,
              background:sessionData.took_place===opt.v?"#10b98122":"var(--border)",
              color:sessionData.took_place===opt.v?"#10b981":"#6b7280"}}>{opt.l}</button>
          ))}
        </div>
        {/* Punkt 5: Alphabetisch sortierte Dropdown-Liste */}
        {!sessionData.took_place&&<div style={{marginTop:12}}>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:6}}>Grund</label>
          <select value={sessionData.reason||""} onChange={e=>setSessionData(p=>({...p,reason:e.target.value}))}>
            <option value="">Bitte wählen…</option>
            {ABSENCE_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
        </div>}
      </div>

      {/* Anwesenheit */}
      {sessionData.took_place&&<div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>Anwesenheit</div>
          <button onClick={()=>setAll("a")} style={{padding:"4px 10px",borderRadius:7,background:"#10b98122",border:"1px solid #10b98144",color:"#10b981",fontSize:11,fontWeight:600,cursor:"pointer"}}>Alle ✓ anwesend</button>
        </div>

        {/* Punkt 9: Spaltenköpfe als Kreise */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 52px 52px 52px",gap:6,marginBottom:8,padding:"0 4px"}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:700}}>Name</div>
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
            <div style={{fontSize:11,fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,paddingLeft:4}}>{group}</div>
            {groupPlayers.map(p=>{
              const val=sessionData.attendances?.[p.id]||"a";
              return <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr 44px 44px 44px",gap:4,marginBottom:5,alignItems:"center",background:"var(--bg)",borderRadius:8,padding:"7px 8px"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0,overflow:"hidden"}}>
                  <span style={{fontSize:15,flexShrink:0}}>{p.avatar||"🏓"}</span>
                  <span style={{fontSize:12,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.firstName} {p.lastName}</span>
                </div>
                {COL_HEADERS.map(opt=>(
                  <div key={opt.key} style={{display:"flex",justifyContent:"center"}}>
                    <button onClick={()=>setSessionData(prev=>({...prev,attendances:{...prev.attendances,[p.id]:opt.key}}))} style={{
                      width:34,height:34,borderRadius:"50%",border:`2px solid ${val===opt.key?opt.color:opt.color+"33"}`,cursor:"pointer",
                      fontSize:13,fontWeight:800,
                      background:val===opt.key?opt.color+"33":"transparent",
                      color:val===opt.key?opt.color:"var(--text4)",
                      transition:"all .15s",flexShrink:0,
                    }}>{opt.label}</button>
                  </div>
                ))}
              </div>;
            })}
          </div>;
        })}
      </div>}

      <button onClick={save} disabled={loading} style={{width:"100%",padding:12,background:loading?"var(--border)":"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:loading?"#6b7280":"#fff",fontSize:14,fontWeight:700,cursor:loading?"not-allowed":"pointer"}}>
        {loading?"Wird gespeichert…":"💾 Speichern"}
      </button>
    </>}
  </div>;
}

// ─── TEILNAHME TAB ────────────────────────────────────────────────────────────
function TeilnahmeTab({players,attendance,onPlayerClick}) {
  const allActive = players.filter(p=>p.status!=="passiv");

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
    const days = getTrainingDaysForGroup(group, player?.trainingDays);
    // Heute als String YYYY-MM-DD (kein Timezone-Problem)
    const todayStr = new Date().toLocaleDateString("sv"); // sv-locale gibt YYYY-MM-DD

    // Individuellen Zeitraum berücksichtigen, fallback auf globalen
    const pStart = player.trainingStart || trainingRange.start || null;
    const pEnd   = player.trainingEnd   || trainingRange.end   || null;

    // String-Vergleich statt Date-Objekte → kein Timezone-Problem
    const pastDays = days.filter(d=>{
      if (d > todayStr) return false;
      if (pStart && d < pStart) return false;
      if (pEnd   && d > pEnd)   return false;
      return true;
    });

    if (!pastDays.length) return {pct:0,present:0,total:0,excused:0,unexcused:0};

    let present=0, excused=0, unexcused=0, total=0;

    for (const d of pastDays) {
      const session = attendance[d];
      if (session && session.took_place === false) continue;
      if (!session) continue;

      total++;
      const val = session.attendances?.[player.id];
      if (val === "e") excused++;
      else if (val === "u") unexcused++;
      else present++;
    }

    const pct = total > 0 ? Math.round((present / total) * 100) : 0;
    return {pct, present, total, excused, unexcused};
  }

  const ranked = [...allActive].map(p=>({...p,...getStats(p)})).sort((a,b)=>b.pct-a.pct);

  return <div style={{padding:13}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📊 Trainingsbeteiligung 2026</div>
    {trainingRange.start&&trainingRange.end&&(
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:14}}>
        Zeitraum: {formatDateDE(trainingRange.start)} – {formatDateDE(trainingRange.end)}
      </div>
    )}
    {ranked.map((player,idx)=>{
      const medal = player.pct>90?"🥇":player.pct>80?"🥈":player.pct>70?"🥉":null;
      return <div key={player.id} style={{background:"var(--bg2)",border:`1px solid ${idx===0?"#f59e0b44":"var(--border)"}`,borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
        <Avatar avatar={player.avatar} color={player.color} size={36}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
            <span
              onClick={()=>onPlayerClick&&onPlayerClick(player)}
              style={{fontSize:14,fontWeight:800,color:"#10b981",cursor:"pointer",textDecoration:"underline dotted"}}
            >{player.firstName} {player.lastName}</span>
            {medal&&<span style={{fontSize:16}}>{medal}</span>}
          </div>
          <div style={{fontSize:10,color:"var(--text3)",marginBottom:5}}>{player.group||"Anfänger"}</div>
          <div style={{background:"var(--bg3)",borderRadius:6,height:8,overflow:"hidden",marginBottom:4}}>
            <div style={{width:`${player.pct}%`,height:"100%",background:player.pct>90?"#ffd700":player.pct>80?"#b8b8b8":player.pct>70?"#cd7f32":"#10b981",borderRadius:6,transition:"width .5s"}}/>
          </div>
          <div style={{display:"flex",gap:10,fontSize:10,color:"var(--text3)",flexWrap:"wrap"}}>
            <span>✓ {player.present} anwesend</span>
            <span>{player.excused} entsch.</span>
            <span>{player.unexcused} unentsch.</span>
            <span>Gesamt: {player.total}</span>
          </div>
        </div>
        <div style={{flexShrink:0,textAlign:"center",background:"var(--bg)",borderRadius:10,padding:"6px 10px",border:`1px solid ${player.color}44`,minWidth:52}}>
          <div style={{fontSize:20,fontWeight:900,color:player.pct>90?"#ffd700":player.pct>80?"#b8b8b8":player.pct>70?"#cd7f32":"#10b981",lineHeight:1}}>{player.pct}%</div>
          <div style={{fontSize:9,color:"var(--text3)",marginTop:1}}>Beteiligung</div>
        </div>
      </div>;
    })}
  </div>;
}

// ─── VERWALTUNG TAB ───────────────────────────────────────────────────────────
function VerwaltungTab({players,rackets,onPlayerAdded,showToast,isDark,onSetUserTheme,userTheme,globalTheme,user}) {
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
  const [trainingRange,setTrainingRange]=useState({start:"",end:""});
  const [rangeSaving,setRangeSaving]=useState(false);
  const [localGlobalTheme,setLocalGlobalTheme]=useState(null);
  const effectiveGlobalTheme = localGlobalTheme || globalTheme || "dark";
  const [joinImporting,setJoinImporting]=useState(false);
  const [joinNotFound,setJoinNotFound]=useState([]);

  function parseDateStr(raw) {
    if (!raw && raw!==0) return "";
    const s=String(raw).trim();
    if (/^\d{5}$/.test(s)){
      const d=new Date(Math.round((Number(s)-25569)*86400*1000));
      if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    }
    if (s.includes(".")){
      const pts=s.split(".");
      if(pts.length>=3){
        let [d,m,y]=[pts[0].trim(),pts[1].trim(),pts[2].trim()];
        if(y.length===2) y=(parseInt(y)>30?"19":"20")+y;
        if(d&&m&&y.length===4) return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
      }
    }
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return "";
  }

  async function handleJoinImport(e) {
    const file=e.target.files?.[0]; if(!file) return;
    setJoinImporting(true); setJoinNotFound([]);
    try {
      const XLSX=await new Promise((res,rej)=>{
        if(window.XLSX){res(window.XLSX);return;}
        const sc=document.createElement("script");
        sc.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        sc.onload=()=>res(window.XLSX); sc.onerror=()=>rej(new Error("SheetJS nicht geladen"));
        document.head.appendChild(sc);
      });
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:"array",cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{raw:true});
      let count=0,notFound=[];
      for(const row of rows){
        const fn=String(row["Vorname"]||row["vorname"]||"").trim();
        const ln=String(row["Nachname"]||row["nachname"]||"").trim();
        const rawDate=row["Datum Vereinsbeitritt"]||row["Vereinsbeitritt"]||row["Beitritt"]||"";
        if(!fn) continue;
        const p=players.find(pl=>
          (pl.firstName||"").toLowerCase()===fn.toLowerCase()&&
          (pl.lastName||"").toLowerCase()===ln.toLowerCase()
        );
        if(!p){notFound.push(`${fn} ${ln}`);continue;}
        const dateStr=parseDateStr(rawDate);
        if(!dateStr){notFound.push(`${fn} ${ln} (Datum: ${rawDate})`);continue;}
        await updateDoc(doc(db,"players",p.id),{joinDate:dateStr}).catch(()=>{});
        count++;
      }
      if(notFound.length) setJoinNotFound(notFound);
      showToast(count>0?`${count} Beitrittsdaten importiert`:"Keine importiert","📅");
    } catch(err){showToast("Fehler: "+err.message,"❌");}
    setJoinImporting(false); e.target.value="";
  }

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
  const groupOrder=["Profis","Fortgeschrittene","Anfänger","Trainer"];

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
        joinDate:      editPlayer.joinDate||"",
        leaveDate:     editPlayer.leaveDate||"",
        roles:         editPlayer.roles||{},
        trainingDays:  editPlayer.trainingDays||"Di",
        racketType:    editPlayer.racketType||"",
        racketNr:      editPlayer.racketNr||"",
        racketStart:   editPlayer.racketStart||"",
        racketEnd:     editPlayer.racketEnd||"",
        tournaments:   editPlayer.tournaments||[],
      });
      // Award dates — alle awardDate_* Felder speichern
      const awardKeys = Object.keys(editPlayer).filter(k=>k.startsWith("awardDate_")||k.startsWith("attendBronzeDate")||k.startsWith("attendSilverDate")||k.startsWith("attendGoldDate"));
      if (awardKeys.length) {
        const awardUpdates={};
        awardKeys.forEach(k=>{ awardUpdates[k]=editPlayer[k]||""; });
        await updateDoc(doc(db,"players",editPlayer.id),awardUpdates).catch(()=>{});
      }
      // Schläger-Status synchronisieren
      const oldPlayer = editPlayer._originalRacketNr; // wird unten gesetzt
      const newNr = editPlayer.racketType==="TTC" ? String(editPlayer.racketNr||"") : "";
      const prevNr = editPlayer._originalRacketNr || "";

      // Alten Schläger ggf. freigeben
      if (prevNr && prevNr !== newNr) {
        await setDoc(doc(db,"rackets",prevNr),{status:"frei",vergebenAn:""},{ merge:true }).catch(()=>{});
      }
      // Neuen Schläger setzen
      if (newNr) {
        if (editPlayer.racketEnd) {
          await setDoc(doc(db,"rackets",newNr),{status:"frei",vergebenAn:""},{ merge:true }).catch(()=>{});
        } else if (editPlayer.racketStart) {
          await setDoc(doc(db,"rackets",newNr),{
            status:"vergeben",
            vergebenAn:`${editPlayer.firstName} ${editPlayer.lastName}`,
          },{ merge:true }).catch(()=>{});
        }
      }
      showToast("Gespeichert","💾");
      const savedId = editPlayer.id;
      setEditPlayer(null);
      // Kurz warten dann zu gespeichertem Spieler scrollen
      setTimeout(()=>{
        const el=document.querySelector(`[data-playerid="${savedId}"]`);
        if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
      },200);
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

    {/* Hinweis für Trainer/Admins mit group:"Trainer" ohne Spieler-Rolle */}
    {players.filter(p=>p.group==="Trainer"&&!p.roles?.player).map(p=>(
      <div key={p.id} style={{background:"#3b82f622",border:"2px solid #3b82f6",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:16}}>ℹ️</span>
        <div style={{flex:1,fontSize:12,color:"#93c5fd"}}>
          <b>{p.firstName} {p.lastName}</b> hat Gruppe „Trainer" aber noch keine Funktionen gesetzt. Bitte Funktionen zuweisen damit die Person in der richtigen Ansicht erscheint.
        </div>
        <button onClick={()=>setEditPlayer({...p, _originalRacketNr: p.racketType==="TTC"?String(p.racketNr||""):""})} style={{padding:"5px 10px",background:"#3b82f6",border:"none",borderRadius:7,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>
          ✏️ Bearbeiten
        </button>
      </div>
    ))}    {deleteConfirmFor&&<Modal onClose={()=>setDeleteConfirmFor(null)}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>🗑️</div>
        <div style={{fontSize:16,fontWeight:800,color:"var(--text)",marginBottom:8}}>Wirklich löschen?</div>
        <div style={{fontSize:13,color:"var(--text2)",marginBottom:20}}><b style={{color:"var(--text)"}}>{deleteConfirmFor.firstName} {deleteConfirmFor.lastName}</b> und alle Daten werden dauerhaft gelöscht.</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setDeleteConfirmFor(null)} style={{flex:1,padding:10,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text2)",fontSize:14,fontWeight:600,cursor:"pointer"}}>Abbrechen</button>
          <button onClick={()=>doDelete(deleteConfirmFor.id)} style={{flex:1,padding:10,background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Löschen</button>
        </div>
      </div>
    </Modal>}

    {/* Login-Upgrade Modal */}
    {loginUpgradeFor&&<Modal onClose={()=>{setLoginUpgradeFor(null);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}}>
      <div style={{fontSize:16,fontWeight:800,color:"var(--text)",marginBottom:6}}>📧 Login einrichten</div>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:16,lineHeight:1.5}}>
        Für <b style={{color:"var(--text)"}}>{loginUpgradeFor.firstName} {loginUpgradeFor.lastName}</b> wird ein Login-Account erstellt. Alle bisherigen Ergebnisse bleiben erhalten.
      </div>
      {upgradeErr&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{upgradeErr}</div>}
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>E-Mail</label>
        <input type="email" value={upgradeEmail} onChange={e=>setUpgradeEmail(e.target.value)}
          placeholder="spieler@email.de"
          style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Passwort (mind. 6 Zeichen)</label>
        <input type="password" value={upgradePass} onChange={e=>setUpgradePass(e.target.value)}
          placeholder="••••••••"
          style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={doUpgradeLogin} disabled={upgrading||!upgradeEmail.trim()||!upgradePass.trim()} style={{
          flex:1,padding:11,
          background:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"var(--border)":"linear-gradient(135deg,#10b981,#059669)",
          border:"none",borderRadius:9,
          color:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"#6b7280":"#fff",
          fontSize:14,fontWeight:700,cursor:(upgrading||!upgradeEmail.trim()||!upgradePass.trim())?"not-allowed":"pointer",
        }}>{upgrading?"Wird eingerichtet…":"📧 Login erstellen"}</button>
        <button onClick={()=>{setLoginUpgradeFor(null);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}} style={{
          flex:1,padding:11,background:"var(--bg3)",border:"1px solid var(--border2)",
          borderRadius:9,color:"var(--text2)",fontSize:13,fontWeight:600,cursor:"pointer",
        }}>Abbrechen</button>
      </div>
    </Modal>}

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:17,fontWeight:800}}>⚙️ Spieler- & Trainerverwaltung</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <label style={{padding:"6px 12px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:joinImporting?"#6b7280":"var(--text2)",fontSize:12,cursor:joinImporting?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:5}}>
          {joinImporting?"⏳":"📥"} Beitritte importieren
          <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleJoinImport} disabled={joinImporting}/>
        </label>
        <button onClick={()=>setShowAdd(!showAdd)} style={{padding:"7px 14px",background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          {showAdd?"✕ Abbrechen":"+ Neu anlegen"}
        </button>
      </div>
    </div>

    {/* Import-Fehler */}
    {joinNotFound.length>0&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:"#ef4444",marginBottom:6}}>⚠️ {joinNotFound.length} Einträge nicht importiert:</div>
      {joinNotFound.map((n,i)=><div key={i} style={{fontSize:11,color:"#fca5a5",marginBottom:2}}>• {n}</div>)}
      <button onClick={()=>setJoinNotFound([])} style={{marginTop:6,padding:"3px 8px",background:"transparent",border:"1px solid #ef444466",borderRadius:5,color:"#ef4444",fontSize:11,cursor:"pointer"}}>Schließen</button>
    </div>}

    {/* Hinweis wenn eingeloggter Admin kein Spielerprofil hat */}
    {(()=>{
      if (!user) return null;
      const myP = players.find(p=>p.email?.toLowerCase()===user.email?.toLowerCase());
      if (myP) return null; // Profil gefunden — alles ok

      // Gibt es einen Eintrag mit ähnlichem Namen aber falscher E-Mail?
      const trainerEntry = players.find(p=>p.group==="Trainer"&&!p.email);

      return <div style={{background:"#f59e0b22",border:"2px solid #f59e0b",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:12,fontWeight:700,color:"#f59e0b",marginBottom:4}}>⚠️ Kein Spielerprofil für {user.email}</div>
        <div style={{fontSize:11,color:"var(--text2)",marginBottom:8}}>
          Dein Login-Konto hat kein verknüpftes Profil. Du kannst hier direkt ein Profil erstellen — ohne neuen Auth-Account.
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={async()=>{
            const id = "admin_"+Date.now();
            await setDoc(doc(db,"players",id),{
              id, email:user.email,
              firstName:"Thomas", lastName:"Meilinger",
              group:"Trainer", status:"aktiv",
              avatar:"🏓", color:"#10b981",
              noLogin:false,
              roles:{player:true, trainer:true, admin:true},
            }).catch(e=>showToast("Fehler: "+e.message,"❌"));
            showToast("Profil angelegt! Seite neu laden.","✅");
            setTimeout(()=>window.location.reload(),1500);
          }} style={{padding:"7px 14px",background:"#f59e0b",border:"none",borderRadius:8,color:"#000",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            ✅ Neues Profil anlegen
          </button>
          {trainerEntry&&<button onClick={async()=>{
            await updateDoc(doc(db,"players",trainerEntry.id),{
              email:user.email,
              roles:{player:true,trainer:true,admin:true},
            }).catch(e=>showToast("Fehler: "+e.message,"❌"));
            showToast("E-Mail verknüpft! Seite neu laden.","✅");
            setTimeout(()=>window.location.reload(),1500);
          }} style={{padding:"7px 14px",background:"#3b82f6",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
            🔗 Mit {trainerEntry.firstName} {trainerEntry.lastName} verknüpfen
          </button>}
        </div>
      </div>;
    })()}

    {/* Hinweis für Trainer-Gruppe ohne Funktionen */}
    {players.filter(p=>p.group==="Trainer"&&!p.roles?.trainer&&!p.roles?.admin&&!p.roles?.player).map(p=>(
      <div key={p.id} style={{background:"#3b82f622",border:"2px solid #3b82f6",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:16}}>ℹ️</span>
        <div style={{flex:1,fontSize:12,color:"#93c5fd"}}><b>{p.firstName} {p.lastName}</b> — Gruppe „Trainer" aber keine Funktionen gesetzt.</div>
        <button onClick={()=>setEditPlayer({...p,_originalRacketNr:p.racketType==="TTC"?String(p.racketNr||""):""})} style={{padding:"5px 10px",background:"#3b82f6",border:"none",borderRadius:7,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>✏️ Bearbeiten</button>
      </div>
    ))}

    {/* Punkt 4: Trainingszeitraum */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:14,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:12}}>📅 Trainingszeitraum</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Start Training</label>
          <input type="date" value={trainingRange.start||""} min="2026-01-01" max="2026-12-31"
            onChange={e=>setTrainingRange(p=>({...p,start:e.target.value}))}
            style={{width:"100%",padding:"9px 11px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Ende Training</label>
          <input type="date" value={trainingRange.end||""} min="2026-01-01" max="2026-12-31"
            onChange={e=>setTrainingRange(p=>({...p,end:e.target.value}))}
            style={{width:"100%",padding:"9px 11px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>
      </div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:10,lineHeight:1.5}}>
        Die Teilnahme-Auswertung bezieht sich nur auf Trainingstage innerhalb dieses Zeitraums. Beide Daten sind inklusiv.
      </div>
      <button onClick={saveTrainingRange} disabled={rangeSaving} style={{width:"100%",padding:9,background:rangeSaving?"var(--border)":"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",borderRadius:9,color:rangeSaving?"#6b7280":"#fff",fontSize:13,fontWeight:700,cursor:rangeSaving?"not-allowed":"pointer"}}>
        {rangeSaving?"Wird gespeichert…":"💾 Zeitraum speichern"}
      </button>
    </div>

    {/* App-Design */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:14,marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:6}}>🎨 App-Design</div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>
        Grundeinstellung gilt für alle. Persönliche Einstellung hat Vorrang.
      </div>

      <div style={{fontSize:11,color:"var(--text2)",marginBottom:6,fontWeight:700}}>Grundeinstellung für alle Nutzer:</div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[{mode:"dark",icon:"🌙",label:"Dark Mode"},{mode:"light",icon:"☀️",label:"Light Mode"}].map(opt=>{
          const isActive = effectiveGlobalTheme===opt.mode;
          return <button key={opt.mode} onClick={async()=>{
            setLocalGlobalTheme(opt.mode); // sofort anzeigen
            await setDoc(doc(db,"config","theme"),{mode:opt.mode}).catch(()=>{});
            showToast(`Grundeinstellung: ${opt.label} aktiv`,"🎨");
          }} style={{
            flex:1,padding:"10px 8px",borderRadius:9,fontWeight:700,cursor:"pointer",fontSize:13,
            border:`2px solid ${isActive?"#10b981":"var(--border2)"}`,
            background:isActive?"#10b98122":"var(--bg3)",
            color:isActive?"#10b981":"var(--text2)",
          }}>{opt.icon} {opt.label}{isActive?" ✓":""}</button>;
        })}
      </div>

      <div style={{fontSize:11,color:"var(--text2)",marginBottom:6,fontWeight:700}}>Deine persönliche Einstellung (hat Vorrang):</div>
      <div style={{display:"flex",gap:8}}>
        {[{mode:"dark",icon:"🌙",label:"Dark"},{mode:"light",icon:"☀️",label:"Light"}].map(opt=>{
          const isActive = userTheme===opt.mode;
          return <button key={opt.mode} onClick={()=>onSetUserTheme&&onSetUserTheme(opt.mode)} style={{
            flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
            border:`2px solid ${isActive?"#10b981":"var(--border2)"}`,
            background:isActive?"#10b98122":"var(--bg3)",
            color:isActive?"#10b981":"var(--text2)",
          }}>{opt.icon} {opt.label}{isActive?" ✓":""}</button>;
        })}
      </div>
      {userTheme&&<div style={{marginTop:8,fontSize:10,color:"var(--text4)"}}>
        Persönliche Einstellung aktiv. Der Theme-Button oben im Menü schaltet um.
      </div>}
    </div>

    {/* Add form */}
    {showAdd&&<div style={{background:"var(--bg2)",border:"1px solid #10b98144",borderRadius:14,padding:16,marginBottom:16}}>
      <div style={{fontSize:14,fontWeight:700,color:"#10b981",marginBottom:14}}>Neue Person anlegen</div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:"#10b98122",border:"2px solid #10b98166",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>{newData.avatar}</div>
        <button onClick={()=>setAvatarPickerFor("new")} style={{padding:"7px 12px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text2)",fontSize:12,fontWeight:600,cursor:"pointer"}}>Avatar ✏️</button>
      </div>
      {[
        {l:"Vorname *",k:"firstName",t:"text",p:"Max"},
        {l:"Nachname",k:"lastName",t:"text",p:"Mustermann"},
      ].map(f=><div key={f.k} style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>{f.l}</label>
        <input type={f.t} value={newData[f.k]} onChange={e=>setNewData(p=>({...p,[f.k]:e.target.value}))} placeholder={f.p}
          style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
      </div>)}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Geschlecht</label>
          <select value={newData.gender} onChange={e=>setNewData(p=>({...p,gender:e.target.value}))}>
            <option value="m">Männlich</option><option value="w">Weiblich</option><option value="d">Divers</option>
          </select>
        </div>
        <div>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Gruppe</label>
          <select value={newData.group} onChange={e=>setNewData(p=>({...p,group:e.target.value}))}>
            {GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Status</label>
        <select value={newData.status} onChange={e=>setNewData(p=>({...p,status:e.target.value}))}>
          <option value="aktiv">Aktiv</option><option value="passiv">Passiv</option>
        </select>
      </div>
      <div style={{marginBottom:10}}>
        <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:6}}>Login-Typ</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button onClick={()=>setNewData(p=>({...p,noLogin:false}))} style={{padding:"8px",borderRadius:9,fontSize:11,fontWeight:700,cursor:"pointer",border:`2px solid ${!newData.noLogin?"#10b981":"var(--border2)"}`,background:!newData.noLogin?"#10b98122":"var(--border)",color:!newData.noLogin?"#10b981":"#6b7280"}}>📧 Mit Login</button>
          <button onClick={()=>setNewData(p=>({...p,noLogin:true}))} style={{padding:"8px",borderRadius:9,fontSize:11,fontWeight:700,cursor:"pointer",border:`2px solid ${newData.noLogin?"#f59e0b":"var(--border2)"}`,background:newData.noLogin?"#f59e0b22":"var(--border)",color:newData.noLogin?"#f59e0b":"#6b7280"}}>👤 Ohne Login</button>
        </div>
      </div>
      {!newData.noLogin&&<>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>E-Mail</label>
          <input type="email" value={newData.email} onChange={e=>setNewData(p=>({...p,email:e.target.value}))} placeholder="spieler@email.de"
            style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Passwort (mind. 6 Zeichen)</label>
          <input type="password" value={newData.pass} onChange={e=>setNewData(p=>({...p,pass:e.target.value}))} placeholder="••••••••"
            style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
        </div>
      </>}
      <button onClick={addPlayer} disabled={saving||!newData.firstName.trim()} style={{width:"100%",padding:11,background:(saving||!newData.firstName.trim())?"var(--border)":"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:(saving||!newData.firstName.trim())?"#6b7280":"#fff",fontSize:14,fontWeight:700,cursor:(saving||!newData.firstName.trim())?"not-allowed":"pointer"}}>
        {saving?"Wird erstellt…":"Person anlegen"}
      </button>
    </div>}

    {/* Players by group */}
    {groupOrder.map(group=>{
      const groupPlayers=[...players.filter(p=>(p.group||"Anfänger")===group)]
        .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||""));
      if (!groupPlayers.length) return null;
      return <div key={group} style={{marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8,paddingLeft:2}}>{group} ({groupPlayers.length})</div>
        {groupPlayers.map(p=>(
          editPlayer?.id===p.id ? (
            <div key={p.id} style={{background:"var(--bg2)",border:"1px solid #10b98144",borderRadius:12,padding:14,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setAvatarPickerFor("edit")}>
                  <Avatar avatar={editPlayer.avatar} color={p.color} size={44}/>
                  <span style={{position:"absolute",bottom:-2,right:-2,fontSize:12,background:"var(--bg3)",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border2)"}}>✏️</span>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{editPlayer.firstName} {editPlayer.lastName} bearbeiten</div>
              </div>
              {[{l:"Vorname",k:"firstName"},{l:"Nachname",k:"lastName"},{l:"E-Mail",k:"email"}].map(f=>(
                <div key={f.k} style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>{f.l}</label>
                  <input type="text" value={editPlayer[f.k]||""} onChange={e=>setEditPlayer(prev=>({...prev,[f.k]:e.target.value}))}
                    style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Geschlecht</label>
                  <select value={editPlayer.gender||"m"} onChange={e=>setEditPlayer(prev=>({...prev,gender:e.target.value}))}>
                    <option value="m">Männlich</option><option value="w">Weiblich</option><option value="d">Divers</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Gruppe</label>
                  <select value={editPlayer.group||"Anfänger"} onChange={e=>setEditPlayer(prev=>({...prev,group:e.target.value}))}>
                    {GROUPS.map(g=><option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Status</label>
                <select value={editPlayer.status||"aktiv"} onChange={e=>setEditPlayer(prev=>({...prev,status:e.target.value}))}>
                  <option value="aktiv">Aktiv</option><option value="passiv">Passiv</option>
                </select>
              </div>

              {/* Vereinsbeitritt / Vereinsaustritt */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>📅 Vereinsbeitritt</label>
                  <input type="date" value={editPlayer.joinDate||""} onChange={e=>setEditPlayer(prev=>({...prev,joinDate:e.target.value}))}
                    style={{width:"100%",padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>📅 Vereinsaustritt</label>
                  <input type="date" value={editPlayer.leaveDate||""} onChange={e=>setEditPlayer(prev=>({...prev,leaveDate:e.target.value}))}
                    style={{width:"100%",padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                </div>
              </div>
              {/* Geburtstag */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Geburtstag</label>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input type="date" value={editPlayer.birthdate||""} onChange={e=>setEditPlayer(prev=>({...prev,birthdate:e.target.value}))}
                    style={{flex:1,padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                  {editPlayer.birthdate&&<button onClick={()=>setEditPlayer(prev=>({...prev,birthdate:""}))} style={{padding:"9px 10px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text3)",fontSize:12,cursor:"pointer",flexShrink:0}}>✕</button>}
                </div>
              </div>
              {/* Trainingstage (nur für Trainer-Gruppe) */}
              {editPlayer.group==="Trainer"&&<div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>🗓️ Trainingstage</label>
                <select value={editPlayer.trainingDays||"Di"} onChange={e=>setEditPlayer(prev=>({...prev,trainingDays:e.target.value}))}>
                  <option value="Di">Nur Dienstag</option>
                  <option value="Fr">Nur Freitag</option>
                  <option value="Di+Fr">Dienstag + Freitag</option>
                </select>
              </div>}

              {/* Trainingsheft erhalten */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Trainingsheft erhalten</label>
                <select value={editPlayer.trainingsheft||"ja"} onChange={e=>setEditPlayer(prev=>({...prev,trainingsheft:e.target.value}))}>
                  <option value="ja">Ja</option>
                  <option value="nein">Nein</option>
                </select>
              </div>

              {/* Funktionen */}
              <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>🎭 Funktionen</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[
                    {key:"player",  icon:"🏓", label:"Spieler"},
                    {key:"trainer", icon:"🛡️", label:"Trainer"},
                    {key:"admin",   icon:"⚙️", label:"Admin"},
                  ].map(role=>{
                    const isOn=(editPlayer.roles||{})[role.key]===true;
                    return <button key={role.key} onClick={()=>setEditPlayer(prev=>({
                      ...prev,
                      roles:{...(prev.roles||{}), [role.key]:!isOn}
                    }))} style={{
                      padding:"7px 12px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                      border:`2px solid ${isOn?"#10b981":"var(--border2)"}`,
                      background:isOn?"#10b98122":"transparent",
                      color:isOn?"#10b981":"var(--text3)",
                      display:"flex",alignItems:"center",gap:5,
                    }}>{role.icon} {role.label} {isOn?"✓":""}</button>;
                  })}
                </div>
                <div style={{fontSize:10,color:"var(--text4)",marginTop:6,lineHeight:1.4}}>
                  Trainer/Admin: Person kann zwischen Ansichten wechseln. Admin: Verwaltung sichtbar.
                </div>
              </div>
              {/* Schläger */}
              <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>🏓 Schläger</div>
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Typ</label>
                  <select value={editPlayer.racketType||""} onChange={e=>setEditPlayer(prev=>({...prev,racketType:e.target.value,racketNr:""}))}>
                    <option value="">— kein —</option>
                    <option value="eigener">Eigener</option>
                    <option value="TTC">TTC-Schläger</option>
                  </select>
                </div>
                {editPlayer.racketType==="TTC"&&<>
                  <div style={{marginBottom:8}}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Schläger-Nr.</label>
                    <select value={editPlayer.racketNr||""} onChange={e=>setEditPlayer(prev=>({...prev,racketNr:e.target.value}))}>
                      <option value="">— wählen —</option>
                      {(rackets||[]).filter(r=>{const isCurrentRacket=String(r.nr)===String(editPlayer.racketNr);const isFree=!r.vergebenAn&&(r.status==="frei"||r.status==="offen"||!r.status);return isFree||isCurrentRacket;}).sort((a,b)=>Number(a.nr)-Number(b.nr)).map(r=>(
                        <option key={r.nr} value={r.nr}>{String(r.nr).padStart(3,"0")} {r.status==="frei"?"(frei)":"(aktuell)"}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Start (Vergabe)</label>
                      <input type="date" value={editPlayer.racketStart||""} onChange={e=>setEditPlayer(prev=>({...prev,racketStart:e.target.value}))}
                        style={{width:"100%",padding:"7px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                    </div>
                    <div>
                      <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Ende (Rückgabe)</label>
                      <input type="date" value={editPlayer.racketEnd||""} onChange={e=>setEditPlayer(prev=>({...prev,racketEnd:e.target.value}))}
                        style={{width:"100%",padding:"7px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                    </div>
                  </div>
                </>}
              </div>
              {/* Individueller Trainingszeitraum */}
              <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>📅 Individueller Trainingszeitraum</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Start Training</label>
                    <input type="date" value={editPlayer.trainingStart||""} min="2026-01-01" max="2026-12-31"
                      onChange={e=>setEditPlayer(prev=>({...prev,trainingStart:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Ende Training</label>
                    <input type="date" value={editPlayer.trainingEnd||""} min="2026-01-01" max="2026-12-31"
                      onChange={e=>setEditPlayer(prev=>({...prev,trainingEnd:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                  </div>
                </div>
                <div style={{fontSize:10,color:"var(--text4)",marginTop:6}}>Hat Vorrang vor dem globalen Trainingszeitraum</div>
              </div>

              {/* Urkunden-Vergabedaten */}
              {(()=>{
                const {beginnerStars,totalStars}=getAward(editPlayer);
                const earnedBeg=BEGINNER_AWARDS.filter(a=>beginnerStars>=a.stars);
                const earnedAdv=ADVANCED_AWARDS.filter(a=>totalStars>=a.stars);
                const allEarned=[...earnedBeg,...earnedAdv];
                if(!allEarned.length&&!earnedBeg.length&&!earnedAdv.length) return null;
                return <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                  <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>🏅 Urkunden-Vergabedaten</div>
                  {allEarned.map(a=>{
                    const key=`awardDate_${a.label.replace(/\s/g,"_")}`;
                    return <div key={key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                      <span style={{fontSize:16}}>{a.emoji}</span>
                      <div style={{flex:1,fontSize:11,color:"var(--text2)"}}>{a.label}</div>
                      <input type="date" value={editPlayer[key]||""}
                        onChange={e=>setEditPlayer(prev=>({...prev,[key]:e.target.value}))}
                        style={{padding:"5px 8px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text)",fontSize:11,outline:"none"}}/>
                    </div>;
                  })}
                  <div style={{marginTop:8,borderTop:"1px solid var(--border2)",paddingTop:8}}>
                    <div style={{fontSize:11,color:"var(--text2)",marginBottom:4,fontWeight:600}}>Trainingsbeteiligung-Urkunde</div>
                    <div style={{fontSize:10,color:"var(--text4)",marginBottom:8,lineHeight:1.4}}>
                      Die Beteiligung ergibt sich automatisch aus dem Trainingszeitraum in der Teilnahme-Auswertung.
                      Hier nur das Datum der Urkundenvergabe eintragen.
                    </div>
                    {[{key:"attendBronzeDate",label:"Bronze >70%",emoji:"🥉",threshold:70},{key:"attendSilverDate",label:"Silber >80%",emoji:"🥈",threshold:80},{key:"attendGoldDate",label:"Gold >90%",emoji:"🥇",threshold:90}].map(a=>(
                      <div key={a.key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                        <span style={{fontSize:16}}>{a.emoji}</span>
                        <div style={{flex:1,fontSize:11,color:"var(--text2)"}}>{a.label}</div>
                        <input type="date" value={editPlayer[a.key]||""}
                          onChange={e=>setEditPlayer(prev=>({...prev,[a.key]:e.target.value}))}
                          style={{padding:"5px 8px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text)",fontSize:11,outline:"none"}}/>
                      </div>
                    ))}
                  </div>
                </div>;
              })()}

              {/* Turniere */}
              {(()=>{
                const VEREINS_TURNIERE=["Brettchenturnier","Minimeisterschaften","Ranglistenturnier","Vereinsmeisterschaften"];
                const KREIS_TURNIERE=["Kreisjahrgangsmeisterschaften","Kreismeisterschaften","Kreisrangliste","Kreisentscheid Minimeisterschaften"];
                const BEZIRK_TURNIERE=["Bezirksjahrgangsmeisterschaften (BJM)","Bezirkseinzelmeisterschaften (BEM)","Bezirksrangliste (BRL)","Bezirksentscheid Minimeisterschaften"];
                const KONKURRENZ=["Einzel","Doppel","Mixed","Mannschaft"];

                function getTurnierOptions(type) {
                  if(type==="vereinsintern") return VEREINS_TURNIERE;
                  if(type==="extern_kreis") return KREIS_TURNIERE;
                  if(type==="extern_bezirk") return BEZIRK_TURNIERE;
                  return null; // Verband: Freitext
                }

                function updateT(i,field,val) {
                  const tt=[...(editPlayer.tournaments||[])];
                  tt[i]={...tt[i],[field]:val};
                  if(field==="date"&&val) tt[i].year=val.slice(0,4);
                  setEditPlayer(p=>({...p,tournaments:tt}));
                }

                // Sortiert absteigend nach Datum
                const sortedT=[...(editPlayer.tournaments||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||""));

                return <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:14}}>
                  <div style={{fontSize:12,color:"var(--text2)",marginBottom:10,fontWeight:600}}>🏆 Turniererfolge</div>
                  {sortedT.map((t,sortedIdx)=>{
                    // Original-Index finden
                    const origIdx=(editPlayer.tournaments||[]).findIndex((ot,i)=>ot===t||(ot.type===t.type&&ot.name===t.name&&ot.date===t.date&&i===sortedIdx));
                    const i=(editPlayer.tournaments||[]).indexOf(t);
                    const opts=getTurnierOptions(t.type);
                    return <div key={i} style={{background:"var(--bg2)",borderRadius:8,padding:"10px 12px",marginBottom:8,position:"relative"}}>
                      <button onClick={()=>setEditPlayer(prev=>({...prev,tournaments:prev.tournaments.filter((_,j)=>j!==i)}))}
                        style={{position:"absolute",top:6,right:6,background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14,lineHeight:1}}>✕</button>
                      {/* Zeile 1: Typ + Turniername */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Typ</label>
                          <select value={t.type||"vereinsintern"} onChange={e=>updateT(i,"type",e.target.value)} style={{fontSize:11,padding:"4px 6px",width:"100%"}}>
                            <option value="vereinsintern">Vereinsintern</option>
                            <option value="extern_kreis">Extern – Kreis</option>
                            <option value="extern_bezirk">Extern – Bezirk</option>
                            <option value="extern_verband">Extern – Verband (Hessen)</option>
                          </select>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Turniername</label>
                          {opts ? (
                            <select value={t.name||""} onChange={e=>updateT(i,"name",e.target.value)} style={{fontSize:11,padding:"4px 6px",width:"100%"}}>
                              <option value="">— wählen —</option>
                              {opts.map(o=><option key={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input value={t.name||""} onChange={e=>updateT(i,"name",e.target.value)} placeholder="Turniername"
                              style={{padding:"4px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                          )}
                        </div>
                      </div>
                      {/* Zeile 2: Platz + Konkurrenz + Altersklasse */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Platz</label>
                          <input value={t.place||""} onChange={e=>updateT(i,"place",e.target.value)} placeholder="z. B. 1"
                            style={{padding:"4px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Konkurrenz</label>
                          <select value={t.konkurrenz||""} onChange={e=>updateT(i,"konkurrenz",e.target.value)} style={{fontSize:11,padding:"4px 6px",width:"100%"}}>
                            <option value="">—</option>
                            {KONKURRENZ.map(k=><option key={k}>{k}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Altersklasse</label>
                          <input value={t.altersklasse||""} onChange={e=>updateT(i,"altersklasse",e.target.value)} placeholder="z. B. U13"
                            style={{padding:"4px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                        </div>
                      </div>
                      {/* Zeile 3: Datum + Jahr (auto) */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 80px",gap:6}}>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Datum</label>
                          <input type="date" value={t.date||""} onChange={e=>updateT(i,"date",e.target.value)}
                            style={{padding:"4px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                        </div>
                        <div>
                          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Jahr</label>
                          <div style={{padding:"4px 8px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text2)",fontSize:11,height:26,display:"flex",alignItems:"center"}}>
                            {t.year||t.date?.slice(0,4)||"—"}
                          </div>
                        </div>
                      </div>
                    </div>;
                  })}
                  <button onClick={()=>setEditPlayer(prev=>({...prev,tournaments:[...(prev.tournaments||[]),{type:"vereinsintern",name:"",place:"",konkurrenz:"",altersklasse:"",date:"",year:""}]}))}
                    style={{width:"100%",padding:"7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text2)",fontSize:12,cursor:"pointer"}}>+ Turnier hinzufügen</button>
                </div>;
              })()}
              <div style={{display:"flex",gap:8}}>
                <button onClick={saveEdit} disabled={saving} style={{flex:1,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>{saving?"Speichert…":"💾 Speichern"}</button>
                <button onClick={()=>setEditPlayer(null)} style={{flex:1,padding:10,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text2)",fontSize:13,fontWeight:600,cursor:"pointer"}}>Abbrechen</button>
              </div>
            </div>
          ) : (
            <div key={p.id} data-playerid={p.id} style={{display:"flex",alignItems:"center",gap:9,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"9px 13px",marginBottom:6}}>
              <span style={{fontSize:18}}>{p.avatar||"🏓"}</span>
              <span style={{width:8,height:8,borderRadius:"50%",background:p.color,display:"inline-block",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:p.status==="passiv"?"#6b7280":"var(--text)"}}>{p.firstName} {p.lastName}{p.status==="passiv"&&<span style={{fontSize:10,color:"var(--text3)",marginLeft:6}}>(passiv)</span>}</div>
                <div style={{fontSize:10,color:"var(--text4)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  {p.noLogin
                    ? <><span style={{color:"#f59e0b"}}>👤 Kein Login</span>
                        <button onClick={()=>{setLoginUpgradeFor(p);setUpgradeEmail("");setUpgradePass("");setUpgradeErr("");}} style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:5,color:"#f59e0b",fontSize:10,fontWeight:600,cursor:"pointer",padding:"1px 6px"}}>→ Login einrichten</button>
                      </>
                    : <span style={{color:"#10b981"}}>📧 {p.email}</span>
                  }
                  {/* Rollen-Badges */}
                  {p.roles&&Object.entries({player:"🏓",trainer:"🛡️",admin:"⚙️"}).map(([k,icon])=>
                    p.roles[k]&&<span key={k} style={{fontSize:10,background:"var(--border)",borderRadius:4,padding:"1px 4px"}}>{icon}</span>
                  )}
                  {p.joinDate&&<span style={{fontSize:10,color:"var(--text4)"}}>🏅 {new Date(p.joinDate).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}</span>}
                  {p.racketType==="TTC"&&p.racketNr&&(
                    <span style={{color:p.racketStart?"#3b82f6":"#f59e0b",fontWeight:600}}>
                      🏓 Nr.{String(p.racketNr).padStart(3,"0")}
                      {!p.racketStart&&" ⚠️ Vergabedatum fehlt!"}
                    </span>
                  )}
                </div>
              </div>
              <span style={{fontSize:12,color:"var(--text3)",flexShrink:0}}>{getAward(p).totalStars} ★</span>
              <button onClick={()=>setEditPlayer({...p, _originalRacketNr: p.racketType==="TTC"?String(p.racketNr||""):""})} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14}}>✏️</button>
              <button onClick={()=>setDeleteConfirmFor(p)} style={{background:"transparent",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14}}>🗑️</button>
            </div>
          )
        ))}
      </div>;
    })}
  </div>;
}

// ─── PLAYER TRAINING DETAIL (Punkt 7: editierbare Trainingsübersicht im Drilldown) ──
function PlayerTrainingDetail({player,attendance,showToast}) {
  const days = getTrainingDaysForGroup(player.group||"Anfänger", player.trainingDays);
  const today = new Date(); today.setHours(0,0,0,0);
  const pStart = player.trainingStart||null;
  // Punkt 2: Nur vergangene Trainings (inkl. heute), neuestes oben
  const filteredDays = days
    .filter(d=>{
      if(new Date(d) > today) return false; // keine Zukunft
      if(pStart && d < pStart) return false;
      return true;
    })
    .reverse(); // neuestes oben
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
      <div style={{fontSize:10,fontWeight:700,color:"var(--text3)"}}>Datum</div>
      <div style={{fontSize:10,fontWeight:700,color:"var(--text3)"}}>Tag</div>
      <div/>
      {COL.map(c=><div key={c.key} style={{display:"flex",justifyContent:"center"}}>
        <div style={{width:32,height:32,borderRadius:"50%",background:c.color+"22",border:`2px solid ${c.color}66`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:c.color}}>{c.label}</div>
      </div>)}
    </div>
    {filteredDays.map(d=>{
      const s=attendance[d];
      const noTraining=s&&s.took_place===false;
      const rawVal = s?.attendances?.[player.id] ?? null;
      // Wenn Session existiert und kein expliziter Eintrag → Standard "a" (anwesend)
      const val = (s && s.took_place !== false && rawVal === null) ? "a" : rawVal;
      const todayS2=new Date().toLocaleDateString("sv");
      const isPast=d<=todayS2;
      return <div key={d} style={{display:"grid",gridTemplateColumns:"90px 32px 1fr 44px 44px 44px",gap:4,marginBottom:4,alignItems:"center",background:noTraining?"#1a1a1a":"var(--bg)",borderRadius:7,padding:"5px 6px",opacity:noTraining?0.5:1}}>
        <div style={{fontSize:11,color:"var(--text)"}}>{formatDateDE(d)}</div>
        <div style={{fontSize:11,color:"var(--text3)"}}>{formatDayDE(d)}</div>
        <div style={{fontSize:10,color:"var(--text4)"}}>{noTraining?`❌ ${s.reason||""}`:""}</div>
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
                color:val===opt.key?opt.color:"var(--text4)",
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
  // Punkt 10: Filter
  const [filters,setFilters]=useState({nr:"",status:"",zustand:"",marke:"",art:"",griffform:"",farbeBelaege:"",vergebenAn:""});
  const [showFilters,setShowFilters]=useState(false);

  function sort(col){if(sortCol===col)setSortAsc(a=>!a);else{setSortCol(col);setSortAsc(true);}}
  function setFilter(col,val){setFilters(f=>({...f,[col]:val}));}
  function clearFilters(){setFilters({nr:"",status:"",zustand:"",marke:"",art:"",griffform:"",farbeBelaege:"",vergebenAn:""});}
  const hasFilters=Object.values(filters).some(v=>v!=="");

  const allNrs = Array.from({length:230},(_,i)=>i+1);
  const rMap = Object.fromEntries((rackets||[]).map(r=>[String(r.nr),r]));
  const rows = allNrs.map(nr=>{
    const r = rMap[String(nr)];
    return r || {nr,status:"frei",zustand:"",marke:"",art:"",griffform:"",farbeBelaege:"",vergebenAn:""};
  });

  // Filter anwenden
  const filtered = rows.filter(r=>{
    if(filters.nr&&!String(r.nr).padStart(3,"0").includes(filters.nr)) return false;
    if(filters.status&&r.status!==filters.status) return false;
    if(filters.zustand&&r.zustand!==filters.zustand) return false;
    if(filters.marke&&!(r.marke||"").toLowerCase().includes(filters.marke.toLowerCase())) return false;
    if(filters.art&&!(r.art||"").toLowerCase().includes(filters.art.toLowerCase())) return false;
    if(filters.griffform&&r.griffform!==filters.griffform) return false;
    if(filters.farbeBelaege&&r.farbeBelaege!==filters.farbeBelaege) return false;
    if(filters.vergebenAn&&!(r.vergebenAn||"").toLowerCase().includes(filters.vergebenAn.toLowerCase())) return false;
    return true;
  });

  const sorted = [...filtered].sort((a,b)=>{
    const va=String(a[sortCol]||""), vb=String(b[sortCol]||"");
    return sortAsc?va.localeCompare(vb,"de",{numeric:true}):vb.localeCompare(va,"de",{numeric:true});
  });

  async function saveRow() {
    setSaving(true);
    try {
      const oldRow = rMap[String(form.nr)] || {};
      await setDoc(doc(db,"rackets",String(form.nr)),{...form,nr:Number(form.nr)});

      // Sync zurück zu Spieler wenn vergebenAn geändert wurde
      const oldName = oldRow.vergebenAn || "";
      const newName = form.vergebenAn || "";

      // Alten Spieler freigeben
      if (oldName && oldName !== newName) {
        const oldP = players.find(p=>`${p.firstName} ${p.lastName}`===oldName);
        if (oldP) {
          await updateDoc(doc(db,"players",oldP.id),{racketNr:"",racketType:"",racketStart:"",racketEnd:""}).catch(()=>{});
        }
      }
      // Neuem Spieler zuweisen
      if (newName && newName !== oldName) {
        const newP = players.find(p=>`${p.firstName} ${p.lastName}`===newName);
        if (newP) {
          await updateDoc(doc(db,"players",newP.id),{
            racketType:"TTC",
            racketNr:form.nr,
            racketStart: newP.racketStart||"",
          }).catch(()=>{});
        }
      }
      // Status-Sync
      if (form.status==="frei" && oldName) {
        const oldP = players.find(p=>`${p.firstName} ${p.lastName}`===oldName);
        if (oldP) await updateDoc(doc(db,"players",oldP.id),{racketEnd: new Date().toISOString().slice(0,10)}).catch(()=>{});
      }

      showToast("Gespeichert & synchronisiert","💾");
      setEditId(null);
    } catch(e){showToast("Fehler: "+e.message,"❌");}
    setSaving(false);
  }

  const playersWithoutRacket = players.filter(p=>p.racketType!=="TTC"&&p.racketType!=="eigener");
  const statColor={frei:"#10b981",vergeben:"#f59e0b",kaputt:"#ef4444",offen:"#6b7280",verkauft:"#8b5cf6"};

  // Punkt 12: Sticky header — table inside scrollable div
  const SH=({col,label})=><th onClick={()=>sort(col)} style={{
    padding:"7px 8px",fontSize:11,color:"var(--text2)",fontWeight:700,cursor:"pointer",
    userSelect:"none",whiteSpace:"nowrap",background:"var(--bg2)",
    position:"sticky",top:0,zIndex:3,borderBottom:"1px solid var(--border2)",
  }}>{label}{sortCol===col?(sortAsc?" ▲":" ▼"):""}</th>;

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontSize:17,fontWeight:800}}>🏓 Schlägerverwaltung</div>
      <div style={{display:"flex",gap:6}}>
        {hasFilters&&<button onClick={clearFilters} style={{padding:"5px 10px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:7,color:"#ef4444",fontSize:11,cursor:"pointer"}}>✕ Filter löschen</button>}
        <button onClick={()=>setShowFilters(f=>!f)} style={{padding:"5px 10px",background:showFilters?"#3b82f622":"var(--border)",border:`1px solid ${showFilters?"#3b82f6":"var(--border2)"}`,borderRadius:7,color:showFilters?"#3b82f6":"#9ca3af",fontSize:11,cursor:"pointer"}}>
          🔍 Filter {showFilters?"ausblenden":"anzeigen"}
        </button>
      </div>
    </div>

    {/* Filterzeile */}
    {showFilters&&<div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12,display:"grid",gridTemplateColumns:"60px 80px 80px 1fr 1fr 100px 120px 1fr",gap:6}}>
      <input placeholder="Nr." value={filters.nr} onChange={e=>setFilter("nr",e.target.value)} style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
      <select value={filters.status} onChange={e=>setFilter("status",e.target.value)} style={{padding:"5px 7px",fontSize:11}}>
        <option value="">Status</option>{["frei","vergeben","kaputt","offen","verkauft"].map(s=><option key={s}>{s}</option>)}
      </select>
      <select value={filters.zustand} onChange={e=>setFilter("zustand",e.target.value)} style={{padding:"5px 7px",fontSize:11}}>
        <option value="">Zustand</option>{["neu","gut","mittel","schlecht"].map(s=><option key={s}>{s}</option>)}
      </select>
      <input placeholder="Marke" value={filters.marke} onChange={e=>setFilter("marke",e.target.value)} style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
      <input placeholder="Art" value={filters.art} onChange={e=>setFilter("art",e.target.value)} style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
      <select value={filters.griffform} onChange={e=>setFilter("griffform",e.target.value)} style={{padding:"5px 7px",fontSize:11}}>
        <option value="">Griffform</option>{["Anatomisch","Gerade","Konisch","Konkav"].map(s=><option key={s}>{s}</option>)}
      </select>
      <select value={filters.farbeBelaege} onChange={e=>setFilter("farbeBelaege",e.target.value)} style={{padding:"5px 7px",fontSize:11}}>
        <option value="">Beläge</option>{["Schwarz/rot","Schwarz/blau","Schwarz/grün","Schwarz/pink","Schwarz/violett"].map(s=><option key={s}>{s}</option>)}
      </select>
      <input placeholder="Vergabe an" value={filters.vergebenAn} onChange={e=>setFilter("vergebenAn",e.target.value)} style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
    </div>}

    <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>{sorted.length} von 230 Schlägern angezeigt</div>

    {/* Punkt 12: Scrollbare Tabelle mit fixiertem Header */}
    <div style={{maxHeight:"60vh",overflowY:"auto",borderRadius:12,border:"1px solid var(--border)"}}>
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
            <th style={{padding:"7px 8px",background:"var(--bg2)",position:"sticky",top:0,zIndex:3,borderBottom:"1px solid var(--border2)"}}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r=>(
            editId===r.nr ? (
              <tr key={r.nr} style={{background:"#1a2332"}}>
                <td style={{padding:"6px 8px",color:"var(--text)",fontWeight:700}}>{String(r.nr).padStart(3,"0")}</td>
                <td style={{padding:"4px"}}>
                  <select value={form.status||"frei"} onChange={e=>{
                    const ns=e.target.value;
                    setForm(p=>({...p,status:ns,...(ns==="vergeben"?{griffform:"Konkav",farbeBelaege:"Schwarz/rot"}:{})}));
                  }} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    {["frei","vergeben","kaputt","offen","verkauft"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.zustand||""} onChange={e=>setForm(p=>({...p,zustand:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>{["neu","gut","mittel","schlecht"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <input list={`marke-${r.nr}`} value={form.marke||""} onChange={e=>setForm(p=>({...p,marke:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:4,color:"var(--text)",outline:"none"}}/>
                  <datalist id={`marke-${r.nr}`}><option>Butterfly</option><option>GEWO</option><option>Joola</option><option>Nimatsu</option><option>TSP</option></datalist>
                </td>
                <td style={{padding:"4px"}}>
                  <input list={`art-${form.nr}`} value={form.art||""} onChange={e=>setForm(p=>({...p,art:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:4,color:"var(--text)",outline:"none"}}/>
                  <datalist id={`art-${form.nr}`}>
                    {form.marke==="GEWO"&&["Blast Junior","Raver","Standard Pro"].map(a=><option key={a}>{a}</option>)}
                    {form.marke==="Butterfly"&&["Comfort","Easy Bat"].map(a=><option key={a}>{a}</option>)}
                    {form.marke==="Joola"&&["Champ","Team","Classic"].map(a=><option key={a}>{a}</option>)}
                  </datalist>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.griffform||""} onChange={e=>setForm(p=>({...p,griffform:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>{["Anatomisch","Gerade","Konisch","Konkav"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.farbeBelaege||""} onChange={e=>setForm(p=>({...p,farbeBelaege:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">—</option>{["Schwarz/rot","Schwarz/blau","Schwarz/grün","Schwarz/pink","Schwarz/violett"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{padding:"4px"}}>
                  <select value={form.vergebenAn||""} onChange={e=>setForm(p=>({...p,vergebenAn:e.target.value}))} style={{fontSize:11,padding:"3px 6px",width:"100%"}}>
                    <option value="">— frei —</option>
                    {[...playersWithoutRacket,
                      ...players.filter(p=>p.racketNr===form.nr&&p.racketType==="TTC"&&!playersWithoutRacket.find(x=>x.id===p.id))
                    ].sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"")).map(p=>(
                      <option key={p.id} value={`${p.firstName} ${p.lastName}`}>{p.firstName} {p.lastName}</option>
                    ))}
                  </select>
                </td>
                <td style={{padding:"4px",whiteSpace:"nowrap"}}>
                  <button onClick={saveRow} disabled={saving} style={{padding:"3px 8px",background:"#10b981",border:"none",borderRadius:4,color:"#fff",fontSize:11,cursor:"pointer",marginRight:3}}>💾</button>
                  <button onClick={()=>setEditId(null)} style={{padding:"3px 8px",background:"var(--border2)",border:"none",borderRadius:4,color:"var(--text2)",fontSize:11,cursor:"pointer"}}>✕</button>
                </td>
              </tr>
            ) : (
              <tr key={r.nr} style={{borderTop:"1px solid var(--border)",cursor:"pointer"}}>
                <td style={{padding:"7px 8px",color:"var(--text)",fontWeight:700}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{String(r.nr).padStart(3,"0")}</td>
                <td style={{padding:"7px 8px"}} onClick={()=>{setEditId(r.nr);setForm({...r});}}><span style={{color:statColor[r.status||"frei"]||"#10b981",fontWeight:600,fontSize:11}}>{r.vergebenAn?"vergeben":r.status||"frei"}</span></td>
                <td style={{padding:"7px 8px",color:"var(--text2)",fontSize:11}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{r.zustand||"—"}</td>
                <td style={{padding:"7px 8px",color:"var(--text2)",fontSize:11}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{r.marke||"—"}</td>
                <td style={{padding:"7px 8px",color:"var(--text2)",fontSize:11}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{r.art||"—"}</td>
                <td style={{padding:"7px 8px",color:"var(--text2)",fontSize:11}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{r.griffform||"—"}</td>
                <td style={{padding:"7px 8px",color:"var(--text2)",fontSize:11}} onClick={()=>{setEditId(r.nr);setForm({...r});}}>{r.farbeBelaege||"—"}</td>
                <td style={{padding:"7px 8px",fontSize:11}}>
                  {r.vergebenAn ? (
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <span style={{color:"var(--text)"}}>{r.vergebenAn}</span>
                      <button onClick={async(e)=>{
                        e.stopPropagation();
                        // Punkt 6: Vergabe löschen — Schläger freigeben + Spieler aktualisieren
                        const oldName=r.vergebenAn;
                        await setDoc(doc(db,"rackets",String(r.nr)),{...r,status:"frei",vergebenAn:""}).catch(()=>{});
                        const oldP=players.find(pl=>`${pl.firstName} ${pl.lastName}`===oldName);
                        if(oldP) await updateDoc(doc(db,"players",oldP.id),{racketType:"",racketNr:"",racketStart:"",racketEnd:""}).catch(()=>{});
                        showToast("Vergabe gelöscht","🏓");
                      }} style={{padding:"1px 5px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:4,color:"#ef4444",fontSize:10,cursor:"pointer",flexShrink:0}}>✕</button>
                    </div>
                  ) : <span style={{color:"var(--text4)",fontSize:11}}>—</span>}
                </td>
                <td style={{padding:"7px 8px",color:"var(--text4)",fontSize:12}} onClick={()=>{setEditId(r.nr);setForm({...r});}} >✏️</td>
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
  const [notFoundList,setNotFoundList]=useState([]);
  const [sortCol,setSortCol]=useState("birthday");
  const [sortAsc,setSortAsc]=useState(true);

  function toggleSort(col){if(sortCol===col)setSortAsc(a=>!a);else{setSortCol(col);setSortAsc(true);}}

  // Punkt 1: Nur aktive Spieler mit Geburtstag
  const withBirthday = players
    .filter(p=>p.status!=="passiv" && p.birthdate && typeof p.birthdate==="string" && p.birthdate.trim()!=="")
    .map(p=>{
      const bd=new Date(p.birthdate);
      const now=new Date();
      let age=now.getFullYear()-bd.getFullYear();
      if(now.getMonth()<bd.getMonth()||(now.getMonth()===bd.getMonth()&&now.getDate()<bd.getDate())) age--;
      const mm=String(bd.getMonth()+1).padStart(2,"0");
      const dd=String(bd.getDate()).padStart(2,"0");
      return {...p,age,bdMonth:bd.getMonth(),bdDay:bd.getDate(),
        sortKeyBirthday:`${mm}-${dd}`,
        sortKeyFirstName:(p.firstName||"").toLowerCase(),
        sortKeyLastName:(p.lastName||"").toLowerCase(),
        sortKeyAge:age,
        sortKeyGender:(p.gender||"").toLowerCase(),
      };
    });

  // Punkt 3: Sortierung nach gewählter Spalte
  const sorted=[...withBirthday].sort((a,b)=>{
    let va,vb;
    if(sortCol==="birthday"){va=a.sortKeyBirthday;vb=b.sortKeyBirthday;}
    else if(sortCol==="firstName"){va=a.sortKeyFirstName;vb=b.sortKeyFirstName;}
    else if(sortCol==="lastName"){va=a.sortKeyLastName;vb=b.sortKeyLastName;}
    else if(sortCol==="age"){va=a.sortKeyAge;vb=b.sortKeyAge;return sortAsc?va-vb:vb-va;}
    else if(sortCol==="gender"){va=a.sortKeyGender;vb=b.sortKeyGender;}
    else{va=a.sortKeyBirthday;vb=b.sortKeyBirthday;}
    return sortAsc?va.localeCompare(vb,"de"):vb.localeCompare(va,"de");
  });

  const today=new Date();today.setHours(0,0,0,0);
  const allDays=[...new Set([...ALL_TUESDAYS,...ALL_FRIDAYS])].sort();
  const lastTraining=([...allDays].reverse().find(d=>new Date(d)<=today))||null;

  function isRecentBirthday(p) {
    if (!lastTraining||!p.birthdate) return false;
    const bd=new Date(p.birthdate);
    const since=new Date(lastTraining);
    const thisYear=new Date(today.getFullYear(),bd.getMonth(),bd.getDate());
    return thisYear>=since && thisYear<=today;
  }

  function calcAge(birthdateStr) {
    if (!birthdateStr) return "—";
    const bd = new Date(birthdateStr);
    if (isNaN(bd.getTime())) return "—";
    const now = new Date();
    let age = now.getFullYear() - bd.getFullYear();
    if (now.getMonth() < bd.getMonth() || (now.getMonth()===bd.getMonth() && now.getDate()<bd.getDate())) age--;
    return age;
  }

  function formatBirthdayShort(dateStr) {
    if (!dateStr) return "—";
    const parts = dateStr.split("-");
    if (parts.length!==3) return dateStr;
    return `${parts[2]}.${parts[1]}.`;
  }

  // Punkt 4: Geschlecht ableiten
  function genderLabel(g) {
    if (!g) return "—";
    const gl=g.toLowerCase();
    if(gl==="w"||gl==="weiblich"||gl==="mädchen"||gl==="f") return "w";
    if(gl==="m"||gl==="männlich"||gl==="junge") return "m";
    return "—";
  }

  function parseDate(raw) {
    if (raw===null||raw===undefined||raw==="") return "";
    if (typeof raw === "number" || (/^\d{5}$/.test(String(raw).trim()))) {
      const n = typeof raw === "number" ? raw : Number(raw);
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    }
    let s = String(raw).trim();
    if (s.includes(".")) {
      const parts = s.split(".");
      if (parts.length >= 3) {
        let d=parts[0].trim(), m=parts[1].trim(), y=parts[2].trim();
        if (y.length===2) y = (parseInt(y)>30?"19":"20")+y;
        if (d.length&&m.length&&y.length===4) return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
      }
    }
    if (s.includes("/")) {
      const [m,d,y] = s.split("/");
      if (y&&y.length===4) return `${y}-${m.trim().padStart(2,"0")}-${d.trim().padStart(2,"0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return "";
  }

  async function handleExcelUpload(e) {
    const file=e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setNotFoundList([]);
    try {
      const XLSX = await new Promise((resolve,reject)=>{
        if (window.XLSX) { resolve(window.XLSX); return; }
        const s=document.createElement("script");
        s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload=()=>resolve(window.XLSX);
        s.onerror=()=>reject(new Error("SheetJS konnte nicht geladen werden"));
        document.head.appendChild(s);
      });
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:"array",cellDates:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{raw:true});
      let count=0, notFound=[], failed=[];
      for (const row of rows) {
        const vorname=String(row["Vorname"]||row["vorname"]||"").trim();
        const nachname=String(row["Nachname"]||row["nachname"]||"").trim();
        const rawDate=row["Geburtsdatum"]||row["geburtsdatum"]||row["Geburtstag"]||row["geburtstag"]||"";
        if (!vorname) continue;
        const p=players.find(pl=>
          (pl.firstName||"").toLowerCase().trim()===vorname.toLowerCase()&&
          (pl.lastName||"").toLowerCase().trim()===nachname.toLowerCase()
        );
        if (!p) { notFound.push(`${vorname} ${nachname}`); continue; }
        if (!rawDate && rawDate!==0) { failed.push(`${vorname} (kein Datum)`); continue; }
        const dateStr=parseDate(rawDate);
        if (!dateStr) { failed.push(`${vorname} ${nachname} (Datum: ${rawDate})`); continue; }
        await setDoc(doc(db,"players",p.id),{birthdate:dateStr},{merge:true});
        count++;
      }
      // Punkt 2: Nicht-importierte anzeigen
      if(notFound.length||failed.length) setNotFoundList([...notFound,...failed]);
      showToast(count>0?`${count} Geburtstage importiert`:"Keine importiert","🎂");
    } catch(err){
      showToast("Fehler: "+err.message,"❌");
    }
    setUploading(false);
    e.target.value="";
  }

  const SH=({col,label,align})=><div onClick={()=>toggleSort(col)} style={{
    padding:"8px 8px",fontSize:11,fontWeight:700,color:sortCol===col?"#10b981":"var(--text2)",
    cursor:"pointer",userSelect:"none",textAlign:align||"left",whiteSpace:"nowrap",
    background:"var(--bg3)",borderBottom:"2px solid var(--border2)",
  }}>{label}{sortCol===col?(sortAsc?" ▲":" ▼"):""}</div>;

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div style={{fontSize:17,fontWeight:800}}>🎂 Geburtstage</div>
      <label style={{padding:"6px 12px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:uploading?"#6b7280":"var(--text2)",fontSize:12,cursor:uploading?"not-allowed":"pointer"}}>
        {uploading?"⏳ Importiert…":"📥 Excel importieren"}
        <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleExcelUpload} disabled={uploading}/>
      </label>
    </div>

    {/* Punkt 2: Nicht-gefundene anzeigen */}
    {notFoundList.length>0&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:12,fontWeight:700,color:"#ef4444",marginBottom:6}}>⚠️ {notFoundList.length} Einträge konnten nicht importiert werden:</div>
      {notFoundList.map((n,i)=><div key={i} style={{fontSize:11,color:"#fca5a5",marginBottom:2}}>• {n}</div>)}
      <button onClick={()=>setNotFoundList([])} style={{marginTop:6,padding:"3px 8px",background:"transparent",border:"1px solid #ef444466",borderRadius:5,color:"#ef4444",fontSize:11,cursor:"pointer"}}>Schließen</button>
    </div>}

    <div style={{fontSize:11,color:"var(--text3)",marginBottom:12,lineHeight:1.5}}>
      Hervorgehoben: Geburtstage seit letztem Training ({lastTraining?formatDateDE(lastTraining):"—"}).
      Nur aktive Personen. Excel: „Vorname", „Nachname", „Geburtsdatum" (TT.MM.JJJJ).
    </div>

    {/* Tabelle: Header fixiert, Daten scrollbar */}
    <div style={{borderRadius:12,border:"1px solid var(--border)",overflow:"hidden"}}>
      {/* Fixierter Header */}
      <div style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 30px 38px 32px",background:"var(--bg3)"}}>
        <SH col="birthday" label="Datum"/>
        <SH col="firstName" label="Vorname"/>
        <SH col="lastName" label="Nachname"/>
        <SH col="gender" label="w/m"/>
        <SH col="age" label="Alter" align="right"/>
        <div style={{padding:"8px 4px",background:"var(--bg3)",borderBottom:"2px solid var(--border2)"}}/>
      </div>
      {/* Scrollbarer Inhalt */}
      <div style={{maxHeight:"calc(100vh - 300px)",overflowY:"auto"}}>
        {sorted.map(p=>{
          const highlight=isRecentBirthday(p);
          return <div key={p.id} style={{display:"grid",gridTemplateColumns:"80px 1fr 1fr 30px 38px 32px",borderTop:"1px solid var(--border)",background:highlight?"#f59e0b11":"var(--bg2)",alignItems:"center"}}>
            <div style={{padding:"8px 8px",fontSize:12,color:highlight?"#f59e0b":"var(--text2)",fontWeight:highlight?700:400,whiteSpace:"nowrap"}}>
              {highlight?"🎂":""}{formatBirthdayShort(p.birthdate)}
            </div>
            <div style={{padding:"8px 6px",fontSize:12,color:highlight?"#f59e0b":"var(--text)",fontWeight:highlight?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.firstName}</div>
            <div style={{padding:"8px 6px",fontSize:12,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.lastName}</div>
            <div style={{padding:"8px 4px",fontSize:11,color:"var(--text3)",textAlign:"center"}}>{genderLabel(p.gender)}</div>
            <div style={{padding:"8px 6px",fontSize:12,color:highlight?"#f59e0b":"var(--text3)",fontWeight:highlight?700:400,textAlign:"right"}}>{calcAge(p.birthdate)}</div>
            <div style={{padding:"6px 4px",textAlign:"center"}}>
              <button onClick={async()=>{
                if(!window.confirm(`Geburtstag von ${p.firstName} ${p.lastName} löschen?`)) return;
                await updateDoc(doc(db,"players",p.id),{birthdate:""}).catch(()=>{});
                showToast("Geburtstag gelöscht","🗑️");
              }} style={{padding:"2px 5px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:4,color:"#ef4444",fontSize:10,cursor:"pointer"}}>✕</button>
            </div>
          </div>;
        })}
        {sorted.length===0&&<div style={{padding:20,textAlign:"center",color:"var(--text3)",fontSize:13}}>Noch keine Geburtstage erfasst</div>}
      </div>
    </div>
  </div>;
}


// ─── PLAYER VIEW ──────────────────────────────────────────────────────────────
function PlayerView({user,players,attendance,isDark,onSetUserTheme,userTheme,onSignOut,hideHeader,forcePlayer}) {
  const myPlayer=forcePlayer||players.find(p=>p.email===user?.email);
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
    {key:"teilnahme",label:"Teilnahme",icon:"📊"},
    {key:"ranking",label:"Rangliste",icon:"🏆"},
    {key:"erfolge",label:"Erfolge",icon:"🏅"},
    {key:"beobachtungen",label:"Beobachtungen",icon:"🔍"},
    {key:"spielbetrieb",label:"Spielbetrieb",icon:"⚽"},
  ];

  // Punkt 6: Avatar selbst ändern
  async function changeMyAvatar(av) {
    if (!myPlayer) return;
    try {
      await updateDoc(doc(db,"players",myPlayer.id),{avatar:av});
      setShowAvatarPicker(false);
    } catch(e){}
  }

  if (!myPlayer) return <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:16}}>
    <div style={{fontSize:40}}>⏳</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--text)",textAlign:"center"}}>Dein Profil wird noch eingerichtet.</div>
    <div style={{fontSize:13,color:"var(--text3)",textAlign:"center"}}>Bitte wende dich an deinen Trainer.</div>
    <button onClick={onSignOut} style={{padding:"8px 16px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text2)",fontSize:13,cursor:"pointer"}}>Abmelden</button>
  </div>;

  const {currentAward,beginnerStars,advancedStars,totalStars}=getAward(myPlayer);
  const nexts=nextAwards(myPlayer);
  const myRank=sortedRanking.findIndex(p=>p.id===myPlayer.id)+1;
  const myDays=getTrainingDaysForGroup(myPlayer.group||"Anfänger", myPlayer.trainingDays);
  const todayStr=new Date().toLocaleDateString("sv");
  const pastDays=myDays.filter(d=>d<=todayStr);
  let present=0,total=0;
  for (const d of pastDays) {
    const s=attendance[d];
    if (s&&s.took_place===false) continue;
    if (!s) continue;
    total++;
    const val=s.attendances?.[myPlayer.id];
    if(val==="e"||val==="u"){/* nicht anwesend */}else present++;
  }
  const pct=total>0?Math.round((present/total)*100):0;

  return <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:680,margin:"0 auto",paddingBottom:80}}>
    {showAvatarPicker&&<AvatarPicker current={myPlayer.avatar} onSelect={changeMyAvatar} onClose={()=>setShowAvatarPicker(false)}/>}

    {/* Header — ausgeblendet wenn RoleSwitchWrapper aktiv */}
    {!hideHeader&&<div style={{background:"linear-gradient(135deg,var(--bg2),var(--bg))",borderBottom:"1px solid var(--border)",padding:"14px 14px 12px",position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setShowAvatarPicker(true)}>
            <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={42}/>
            <span style={{position:"absolute",bottom:-1,right:-1,fontSize:10,background:"var(--bg3)",borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border2)"}}>✏️</span>
          </div>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:myPlayer.color}}>{myPlayer.firstName} {myPlayer.lastName}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>TTC Niederzeuzheim · Rang #{myRank} · {pct}% Beteiligung</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>
          <button onClick={onSignOut} title="Abmelden" style={{padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text3)",fontSize:16,cursor:"pointer",lineHeight:1}}>⏻</button>
        </div>
      </div>
    </div>}

    {/* Tabs */}
    <div style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--bg)",position:"sticky",top:hideHeader?0:70,zIndex:99}}>
      {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{flex:1,padding:"11px 0",background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,color:activeTab===t.key?"#10b981":"var(--text3)",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>{t.icon} {t.label}</button>)}
    </div>

    {/* ── STATS ── */}
    {activeTab==="stats"&&<div style={{padding:14}}>
      <div style={{background:`linear-gradient(135deg,${myPlayer.color}11,var(--bg2))`,border:`1px solid ${myPlayer.color}44`,borderRadius:16,padding:18,marginBottom:16,textAlign:"center"}}>
        {/* Punkt 6: Avatar klickbar im großen Profil */}
        <div style={{position:"relative",display:"inline-block",cursor:"pointer"}} onClick={()=>setShowAvatarPicker(true)}>
          <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={64}/>
          <span style={{position:"absolute",bottom:0,right:0,fontSize:12,background:"var(--bg3)",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border2)"}}>✏️</span>
        </div>
        <div style={{fontSize:22,fontWeight:900,color:myPlayer.color,marginTop:12}}>{myPlayer.firstName} {myPlayer.lastName}</div>
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:12}}>{myPlayer.group||"Anfänger"} · Rang #{myRank} von {activePlayers.filter(p=>p.group!=="Trainer").length}</div>
        {currentAward&&<div style={{marginBottom:12}}><AwardBadge award={currentAward}/></div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
          {[{label:"Gesamt",val:totalStars,color:myPlayer.color},{label:"Anfänger",val:beginnerStars,color:"#10b981"},{label:"Fortgeschr.",val:advancedStars,color:"#3b82f6"}].map(s=>(
            <div key={s.label} style={{background:"var(--bg)",borderRadius:10,padding:"10px 6px"}}>
              <div style={{fontSize:22,fontWeight:900,color:s.color}}>{s.val}</div>
              <div style={{fontSize:10,color:"var(--text3)"}}>★ {s.label}</div>
            </div>
          ))}
        </div>
        <div style={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text2)",marginBottom:3}}><span>Anfänger</span><span>{beginnerStars}/50</span></div>
          <ProgressBar value={beginnerStars} max={50} color={myPlayer.color}/>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text2)",marginBottom:3}}><span>Fortgeschrittene</span><span>{advancedStars}/150</span></div>
          <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
        </div>
        {/* Punkt 11: Alle nächsten Ziele */}
        {nexts.length>0&&<div style={{marginTop:12,background:"var(--bg)",borderRadius:8,padding:"8px 12px",display:"flex",flexDirection:"column",gap:5,alignItems:"center"}}>
          {nexts.map((a,i)=>(
            <div key={i} style={{fontSize:12,color:"var(--text2)",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"center"}}>
              <span style={{fontSize:10,color:"var(--text4)"}}>{a.type==="beginner"?"Anfänger:":"Fortgeschr.:"}</span>
              <AwardBadge award={a} small/>
              <span>— noch {a.needed} Sterne</span>
            </div>
          ))}
        </div>}
      </div>

      <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:"var(--text)"}}>Meine Übungen</div>
      {/* Punkt 8: Aufklappbare Übungen für Spieler */}
      <div style={{display:"flex",flexDirection:"column",gap:6,paddingBottom:20}}>
        {ALL_EXERCISES.map(ex=>{
          const stars=myPlayer.stars?.[ex.id]||0;
          const isBeg=ex.id<=10;
          const isExp=expandedEx===ex.id;
          return <div key={ex.id} style={{background:"var(--bg2)",border:`1px solid ${stars>0?"#2d3748":"var(--border)"}`,borderRadius:10,overflow:"hidden"}}>
            <div onClick={()=>setExpandedEx(isExp?null:ex.id)} style={{padding:"10px 12px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <div style={{width:26,height:26,borderRadius:6,flexShrink:0,background:isBeg?"#10b98122":"#3b82f622",border:`1px solid ${isBeg?"#10b98144":"#3b82f644"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:isBeg?"#10b981":"#3b82f6"}}>{ex.id}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"var(--text)",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div></div>
              <StarRating stars={stars} readonly/>
              <span style={{color:"var(--text3)",fontSize:12,marginLeft:4}}>{isExp?"▲":"▼"}</span>
            </div>
            {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:"10px 12px",background:"var(--bg)"}}>
              <div style={{display:"flex",flexDirection:"column",gap:5}}>
                {ex.thresholds.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 9px",borderRadius:7,background:stars>=i+1?"#f59e0b11":"var(--border)",border:`1px solid ${stars>=i+1?"#f59e0b44":"var(--border2)"}`}}>
                    <span style={{color:stars>=i+1?"#f59e0b":"#6b7280",fontSize:12}}>{"★".repeat(i+1)}{"☆".repeat(4-i)}</span>
                    <span style={{fontSize:12,color:stars>=i+1?"var(--text)":"#9ca3af",flex:1}}>{t}</span>
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
      <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>📅 Meine Trainingstage</div>

      {/* Summary - fixiert beim Scrollen */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:14,marginBottom:14,position:"sticky",top:0,zIndex:5}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,textAlign:"center"}}>
          {[{l:"Beteiligung",v:`${pct}%`,c:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981"},{l:"Anwesend",v:present,c:"#10b981"},{l:"Gesamt",v:total,c:"#6b7280"}].map(s=>(
            <div key={s.l} style={{background:"var(--bg)",borderRadius:10,padding:"8px 6px"}}>
              <div style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div>
              <div style={{fontSize:10,color:"var(--text3)"}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Training days table — nur Vergangenheit, neuestes oben */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"90px 36px 1fr",background:"var(--bg3)",padding:"8px 12px",gap:8}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text2)"}}>Datum</div>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text2)"}}>Tag</div>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text2)"}}>Status</div>
        </div>
        {/* Nur vergangene Tage, umgekehrte Reihenfolge */}
        {[...myDays].filter(d=>d<=new Date().toLocaleDateString("sv")).reverse().map(d=>{
          const s=attendance[d];
          const didNotTakePlace=s&&s.took_place===false;
          const val=s?.attendances?.[myPlayer.id];
          let statusLabel="Nicht erfasst";
          let statusColor="#4b5563";
          if (didNotTakePlace) {statusLabel=`Kein Training${s.reason?` (${s.reason})`:""}`; statusColor="#6b7280";}
          else if (s) {
            if (val===undefined||val===null||val==="a"){statusLabel="✓ Anwesend";statusColor="#10b981";}
            else if (val==="e"){statusLabel="Entschuldigt";statusColor="#f59e0b";}
            else {statusLabel="Unentschuldigt";statusColor="#ef4444";}
          }
          return <div key={d} style={{display:"grid",gridTemplateColumns:"90px 36px 1fr",padding:"9px 12px",gap:8,borderTop:"1px solid var(--border)",background:didNotTakePlace?"#0d0d0d":"transparent",opacity:didNotTakePlace?0.5:1}}>
            <div style={{fontSize:12,color:"var(--text)",fontWeight:500}}>{formatDateDE(d)}</div>
            <div style={{fontSize:12,color:"var(--text3)"}}>{formatDayDE(d)}</div>
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
        const days=getTrainingDaysForGroup(player.group||"Anfänger", player.trainingDays);
        const pStart=player.trainingStart||null;
        const pEnd=player.trainingEnd||null;
        const todayS=new Date().toLocaleDateString("sv");
        const pastD=days.filter(d=>{
          if(d>todayS)return false;
          if(pStart&&d<pStart)return false;
          if(pEnd&&d>pEnd)return false;
          return true;
        });
        let pres=0,tot=0,exc=0,unex=0;
        for(const d of pastD){
          const s=attendance[d];
          if(s&&s.took_place===false)continue;
          if(!s)continue;
          tot++;
          const val=s.attendances?.[player.id];
          if(val==="e")exc++;
          else if(val==="u")unex++;
          else pres++; // "a", undefined, null → anwesend
        }
        const pct=tot>0?Math.round((pres/tot)*100):0;
        return {...player,pct,pres,tot,exc,unex};
      }).sort((a,b)=>b.pct-a.pct);

      return <div style={{padding:14}}>
        <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📊 Trainingsbeteiligung</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>Gruppe: {myGroup}</div>
        {rankedPeers.map((player,idx)=>{
          const {pct,pres,tot,exc,unex}=player;
          const isMe=player.id===myPlayer.id;
          const medal=pct>90?"🥇":pct>80?"🥈":pct>70?"🥉":null;
          return <div key={player.id} style={{background:isMe?"#10b98111":"var(--bg2)",border:`2px solid ${isMe?myPlayer.color+"88":idx===0?"#f59e0b44":"var(--border)"}`,borderRadius:12,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,position:"relative"}}>
            {isMe&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:myPlayer.color,borderRadius:"12px 12px 0 0"}}/>}
            <Avatar avatar={player.avatar} color={player.color} size={36}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
                <span style={{fontSize:14,fontWeight:800,color:isMe?myPlayer.color:"var(--text)"}}>{player.firstName} {player.lastName}{isMe&&" (Du)"}</span>
                {medal&&<span style={{fontSize:18}}>{medal}</span>}
              </div>
              <div style={{background:"var(--bg3)",borderRadius:6,height:8,overflow:"hidden",marginBottom:4}}>
                <div style={{width:`${pct}%`,height:"100%",background:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981",borderRadius:6}}/>
              </div>
              <div style={{display:"flex",gap:10,fontSize:10,color:"var(--text3)"}}>
                <span>✓ {pres} anwesend</span>
                <span>{exc} entsch.</span>
                <span>{unex} unentsch.</span>
              </div>
            </div>
            <div style={{flexShrink:0,textAlign:"center",background:"var(--bg)",borderRadius:10,padding:"6px 10px",border:`1px solid ${player.color}44`,minWidth:50}}>
              <div style={{fontSize:20,fontWeight:900,color:pct>90?"#ffd700":pct>80?"#b8b8b8":pct>70?"#cd7f32":"#10b981",lineHeight:1}}>{pct}%</div>
              <div style={{fontSize:9,color:"var(--text3)",marginTop:1}}>Beteiligung</div>
            </div>
          </div>;
        })}
      </div>;
    })()}

    {/* ── RANGLISTE (nur eigene Gruppe) ── */}
    {activeTab==="ranking"&&<div style={{padding:14}}>
      <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>🏆 Rangliste</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:14}}>Gruppe: {myGroup}</div>
      {sortedRanking.map((player,idx)=>{
        const {beginnerStars,advancedStars,totalStars,isAdvanced}=getAward(player);
        const isMe=player.id===myPlayer.id;
        const rankEmoji=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
        // Punkt 8: Die 2 höchsten erreichten Urkunden ermitteln
        const earnedBeg=[...BEGINNER_AWARDS].reverse().filter(a=>beginnerStars>=a.stars).slice(0,1);
        const earnedAdv=[...ADVANCED_AWARDS].reverse().filter(a=>totalStars>=a.stars).slice(0,1);
        const topAwards=[...earnedAdv,...earnedBeg].slice(0,2);
        return <div key={player.id} style={{background:isMe?"#10b98111":"var(--bg2)",border:`2px solid ${isMe?myPlayer.color+"88":idx===0?"#f59e0b44":"var(--border)"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
          {isMe&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:myPlayer.color}}/>}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:topAwards.length?8:0}}>
            <span style={{fontSize:18,minWidth:28}}>{rankEmoji}</span>
            <Avatar avatar={player.avatar} color={player.color} size={36}/>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:isMe?myPlayer.color:"var(--text)"}}>{player.firstName} {player.lastName}{isMe&&" (Du)"}</div>
              <div style={{fontSize:11,color:"var(--text3)"}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · {totalStars} ★</div>
            </div>
          </div>
          {/* Punkt 7: Urkunden unterhalb des Namens */}
          {topAwards.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",paddingLeft:36}}>
            {topAwards.map(a=><AwardBadge key={a.label} award={a} small/>)}
          </div>}
        </div>;
      })}
    </div>}

    {/* ── ERFOLGE ── */}
    {activeTab==="erfolge"&&<ErfolgeTab player={myPlayer}/>}

    {/* ── BEOBACHTUNGEN ── */}
    {activeTab==="beobachtungen"&&<BeobachtungenPlayerTab player={myPlayer}/>}
    {activeTab==="spielbetrieb"&&<SpielbetrieblTab isSuperAdmin={false}/>}

    <style>{`
      *{box-sizing:border-box}
      input::placeholder{color:var(--text4)}
      input,textarea{background:var(--input-bg)!important;color:var(--text)!important;border-color:var(--border2)!important}
      select{background:var(--sel-bg)!important;color:var(--text)!important;border:1px solid var(--border2)!important;border-radius:9px;padding:10px 13px;font-size:14px;width:100%;outline:none}
    `}</style>
  </div>;
}

// ─── ERFOLGE TAB (Spielerbereich) ─────────────────────────────────────────────
function ErfolgeTab({player}) {
  const {beginnerStars,totalStars}=getAward(player);

  // Ribbon-Badge Komponente (Option C)
  function RibbonBadge({emoji,label,color,date,earned}) {
    if (!earned) return null;
    return <div style={{
      display:"flex",alignItems:"center",gap:10,
      background:`linear-gradient(135deg,${color}22,${color}11)`,
      border:`2px solid ${color}66`,borderRadius:12,padding:"10px 14px",marginBottom:8,
      position:"relative",overflow:"hidden",
    }}>
      <div style={{
        position:"absolute",left:0,top:0,bottom:0,width:4,
        background:color,borderRadius:"12px 0 0 12px",
      }}/>
      <div style={{
        width:44,height:44,borderRadius:"50%",flexShrink:0,
        background:`linear-gradient(135deg,${color},${color}bb)`,
        display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,
        boxShadow:`0 2px 8px ${color}44`,
      }}>{emoji}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{label}</div>
        {date&&<div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>🗓️ Vergeben am {formatDateDE(date)}</div>}
        {!date&&<div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Datum noch nicht eingetragen</div>}
      </div>
      <div style={{flexShrink:0,width:28,height:28,borderRadius:"50%",background:color+"33",border:`2px solid ${color}66`,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{color,fontSize:14,fontWeight:800}}>✓</span>
      </div>
    </div>;
  }

  // Earned awards
  const earnedBeg = BEGINNER_AWARDS.filter(a=>beginnerStars>=a.stars);
  const earnedAdv = ADVANCED_AWARDS.filter(a=>totalStars>=a.stars);

  // Turniere sortiert absteigend nach Datum
  const allTournaments=[...(player.tournaments||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const vereinsTurniere = allTournaments.filter(t=>t.type==="vereinsintern");
  const externKreis = allTournaments.filter(t=>t.type==="extern_kreis");
  const externBezirk = allTournaments.filter(t=>t.type==="extern_bezirk");
  const externVerband = allTournaments.filter(t=>t.type==="extern_verband");

  function placeEmoji(p) {
    const n=parseInt(p);
    if(n===1)return "🥇";if(n===2)return "🥈";if(n===3)return "🥉";return `#${p}`;
  }

  function TournamentBadge({t}) {
    const placeN=parseInt(t.place||"99");
    const color=placeN===1?"#ffd700":placeN===2?"#b8b8b8":placeN===3?"#cd7f32":"#6b7280";
    const year=t.year||t.date?.slice(0,4)||"";
    const line1=[t.name,year].filter(Boolean).join(" ");
    const line2=[t.altersklasse,t.konkurrenz].filter(Boolean).join(" – ");
    const line3=t.date?formatDateDE(t.date):"";
    return <div style={{background:"var(--bg2)",border:`1px solid ${color}44`,borderRadius:11,padding:"10px 13px",marginBottom:7,display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:40,height:40,borderRadius:"50%",flexShrink:0,background:`${color}22`,border:`2px solid ${color}66`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{placeEmoji(t.place||"?")}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{line1||"Turnier"}</div>
        {line2&&<div style={{fontSize:11,color:"var(--text2)",marginTop:1}}>{line2}</div>}
        {line3&&<div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{line3}</div>}
      </div>
      <div style={{fontSize:22,fontWeight:900,color,flexShrink:0}}>{t.place||"?"}</div>
    </div>;
  }

  return <div style={{padding:14,paddingBottom:40}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:16}}>🏅 Meine Erfolge</div>

    {/* Training */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>🏋️ Training — Urkunden</div>
      {earnedBeg.length===0&&earnedAdv.length===0&&(
        <div style={{fontSize:12,color:"var(--text4)",textAlign:"center",padding:16}}>Noch keine Urkunden erreicht — weiter trainieren! 💪</div>
      )}
      {earnedBeg.map(a=>{
        const key=`awardDate_${a.label.replace(/\s/g,"_")}`;
        return <RibbonBadge key={a.label} emoji={a.emoji} label={a.label} color={a.color} date={player[key]} earned/>;
      })}
      {earnedAdv.map(a=>{
        const key=`awardDate_${a.label.replace(/\s/g,"_")}`;
        return <RibbonBadge key={a.label} emoji={a.emoji} label={a.label} color={a.color} date={player[key]} earned/>;
      })}

      {/* Trainingsbeteiligung */}
      {player.attendGoldDate&&<RibbonBadge emoji="🥇" label="Trainingsbeteiligung Gold >90%" color="#ffd700" date={player.attendGoldDate} earned/>}
      {player.attendSilverDate&&<RibbonBadge emoji="🥈" label="Trainingsbeteiligung Silber >80%" color="#b8b8b8" date={player.attendSilverDate} earned/>}
      {player.attendBronzeDate&&<RibbonBadge emoji="🥉" label="Trainingsbeteiligung Bronze >70%" color="#cd7f32" date={player.attendBronzeDate} earned/>}
    </div>

    {/* Vereinsturniere */}
    {vereinsTurniere.length>0&&<div style={{marginBottom:20}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>🏓 Turniere Verein</div>
      {vereinsTurniere.map((t,i)=><TournamentBadge key={i} t={t}/>)}
    </div>}

    {/* Externe Turniere */}
    {(externKreis.length>0||externBezirk.length>0||externVerband.length>0)&&<div style={{marginBottom:20}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>🌍 Turniere Extern</div>
      {externKreis.length>0&&<>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:6,paddingLeft:2}}>Kreis</div>
        {externKreis.map((t,i)=><TournamentBadge key={i} t={t}/>)}
      </>}
      {externBezirk.length>0&&<>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:6,paddingLeft:2,marginTop:8}}>Bezirk</div>
        {externBezirk.map((t,i)=><TournamentBadge key={i} t={t}/>)}
      </>}
      {externVerband.length>0&&<>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:6,paddingLeft:2,marginTop:8}}>Verband Hessen</div>
        {externVerband.map((t,i)=><TournamentBadge key={i} t={t}/>)}
      </>}
    </div>}

    {vereinsTurniere.length===0&&externKreis.length===0&&externBezirk.length===0&&externVerband.length===0&&earnedBeg.length===0&&earnedAdv.length===0&&!player.attendGoldDate&&!player.attendSilverDate&&!player.attendBronzeDate&&(
      <div style={{textAlign:"center",padding:30,color:"var(--text4)",fontSize:13}}>
        <div style={{fontSize:40,marginBottom:12}}>🏅</div>
        Noch keine Erfolge erfasst.<br/>Weiter trainieren und an Turnieren teilnehmen!
      </div>
    )}
  </div>;
}

// ─── BEOBACHTUNGEN TAB (Trainerbereich) ───────────────────────────────────────
function BeobachtungenAdminTab({players,user,showToast}) {
  const [selPlayerId,setSelPlayerId] = useState(players[0]?.id||null);
  const [observations,setObservations] = useState([]);
  const [loading,setLoading] = useState(false);
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState({date:new Date().toLocaleDateString("sv"),context:"Training",strengths:"",weaknesses:"",focus:""});
  const [expandedId,setExpandedId] = useState(null);

  const selPlayer = players.find(p=>p.id===selPlayerId)||players[0];

  // Beobachtungen laden wenn Spieler wechselt
  useEffect(()=>{
    if (!selPlayer) return;
    setLoading(true);
    const unsub = onSnapshot(
      collection(db,"observations",selPlayer.id,"entries"),
      snap=>{
        const data = snap.docs.map(d=>({id:d.id,...d.data()}))
          .sort((a,b)=>b.date.localeCompare(a.date));
        setObservations(data);
        setLoading(false);
      },
      ()=>setLoading(false)
    );
    return unsub;
  },[selPlayer?.id]);

  async function saveObs() {
    if (!selPlayer||(!form.strengths&&!form.weaknesses&&!form.focus)) {
      showToast("Bitte mindestens ein Feld ausfüllen","⚠️");
      return;
    }
    const entry = {
      ...form,
      trainerId: user?.uid||"",
      trainerName: user?.displayName||user?.email||"Trainer",
      createdAt: Date.now(),
    };
    try {
      await addDoc(collection(db,"observations",selPlayer.id,"entries"),entry);
      showToast("Beobachtung gespeichert","🔍");
      setShowForm(false);
      setForm({date:new Date().toLocaleDateString("sv"),context:"Training",strengths:"",weaknesses:"",focus:""});
    } catch(e) {
      showToast("Fehler beim Speichern: "+e.message,"❌");
      console.error("saveObs error:",e);
    }
  }

  async function deleteObs(id) {
    if (!window.confirm("Beobachtung löschen?")) return;
    await deleteDoc(doc(db,"observations",selPlayer.id,"entries",id)).catch(()=>{});
    showToast("Gelöscht","🗑️");
  }

  const CONTEXT_COLORS = {Training:"#3b82f6",Punktspiel:"#f59e0b",Turnier:"#10b981"};

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:12}}>🔍 Beobachtungen</div>

    {/* Spieler-Auswahl */}
    <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:14,paddingBottom:4}}>
      {players.map(p=>{
        const isActive=p.id===selPlayer?.id;
        return <button key={p.id} onClick={()=>{setSelPlayerId(p.id);setShowForm(false);}} style={{
          flexShrink:0,padding:"5px 10px 5px 7px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
          border:`2px solid ${isActive?p.color||"#10b981":"var(--border2)"}`,
          background:isActive?(p.color||"#10b981")+"22":"transparent",
          color:isActive?p.color||"#10b981":"var(--text2)",
          display:"flex",alignItems:"center",gap:5,
        }}><span>{p.avatar||"🏓"}</span>{p.firstName}</button>;
      })}
    </div>

    {selPlayer&&<>
      {/* Header mit Spieler-Info und Neu-Button */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:selPlayer.color||"#10b981"}}>{selPlayer.firstName} {selPlayer.lastName}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>{observations.length} Beobachtung{observations.length!==1?"en":""}</div>
        </div>
        <button onClick={()=>setShowForm(v=>!v)} style={{
          padding:"7px 14px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
          background:showForm?"transparent":"linear-gradient(135deg,#3b82f6,#1d4ed8)",
          border:showForm?"2px solid var(--border2)":"none",
          color:showForm?"var(--text3)":"#fff",
        }}>{showForm?"✕ Abbrechen":"+ Neue Beobachtung"}</button>
      </div>

      {/* Eingabe-Formular */}
      {showForm&&<div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:14,marginBottom:14}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
          <div>
            <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Datum</label>
            <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}
              style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg)",color:"var(--text)",fontSize:13}}/>
          </div>
          <div>
            <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Kontext</label>
            <select value={form.context} onChange={e=>setForm(p=>({...p,context:e.target.value}))}>
              <option>Training</option>
              <option>Punktspiel</option>
              <option>Turnier</option>
            </select>
          </div>
        </div>
        <div style={{marginBottom:8}}>
          <label style={{fontSize:11,color:"#10b981",display:"block",marginBottom:4,fontWeight:600}}>💪 Stärken</label>
          <textarea value={form.strengths} onChange={e=>setForm(p=>({...p,strengths:e.target.value}))}
            placeholder="Was lief gut? Was zeigt das Kind besonders gut?"
            rows={2} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #10b98144",background:"var(--bg)",color:"var(--text)",fontSize:13,resize:"vertical",outline:"none"}}/>
        </div>
        <div style={{marginBottom:8}}>
          <label style={{fontSize:11,color:"#f59e0b",display:"block",marginBottom:4,fontWeight:600}}>⚠️ Entwicklungsfelder</label>
          <textarea value={form.weaknesses} onChange={e=>setForm(p=>({...p,weaknesses:e.target.value}))}
            placeholder="Was soll verbessert werden? Wo gibt es Defizite?"
            rows={2} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #f59e0b44",background:"var(--bg)",color:"var(--text)",fontSize:13,resize:"vertical",outline:"none"}}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{fontSize:11,color:"#3b82f6",display:"block",marginBottom:4,fontWeight:600}}>🎯 Fokus nächstes Training</label>
          <textarea value={form.focus} onChange={e=>setForm(p=>({...p,focus:e.target.value}))}
            placeholder="Ein konkreter Fokuspunkt für das nächste Training"
            rows={1} style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #3b82f644",background:"var(--bg)",color:"var(--text)",fontSize:13,resize:"vertical",outline:"none"}}/>
        </div>
        <button onClick={saveObs} style={{width:"100%",padding:"10px",background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          💾 Beobachtung speichern
        </button>
      </div>}

      {/* Liste */}
      {loading&&<div style={{textAlign:"center",color:"var(--text3)",padding:20}}>Lädt…</div>}
      {!loading&&observations.length===0&&!showForm&&<div style={{textAlign:"center",color:"var(--text3)",padding:30,fontSize:13}}>
        Noch keine Beobachtungen für {selPlayer.firstName}.<br/>
        <span style={{fontSize:11}}>Klicke auf „+ Neue Beobachtung" um zu starten.</span>
      </div>}
      {observations.map(obs=>{
        const isExp=expandedId===obs.id;
        const ctxColor=CONTEXT_COLORS[obs.context]||"#6b7280";
        return <div key={obs.id} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,marginBottom:8,overflow:"hidden"}}>
          {/* Header */}
          <div onClick={()=>setExpandedId(isExp?null:obs.id)}
            style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
            <span style={{fontSize:11,fontWeight:700,color:ctxColor,background:ctxColor+"22",padding:"2px 8px",borderRadius:20,flexShrink:0}}>{obs.context}</span>
            <span style={{fontSize:12,color:"var(--text2)",flex:1}}>{new Date(obs.date).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}</span>
            <span style={{fontSize:10,color:"var(--text4)"}}>{obs.trainerName}</span>
            <span style={{color:"var(--text4)",fontSize:12}}>{isExp?"▲":"▼"}</span>
          </div>
          {/* Vorschau (immer sichtbar) */}
          {!isExp&&obs.focus&&<div style={{padding:"0 14px 10px",fontSize:12,color:"#93c5fd"}}>
            🎯 {obs.focus}
          </div>}
          {/* Detail (ausgeklappt) */}
          {isExp&&<div style={{padding:"0 14px 14px",borderTop:"1px solid var(--border)"}}>
            {obs.strengths&&<div style={{marginBottom:8,marginTop:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#10b981",marginBottom:3}}>💪 Stärken</div>
              <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{obs.strengths}</div>
            </div>}
            {obs.weaknesses&&<div style={{marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,color:"#f59e0b",marginBottom:3}}>⚠️ Entwicklungsfelder</div>
              <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{obs.weaknesses}</div>
            </div>}
            {obs.focus&&<div style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#3b82f6",marginBottom:3}}>🎯 Fokus nächstes Training</div>
              <div style={{fontSize:13,color:"var(--text)",lineHeight:1.5}}>{obs.focus}</div>
            </div>}
            <button onClick={()=>deleteObs(obs.id)} style={{padding:"4px 10px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}>🗑️ Löschen</button>
          </div>}
        </div>;
      })}
    </>}
  </div>;
}

// ─── BEOBACHTUNGEN TAB (Spielerbereich) ───────────────────────────────────────
function BeobachtungenPlayerTab({player}) {
  const [observations,setObservations] = useState([]);
  const [loading,setLoading] = useState(true);
  const [expandedId,setExpandedId] = useState(null);

  useEffect(()=>{
    if (!player) return;
    const unsub = onSnapshot(
      collection(db,"observations",player.id,"entries"),
      snap=>{
        const data = snap.docs.map(d=>({id:d.id,...d.data()}))
          .sort((a,b)=>b.date.localeCompare(a.date));
        setObservations(data);
        setLoading(false);
      },
      ()=>setLoading(false)
    );
    return unsub;
  },[player?.id]);

  const CONTEXT_COLORS = {Training:"#3b82f6",Punktspiel:"#f59e0b",Turnier:"#10b981"};
  const newestFocus = observations.find(o=>o.focus)?.focus;

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>🔍 Beobachtungen</div>
    <div style={{fontSize:11,color:"var(--text3)",marginBottom:14}}>Rückmeldungen deines Trainers aus Training, Spielen und Turnieren.</div>

    {/* Aktueller Fokus — prominent oben */}
    {newestFocus&&<div style={{background:"#3b82f622",border:"2px solid #3b82f6",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:"#3b82f6",marginBottom:4}}>🎯 Dein aktueller Trainingsfokus</div>
      <div style={{fontSize:14,color:"var(--text)",fontWeight:600,lineHeight:1.5}}>{newestFocus}</div>
    </div>}

    {loading&&<div style={{textAlign:"center",color:"var(--text3)",padding:20}}>Lädt…</div>}
    {!loading&&observations.length===0&&<div style={{textAlign:"center",padding:40}}>
      <div style={{fontSize:32,marginBottom:8}}>🔍</div>
      <div style={{fontSize:14,color:"var(--text2)",fontWeight:600}}>Noch keine Beobachtungen</div>
      <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>Dein Trainer hat noch keine Einträge hinterlegt.</div>
    </div>}

    {observations.map((obs,i)=>{
      const isExp=expandedId===obs.id;
      const ctxColor=CONTEXT_COLORS[obs.context]||"#6b7280";
      const isNewest=i===0;
      return <div key={obs.id} style={{
        background:"var(--bg2)",
        border:`1px solid ${isNewest?"var(--border2)":"var(--border)"}`,
        borderLeft:`3px solid ${ctxColor}`,
        borderRadius:12,marginBottom:8,overflow:"hidden",
        opacity:i>0?0.9:1,
      }}>
        <div onClick={()=>setExpandedId(isExp?null:obs.id)}
          style={{padding:"11px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
          <span style={{fontSize:11,fontWeight:700,color:ctxColor,background:ctxColor+"22",padding:"2px 8px",borderRadius:20,flexShrink:0}}>{obs.context}</span>
          <span style={{fontSize:12,color:"var(--text2)",flex:1}}>
            {new Date(obs.date).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"})}
          </span>
          {isNewest&&<span style={{fontSize:10,background:"#10b98122",color:"#10b981",padding:"1px 6px",borderRadius:10,fontWeight:600}}>NEU</span>}
          <span style={{color:"var(--text4)",fontSize:12}}>{isExp?"▲":"▼"}</span>
        </div>
        {/* Immer: Fokus-Vorschau */}
        {!isExp&&obs.focus&&<div style={{padding:"0 14px 10px",fontSize:12,color:"#93c5fd",lineHeight:1.4}}>
          🎯 {obs.focus}
        </div>}
        {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:"12px 14px"}}>
          {obs.strengths&&<div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#10b981",marginBottom:3}}>💪 Stärken</div>
            <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,background:"#10b98111",borderRadius:8,padding:"8px 10px"}}>{obs.strengths}</div>
          </div>}
          {obs.weaknesses&&<div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#f59e0b",marginBottom:3}}>⚠️ Entwicklungsfelder</div>
            <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,background:"#f59e0b11",borderRadius:8,padding:"8px 10px"}}>{obs.weaknesses}</div>
          </div>}
          {obs.focus&&<div>
            <div style={{fontSize:11,fontWeight:700,color:"#3b82f6",marginBottom:3}}>🎯 Fokus nächstes Training</div>
            <div style={{fontSize:13,color:"var(--text)",lineHeight:1.6,background:"#3b82f611",borderRadius:8,padding:"8px 10px"}}>{obs.focus}</div>
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}

// ─── SPIELBETRIEB TAB ─────────────────────────────────────────────────────────
const BASE = "https://www.mytischtennis.de/click-tt/HeTTV";
const CLUB = "verein/33053/TTC_Niederzeuzheim";
const S = "25--26"; // Saison

const TEAMS = [
  {
    id:"erw1",
    name:"Erwachsene I",
    liga:"West Bezirksliga Gr. West",
    gruppe:"496021",
    mannschaft:"2966286",
    mName:"Erwachsene",
    rang:10, punkte:"3:33",
    color:"#3b82f6",
  },
  {
    id:"erw2",
    name:"Erwachsene II",
    liga:"Kreisliga Gr. 3",
    gruppe:"496580",
    mannschaft:"2967555",
    mName:"Erwachsene_II_(4er)",
    rang:7, punkte:"15:21",
    color:"#10b981",
  },
  {
    id:"erw3",
    name:"Erwachsene III",
    liga:"1. Kreisklasse Gr. 3",
    gruppe:"496295",
    mannschaft:"2968581",
    mName:"Erwachsene_III_(4er)",
    rang:10, punkte:"18:26",
    color:"#f59e0b",
  },
  {
    id:"erw4",
    name:"Erwachsene IV",
    liga:"3. Kreisklasse Gr. 1",
    gruppe:"496366",
    mannschaft:"2969119",
    mName:"Erwachsene_IV_(4er)",
    rang:2, punkte:"26:6",
    color:"#ef4444",
  },
  {
    id:"erw5",
    name:"Erwachsene V",
    liga:"3. Kreisklasse Gr. 2",
    gruppe:"496450",
    mannschaft:"2966072",
    mName:"Erwachsene_V_(4er)",
    rang:9, punkte:"6:30",
    color:"#8b5cf6",
  },
  {
    id:"maed13",
    name:"Mädchen 13",
    liga:"Jugend 13 Kreisliga",
    gruppe:"496458",
    mannschaft:"2993877",
    mName:"M%C3%A4dchen_13",
    rang:7, punkte:"9:23",
    color:"#ec4899",
  },
  {
    id:"maed15",
    name:"Mädchen 15",
    liga:"Jugend 15 Kreisklasse",
    gruppe:"496479",
    mannschaft:"2993878",
    mName:"M%C3%A4dchen_15",
    rang:2, punkte:"20:8",
    color:"#14b8a6",
  },
];

function teamLinks(t) {
  const g = `${BASE}/${S}/ligen`;
  const liga = t.liga.replace(/ /g,"_").replace(/\./g,"");
  const mBase = `${g}/${liga}/gruppe/${t.gruppe}/mannschaft/${t.mannschaft}/${t.mName}`;
  return {
    tabelle:      `${g}/${liga}/gruppe/${t.gruppe}/tabelle/gesamt`,
    spielplan:    `${mBase}/spielplan/gesamt`,
    aufstellung:  `${mBase}/spielerbilanzen/gesamt`,
    einzelrl:     `${mBase}/rangliste/einzel`,
    doppelrl:     `${mBase}/rangliste/doppel`,
  };
}

function SpielbetrieblTab({isSuperAdmin}) {
  // Photos stored in Firestore config/teamPhotos as {teamId: url}
  const [teamPhotos,setTeamPhotos] = useState({});
  const [uploadingFor,setUploadingFor] = useState(null);

  useEffect(()=>{
    const unsub = onSnapshot(doc(db,"config","teamPhotos"),snap=>{
      if(snap.exists()) setTeamPhotos(snap.data());
    },()=>{});
    return unsub;
  },[]);

  async function handlePhotoUpload(teamId, file) {
    if (!file) return;
    setUploadingFor(teamId);
    // Store as base64 in Firestore (small images only)
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const updated = {...teamPhotos, [teamId]: dataUrl};
      await setDoc(doc(db,"config","teamPhotos"), updated, {merge:true}).catch(()=>{});
      setTeamPhotos(updated);
      setUploadingFor(null);
    };
    reader.readAsDataURL(file);
  }

  const LinkBtn = ({href,label,icon}) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      display:"inline-flex",alignItems:"center",gap:4,
      padding:"5px 9px",borderRadius:7,fontSize:11,fontWeight:600,
      background:"var(--bg3)",border:"1px solid var(--border2)",
      color:"var(--text2)",textDecoration:"none",
      whiteSpace:"nowrap",
    }}>{icon} {label}</a>
  );

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>🏆 Spielbetrieb</div>
    <div style={{fontSize:11,color:"var(--text3)",marginBottom:14}}>
      TTC Niederzeuzheim · Saison 2025/26 · Hessischer Tischtennis-Verband
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr",gap:12}}>
      {TEAMS.map(t=>{
        const links = teamLinks(t);
        const photo = teamPhotos[t.id];
        return <div key={t.id} style={{
          background:"var(--bg2)",borderRadius:14,overflow:"hidden",
          border:`1px solid var(--border)`,
          borderLeft:`4px solid ${t.color}`,
        }}>
          {/* Team header */}
          <div style={{display:"flex",alignItems:"stretch",minHeight:80}}>
            {/* Photo area */}
            <div style={{
              width:90,flexShrink:0,background:photo?"transparent":"var(--bg3)",
              display:"flex",alignItems:"center",justifyContent:"center",
              position:"relative",overflow:"hidden",
            }}>
              {photo
                ? <img src={photo} alt={t.name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                : <span style={{fontSize:28}}>🏓</span>
              }
              {isSuperAdmin&&<label style={{
                position:"absolute",bottom:0,left:0,right:0,
                background:"rgba(0,0,0,0.55)",color:"#fff",
                fontSize:9,textAlign:"center",padding:"3px 0",cursor:"pointer",
              }}>
                {uploadingFor===t.id?"⏳":photo?"📷 ändern":"📷 Foto"}
                <input type="file" accept="image/*" style={{display:"none"}}
                  onChange={e=>handlePhotoUpload(t.id, e.target.files?.[0])}
                  disabled={uploadingFor===t.id}/>
              </label>}
            </div>

            {/* Team info */}
            <div style={{flex:1,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                <div style={{fontSize:14,fontWeight:800,color:t.color}}>{t.name}</div>
                <div style={{
                  fontSize:11,fontWeight:700,
                  color:t.rang<=3?"#10b981":t.rang<=6?"#f59e0b":"var(--text3)",
                  background:t.rang<=3?"#10b98122":t.rang<=6?"#f59e0b22":"var(--bg3)",
                  padding:"2px 7px",borderRadius:20,
                }}>Platz {t.rang}</div>
              </div>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>{t.liga}</div>
              <div style={{fontSize:11,color:"var(--text2)"}}>
                Punkte: <b style={{color:"var(--text)"}}>{t.punkte}</b>
              </div>
            </div>
          </div>

          {/* Links */}
          <div style={{padding:"8px 12px 10px",borderTop:"1px solid var(--border)",display:"flex",gap:6,flexWrap:"wrap"}}>
            <LinkBtn href={links.tabelle}    label="Tabelle"    icon="📊"/>
            <LinkBtn href={links.spielplan}  label="Spielplan"  icon="📅"/>
            <LinkBtn href={links.aufstellung} label="Aufstellung" icon="👥"/>
            <LinkBtn href={links.einzelrl}   label="Einzel-RL"  icon="🥇"/>
            <LinkBtn href={links.doppelrl}   label="Doppel-RL"  icon="🥈"/>
          </div>
        </div>;
      })}
    </div>

    {/* Link to full overview */}
    <a href={`${BASE}/10--11/${CLUB}/mannschaften`} target="_blank" rel="noopener noreferrer"
      style={{display:"block",marginTop:16,textAlign:"center",fontSize:12,color:"#3b82f6",textDecoration:"none"}}>
      🌐 Alle Mannschaften auf myTischtennis.de →
    </a>
  </div>;
}

// ─── ROLE SWITCH WRAPPER ──────────────────────────────────────────────────────
// Zeigt Switch-Bar oben und wechselt zwischen Player/Trainer/Admin-View
function RoleSwitchWrapper({user,players,attendance,rackets,myPlayer,availableViews,hasAdminRole,
  globalTheme,onSetGlobalTheme,onPlayerAdded,isDark,onSetUserTheme,userTheme,onSignOut}) {

  const [activeView,setActiveView] = useState(availableViews[0]||"player");
  // Punkt 4+5: Impersonierung — welchen Spieler schaut man sich an?
  const [viewAsPlayer,setViewAsPlayer] = useState(myPlayer?.id||null);
  const [groupFilter,setGroupFilter] = useState("all");

  const VIEW_CONFIG = {
    player:  {icon:"🏓", label:"Spieler",  color:"#10b981"},
    trainer: {icon:"🛡️", label:"Trainer",  color:"#3b82f6"},
    admin:   {icon:"⚙️", label:"Admin",    color:"#f59e0b"},
  };

  const sharedProps = {isDark,onSetUserTheme,userTheme,onSignOut};

  // Spieler nach Gruppe gefiltert für die Auswahl
  const activePlayers = [...players.filter(p=>p.status!=="passiv")]
    .sort((a,b)=>{
      const fa=(a.firstName||a.name||"").toLowerCase();
      const fb=(b.firstName||b.name||"").toLowerCase();
      if(fa!==fb) return fa.localeCompare(fb,"de");
      return (a.lastName||"").localeCompare(b.lastName||"","de");
    });
  const GROUP_COLORS = {Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6"};
  const filteredChips = groupFilter==="all" ? activePlayers
    : activePlayers.filter(p=>(p.group||"Anfänger")===groupFilter);
  const selectedPlayer = players.find(p=>p.id===viewAsPlayer) || myPlayer || activePlayers[0];

  // Fake user object for impersonation
  const fakeUser = selectedPlayer ? {...(user||{}), email: selectedPlayer.email||user?.email} : user;

  return <div style={{background:"var(--bg)",minHeight:"100vh"}}>
    {/* Role Switch Bar */}
    <div style={{
      background:"var(--bg2)",borderBottom:"2px solid var(--border2)",
      padding:"8px 14px",display:"flex",alignItems:"center",gap:8,
      position:"sticky",top:0,zIndex:500,
    }}>
      {availableViews.map(v=>{
        const cfg=VIEW_CONFIG[v];
        const isActive=activeView===v;
        return <button key={v} onClick={()=>setActiveView(v)} style={{
          padding:"6px 12px",borderRadius:20,border:`2px solid ${isActive?cfg.color:cfg.color+"44"}`,
          background:isActive?cfg.color+"22":"transparent",
          color:isActive?cfg.color:"var(--text3)",
          fontSize:12,fontWeight:700,cursor:"pointer",
          display:"flex",alignItems:"center",gap:4,flexShrink:0,
        }}>{cfg.icon} {cfg.label}</button>;
      })}
      <div style={{flex:1}}/>
      <ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>
      <button onClick={onSignOut} title="Abmelden" style={{
        padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",
        borderRadius:8,color:"var(--text2)",fontSize:16,cursor:"pointer",lineHeight:1,flexShrink:0,
      }}>⏻</button>
    </div>

    {/* Punkt 5: Spieler-Auswahl für Trainer/Admin in Spieler-Ansicht */}
    {activeView==="player"&&(hasAdminRole||(availableViews.includes("trainer")))&&<div style={{
      background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"8px 14px",
      position:"sticky",top:44,zIndex:499,
    }}>
      {/* Gruppenfilter */}
      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
        <button onClick={()=>setGroupFilter("all")} style={{
          padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
          border:`2px solid ${groupFilter==="all"?"#6b7280":"#6b728044"}`,
          background:groupFilter==="all"?"#6b728022":"transparent",
          color:groupFilter==="all"?"#9ca3af":"#6b728066",
        }}>Alle</button>
        {["Profis","Fortgeschrittene","Anfänger","Trainer"].map(g=>{
          const c=GROUP_COLORS[g]; const on=groupFilter===g;
          return <button key={g} onClick={()=>setGroupFilter(g)} style={{
            padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
            border:`2px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:c+"66",
          }}>{g}</button>;
        })}
      </div>
      {/* Spieler-Chips */}
      <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
        {filteredChips.map(p=>{
          const isActive=p.id===selectedPlayer?.id;
          return <button key={p.id} onClick={()=>setViewAsPlayer(p.id)} style={{
            flexShrink:0,padding:"3px 9px 3px 6px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
            border:`2px solid ${isActive?p.color||"#10b981":"var(--border2)"}`,
            background:isActive?(p.color||"#10b981")+"22":"transparent",
            color:isActive?p.color||"#10b981":"var(--text2)",
            display:"flex",alignItems:"center",gap:4,
          }}><span style={{fontSize:13}}>{p.avatar||"🏓"}</span>{p.firstName}</button>;
        })}
      </div>
    </div>}

    {/* Aktive View */}
    {activeView==="player"&&<PlayerView
      user={user}
      players={players}
      attendance={attendance}
      forcePlayer={selectedPlayer}
      hideHeader
      {...sharedProps}/>}
    {activeView==="trainer"&&<AdminPanel
      user={user} players={players} attendance={attendance} rackets={rackets}
      isSuperAdmin={false}
      globalTheme={globalTheme} onSetGlobalTheme={onSetGlobalTheme}
      onPlayerAdded={onPlayerAdded}
      hideHeader {...sharedProps}/>}
    {activeView==="admin"&&<AdminPanel
      user={user} players={players} attendance={attendance} rackets={rackets}
      isSuperAdmin={true}
      globalTheme={globalTheme} onSetGlobalTheme={onSetGlobalTheme}
      onPlayerAdded={onPlayerAdded}
      hideHeader {...sharedProps}/>}
  </div>;
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser,     setAuthUser]     = useState(undefined);
  const [players,      setPlayers]      = useState([]);
  const [attendance,   setAttendance]   = useState({});
  const [rackets,      setRackets]      = useState([]);
  const [loginErr,     setLoginErr]     = useState("");
  const [loginLoad,    setLoginLoad]    = useState(false);
  const [isAdmin,      setIsAdmin]      = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminReady,   setAdminReady]   = useState(false);
  const [loginSuccess, setLoginSuccess] = useState("");
  // Punkt 4: Theme (dark/light)
  const [globalTheme,  setGlobalTheme]  = useState("dark");
  const [userTheme,    setUserTheme]    = useState(()=>localStorage.getItem("ttc_theme")||"");

  // Effektives Theme: Nutzer-Präferenz hat Vorrang
  const theme = userTheme || globalTheme;
  const isDark = theme==="dark";

  // CSS-Variablen mit konkreten Hex-Werten setzen (KEIN var() hier!)
  useEffect(()=>{
    const r = document.documentElement;
    if (isDark) {
      r.style.setProperty("--bg",       "#0d1117");
      r.style.setProperty("--bg2",      "#111827");
      r.style.setProperty("--bg3",      "#1f2937");
      r.style.setProperty("--border",   "#1f2937");
      r.style.setProperty("--border2",  "#374151");
      r.style.setProperty("--text",     "#e5e7eb");
      r.style.setProperty("--text2",    "#9ca3af");
      r.style.setProperty("--text3",    "#6b7280");
      r.style.setProperty("--text4",    "#4b5563");
      r.style.setProperty("--input-bg", "#0d1117");
      r.style.setProperty("--sel-bg",   "#0d1117");
    } else {
      r.style.setProperty("--bg",       "#f3f4f6");
      r.style.setProperty("--bg2",      "#ffffff");
      r.style.setProperty("--bg3",      "#e5e7eb");
      r.style.setProperty("--border",   "#e5e7eb");
      r.style.setProperty("--border2",  "#d1d5db");
      r.style.setProperty("--text",     "#111827");
      r.style.setProperty("--text2",    "#374151");
      r.style.setProperty("--text3",    "#6b7280");
      r.style.setProperty("--text4",    "#9ca3af");
      r.style.setProperty("--input-bg", "#ffffff");
      r.style.setProperty("--sel-bg",   "#f9fafb");
    }
    document.body.style.background = isDark ? "#0d1117" : "#f3f4f6";
    document.body.style.color = isDark ? "#e5e7eb" : "#111827";
  },[isDark]);

  // Globale Theme-Einstellung aus Firestore laden
  useEffect(()=>{
    const unsub=onSnapshot(doc(db,"config","theme"),snap=>{
      if(snap.exists()) setGlobalTheme(snap.data().mode||"dark");
    },()=>{});
    return unsub;
  },[]);

  function handleSetUserTheme(mode) {
    setUserTheme(mode);
    if(mode) localStorage.setItem("ttc_theme",mode);
    else localStorage.removeItem("ttc_theme");
  }

  async function handleSetGlobalTheme(mode) {
    setGlobalTheme(mode);
    await setDoc(doc(db,"config","theme"),{mode}).catch(()=>{});
  }

  // ── Auth listener mit robustem Admin-Check ──
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, async u => {
      setAuthUser(u || null);
      if (!u) { setIsAdmin(false); setIsSuperAdmin(false); setAdminReady(true); return; }

      // 1) E-Mail-Vergleich (ADMIN_EMAILS → immer Trainer+Admin)
      if (isAdminEmail(u.email)) {
        setIsAdmin(true);
        setIsSuperAdmin(isSuperAdminEmail(u.email));
        setAdminReady(true); return;
      }

      // 2) Firestore trainers-Collection (Legacy)
      try {
        const snap = await getDoc(doc(db, "trainers", u.uid));
        if (snap.exists() && snap.data().role === "admin") {
          setIsAdmin(true);
          setIsSuperAdmin(snap.data().superAdmin===true || isSuperAdminEmail(u.email));
          setAdminReady(true); return;
        }
      } catch(e) {}

      // 3) Rollen werden jetzt über players-Collection gesteuert (roles.trainer/admin)
      // Wird in Root render ausgewertet sobald players geladen sind
      setIsAdmin(false); setIsSuperAdmin(false); setAdminReady(true);
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
    // Erst state löschen, dann ausloggen
    // adminReady NICHT auf false setzen — onAuthStateChanged(null) setzt es korrekt auf true
    setPlayers([]); setAttendance({}); setRackets([]); setIsAdmin(false); setLoginSuccess("");
    try { await signOut(auth); } catch(e) {}
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

  // ── Ladezustand: nur beim allerersten Start (authUser noch unbekannt) ──
  if (authUser === undefined) return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>🏓</div>
      <div style={{fontSize:14,color:"var(--text3)"}}>TTC Niederzeuzheim wird geladen…</div>
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

  // ── Spieler-Profil suchen ──
  const myPlayer = players.find(p => p.email?.toLowerCase() === authUser.email?.toLowerCase());

  // Rollen aus Spieler-Profil ermitteln
  const playerRoles = myPlayer?.roles || {};
  const hasTrainerRole = isAdmin || playerRoles.trainer === true;
  const hasAdminRole   = isSuperAdmin || playerRoles.admin === true;
  const hasPlayerRole  = !isAdmin || playerRoles.player === true || !!myPlayer;

  // Verfügbare Views für diese Person
  const availableViews = [];
  if (hasPlayerRole && myPlayer) availableViews.push("player");
  if (hasTrainerRole)             availableViews.push("trainer");
  if (hasAdminRole)               availableViews.push("admin");
  if (availableViews.length === 0 && isAdmin) availableViews.push("trainer");

  // Angemeldet als reiner Trainer (keine Spieler-Rolle, kein Profil) → Trainer-View
  if (!myPlayer && !isAdmin) return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{maxWidth:400,width:"100%"}}>
        <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:16,padding:24,textAlign:"center"}}>
          <div style={{fontSize:40,marginBottom:12}}>🔑</div>
          <div style={{fontSize:16,fontWeight:800,color:"var(--text)",marginBottom:8}}>Bist du ein Trainer?</div>
          <div style={{fontSize:13,color:"var(--text3)",marginBottom:20,lineHeight:1.6}}>
            Angemeldet als: <b style={{color:"#10b981"}}>{authUser.email}</b>
          </div>
          <button onClick={makeAdminInFirestore} style={{width:"100%",padding:12,marginBottom:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>
            ✅ Trainer-Zugang freischalten
          </button>
          <button onClick={handleSignOut} style={{width:"100%",padding:10,background:"transparent",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text3)",fontSize:13,cursor:"pointer"}}>Abmelden</button>
        </div>
      </div>
    </div>
  );

  // Gemeinsame Props
  const sharedProps = {
    isDark, onSetUserTheme:handleSetUserTheme, userTheme,
    onSignOut:handleSignOut,
  };

  // Wenn nur eine View verfügbar → direkt rendern ohne Switch
  if (availableViews.length <= 1) {
    if (isAdmin || hasTrainerRole) return (
      <AdminPanel user={authUser} players={players} attendance={attendance} rackets={rackets}
        isSuperAdmin={hasAdminRole} globalTheme={globalTheme} onSetGlobalTheme={handleSetGlobalTheme}
        onPlayerAdded={name=>setLoginSuccess(`${name} wurde angelegt!`)} {...sharedProps}/>
    );
    return <PlayerView user={authUser} players={players} attendance={attendance} {...sharedProps}/>;
  }

  // Mehrere Views → RoleSwitch wrapper
  return (
    <RoleSwitchWrapper
      user={authUser}
      players={players}
      attendance={attendance}
      rackets={rackets}
      myPlayer={myPlayer}
      availableViews={availableViews}
      hasAdminRole={hasAdminRole}
      globalTheme={globalTheme}
      onSetGlobalTheme={handleSetGlobalTheme}
      onPlayerAdded={name=>setLoginSuccess(`${name} wurde angelegt!`)}
      {...sharedProps}
    />
  );
}
