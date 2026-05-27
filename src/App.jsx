import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
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
  {id:1, name:"Seilspringen",                          symbol:"🪢",
   description:"Es wird die Anzahl der Sprünge gezählt, die in 1 Minute geschafft werden.",
   thresholds:["25 Sprünge","50 Sprünge","75 Sprünge","100 Sprünge","125 Sprünge"]},
  {id:2, name:"Wandsitzen",                            symbol:"🧱",
   description:"Es wird die Zeit gemessen, die ein Kind an der Wand sitzen kann (Oberschenkel und Unterschenkel im rechten Winkel zueinander).",
   thresholds:["1 Minute","2 Minuten","3 Minuten","4 Minuten","5 Minuten"]},
  {id:3, name:"Vorhand tippen",                        symbol:"🏓",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler auf der Vorhand getippt wird.",
   thresholds:["10×","25×","50×","100×","150×"]},
  {id:4, name:"Rückhand tippen",                       symbol:"🏓",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler auf der Rückhand getippt wird.",
   thresholds:["10×","25×","50×","100×","150×"]},
  {id:5, name:"Vorhand/Rückhand abwechselnd tippen",   symbol:"🔄",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler abwechselnd auf der Vorhand und Rückhand getippt wird.",
   thresholds:["5×","15×","25×","50×","100×"]},
  {id:6, name:"Vorhand balancieren",                   symbol:"⚖️",
   description:"Es wird gemessen, wie weit der Ball auf der Vorhand balanciert wird, ohne dass er vom Schläger fällt.",
   thresholds:["10 m","25 m","50 m","100 m","200 m"]},
  {id:7, name:"Rückhand balancieren",                  symbol:"⚖️",
   description:"Es wird gemessen, wie weit der Ball auf der Rückhand balanciert wird, ohne dass er vom Schläger fällt.",
   thresholds:["10 m","25 m","50 m","100 m","200 m"]},
  {id:8, name:"Vorhand prellen",                       symbol:"⬇️",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler mit der Vorhand auf dem Boden geprellt wird.",
   thresholds:["10×","25×","50×","100×","150×"]},
  {id:9, name:"Rückhand prellen",                      symbol:"⬇️",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler mit der Rückhand auf dem Boden geprellt wird.",
   thresholds:["10×","25×","50×","100×","150×"]},
  {id:10,name:"Vorhand/Rückhand abwechselnd prellen",  symbol:"🔄",
   description:"Es wird gezählt, wie oft der Ball ohne Fehler abwechselnd mit der VH und RH auf dem Boden geprellt wird.",
   thresholds:["10×","25×","50×","75×","100×"]},
];
const EXERCISES_ADVANCED = [
  {id:11,name:"Roll-Aufschlag VH diagonal",            symbol:"↗️",
   description:"Es wird gezählt, wie viele von 20 Vorhand-Rollaufschlägen diagonal im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:12,name:"Roll-Aufschlag VH parallel",            symbol:"➡️",
   description:"Es wird gezählt, wie viele von 20 Vorhand-Rollaufschlägen parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:13,name:"Roll-Aufschlag RH diagonal",            symbol:"↗️",
   description:"Es wird gezählt, wie viele von 20 Rückhand-Rollaufschlägen diagonal im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:14,name:"Roll-Aufschlag RH parallel",            symbol:"➡️",
   description:"Es wird gezählt, wie viele von 20 Rückhand-Rollaufschlägen parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:15,name:"Roll-Aufschlag VH diagonal/parallel Wechsel", symbol:"🔀",
   description:"Es wird gezählt, wie viele von 20 VH-Rollaufschlägen abwechselnd diagonal und parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:16,name:"Roll-Aufschlag RH diagonal/parallel Wechsel", symbol:"🔀",
   description:"Es wird gezählt, wie viele von 20 RH-Rollaufschlägen abwechselnd diagonal und parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:17,name:"Roll-Aufschlag VH diagonal auf 6 Becher", symbol:"🥤",
   description:"Es werden die Aufschläge gezählt, die benötigt werden, um 6 Becher vom Tisch zu bekommen. Die Becher werden nach Treffern wieder aufgestellt.",
   thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:18,name:"Roll-Aufschlag VH parallel auf 6 Becher",  symbol:"🥤",
   description:"Es werden die Aufschläge gezählt, die benötigt werden, um 6 Becher mit VH parallel vom Tisch zu bekommen.",
   thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:19,name:"Roll-Aufschlag RH diagonal auf 6 Becher",  symbol:"🥤",
   description:"Es werden die Aufschläge gezählt, die benötigt werden, um 6 Becher mit RH diagonal vom Tisch zu bekommen.",
   thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:20,name:"Roll-Aufschlag RH parallel auf 6 Becher",  symbol:"🥤",
   description:"Es werden die Aufschläge gezählt, die benötigt werden, um 6 Becher mit RH parallel vom Tisch zu bekommen.",
   thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"]},
  {id:21,name:"Unterschnitt-Aufschlag VH diagonal",    symbol:"↙️",
   description:"Es wird gezählt, wie viele von 20 VH-Unterschnitt-Aufschlägen diagonal im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:22,name:"Unterschnitt-Aufschlag VH parallel",    symbol:"↙️",
   description:"Es wird gezählt, wie viele von 20 VH-Unterschnitt-Aufschlägen parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:23,name:"Unterschnitt-Aufschlag RH diagonal",    symbol:"↙️",
   description:"Es wird gezählt, wie viele von 20 RH-Unterschnitt-Aufschlägen diagonal im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:24,name:"Unterschnitt-Aufschlag RH parallel",    symbol:"↙️",
   description:"Es wird gezählt, wie viele von 20 RH-Unterschnitt-Aufschlägen parallel im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:25,name:"Unterschnitt-AS VH diagonal / Ball zurück", symbol:"↩️",
   description:"Es wird gezählt, bei wie vielen von 20 VH-Unterschnitt-Aufschlägen diagonal der Ball auf dem Tisch zurückrollt.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:26,name:"Unterschnitt-AS VH parallel / Ball zurück",  symbol:"↩️",
   description:"Es wird gezählt, bei wie vielen von 20 VH-Unterschnitt-Aufschlägen parallel der Ball auf dem Tisch zurückrollt.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:27,name:"Unterschnitt-AS RH diagonal / Ball zurück",  symbol:"↩️",
   description:"Es wird gezählt, bei wie vielen von 20 RH-Unterschnitt-Aufschlägen diagonal der Ball auf dem Tisch zurückrollt.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:28,name:"Unterschnitt-AS RH parallel / Ball zurück",  symbol:"↩️",
   description:"Es wird gezählt, bei wie vielen von 20 RH-Unterschnitt-Aufschlägen parallel der Ball auf dem Tisch zurückrollt.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:29,name:"Vorhand Schupf diagonal",               symbol:"🍂",
   description:"Es wird gezählt, wie viele Schupf-Schläge ohne Fehler von beiden Spieler:innen korrekt diagonal ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:30,name:"Rückhand Schupf diagonal",              symbol:"🍂",
   description:"Es wird gezählt, wie viele Rückhand-Schupf-Schläge ohne Fehler von beiden Spieler:innen korrekt diagonal ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:31,name:"Vorhand Kontern diagonal",              symbol:"⚡",
   description:"Es wird gezählt, wie viele VH-Konterschläge ohne Fehler von beiden Spieler:innen korrekt diagonal ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:32,name:"Rückhand Kontern diagonal",             symbol:"⚡",
   description:"Es wird gezählt, wie viele RH-Konterschläge ohne Fehler von beiden Spieler:innen korrekt diagonal ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:33,name:"Vorhand auf Rückhand Kontern parallel", symbol:"↔️",
   description:"Es wird gezählt, wie viele VH-auf-RH-Konterschläge ohne Fehler von beiden Spieler:innen korrekt parallel ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:34,name:"Rückhand auf Vorhand Kontern parallel", symbol:"↔️",
   description:"Es wird gezählt, wie viele RH-auf-VH-Konterschläge ohne Fehler von beiden Spieler:innen korrekt parallel ausgeführt werden.",
   thresholds:["10×","25×","50×","100×","200×"]},
  {id:35,name:"Vorhand-Topspin diagonal auf Balleimer (US)", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 VH-Topspins diagonal auf den Balleimer (Unterschnitt) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:36,name:"Vorhand-Topspin parallel auf Balleimer (US)", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 VH-Topspins parallel auf den Balleimer (Unterschnitt) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:37,name:"Vorhand-Topspin diagonal/parallel Wechsel auf Balleimer", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 VH-Topspins abwechselnd diagonal und parallel auf den Balleimer (US) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:38,name:"Rückhand-Topspin diagonal auf Balleimer (US)", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 RH-Topspins diagonal auf den Balleimer (Unterschnitt) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:39,name:"Rückhand-Topspin parallel auf Balleimer (US)", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 RH-Topspins parallel auf den Balleimer (Unterschnitt) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
  {id:40,name:"Rückhand-Topspin diagonal/parallel Wechsel auf Balleimer", symbol:"🌀",
   description:"Es wird gezählt, wie viele von 20 RH-Topspins abwechselnd diagonal und parallel auf den Balleimer (US) im Ziel ankommen.",
   thresholds:["5×","10×","15×","18×","20×"]},
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
const GROUPS = ["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"];
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
function LoginScreen({onLogin,error,loading,successMessage,clubConfig={}}) {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [resetMode,setResetMode]=useState(false);
  const [resetEmail,setResetEmail]=useState("");
  const [resetSent,setResetSent]=useState(false);
  const [resetErr,setResetErr]=useState("");
  const [resetLoad,setResetLoad]=useState(false);
  const [uploadingLogo,setUploadingLogo]=useState(false);

  const clubName = clubConfig.name || "TTC Niederzeuzheim";
  const clubSubtitle = clubConfig.subtitle || "Trainings-App";
  const clubLogo = clubConfig.logo || "";

  async function handleLogoUpload(file) {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target.result;
        // Save as data URL in Firestore (no Storage needed)
        const updated = {...clubConfig, logo: dataUrl};
        await setDoc(doc(db,"config","clubConfig"), updated).catch(()=>{});
        setUploadingLogo(false);
      };
      reader.readAsDataURL(file);
    } catch(e) { setUploadingLogo(false); }
  }

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
        {/* Vereinswappen oder Standard-Emoji */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
          {clubLogo
            ? <img src={clubLogo} alt="Vereinswappen" style={{width:120,height:120,objectFit:"contain",borderRadius:8}}/>
            : <div style={{fontSize:56}}>🏓</div>
          }
        </div>
        <div style={{fontSize:22,fontWeight:800,color:"var(--text)"}}>{clubName}</div>
        <div style={{fontSize:13,color:"var(--text3)",marginTop:4}}>{clubSubtitle}</div>
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
function AdminPanel({user,players,attendance,rackets,isSuperAdmin,isDark,onSetUserTheme,userTheme,globalTheme,onSignOut,onPlayerAdded,hideHeader,externalPlayer,showOnlyPresentExt,onSetShowOnlyPresent,clubConfig={},groupFiltersExt}) {
  const ALL_TABS=[
    {key:"training",     label:"Training",      icon:"📅"},
    {key:"teilnahme",    label:"Teilnahme",     icon:"📊"},
    {key:"einheiten",    label:"Einheiten",     icon:"📝"},
    {key:"uebungen",     label:"Übungen",       icon:"🏋️"},
    {key:"rangliste",    label:"Rangliste",     icon:"🏆"},
    {key:"beobachtungen",label:"Beobachtungen", icon:"🔍"},
    {key:"spielbetrieb", label:"Spielbetrieb",  icon:"📋"},
    {key:"aufstellung",  label:"Aufstellung",   icon:"📋"},
    {key:"spielplan",    label:"Spielplan",     icon:"📅"},
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
  // Sync external player selection from RSW chips
  useEffect(()=>{
    if(externalPlayer){
      setSelectedPlayer(externalPlayer.id);
      setActiveTab("uebungen");
    }
  },[externalPlayer?.id]);
  const [toast,setToast]=useState(null);
  const [saving,setSaving]=useState(false);
  const [groupFilters,setGroupFilters]=useState({Profis:true,Fortgeschrittene:true,Anfänger:true,Trainer:true});
  // Wenn RSW adminGroupFilters gesetzt, diese verwenden
  const effectiveGroupFilters = groupFiltersExt && Object.keys(groupFiltersExt).some(Boolean)
    ? {Profis:groupFiltersExt["Profis"]||false, Fortgeschrittene:groupFiltersExt["Fortgeschrittene"]||false,
       Anfänger:groupFiltersExt["Anfänger"]||false, Trainer:groupFiltersExt["Trainer"]||false,
       Erwachsene:groupFiltersExt["Erwachsene"]||false}
    : groupFilters;
  const [showOnlyPresentLocal,setShowOnlyPresentLocal]=useState(false);
  const showOnlyPresent = showOnlyPresentExt !== undefined ? showOnlyPresentExt : showOnlyPresentLocal;
  const setShowOnlyPresent = onSetShowOnlyPresent || setShowOnlyPresentLocal;
  // Punkt 7: Teilnahme-Drilldown
  const [teilnahmePlayer,setTeilnahmePlayer]=useState(null);
  // Punkt 6: Geburtstags-Popup
  const [birthdayPopupDismissed,setBirthdayPopupDismissed]=useState(false);

  function toggleGroupFilter(g){setGroupFilters(f=>({...f,[g]:!f[g]}));}
  function showToast(msg,emoji="✅"){setToast({msg,emoji});setTimeout(()=>setToast(null),2200);}

  const activePlayers = players.filter(p=>p.status!=="passiv"&&(p.group||"Anfänger")!=="Erwachsene");
  const visiblePlayers = activePlayers
    .filter(p=>{
      const g = p.group||"Anfänger";
      if (g==="Erwachsene") return false; // Erwachsene immer separat in RoleSwitchWrapper
      return effectiveGroupFilters[g] !== false;
    })
    .sort((a,b)=>{
      const fa=(a.firstName||a.name||"").toLowerCase();
      const fb=(b.firstName||b.name||"").toLowerCase();
      if(fa!==fb) return fa.localeCompare(fb,"de");
      return (a.lastName||"").localeCompare(b.lastName||"","de");
    });
  const curPlayer = visiblePlayers.find(p=>p.id===selectedPlayer)||visiblePlayers[0];
  const filteredEx = exerciseFilter==="beginner"?EXERCISES_BEGINNER:exerciseFilter==="advanced"?EXERCISES_ADVANCED:ALL_EXERCISES;
  const sortedRanking = [...visiblePlayers].filter(p=>(p.group||"Anfänger")!=="Erwachsene").sort((a,b)=>getAward(b).totalStars-getAward(a).totalStars);

  async function setStars(playerId,exId,value) {
    setSaving(true);
    try { await updateDoc(doc(db,"players",String(playerId)),{[`stars.${exId}`]:value}); showToast("Gespeichert","💾"); }
    catch(e){showToast("Fehler","❌");}
    setSaving(false);
  }

  // Punkt 6: Geburtstage seit letztem Training — letzter DIENSTAG als Referenz
  // (Anfänger/Fortgeschrittene trainieren nur Di → wir nehmen den frühesten letzten Tag)
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr2 = today.toLocaleDateString("sv");
  const lastTue = [...ALL_TUESDAYS].reverse().find(d=>d<=todayStr2) || ALL_TUESDAYS[0];
  const lastFri = [...ALL_FRIDAYS].reverse().find(d=>d<=todayStr2)  || ALL_FRIDAYS[0];
  // Use the LATER of the two = most recent training day (not the earlier/broader window)
  // Anfänger/Fortgeschrittene only train Tuesday, so lastTue is the correct reference
  const lastTraining = lastTue > lastFri ? lastTue : lastFri; // most recent training
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

  return <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:1024,margin:"0 auto",paddingBottom:80}}>
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

    {/* Standalone header + chips - only when NOT inside RSW */}
    {!hideHeader&&<div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:1024,zIndex:97,background:"var(--bg2)"}}>
      <div style={{background:"linear-gradient(135deg,var(--bg2),var(--bg))",borderBottom:"1px solid var(--border)",padding:"14px 14px 6px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,background:"linear-gradient(135deg,#10b981,#3b82f6)",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏓</div>
            <div>
              <div style={{fontSize:15,fontWeight:800}}>TTC Niederzeuzheim</div>
              <div style={{fontSize:11,color:"#10b981",fontWeight:600}}>🛡️ Trainer-Bereich</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <BirthdayBtn players={players} attendance={attendance}/>
            {saving&&<span style={{fontSize:11,color:"#f59e0b"}}>💾</span>}
            <ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>
            <button onClick={onSignOut} title="Abmelden" style={{padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text2)",fontSize:16,cursor:"pointer",lineHeight:1}}>⏻</button>
          </div>
        </div>
      </div>
      <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"8px 14px 6px"}}>
        <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
          {["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"].map(g=>{
            const colors={Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6",Erwachsene:"#ec4899"};
            const c=colors[g]; const on=groupFilters[g];
            return <button key={g} onClick={()=>toggleGroupFilter(g)} style={{
              padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`2px solid ${on?c:c+"44"}`,background:on?c+"22":"transparent",color:on?c:c+"66",transition:"all .15s",
            }}>{g}</button>;
          })}
        </div>
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2,alignItems:"center"}}>
          {(()=>{
            const todayStr=new Date().toLocaleDateString("sv");
            let absentCount=0;
            for(const p of visiblePlayers){
              const grp=p.group||"Anfänger";
              const pDays=getTrainingDaysForGroup(grp,p.trainingDays);
              const nearestDay=[...pDays].reverse().find(d=>d<=todayStr)||pDays[0];
              if(!nearestDay) continue;
              const sess=attendance?.[nearestDay];
              if(!sess||sess.took_place===false||!sess.attendances) continue;
              const v=sess.attendances[p.id];
              if(v==="e"||v==="u") absentCount++;
            }
            if(absentCount===0) return null;
            return <button onClick={()=>setShowOnlyPresent(p=>!p)} title={showOnlyPresent?"Abwesende anzeigen":"Abwesende ausblenden"} style={{
              flexShrink:0,padding:"4px 8px",borderRadius:20,fontSize:14,cursor:"pointer",
              border:`2px solid ${showOnlyPresent?"#f59e0b":"#6b728088"}`,
              background:showOnlyPresent?"#f59e0b22":"var(--bg3)",
              color:showOnlyPresent?"#f59e0b":"var(--text3)",
            }}>👁</button>;
          })()}
          {visiblePlayers
            .filter(p=>{
              if(!showOnlyPresent) return true;
              const todayStr=new Date().toLocaleDateString("sv");
              const grp=p.group||"Anfänger";
              const pDays=getTrainingDaysForGroup(grp,p.trainingDays);
              const nearestDay=[...pDays].reverse().find(d=>d<=todayStr)||pDays[0];
              if(!nearestDay) return true;
              const sess=attendance?.[nearestDay];
              if(!sess||sess.took_place===false||!sess.attendances) return true;
              const v=sess.attendances[p.id];
              return v!=="e"&&v!=="u";
            })
            .map(p=>(
            <button key={p.id} onClick={()=>{setSelectedPlayer(p.id);setActiveTab("uebungen");}} style={{
              flexShrink:0,padding:"3px 9px 3px 5px",borderRadius:20,
              border:`2px solid ${curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"var(--border2)"}`,
              background:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color+"22":"transparent",
              color:curPlayer?.id===p.id&&activeTab==="uebungen"?p.color:"var(--text2)",
              fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
              <span style={{fontSize:14}}>{p.avatar||"🏓"}</span>{(()=>{
                const counts={};
                visiblePlayers.forEach(x=>{counts[x.firstName]=(counts[x.firstName]||0)+1;});
                return counts[p.firstName]>1?`${p.firstName} ${(p.lastName||"").charAt(0)}.`:(p.firstName||p.name);
              })()}
            </button>
          ))}
          {visiblePlayers.length===0&&<span style={{fontSize:11,color:"var(--text4)",padding:"4px 0"}}>Keine Spieler sichtbar</span>}
        </div>
      </div>
    </div>}

    {/* Tabs — immer fixiert: unter RSWHeader (hideHeader) oder standalone (62px) */}
    <div style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--bg)",
      position:"fixed",
      top:hideHeader?"var(--rsw-height)":"62px",
      left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:1024,zIndex:96,
      overflowX:"auto",overflowY:"hidden"}}>
      {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{
        flexShrink:0,flex:1,padding:"10px 4px",background:"transparent",border:"none",
        borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,
        color:activeTab===t.key?"#10b981":"#6b7280",fontSize:11,fontWeight:600,cursor:"pointer",
        display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>{t.icon} {t.label}</button>)}
    </div>
    {/* Spacer: standalone=header(62)+tabs(40)=102, in RSW RSWHeader-Spacer+tabs(40)=40 */}
    <div style={{height:hideHeader?40:102}}/>


    {activeTab==="einheiten"&&<EinheitenTab user={user} players={players}/>}
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
                  <StarRating stars={stars} onRate={v=>setStars(curPlayer.id,ex.id,v)}/>
                  <span style={{color:"var(--text3)",fontSize:12}}>{isExp?"▲":"▼"}</span>
                </div>
              </div>
              {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:13,background:"var(--bg)"}}>
                <div style={{marginBottom:11,fontSize:12,color:"var(--text2)"}}>⚙️ Sterne vergeben:</div>
                <div style={{marginBottom:13}}><StarRating stars={stars} onRate={v=>setStars(curPlayer.id,ex.id,v)}/></div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {ex.thresholds.map((t,i)=>(
                    <div key={i} onClick={()=>setStars(curPlayer.id,ex.id,stars===i+1?0:i+1)}
                      style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",borderRadius:7,cursor:"pointer",
                        background:stars>=i+1?"#f59e0b11":"var(--border)",
                        border:`1px solid ${stars>=i+1?"#f59e0b44":"var(--border2)"}`,
                        transition:"all .15s"}}>
                      <span style={{color:stars>=i+1?"#f59e0b":"#6b7280",fontSize:13}}>{"★".repeat(i+1)}{"☆".repeat(4-i)}</span>
                      <span style={{fontSize:13,color:stars>=i+1?"var(--text)":"#9ca3af",flex:1}}>{t}</span>
                      {stars>=i+1?<span style={{color:"#10b981"}}>✓</span>:<span style={{color:"var(--text4)",fontSize:10}}>Tippen zum Setzen</span>}
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
    {activeTab==="training"&&<AdminTrainingTab players={activePlayers} groupFilters={effectiveGroupFilters} attendance={attendance} showToast={showToast}/>}

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
    {activeTab==="spielplan"&&<VereinsSpielplan nurNachwuchs={!isSuperAdmin}/>}
    {activeTab==="aufstellung"&&<AufstellungView players={players} nurNachwuchs={!isSuperAdmin}/>}
    {activeTab==="verwaltung"&&<VerwaltungTab players={players} rackets={rackets} onPlayerAdded={onPlayerAdded} showToast={showToast} isDark={isDark} onSetUserTheme={onSetUserTheme} userTheme={userTheme} globalTheme={globalTheme} user={user} clubConfig={clubConfig}/>}

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
  const groupOrder = ["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"];

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

        {/* Punkt 5: GESAMT-Zeile + Gruppenköpfe mit Spaltenköpfen */}
        {(()=>{
          const playerGroups = ["Profis","Fortgeschrittene","Anfänger"];
          const countFor = (grp) => {
            const gp = grp==="Trainer"
              ? relevantPlayers.filter(p=>(p.group||"Anfänger")==="Trainer")
              : relevantPlayers.filter(p=>(p.group||"Anfänger")===grp);
            const a=gp.filter(p=>(sessionData.attendances?.[p.id]||"a")==="a").length;
            const e=gp.filter(p=>sessionData.attendances?.[p.id]==="e").length;
            const u=gp.filter(p=>sessionData.attendances?.[p.id]==="u").length;
            return {a,e,u,total:gp.length};
          };
          const gesamtA = playerGroups.reduce((s,g)=>s+countFor(g).a,0);
          const gesamtE = playerGroups.reduce((s,g)=>s+countFor(g).e,0);
          const gesamtU = playerGroups.reduce((s,g)=>s+countFor(g).u,0);
          const SumRow = ({label,counts,bold})=>(
            <div style={{display:"grid",gridTemplateColumns:"1fr 44px 44px 44px",gap:4,marginBottom:4,alignItems:"center",
              background:bold?"var(--bg3)":"var(--bg)",borderRadius:8,padding:"5px 8px",
              borderLeft:bold?"3px solid #10b981":"3px solid var(--border2)"}}>
              <div style={{fontSize:11,fontWeight:700,color:bold?"#10b981":"var(--text3)",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
              <div style={{textAlign:"center",fontSize:13,fontWeight:700,color:"#10b981"}}>{counts.a}</div>
              <div style={{textAlign:"center",fontSize:13,fontWeight:700,color:"#f59e0b"}}>{counts.e}</div>
              <div style={{textAlign:"center",fontSize:13,fontWeight:700,color:"#ef4444"}}>{counts.u}</div>
            </div>
          );
          return <>
            {/* Spaltenköpfe */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 44px 44px 44px",gap:4,marginBottom:6,padding:"0 8px"}}>
              <div/>
              {COL_HEADERS.map(h=>(
                <div key={h.key} style={{display:"flex",justifyContent:"center"}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:h.color+"22",border:`2px solid ${h.color}88`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:h.color}} title={h.title}>{h.label}</div>
                </div>
              ))}
            </div>
            <SumRow label="GESAMT" counts={{a:gesamtA,e:gesamtE,u:gesamtU}} bold/>
            {["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"].map(g=>{
              const cnt=countFor(g);
              if(!relevantPlayers.some(p=>(p.group||"Anfänger")===g)) return null;
              return <SumRow key={g} label={g} counts={cnt}/>;
            })}
          </>;
        })()}

        {groupOrder.map(group=>{
          const groupPlayers = relevantPlayers.filter(p=>(p.group||"Anfänger")===group)
            .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"","de"));
          if (!groupPlayers.length) return null;
          return <div key={group} style={{marginBottom:12,marginTop:10}}>
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
  const allActive = players.filter(p=>p.status!=="passiv" && (p.group||"Anfänger")!=="Erwachsene");

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

// AufstellungView — zeigt Aufstellungstabelle
function AufstellungView({players=[], nurNachwuchs=false, nurErwachsene=false}) {
  const [aufstellungen,setAufstellungen]=useState([]);
  const [selId,setSelId]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    // Immer die eingebetteten Konstanten verwenden — zuverlässig und korrekt.
    // Firestore nur für Metadaten (saison, runde) laden falls vorhanden.
    const ALL_KEYS=[
      "aufstellung_2025_2026_R","aufstellung_2025_2026_V",
      "aufstellung_2024_2025_R","aufstellung_2024_2025_V",
      "aufstellung_2026_2027_R","aufstellung_2026_2027_V",
    ];

    // Basis: eingebettete Daten
    const embedded=[
      {id:"aufstellung_2025_2026_R",saison:"2025/2026",runde:"Rückrunde",spieler:AUFSTELLUNG_2025_2026_R},
      {id:"aufstellung_2025_2026_V",saison:"2025/2026",runde:"Vorrunde", spieler:AUFSTELLUNG_2025_2026_V},
      {id:"aufstellung_2024_2025_R",saison:"2024/2025",runde:"Rückrunde",spieler:AUFSTELLUNG_2024_2025_R},
      {id:"aufstellung_2024_2025_V",saison:"2024/2025",runde:"Vorrunde", spieler:AUFSTELLUNG_2024_2025_V},
    ];

    // Firestore prüfen ob Docs existieren (für PDF-Link später)
    Promise.all(ALL_KEYS.map(k=>
      getDoc(doc(db,"config",k))
        .then(s=>s.exists()?{id:k,exists:true}:null)
        .catch(()=>null)
    )).then(results=>{
      // Merge: embedded Daten + Info ob Firestore-Doc existiert
      const existsSet=new Set(results.filter(Boolean).map(r=>r.id));
      const afs=embedded
        .filter(e=>AUFSTELLUNG_DATA[e.id]) // nur die mit eingebetteten Daten
        .map(e=>({...e, inFirestore:existsSet.has(e.id)}))
        .sort((a,b)=>{
          const sA=a.id.replace(/_[RV]$/,""),sB=b.id.replace(/_[RV]$/,"");
          if(sA!==sB) return sB.localeCompare(sA);
          return a.id.endsWith("_R")?-1:1;
        });
      setAufstellungen(afs);
      setSelId(afs[0].id);
      setLoading(false);
    }).catch(()=>{
      setAufstellungen(embedded);
      setSelId(embedded[0].id);
      setLoading(false);
    });
  },[]);



  if(loading) return <div style={{padding:20,textAlign:"center",color:"var(--text3)"}}>⏳ Lade...</div>;
  if(aufstellungen.length===0) return <div style={{padding:20,textAlign:"center",color:"var(--text3)"}}>
    <div style={{fontSize:24,marginBottom:8}}>📋</div>
    <div>Noch keine Aufstellungen vorhanden.</div>
    <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>Bitte in Verwaltung → Uploads hochladen.</div>
  </div>;

  // Spieler mit stammErsatz + Status aus Verwaltung anreichern
  // PDF-Name: "Titz, Stefan" → match mit players.lastName="Titz", firstName="Stefan"
  const spieler=(aufstellungen.find(a=>a.id===selId)?.spieler)||[];
  const enriched=spieler.map(s=>{
    const nameParts=(s.name||"").split(",").map(p=>p.trim());
    const lastName=nameParts[0]||"";
    const firstName=nameParts[1]||"";
    const match=players.find(p=>{
      const pLast=(p.lastName||"").toLowerCase();
      const pFirst=(p.firstName||"").toLowerCase();
      // Immer Vor- UND Nachname prüfen um Verwechslungen zu vermeiden
      return pLast===lastName.toLowerCase()&&pFirst===firstName.toLowerCase();
    });
    return {...s,stammErsatz:match?.stammErsatz||"Stammspieler",status:match?.status||"aktiv",matched:!!match};
  });

  const NACHWUCHS_MANN=["Mädchen 17","Mädchen 15","Mädchen 13","Mädchen 11","Jugend 15","Jugend 13","Jugend 11"];
  // Mannschaft-Namen: Erwachsene → Herren 1 etc.
  function mannLabel(m) {
    const map={"Erwachsene":"Herren 1","Erwachsene II":"Herren 2","Erwachsene III":"Herren 3",
               "Erwachsene IV":"Herren 4","Erwachsene V":"Herren 5","Erwachsene VI":"Herren 6"};
    return map[m]||m;
  }
  // Sortierung: Herren aufsteigend, dann Nachwuchs absteigend (älteste zuerst = höhere Jahrg.)
  const MANN_ORDER=["Erwachsene","Erwachsene II","Erwachsene III","Erwachsene IV","Erwachsene V","Erwachsene VI",
    "Mädchen 17","Mädchen 15","Mädchen 13","Mädchen 11","Jugend 15","Jugend 13","Jugend 11"];
  const mannschaften=[...new Set(enriched.map(s=>s.mannschaft).filter(Boolean))]
    .filter(m=>{
      if(nurNachwuchs) return NACHWUCHS_MANN.some(nm=>m===nm||m.startsWith(nm));
      if(nurErwachsene) return m.startsWith("Erwachsene");
      return true;
    })
    .sort((a,b)=>{
      const ia=MANN_ORDER.indexOf(a); const ib=MANN_ORDER.indexOf(b);
      if(ia>=0&&ib>=0) return ia-ib;
      if(ia>=0) return -1; if(ib>=0) return 1;
      return a.localeCompare(b,"de");
    });

  return <div>
    {/* P3: Halbrunden-Dropdown mit PDF-Link */}
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      <label style={{fontSize:11,color:"var(--text3)",flexShrink:0}}>📋 Halbrunde:</label>
      <select value={selId} onChange={e=>setSelId(e.target.value)}
        style={{padding:"5px 8px",borderRadius:7,fontSize:12,background:"var(--bg)",border:"1px solid var(--border2)",color:"var(--text)"}}>
        {aufstellungen.map(a=><option key={a.id} value={a.id}>
          {a.runde==="Rückrunde"?"RR":"VR"} {a.saison}
        </option>)}
      </select>
      {aufstellungen.find(a=>a.id===selId)&&
        <button onClick={async()=>{
          // Versuche zuerst separates pdf_KEY Dokument, dann pdfUrl im Haupt-Dokument
          let pdfUrl=null;
          const pdfSnap=await getDoc(doc(db,"config","pdf_"+selId)).catch(()=>null);
          if(pdfSnap?.exists()) pdfUrl=pdfSnap.data().pdfUrl;
          if(!pdfUrl){
            const mainSnap=await getDoc(doc(db,"config",selId)).catch(()=>null);
            if(mainSnap?.exists()) pdfUrl=mainSnap.data().pdfUrl;
          }
          if(!pdfUrl){alert("Kein PDF gespeichert. Bitte Aufstellung erneut hochladen.");return;}
          const b64=pdfUrl.split(",")[1];
          const bin=atob(b64);const bytes=new Uint8Array(bin.length);
          for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
          const blobUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
          const a=document.createElement("a");
          a.href=blobUrl;
          a.download="Aufstellung_"+selId+".pdf";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(()=>URL.revokeObjectURL(blobUrl),5000);
        }} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"#3b82f622",color:"#3b82f6",
            border:"1px solid #3b82f644",cursor:"pointer",whiteSpace:"nowrap"}}>
          📄 PDF öffnen
        </button>}
    </div>

    {spieler.length===0?<div style={{padding:20,textAlign:"center",color:"var(--text3)",fontSize:12}}>
      Keine Spieler in dieser Aufstellung. Bitte in Verwaltung ergänzen.
    </div>:mannschaften.map(mann=>{
      const ms=enriched.filter(s=>s.mannschaft===mann);
      return <div key={mann} style={{marginBottom:16,background:"var(--bg2)",borderRadius:12,overflow:"hidden",border:"1px solid var(--border)"}}>
        <div style={{padding:"8px 12px",background:"var(--bg3)",borderBottom:"1px solid var(--border)",fontWeight:700,fontSize:13}}>{mannLabel(mann)}</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
            <thead><tr style={{background:"var(--bg2)"}}>
              {[{l:"Rg",w:36},{l:"TTR",w:52},{l:"Name",w:130},{l:"S/E",w:60},{l:"St.",w:50}].map(h=>(
                <th key={h.l} style={{padding:"6px 8px",textAlign:"left",fontWeight:600,color:"var(--text2)",
                  borderBottom:"1px solid var(--border2)",whiteSpace:"nowrap",position:"sticky",top:0,
                  background:"var(--bg2)",width:h.w,minWidth:h.w}}>{h.l}</th>
              ))}
            </tr></thead>
            <tbody>{ms.map((s,i)=>(
              <tr key={i} style={{borderBottom:"1px solid var(--border)",background:i%2===0?"transparent":"var(--bg3)"}}>
                <td style={{padding:"4px 5px",color:"var(--text2)",width:36,fontSize:11}}>{s.rang||"—"}</td>
                <td style={{padding:"4px 5px",width:52,fontSize:11}}>{s.qTtr||"—"}</td>
                <td style={{padding:"4px 5px",fontWeight:500,width:130,wordBreak:"break-word",whiteSpace:"normal"}}>{s.name||"—"}</td>
                <td style={{padding:"4px 5px",width:60}}>
                  <span style={{padding:"1px 5px",borderRadius:10,fontSize:10,
                    background:s.stammErsatz==="Stammspieler"?"#10b98122":"#f59e0b22",
                    color:s.stammErsatz==="Stammspieler"?"#10b981":"#f59e0b"}}>
                    {s.stammErsatz==="Stammspieler"?"⭐ Stamm":"🔄 Ersatz"}
                  </span>
                </td>
                <td style={{padding:"4px 5px",width:50}}>
                  <span style={{padding:"1px 5px",borderRadius:10,fontSize:10,
                    background:s.status==="aktiv"?"#3b82f622":"#ef444422",
                    color:s.status==="aktiv"?"#3b82f6":"#ef4444"}}>
                    {s.status||"aktiv"}
                  </span>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>;
    })}
  </div>;
}

// ─── BRANDING EDITOR ──────────────────────────────────────────────────────────
function BrandingEditor({showToast}) {
  const [name,     setName]     = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [logo,     setLogo]     = useState("");
  const [saving,   setSaving]   = useState(false);
  const [logoSaving,setLogoSaving] = useState(false);
  const [loaded,   setLoaded]   = useState(false);

  // Einmalig beim Mount aus Firestore laden
  useEffect(()=>{
    getDoc(doc(db,"config","clubConfig")).then(snap=>{
      if(snap.exists()){
        const d=snap.data();
        setName(d.name||"");
        setSubtitle(d.subtitle||"");
        setLogo(d.logo||"");
      }
      setLoaded(true);
    }).catch(()=>setLoaded(true));
  },[]);

  async function saveText() {
    setSaving(true);
    try {
      await setDoc(doc(db,"config","clubConfig"),{name:name.trim(),subtitle:subtitle.trim(),logo},{merge:false});
      showToast("Gespeichert ✅","✅");
    } catch(e) {
      window.alert("Fehler:\n"+e.code+"\n"+e.message);
    }
    setSaving(false);
  }

  async function saveLogo(file) {
    if(!file) return;
    setLogoSaving(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      if(dataUrl.length > 700000) {
        window.alert("Bild zu groß! Bitte unter 500KB wählen.");
        setLogoSaving(false);
        return;
      }
      setLogo(dataUrl);
      try {
        await setDoc(doc(db,"config","clubConfig"),{name:name.trim(),subtitle:subtitle.trim(),logo:dataUrl},{merge:false});
        showToast("Wappen gespeichert 🖼️","🖼️");
      } catch(e) {
        window.alert("Fehler:\n"+e.code+"\n"+e.message);
      }
      setLogoSaving(false);
    };
    reader.onerror = ()=>{ window.alert("Datei konnte nicht gelesen werden"); setLogoSaving(false); };
    reader.readAsDataURL(file);
  }

  async function deleteLogo() {
    setLogo("");
    try {
      await setDoc(doc(db,"config","clubConfig"),{name:name.trim(),subtitle:subtitle.trim(),logo:""},{merge:false});
      showToast("Wappen entfernt","✅");
    } catch(e) {
      window.alert("Fehler:\n"+e.code+"\n"+e.message);
    }
  }

  if(!loaded) return <div style={{padding:12,color:"var(--text3)",fontSize:12}}>⏳ Lade...</div>;

  return <div style={{borderTop:"1px solid var(--border)",paddingTop:14,marginTop:12}}>
    <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:12}}>🏷️ Vereins-Branding</div>

    <div style={{marginBottom:10}}>
      <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Vereinsname</label>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="TTC Niederzeuzheim"
        style={{width:"100%",padding:"8px 10px",background:"var(--bg3)",border:"1px solid var(--border2)",
          borderRadius:8,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
    </div>

    <div style={{marginBottom:12}}>
      <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Untertitel</label>
      <input value={subtitle} onChange={e=>setSubtitle(e.target.value)} placeholder="Trainings-App"
        style={{width:"100%",padding:"8px 10px",background:"var(--bg3)",border:"1px solid var(--border2)",
          borderRadius:8,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
    </div>

    <button onClick={saveText} disabled={saving} style={{
      width:"100%",padding:"10px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",
      background:saving?"var(--bg3)":"#10b981",border:"none",color:saving?"var(--text3)":"#fff",
      marginBottom:14
    }}>{saving?"⏳ Speichern...":"💾 Name & Untertitel speichern"}</button>

    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:6}}>Vereinswappen</label>
    <div style={{textAlign:"center",marginBottom:8}}>
      {logo
        ? <img src={logo} alt="Wappen" style={{width:80,height:80,objectFit:"contain",borderRadius:8,border:"1px solid var(--border2)"}}/>
        : <div style={{fontSize:40}}>🏓</div>
      }
    </div>
    <label style={{display:"block",padding:"9px",background:"var(--bg3)",border:"2px dashed var(--border2)",
      borderRadius:8,textAlign:"center",cursor:logoSaving?"not-allowed":"pointer",fontSize:12,color:"var(--text3)"}}>
      {logoSaving?"⏳ Hochladen...":"📎 JPG/PNG hochladen (max 500KB)"}
      <input type="file" accept="image/*" style={{display:"none"}} disabled={logoSaving}
        onChange={e=>saveLogo(e.target.files?.[0])}/>
    </label>
    {logo&&<button onClick={deleteLogo} style={{marginTop:6,width:"100%",padding:6,
      background:"#ef444422",border:"1px solid #ef444466",borderRadius:6,color:"#ef4444",fontSize:11,cursor:"pointer"}}>
      ✕ Wappen entfernen
    </button>}
  </div>;
}

function VerwaltungTab({players,rackets,onPlayerAdded,showToast,isDark,onSetUserTheme,userTheme,globalTheme,user,clubConfig={}}) {
  const [editPlayer,setEditPlayer]=useState(null);

  // Sync editPlayer wenn sich Spielerdaten in Firestore ändern (z.B. nach Vergabe-Löschen)
  useEffect(()=>{
    if(!editPlayer?.id) return;
    const updated=players.find(p=>p.id===editPlayer.id);
    if(!updated) return;
    // Nur racket-Felder synchronisieren wenn sie sich geändert haben
    if(String(updated.racketNr||"")!==String(editPlayer.racketNr||"")||
       (updated.racketType||"")!==(editPlayer.racketType||"")){
      setEditPlayer(prev=>prev?{...prev,racketNr:updated.racketNr||"",racketType:updated.racketType||"",racketStart:updated.racketStart||"",racketEnd:updated.racketEnd||""}:null);
    }
  },[players]);
  const [showAdd,setShowAdd]=useState(false);
  const [showM,setShowM]=useState(false);
  const [showT,setShowT]=useState(false);
  const [showEhr,setShowEhr]=useState(false);
  const [showAppDesign,setShowAppDesign]=useState(false);
  const [showTrainingZR,setShowTrainingZR]=useState(false);
  const [showGrp,setShowGrp]=useState({});
  const [showUploads,setShowUploads]=useState(false);    // Uploads section
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

  const newData0={firstName:"",lastName:"",gender:"m",email:"",avatar:"🏓",group:"Anfänger",status:"aktiv",noLogin:false,pass:"",roles:{},stammErsatz:"Stammspieler"};
  const [newData,setNewData]=useState(newData0);
  const groupOrder=["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"];

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
        ...( ((editPlayer.group||"Anfänger")==="Erwachsene"||editPlayer.roles?.erwachsene===true) ? {stammErsatz:editPlayer.stammErsatz||"Stammspieler", anzugSize:editPlayer.anzugSize||""} : {} ),
        birthdate:     editPlayer.birthdate||"",
        trainingStart: editPlayer.trainingStart||"",
        trainingEnd:   editPlayer.trainingEnd||"",
        trainingsheft: editPlayer.trainingsheft||"ja",
        joinDate:      editPlayer.joinDate||"",
        leaveDate:     editPlayer.leaveDate||"",
        roles:         editPlayer.roles||{},
        trainingDays:  editPlayer.trainingDays||"Di",
        phone:         editPlayer.phone||"",
        tshirtSize:    editPlayer.tshirtSize||"",
        tshirtDTTB:    editPlayer.tshirtDTTB||"nein",
        tshirtTTC:     editPlayer.tshirtTTC||"nein",
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
        roles:newData.roles||{},
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
      <div style={{fontSize:17,fontWeight:800}}>⚙️ Personen-Verwaltung</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
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
      if (myP) return null;
      // Also suppress if user has admin role in any player (e.g. email mismatch)
      const hasAdminPlayer = players.find(p=>p.roles?.admin===true);
      if (hasAdminPlayer) return null;

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

    {/* App-Design — P4 ausblendbar */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,marginBottom:16}}>
      <div onClick={()=>setShowAppDesign(p=>!p)} style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>🎨 App-Design</div>
        <span style={{fontSize:11,color:"var(--text4)"}}>{showAppDesign?"▲":"▼"}</span>
      </div>
      {showAppDesign&&<ErrorBoundary><div style={{padding:"0 14px 14px"}}>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>
          Grundeinstellung gilt für alle. Persönliche Einstellung hat Vorrang.
        </div>
        <div style={{fontSize:11,color:"var(--text2)",marginBottom:6,fontWeight:700}}>Grundeinstellung für alle Nutzer:</div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[{mode:"dark",icon:"🌙",label:"Dark Mode"},{mode:"light",icon:"☀️",label:"Light Mode"}].map(opt=>{
            const isActive = effectiveGlobalTheme===opt.mode;
            return <button key={opt.mode} onClick={async()=>{
              setLocalGlobalTheme(opt.mode);
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
        {/* Whitelabel Branding */}
        <BrandingEditor showToast={showToast}/>
      </div></ErrorBoundary>}
    </div>

    {/* Trainingszeitraum — P4 ausblendbar */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,marginBottom:16}}>
      <div onClick={()=>setShowTrainingZR(p=>!p)} style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>📅 Trainingszeitraum</div>
        <span style={{fontSize:11,color:"var(--text4)"}}>{showTrainingZR?"▲":"▼"}</span>
      </div>
      {showTrainingZR&&<div style={{padding:"0 14px 14px"}}>
      <div style={{height:0}}/>
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
        Die Teilnahme-Auswertung bezieht sich nur auf Trainingstage innerhalb dieses Zeitraums.
      </div>
      <button onClick={saveTrainingRange} disabled={rangeSaving} style={{width:"100%",padding:9,background:rangeSaving?"var(--border)":"linear-gradient(135deg,#3b82f6,#2563eb)",border:"none",borderRadius:9,color:rangeSaving?"#6b7280":"#fff",fontSize:13,fontWeight:700,cursor:rangeSaving?"not-allowed":"pointer"}}>
        {rangeSaving?"Wird gespeichert…":"💾 Zeitraum speichern"}
      </button>
      </div>}
    </div>

    {/* Uploads Abschnitt */}
    <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,marginBottom:16}}>
        <div onClick={()=>setShowUploads(p=>!p)} style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>📤 Uploads</div>
        <span style={{fontSize:11,color:"var(--text4)"}}>{showUploads?"▲":"▼"}</span>
      </div>
      {showUploads&&<div style={{padding:"0 14px 14px"}}>
        <SpielplanUpload showToast={showToast} onJoinImport={handleJoinImport} joinImporting={joinImporting}/>
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
      {/* Funktionen bei Neuanlage */}
      <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
        <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>🎭 Funktionen</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[{key:"player",icon:"🏓",label:"Spieler"},{key:"trainer",icon:"🛡️",label:"Trainer"},{key:"admin",icon:"⚙️",label:"Admin"},{key:"erwachsene",icon:"👪",label:"Erwachsene"}].map(role=>{
            const isOn=(newData.roles||{})[role.key]===true;
            return <button key={role.key} onClick={()=>setNewData(p=>({...p,roles:{...(p.roles||{}),[role.key]:!isOn}}))} style={{
              padding:"6px 11px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
              border:`2px solid ${isOn?"#10b981":"var(--border2)"}`,
              background:isOn?"#10b98122":"transparent",
              color:isOn?"#10b981":"var(--text3)",
              display:"flex",alignItems:"center",gap:5,
            }}>{role.icon} {role.label}{isOn?" ✓":""}</button>;
          })}
        </div>
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
      const allGroupPlayers=[...players.filter(p=>(p.group||"Anfänger")===group)]
        .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||""));
      if (!allGroupPlayers.length) return null;
      const activeGroupPlayers = allGroupPlayers.filter(p=>p.status!=="passiv");
      const passiveGroupPlayers = allGroupPlayers.filter(p=>p.status==="passiv");
      const groupPlayers = [...activeGroupPlayers, ...passiveGroupPlayers];
      const grpOpen = showGrp[group]===true;
      const GRP_COL = {Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6",Erwachsene:"#ec4899"};
      const gc = GRP_COL[group]||"#6b7280";
      return <div key={group} style={{marginBottom:8,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden",borderLeft:`4px solid ${gc}`}}>
        <div onClick={()=>setShowGrp(p=>({...p,[group]:!grpOpen}))} style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
          <div style={{fontSize:13,fontWeight:700,color:gc}}>{group} <span style={{fontSize:11,color:"var(--text3)",fontWeight:400}}>({activeGroupPlayers.length} aktiv{passiveGroupPlayers.length>0?`, ${passiveGroupPlayers.length} passiv`:""})</span></div>
          <span style={{fontSize:11,color:"var(--text4)"}}>{grpOpen?"▲":"▼"}</span>
        </div>
        {grpOpen&&groupPlayers.map(p=>(
          editPlayer?.id===p.id ? (
            <div key={p.id} style={{background:"var(--bg2)",border:"1px solid #10b98144",borderRadius:12,padding:14,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                <div style={{position:"relative",cursor:"pointer"}} onClick={()=>setAvatarPickerFor("edit")}>
                  <Avatar avatar={editPlayer.avatar} color={p.color} size={44}/>
                  <span style={{position:"absolute",bottom:-2,right:-2,fontSize:12,background:"var(--bg3)",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border2)"}}>✏️</span>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{editPlayer.firstName} {editPlayer.lastName} bearbeiten</div>
              </div>
              <>{/* 2b Funktionen VOR Vorname */}
              <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>🎭 Funktionen</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {[{key:"player",icon:"🏓",label:"Spieler"},{key:"trainer",icon:"🛡️",label:"Trainer"},
                    {key:"admin",icon:"⚙️",label:"Admin"},{key:"erwachsene",icon:"👪",label:"Erwachsene"}].map(role=>{
                    const isOn=(editPlayer.roles||{})[role.key]===true;
                    return <button key={role.key} onClick={()=>setEditPlayer(prev=>({...prev,roles:{...(prev.roles||{}),[role.key]:!isOn}}))} style={{
                      padding:"7px 12px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                      border:`2px solid ${isOn?"#10b981":"var(--border2)"}`,background:isOn?"#10b98122":"transparent",
                      color:isOn?"#10b981":"var(--text3)",display:"flex",alignItems:"center",gap:5,
                    }}>{role.icon} {role.label} {isOn?"✓":""}</button>;
                  })}
                </div>
              </div>
              {/* Vorname */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Vorname</label>
                <input type="text" value={editPlayer.firstName||""} onChange={e=>setEditPlayer(prev=>({...prev,firstName:e.target.value}))}
                  style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {/* Nachname */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Nachname</label>
                <input type="text" value={editPlayer.lastName||""} onChange={e=>setEditPlayer(prev=>({...prev,lastName:e.target.value}))}
                  style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {/* 2a Geburtstag nach Nachname - für Erwachsene mit T-Shirt + Anzug Größe daneben */}
              {(()=>{
                const isErw=(editPlayer.group||"Anfänger")==="Erwachsene";
                const erwSizes=["XS","S","M","L","XL","XXL","3XL","4XL"];
                if(isErw) return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                  <div>
                    <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>🎂 Geburtstag</label>
                    <div style={{display:"flex",gap:4}}>
                      <input type="date" value={editPlayer.birthdate||""} onChange={e=>setEditPlayer(prev=>({...prev,birthdate:e.target.value}))}
                        style={{flex:1,padding:"9px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                      {editPlayer.birthdate&&<button onClick={()=>setEditPlayer(p=>({...p,birthdate:""}))} style={{padding:"4px 6px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:10,cursor:"pointer",flexShrink:0}}>✕</button>}
                    </div>
                  </div>
                  <div>
                    <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>👕 T-Shirt Größe</label>
                    <select value={editPlayer.tshirtSize||""} onChange={e=>setEditPlayer(prev=>({...prev,tshirtSize:e.target.value}))} style={{fontSize:12,width:"100%",padding:"9px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)"}}>
                      <option value="">—</option>
                      {erwSizes.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>🧥 Anzugs-Größe</label>
                    <select value={editPlayer.anzugSize||""} onChange={e=>setEditPlayer(prev=>({...prev,anzugSize:e.target.value}))} style={{fontSize:12,width:"100%",padding:"9px 8px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)"}}>
                      <option value="">—</option>
                      {erwSizes.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>;
                return <div style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>🎂 Geburtstag</label>
                  <div style={{display:"flex",gap:6}}>
                    <input type="date" value={editPlayer.birthdate||""} onChange={e=>setEditPlayer(prev=>({...prev,birthdate:e.target.value}))}
                      style={{flex:1,padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                    {editPlayer.birthdate&&<button onClick={()=>setEditPlayer(p=>({...p,birthdate:""}))} style={{padding:"4px 7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>}
                  </div>
                </div>;
              })()}
              {/* 2e Handy vor E-Mail */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>📱 Handy Nr.</label>
                <input type="tel" value={editPlayer.phone||""} onChange={e=>setEditPlayer(prev=>({...prev,phone:e.target.value}))} placeholder="+49 151 ..."
                  style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div>
              {/* E-Mail */}
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>E-Mail</label>
                <input type="text" value={editPlayer.email||""} onChange={e=>setEditPlayer(prev=>({...prev,email:e.target.value}))}
                  style={{width:"100%",padding:"10px 12px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
              </div></>
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
              {/* P4: Stammspieler/Ersatzspieler für alle mit Erwachsene-Funktion */}
              {((editPlayer.group||"Anfänger")==="Erwachsene"||editPlayer.roles?.erwachsene===true)&&<div style={{marginBottom:14}}>
                <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Stammspieler / Ersatzspieler</label>
                <select value={editPlayer.stammErsatz||"Stammspieler"} onChange={e=>setEditPlayer(prev=>({...prev,stammErsatz:e.target.value}))}
                  style={{width:"100%",padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13}}>
                  <option value="Stammspieler">Stammspieler</option>
                  <option value="Ersatzspieler">Ersatzspieler</option>
                </select>
              </div>}

              {/* Individueller Trainingszeitraum */}
              <div style={{background:"var(--bg)",borderRadius:9,padding:"10px 12px",marginBottom:10}}>
                <div style={{fontSize:12,color:"var(--text2)",marginBottom:8,fontWeight:600}}>📅 Individueller Trainingszeitraum</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Start Training</label>
                    <div style={{display:"flex",gap:4}}>
                      <input type="date" value={editPlayer.trainingStart||""} onChange={e=>setEditPlayer(prev=>({...prev,trainingStart:e.target.value}))}
                        style={{flex:1,padding:"8px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                      {editPlayer.trainingStart&&<button onClick={()=>setEditPlayer(p=>({...p,trainingStart:""}))} style={{padding:"4px 7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>}
                    </div>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Ende Training</label>
                    <div style={{display:"flex",gap:4}}>
                      <input type="date" value={editPlayer.trainingEnd||""} onChange={e=>setEditPlayer(prev=>({...prev,trainingEnd:e.target.value}))}
                        style={{flex:1,padding:"8px 10px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,outline:"none",boxSizing:"border-box"}}/>
                      {editPlayer.trainingEnd&&<button onClick={()=>setEditPlayer(p=>({...p,trainingEnd:""}))} style={{padding:"4px 7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>}
                    </div>
                  </div>
                </div>
                <div style={{fontSize:10,color:"var(--text4)",marginTop:6}}>Hat Vorrang vor dem globalen Trainingszeitraum</div>
              </div>

              {/* Vereinsbeitritt / Vereinsaustritt */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>📅 Vereinsbeitritt</label>
                  <div style={{display:"flex",gap:4}}>
                    <input type="date" value={editPlayer.joinDate||""} onChange={e=>setEditPlayer(prev=>({...prev,joinDate:e.target.value}))}
                      style={{flex:1,padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                    {editPlayer.joinDate&&<button onClick={()=>setEditPlayer(p=>({...p,joinDate:""}))} style={{padding:"4px 7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>}
                  </div>
                </div>
                <div>
                  <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>📅 Vereinsaustritt</label>
                  <div style={{display:"flex",gap:4}}>
                    <input type="date" value={editPlayer.leaveDate||""} onChange={e=>setEditPlayer(prev=>({...prev,leaveDate:e.target.value}))}
                      style={{flex:1,padding:"9px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
                    {editPlayer.leaveDate&&<button onClick={()=>setEditPlayer(p=>({...p,leaveDate:""}))} style={{padding:"4px 7px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>}
                  </div>
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



              {/* Punkt 3: Abschnitte für Erwachsene-Only ausblenden */}
              {(()=>{
                const isEOnly=editPlayer.roles?.erwachsene===true&&!editPlayer.roles?.player&&!editPlayer.roles?.trainer&&!editPlayer.roles?.admin;
                if(isEOnly) return null;
                return <>

              {/* 2d: T-Shirt Felder nach Schläger */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                {[{k:"tshirtDTTB",l:"👕 T-Shirt DTTB erhalten"},{k:"tshirtTTC",l:"👕 T-Shirt TTC erhalten"}].map(f=>(
                  <div key={f.k}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>{f.l}</label>
                    <select value={editPlayer[f.k]||"nein"} onChange={e=>setEditPlayer(p=>({...p,[f.k]:e.target.value}))} style={{fontSize:12}}>
                      <option value="nein">Nein</option><option value="ja">Ja</option>
                    </select>
                  </div>
                ))}
              </div>
              {/* Abschnitte ausblenden für reine Erwachsene */}
              {(()=>{
                const roles=editPlayer.roles||{};
                const isEOnly=roles.erwachsene===true&&!roles.player&&!roles.trainer&&!roles.admin;
                if(isEOnly) return null;
                return <>
              {/* T-Shirt Größe + Trainingsheft */}
              {(()=>{
                const grp=editPlayer.group||"Anfänger";
                const isErw=grp==="Erwachsene";
                const sizes=isErw?["XS","S","M","L","XL","XXL","3XL","4XL"]:["128","134","140","146","152","158","164"];
                return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                  <div>
                    <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>👕 T-Shirt Größe</label>
                    <select value={editPlayer.tshirtSize||""} onChange={e=>setEditPlayer(prev=>({...prev,tshirtSize:e.target.value}))}>
                      <option value="">—</option>
                      {sizes.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:12,color:"var(--text2)",display:"block",marginBottom:4}}>Trainingsheft erhalten</label>
                    <select value={editPlayer.trainingsheft||"ja"} onChange={e=>setEditPlayer(prev=>({...prev,trainingsheft:e.target.value}))}>
                      <option value="ja">Ja</option>
                      <option value="nein">Nein</option>
                    </select>
                  </div>
                </div>;
              })()}


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
                      {editPlayer[key]&&<button onClick={()=>setEditPlayer(p=>({...p,[key]:""}))} style={{padding:"3px 6px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,color:"var(--text3)",fontSize:10,cursor:"pointer"}}>✕</button>}
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
                        {editPlayer[a.key]&&<button onClick={()=>setEditPlayer(p=>({...p,[a.key]:""}))} style={{padding:"3px 6px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,color:"var(--text3)",fontSize:10,cursor:"pointer"}}>✕</button>}
                      </div>
                    ))}
                  </div>
                </div>;
              })()}

                </>;
              })()}

                </>;
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
                  <div onClick={()=>setShowT(p=>!p)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:showT?10:0}}>
                    <div style={{fontSize:12,color:"var(--text2)",fontWeight:600}}>🏆 Turniererfolge</div>
                    <span style={{fontSize:11,color:"var(--text4)"}}>{showT?"▲":"▼ einblenden"}</span>
                  </div>
                  {showT&&<>
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
                  </>}
                </div>;
              })()}
              {/* P5+P6: Ehrungen für Erwachsene (auch Trainer+Erwachsene) */}
              {(editPlayer.roles?.erwachsene===true)&&(()=>{
                return <div style={{background:"var(--bg2)",border:"1px solid #f59e0b33",borderRadius:11,padding:"10px 12px",marginBottom:10}}>
                  <div onClick={()=>setShowEhr(p=>!p)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#f59e0b"}}>🏅 Ehrungen</div>
                    <span style={{fontSize:11,color:"var(--text4)"}}>{showEhr?"▲":"▼ einblenden"}</span>
                  </div>
                  {showEhr&&<div style={{marginTop:8}}>
                    <EhrungenAdminSection playerId={editPlayer.id} initialEhrungen={editPlayer.ehrungen||[]} showToast={showToast}/>
                  </div>}
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
                    {["frei","kaputt","offen","vergeben","verkauft","verschenkt"].map(s=><option key={s}>{s}</option>)}
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
                  <button onClick={()=>setEditId(null)} style={{padding:"3px 8px",background:"var(--border2)",border:"none",borderRadius:4,color:"var(--text2)",fontSize:11,cursor:"pointer",marginRight:3}}>✕</button>
                  <button onClick={async(e)=>{
                    e.stopPropagation();
                    if(!window.confirm(`Schläger Nr. ${String(form.nr).padStart(3,"0")} wirklich löschen?`)) return;
                    setSaving(true);
                    try {
                      // Spieler-Sync: racketNr und racketStart zurücksetzen
                      if(form.vergebenAn){
                        const oldP=players.find(p=>`${p.firstName} ${p.lastName}`===form.vergebenAn);
                        if(oldP) await updateDoc(doc(db,"players",oldP.id),{racketNr:"",racketType:"",racketStart:"",racketEnd:""}).catch(()=>{});
                      }
                      // Auch alle anderen Spieler mit dieser racketNr bereinigen (falls inkonsistent)
                      const withRacket=players.filter(p=>String(p.racketNr)===String(form.nr));
                      for(const p of withRacket){
                        await updateDoc(doc(db,"players",p.id),{racketNr:"",racketType:"",racketStart:"",racketEnd:""}).catch(()=>{});
                      }
                      await deleteDoc(doc(db,"rackets",String(form.nr)));
                      showToast(`Schläger Nr. ${String(form.nr).padStart(3,"0")} gelöscht`,"🗑️");
                      setEditId(null);
                    } catch(e){showToast("Fehler: "+e.message,"❌");}
                    setSaving(false);
                  }} style={{padding:"3px 8px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:4,color:"#ef4444",fontSize:11,cursor:"pointer"}}>🗑️</button>
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
                        const oldName=r.vergebenAn;
                        await setDoc(doc(db,"rackets",String(r.nr)),{...r,status:"frei",vergebenAn:""}).catch(()=>{});
                        // Spieler per Name ODER per racketNr finden und bereinigen
                        const toReset=players.filter(pl=>
                          `${pl.firstName} ${pl.lastName}`===oldName ||
                          String(pl.racketNr)===String(r.nr)
                        );
                        for(const pl of toReset){
                          await updateDoc(doc(db,"players",pl.id),{racketType:"",racketNr:"",racketStart:"",racketEnd:""}).catch(()=>{});
                        }
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
  const todayStr3=today.toLocaleDateString("sv");
  const lastTue3=[...ALL_TUESDAYS].reverse().find(d=>d<=todayStr3)||ALL_TUESDAYS[0];
  const lastFri3=[...ALL_FRIDAYS].reverse().find(d=>d<=todayStr3)||ALL_FRIDAYS[0];
  const lastTraining=lastTue3>lastFri3?lastTue3:lastFri3; // letzten Trainingstag nehmen

  function isRecentBirthday(p) {
    if (!lastTraining||!p.birthdate) return false;
    const bd=new Date(p.birthdate);
    const since=new Date(lastTraining); since.setHours(0,0,0,0);
    const thisYear=new Date(today.getFullYear(),bd.getMonth(),bd.getDate());
    thisYear.setHours(0,0,0,0);
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

  // Trainer können Sterne setzen wenn sie Spieler per Chip ausgewählt haben
  async function setStars(playerId,exId,value) {
    if (!playerId) return;
    try {
      await updateDoc(doc(db,"players",playerId),{[`stars.${exId}`]:value});
    } catch(e) { console.error("setStars error:",e); }
  }
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
    {key:"spielbetrieb",label:"Spielbetrieb",icon:"📋"},
    {key:"aufstellung",label:"Aufstellung",icon:"📋"},
    {key:"spielplan",label:"Spielplan",icon:"📅"},
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

  return <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:1024,margin:"0 auto",paddingBottom:80}}>
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
    <div style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--bg)",
      position:"fixed",
      top:hideHeader?"var(--rsw-height)":"70px",
      left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:1024,zIndex:99,
      overflowX:"auto",overflowY:"hidden"}}>
      {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{flexShrink:0,padding:"11px 10px",background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,color:activeTab===t.key?"#10b981":"var(--text3)",fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4,whiteSpace:"nowrap"}}>{t.icon} {t.label}</button>)}
    </div>

    {/* ── STATS ── */}
    <div style={{height:hideHeader?40:114}}/>
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
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:"var(--text)",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div>
              </div>
              <StarRating stars={stars} readonly={!hideHeader} onRate={hideHeader?v=>setStars(myPlayer.id,ex.id,v):undefined}/>
              <span style={{color:"var(--text3)",fontSize:12,marginLeft:4}}>{isExp?"▲":"▼"}</span>
            </div>
            {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:"10px 12px",background:"var(--bg)"}}>
              {/* Beschreibung aus Trainingsheft */}
              {ex.description&&<div style={{
                fontSize:12,color:"var(--text2)",lineHeight:1.6,marginBottom:10,
                padding:"8px 10px",background:"var(--bg2)",borderRadius:8,
                borderLeft:"3px solid "+(isBeg?"#10b981":"#3b82f6")
              }}>
                {ex.symbol&&<span style={{marginRight:6,fontSize:16}}>{ex.symbol}</span>}
                {ex.description}
              </div>}
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
    {activeTab==="aufstellung"&&<AufstellungView players={players} nurNachwuchs={true}/>}
    {activeTab==="spielplan"&&<VereinsSpielplan nurNachwuchs={true}/>}

    <style>{`
      *{box-sizing:border-box}
      input::placeholder{color:var(--text4)}
      input,textarea{background:var(--input-bg)!important;color:var(--text)!important;border-color:var(--border2)!important}
      select{background:var(--sel-bg)!important;color:var(--text)!important;border:1px solid var(--border2)!important;border-radius:9px;padding:10px 13px;font-size:14px;width:100%;outline:none}
    `}</style>
  </div>;
}

// ─── ERFOLGE TAB (Spielerbereich) ─────────────────────────────────────────────
function ErfolgeTab({player, hideTraining=false}) {
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
    {!hideTraining&&<div style={{marginBottom:20}}>
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
    </div>}

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
  const [editingId,setEditingId] = useState(null);
  const [editForm,setEditForm] = useState({});

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

  async function updateObs(id) {
    if (!editForm.strengths&&!editForm.weaknesses&&!editForm.focus) return;
    try {
      await setDoc(doc(db,"observations",selPlayer.id,"entries",id),
        {...editForm, updatedAt:Date.now()},{merge:true});
      showToast("Beobachtung aktualisiert","✏️");
      setEditingId(null);
    } catch(e){ showToast("Fehler: "+e.message,"❌"); }
  }

  const CONTEXT_COLORS = {Training:"#3b82f6",Punktspiel:"#f59e0b",Turnier:"#10b981"};

  return <div style={{padding:13,paddingBottom:40}}>
    <div style={{fontSize:17,fontWeight:800,marginBottom:12}}>🔍 Beobachtungen</div>

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
            <button onClick={()=>{
              if(editingId===obs.id){setEditingId(null);}
              else{setEditingId(obs.id);setEditForm({date:obs.date,context:obs.context,strengths:obs.strengths||"",weaknesses:obs.weaknesses||"",focus:obs.focus||""});}
            }} style={{padding:"4px 10px",background:"#3b82f622",border:"1px solid #3b82f644",borderRadius:6,color:"#3b82f6",fontSize:11,cursor:"pointer"}}>
              {editingId===obs.id?"✕ Abbrechen":"✏️ Bearbeiten"}
            </button>
            {editingId===obs.id&&<div style={{marginTop:10,borderTop:"1px solid var(--border2)",paddingTop:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:3}}>Datum</label>
                  <input type="date" value={editForm.date||""} onChange={e=>setEditForm(p=>({...p,date:e.target.value}))}
                    style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg)",color:"var(--text)",fontSize:12,outline:"none"}}/>
                </div>
                <div>
                  <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:3}}>Kontext</label>
                  <select value={editForm.context||"Training"} onChange={e=>setEditForm(p=>({...p,context:e.target.value}))} style={{fontSize:12,padding:"6px 8px"}}>
                    <option>Training</option><option>Punktspiel</option><option>Turnier</option>
                  </select>
                </div>
              </div>
              <div style={{marginBottom:6}}>
                <label style={{fontSize:10,color:"#10b981",display:"block",marginBottom:3,fontWeight:600}}>💪 Stärken</label>
                <textarea value={editForm.strengths||""} onChange={e=>setEditForm(p=>({...p,strengths:e.target.value}))} rows={2}
                  style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid #10b98144",background:"var(--bg)",color:"var(--text)",fontSize:12,resize:"vertical",outline:"none"}}/>
              </div>
              <div style={{marginBottom:6}}>
                <label style={{fontSize:10,color:"#f59e0b",display:"block",marginBottom:3,fontWeight:600}}>⚠️ Entwicklungsfelder</label>
                <textarea value={editForm.weaknesses||""} onChange={e=>setEditForm(p=>({...p,weaknesses:e.target.value}))} rows={2}
                  style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid #f59e0b44",background:"var(--bg)",color:"var(--text)",fontSize:12,resize:"vertical",outline:"none"}}/>
              </div>
              <div style={{marginBottom:8}}>
                <label style={{fontSize:10,color:"#3b82f6",display:"block",marginBottom:3,fontWeight:600}}>🎯 Fokus</label>
                <textarea value={editForm.focus||""} onChange={e=>setEditForm(p=>({...p,focus:e.target.value}))} rows={1}
                  style={{width:"100%",padding:"6px 8px",borderRadius:6,border:"1px solid #3b82f644",background:"var(--bg)",color:"var(--text)",fontSize:12,resize:"vertical",outline:"none"}}/>
              </div>
              <button onClick={()=>updateObs(obs.id)} style={{width:"100%",padding:"8px",background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                💾 Änderungen speichern
              </button>
            </div>}
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

// ─── EINHEITEN TAB ────────────────────────────────────────────────────────────

const AUFWAERM_SPIELE = [
  {id:"aw1",  name:"Raketenfänger",        icon:"🚀", dauer:"10-15 Min", material:"3-6 Softbälle",        details:"Alle Kinder laufen frei durch die Halle. 2-4 Kinder sind Raketenwerfer und rollen oder werfen Softbälle flach über den Boden. Wer getroffen wird, macht 3 Hampelmänner und läuft sofort weiter. Nach einigen Minuten wechseln die Werfer. Besonders gut für: Reaktion, Ausweichen, schnelles Laufen."},
  {id:"aw2",  name:"Lava-Lauf",            icon:"🌋", dauer:"15 Min",    material:"Reifen oder Matten",    details:"Der Boden ist Lava. Kinder bewegen sich zwischen sicheren Inseln (Reifen/Matten). Wer die Lava berührt, macht eine kleine Zusatzaufgabe und spielt weiter. Nach und nach verschwinden Inseln. Besonders gut für: Schnelligkeit und Orientierung."},
  {id:"aw3",  name:"Ninja-Schwänze",       icon:"🥷", dauer:"10-15 Min", material:"Tücher oder Bänder",    details:"Jedes Kind trägt ein Tuch hinten in der Hose. Ziel ist es, möglichst viele Schwänze anderer Kinder zu klauen und den eigenen zu behalten. Wer keinen Schwanz mehr hat, holt sich einen neuen. Besonders gut für: Richtungswechsel und Reaktion."},
  {id:"aw4",  name:"Piraten gegen Haie",   icon:"🏴‍☠️", dauer:"15 Min",  material:"Hütchen",               details:"Piraten bewegen sich zwischen Inseln (Hütchen). Haie versuchen sie zwischen den Inseln abzuschlagen. Gefangene machen eine kleine Aufgabe und spielen weiter. Wechsel nach 3 Minuten. Besonders gut für: Dauerbewegung."},
  {id:"aw5",  name:"Farben-Blitz",         icon:"🌈", dauer:"10 Min",    material:"Farbige Hütchen",       details:"Der Trainer ruft Farben auf. Alle Kinder sprinten zum passenden Hütchen. Wer zuletzt ankommt, macht eine Zusatzaufgabe. Bewegungsarten können variiert werden (hüpfen, rückwärts laufen). Besonders gut für: Schnelle Reaktion."},
  {id:"aw6",  name:"Affenalarm",           icon:"🐒", dauer:"15 Min",    material:"Keines",                details:"Die Kinder bewegen sich wie verschiedene Tiere durch die Halle (Affe, Känguru, Elefant). Auf Zuruf wechseln alle blitzschnell die Tierart. Trainer zeigt kurz vor, wie das Tier sich bewegt. Besonders gut für: Koordination und Kreativität."},
  {id:"aw7",  name:"Geisterjagd",          icon:"👻", dauer:"10-15 Min", material:"Leibchen",              details:"Gefangene Kinder frieren ein und können durch Unterkrabbeln eines freien Kindes befreit werden. 2-3 Fänger mit Leibchen starten. Wechsel nach 3 Minuten. Besonders gut für: Teamarbeit und Bewegung."},
  {id:"aw8",  name:"Roboter-Explosion",    icon:"🤖", dauer:"15 Min",    material:"Keines",                details:"Alle Kinder bewegen sich langsam und steif wie Roboter durch die Halle. Beim Signalwort 'Explosion' sprinten alle los. Beim Signalwort 'Stopp' wieder einfrieren als Roboter. Variation: verschiedene Signale für verschiedene Bewegungen. Besonders gut für: Tempowechsel."},
  {id:"aw9",  name:"König der Reifen",     icon:"👑", dauer:"15 Min",    material:"Reifen",                details:"Immer ein Reifen weniger als Kinder. Nach dem Signal sucht jedes Kind schnell einen Reifen und stellt sich hinein. Wer keinen findet, scheidet aus oder macht eine Aufgabe. Ein weiterer Reifen wird entfernt. Besonders gut für: Aufmerksamkeit und Tempo."},
  {id:"aw10", name:"Superhelden-Fänger",   icon:"🦸", dauer:"15 Min",    material:"Keines",                details:"Jedes Kind wählt eine besondere Bewegungsart (Supersprung, Flugbewegung). Fänger versuchen die Superhelden abzuschlagen. Wer abgeschlagen wird, muss 5 Sekunden in der Superheldenpose stehen bleiben. Besonders gut für: Bewegungsvielfalt."},
  {id:"aw11", name:"Feuer-Wasser-Blitz",   icon:"⚡", dauer:"10-15 Min", material:"Keines",                details:"Der Trainer ruft verschiedene Kommandos: Feuer=alle laufen, Wasser=alle stehen still, Blitz=alle hüpfen, Sturm=alle drehen sich. Wer falsch reagiert, macht eine Zusatzaufgabe. Tempo steigern. Besonders gut für: Reaktionsfähigkeit."},
  {id:"aw12", name:"Monster-Mix",          icon:"👾", dauer:"15 Min",    material:"Keines",                details:"Die Kinder bewegen sich wie verschiedene Monsterarten durch die Halle: Zombie (langsam, steif), Werwolf (auf allen Vieren), Dracula (Arme ausgebreitet). Trainer wechselt das Monster alle 30 Sekunden. Besonders gut für: Ganzkörperbewegung."},
  {id:"aw13", name:"Turbo-Zoo",            icon:"🦁", dauer:"15 Min",    material:"Hütchen als Ziel",      details:"Teams von 3-4 Kindern bewegen sich als Tierherde (Löwen, Pferde, Frösche) durch die Halle. Erste Herde die alle Hütchen auf der eigenen Seite gesammelt hat, gewinnt. Besonders gut für: Beinaktivierung."},
  {id:"aw14", name:"Kettenblitz",          icon:"⛓️",  dauer:"15 Min",    material:"Keines",                details:"1 Kind startet als Fänger. Gefangene Kinder fassen den Fänger an und bilden eine Kette. Die Kette muss zusammenhalten. Nur die Enden der Kette dürfen fangen. Ziel: alle einfangen. Besonders gut für: Teambewegung."},
  {id:"aw15", name:"Chaos-Transport",      icon:"🚚", dauer:"15 Min",    material:"Bälle oder Gegenstände", details:"Teams transportieren möglichst viele Bälle von A nach B mit wechselnden Bewegungsarten (hüpfen, rückwärts, auf Zehenspitzen). Wer mehr Bälle in 3 Minuten transportiert, gewinnt. Besonders gut für: Koordination."},
  {id:"aw16", name:"Die verrückte Ampel",  icon:"🚦", dauer:"10-15 Min", material:"Keines",                details:"Rot=Stopp, Gelb=langsam schleichen, Grün=sprinten. Trainer wechselt schnell. Wer falsch reagiert, macht eine Aufgabe. Variation: Farben umkehren (Grün=Stopp). Besonders gut für: Konzentration."},
  {id:"aw17", name:"Raketenstart",         icon:"🛸", dauer:"10 Min",    material:"Keines",                details:"Alle Kinder starten aus verschiedenen Positionen: liegend, hockend, auf einem Bein stehend, mit geschlossenen Augen. Auf das Signal sprinten alle zur Hallenmitte. Erste Person gewinnt. Besonders gut für: Explosivität."},
  {id:"aw18", name:"Hütchen-Klau",         icon:"🎩", dauer:"15 Min",    material:"Viele Hütchen",         details:"Teams haben je ein Lager mit Hütchen. Teams klauen Hütchen aus den Lagern der anderen. Eigene Hütchen dürfen nicht bewacht werden. Nach 3 Minuten: Wer hat die meisten? Besonders gut für: Dauerbewegung."},
  {id:"aw19", name:"Eisbären-Fang",        icon:"🐻‍❄️", dauer:"15 Min", material:"Keines",                details:"Gefangene Kinder frieren ein (stehen still mit ausgebreckten Armen). Sie können von freien Kindern durch Unterlaufen befreit werden. Eisbären (Fänger) patrouillieren. Wechsel nach 3 Minuten. Besonders gut für: Hohe Aktivität."},
  {id:"aw20", name:"Weltraum-Mission",     icon:"🌍", dauer:"15 Min",    material:"Matten und Hütchen",    details:"Kinder überwinden Asteroidenfelder (Matten auf dem Boden) und retten Energie-Kristalle (Hütchen). Teams konkurrieren wer mehr Kristalle retten kann ohne die Asteroiden zu berühren. Besonders gut für: Koordination."},
  {id:"aw21", name:"Zahlen-Jäger",         icon:"🔢", dauer:"10-15 Min", material:"Keines",                details:"Der Trainer ruft eine Zahl. Kinder müssen sich blitzschnell in Gruppen genau dieser Größe finden. Wer keiner Gruppe angehört oder eine falsche Gruppe hat, macht eine kleine Aufgabe. Besonders gut für: Kommunikation und Tempo."},
  {id:"aw22", name:"Turbo-Tunnel",         icon:"🚇", dauer:"15 Min",    material:"Keines",                details:"Gruppen von 4-6 Kindern bilden Tunnel mit den Beinen. Letztes Kind krabbelt durch den Tunnel und stellt sich vorne an. Wer ist zuerst am Ziel? Variation: Tunnel muss sich vorwärts bewegen. Besonders gut für: Ganzkörperaktivität."},
  {id:"aw23", name:"Bananenfangen",        icon:"🍌", dauer:"10 Min",    material:"Softbälle",             details:"Mehrere Softbälle (Bananen) rollen kreuz und quer durch die Halle. Kinder müssen ausweichen ohne getroffen zu werden. Wer getroffen wird, macht 5 Hampelmänner. Mehr Bälle = schwieriger. Besonders gut für: Reaktion."},
  {id:"aw24", name:"Schlangenrennen",      icon:"🐍", dauer:"15 Min",    material:"Hütchen als Parcours",  details:"Teams von 3-5 Kindern stellen sich hintereinander auf und halten sich an den Schultern fest (Schlange). Sie bewegen sich als Schlange durch einen Hüt-chen-Parcours. Welche Schlange ist am schnellsten? Besonders gut für: Koordination."},
  {id:"aw25", name:"Zombie-Insel",         icon:"🧟", dauer:"15 Min",    material:"Matten oder Reifen",    details:"Zombies bewegen sich langsam durch die Halle. Andere Kinder fliehen und suchen sichere Inseln (Matten/Reifen). Auf der Insel sind sie sicher, aber nicht länger als 5 Sekunden. Wer angetippt wird, wird selbst zum Zombie. Besonders gut für: Richtungswechsel."},
  {id:"aw26", name:"Der Boden ist Pudding",icon:"🍮", dauer:"10-15 Min", material:"Linien oder Matten",    details:"Bestimmte Bereiche der Halle (markiert mit Linien oder Matten) sind Pudding und dürfen nicht betreten werden. Kinder müssen springen, balancieren und ausweichen. Wer den Pudding berührt, macht eine Zusatzaufgabe. Besonders gut für: Sprungkraft."},
  {id:"aw27", name:"Blitz-Ball",           icon:"⚾", dauer:"15 Min",    material:"Mehrere Softbälle",     details:"Viele Bälle gleichzeitig im Spiel. Kinder spielen sich gegenseitig zu und niemand darf länger als 2 Sekunden einen Ball halten. Wer einen Ball fallen lässt, macht eine kleine Aufgabe. Besonders gut für: Hohe Aktivität."},
  {id:"aw28", name:"Frosch-König",         icon:"🐸", dauer:"10-15 Min", material:"Keines",                details:"Alle Kinder bewegen sich hüpfend (wie Frösche) durch die Halle. Der König gibt neue Bewegungsaufgaben vor: Riesenfrosch, Minifrosch, Seitwärtsfrosch. König wechselt nach 2 Minuten. Besonders gut für: Beinaktivierung."},
  {id:"aw29", name:"Schatzräuber",         icon:"💎", dauer:"15 Min",    material:"Bälle oder Hütchen",   details:"Schätze (Bälle/Hütchen) liegen in der Hallenmitte. Teams sammeln Schätze und bringen sie ins eigene Lager. Dabei können gegnerische Schätze aus deren Lager gestohlen werden. Nach 3 Minuten zählen. Besonders gut für: Sprinten und Wenden."},
  {id:"aw30", name:"Wirbelwind-Challenge", icon:"🌀", dauer:"15 Min",    material:"Keines",                details:"Alle 30 Sekunden wechseln die Bewegungsaufgaben: sprinten, hüpfen, krabbeln, drehen, rückwärts laufen, auf Zehenspitzen. Trainer gibt Takt vor. Alle machen gleichzeitig dieselbe Bewegung. Besonders gut für: Maximale Aktivierung."},
];

const WETTKAMPF_SPIELE = [
  {id:"wk1",  gruppe:"Anfänger", name:"Balloon-Tischtennis",    icon:"🎈",
    beschreibung:"Luftballon statt Ball — langsam & spaßig",
    details:"Material: Luftballon. Ablauf: Jedes Kind bekommt einen Luftballon als Ball. Gespielt wird normal am Tisch oder auf dem Boden. Der Ballon fliegt langsam — genug Zeit für Grundstellung und Schlagtechnik. Variation: Wer schlägt den Ballon öfter hin und her ohne Fehler? Besonders gut für: Motivation, Grundstellung, erster Schlagkontakt."},
  {id:"wk2",  gruppe:"Anfänger", name:"Boden-Rallye",           icon:"⛹️",
    beschreibung:"Ball einmal auftippen lassen vor jedem Schlag",
    details:"Material: Tischtennisball und Schläger. Ablauf: Wie normale Rallye, aber vor jedem Schlag darf der Ball einmal auf den Boden tippen. Das verlangsamt das Spiel und gibt Zeit zum Vorbereiten. Punkte für jeden erfolgreichen Ballwechsel. Besonders gut für: Timing, Reaktion, Grundschläge."},
  {id:"wk3",  gruppe:"Anfänger", name:"Kooperations-Rallye",    icon:"🤝",
    beschreibung:"So viele Ballwechsel wie möglich gemeinsam schaffen",
    details:"Material: Tischtennisball und Schläger. Ablauf: Kein Gegeneinander — beide Seiten versuchen den Ball möglichst oft hin und her zu spielen ohne Fehler. Ziel: eigenen Rekord brechen. Trainer zählt laut mit. Variation: Zeitlimit 1 Minute. Besonders gut für: Teamwork, Konzentration, Ausdauer."},
  {id:"wk4",  gruppe:"Anfänger", name:"Zieltreffer-Duell",      icon:"🎯",
    beschreibung:"Kleines Ziel (Hütchen) auf Gegner-Tischseite treffen",
    details:"Material: 1 Hütchen pro Tisch. Ablauf: Ein Hütchen steht in der Mitte der gegnerischen Tischseite. Wer das Hütchen trifft, bekommt 2 Punkte. Normaler Treffer = 1 Punkt. Bis 10 Punkte spielen. Besonders gut für: Zielgenauigkeit, Motivation, Freude am Treffen."},
  {id:"wk5",  gruppe:"Anfänger", name:"Tischtennis-Bowling",    icon:"🎳",
    beschreibung:"Ball über den Tisch rollen und Hütchen umwerfen",
    details:"Material: 6 Hütchen, Tischtennisball. Ablauf: Hütchen werden auf der Grundlinie des Gegners aufgestellt. Ball wird über den Tisch gerollt (nicht geschlagen) um die Kegel umzuwerfen. Jeder Spieler hat 3 Versuche. Wer mehr Kegel trifft, gewinnt. Besonders gut für: Feinmotorik, Spaß, Wurfgefühl."},
  {id:"wk6",  gruppe:"Anfänger", name:"Aufschlag-König",        icon:"👑",
    beschreibung:"Wer trifft 5× den gegnerischen Tisch?",
    details:"Material: Tischtennisball. Ablauf: Jedes Kind macht 5 Aufschläge. Wer den Ball auf die gegnerische Tischseite bringt, bekommt einen Punkt. Wer zuerst 5 Punkte hat, ist Aufschlag-König. Alle dürfen ihre eigene Aufschlagposition wählen. Besonders gut für: Aufschlag üben, Erfolgserlebnisse schaffen."},
  {id:"wk7",  gruppe:"Anfänger", name:"Linienturnier",          icon:"📏",
    beschreibung:"Punkt nur wenn Ball auf die Grundlinie trifft",
    details:"Material: Tischtennisball. Ablauf: Normales Spiel, aber Punkte gibt es nur wenn der Ball die gegnerische Grundlinie berührt oder überfliegt. Sonst kein Punkt. Fördert gezieltes, langes Spiel. Bis 7 Punkte. Besonders gut für: Längeneinschätzung, Schlagstärke."},
  {id:"wk8",  gruppe:"Anfänger", name:"Rückhand-Battle",        icon:"🤜",
    beschreibung:"Nur Rückhand spielen — wer macht 3 Punkte?",
    details:"Material: Tischtennisball. Ablauf: Beide Spieler spielen ausschließlich mit Rückhand. Vorhand = Fehler, Punkt für den Gegner. Bis 5 Punkte. Trainer kann Aufschlag machen. Besonders gut für: Rückhand isoliert üben, taktisches Bewusstsein."},
  {id:"wk9",  gruppe:"Anfänger", name:"Vorhand-Battle",         icon:"🤛",
    beschreibung:"Nur Vorhand spielen — wer macht 3 Punkte?",
    details:"Material: Tischtennisball. Ablauf: Beide Spieler spielen ausschließlich mit Vorhand. Rückhand = Fehler, Punkt für den Gegner. Beide Spieler stehen leicht versetzt. Bis 5 Punkte. Besonders gut für: Vorhand isoliert üben."},
  {id:"wk10", gruppe:"Anfänger", name:"Endlos-Turnier",         icon:"🔄",
    beschreibung:"Punkte sammeln, nach jedem Punkt weiterrotieren",
    details:"Material: Alle Tische. Ablauf: Gewinner bleibt, Verlierer wechselt zum nächsten Tisch (im Uhrzeigersinn). Jeder sammelt Punkte über alle Spiele hinweg. Nach 15 Minuten: Wer hat die meisten Punkte? Besonders gut für: Viele Spielsituationen, Selbstbewusstsein stärken."},
  {id:"wk11", gruppe:"Anfänger", name:"Zwei-Felder-Duell",      icon:"✂️",
    beschreibung:"Tisch in 2 Hälften — nur in die richtige Hälfte spielen",
    details:"Material: Klebeband oder Hütchen als Markierung. Ablauf: Tisch wird längs oder quer in 2 Felder geteilt. Spieler einigen sich vorher welches Feld erlaubt ist. Ball im falschen Feld = Fehler. Variation: Feld nach jedem Punkt wechseln. Besonders gut für: Zielgenauigkeit, Platzierung."},
  {id:"wk12", gruppe:"Anfänger", name:"Tischtennis-Darts",      icon:"🎯",
    beschreibung:"Ringe auf dem Tisch, Punkte je nach Zone",
    details:"Material: Klebeband für Zonen, Tischtennisball. Ablauf: Auf der Tischseite des Gegners werden 3 Zonen markiert (innen=3P, mitte=2P, außen=1P). Jeder Spieler macht 5 gezielte Aufschläge oder Schläge. Wer mehr Punkte sammelt, gewinnt. Besonders gut für: Präzision, Motivation."},
  {id:"wk13", gruppe:"Anfänger", name:"Ball-Halten-Wettbewerb", icon:"⏱️",
    beschreibung:"Ball am längsten auf dem Schläger halten",
    details:"Material: Tischtennisball und Schläger. Ablauf: Jeder Spieler balanciert den Ball auf dem Schläger und geht dabei durch die Halle. Wer den Ball fallen lässt, scheidet aus oder zählt die Zeit neu. Variation: Hindernisse überwinden. Besonders gut für: Konzentration, Gleichgewicht, Ballgefühl."},
  {id:"wk14", gruppe:"Anfänger", name:"Spiegelspiel",           icon:"🪞",
    beschreibung:"Trainer spielt vor — Kinder spiegeln, dann gegenseitig",
    details:"Material: Tischtennisball und Schläger. Ablauf: Trainer schlägt in verschiedene Ecken. Kinder versuchen denselben Schlag zu spiegeln (selbe Richtung, selbe Stärke). Dann spielen zwei Kinder gegeneinander — einer macht vor, der andere spiegelt. Besonders gut für: Beobachtungsvermögen, Schlagtechnik."},
  {id:"wk15", gruppe:"Anfänger", name:"Kerzen-Bowling",         icon:"🕯️",
    beschreibung:"Hütchen als Kegel aufstellen und umrollen",
    details:"Material: Hütchen, Tischtennisball. Ablauf: 6 Hütchen werden auf dem Tisch aufgestellt. Ball wird von der Grundlinie gerollt (nicht geschlagen). Wer alle Kegel mit weniger Versuchen umwirft, gewinnt. Variation: Ball über Netz rollen. Besonders gut für: Präzision, Feinmotorik."},
  {id:"wk16", gruppe:"Fortgeschrittene", name:"21er-Turnier",          icon:"🔢",
    beschreibung:"Klassisch bis 21, Aufschlag wechselt alle 5 Punkte",
    details:"Material: Tischtennisball. Ablauf: Klassisches Tischtennis bis 21 Punkte, 2 Punkte Vorsprung erforderlich. Aufschlag wechselt alle 5 Punkte (ab 20:20 jede Runde). Gewinner bleibt, Nächster kommt. Besonders gut für: Wettkampferfahrung, Regelkenntnisse."},
  {id:"wk17", gruppe:"Fortgeschrittene", name:"Zonenduell",             icon:"🗺️",
    beschreibung:"Punkte nur wenn in markierte Zonen gespielt wird",
    details:"Material: Klebeband, Tischtennisball. Ablauf: Tisch wird in 4 Zonen eingeteilt. Vor dem Spiel werden 2 Zonen als Pflichtzonen definiert. Ball nur in Pflichtzone = 2 Punkte, andere Seite = 1 Punkt, Netz = 0. Wechselt alle 3 Minuten. Besonders gut für: Platzierung, taktisches Denken."},
  {id:"wk18", gruppe:"Fortgeschrittene", name:"Aufschlag-Varianten",    icon:"🌀",
    beschreibung:"Nur bestimmte Aufschlagtechniken erlaubt",
    details:"Material: Tischtennisball. Ablauf: Trainer bestimmt die Aufschlagform (z.B. nur Unterschnitt, nur Seitenschnitt, nur langer Aufschlag). Punktestand bis 11. Jede Runde andere Aufschlagtechnik. Besonders gut für: Aufschlagtechnik vertiefen, taktische Variabilität."},
  {id:"wk19", gruppe:"Fortgeschrittene", name:"Konter-Battle",          icon:"⚔️",
    beschreibung:"Nur Konterschläge — kein Topspin erlaubt",
    details:"Material: Tischtennisball. Ablauf: Beide Spieler spielen ausschließlich Konterschläge (flach, schnell, keine Rotation). Topspin = Fehler, Punkt für Gegner. Bis 11 Punkte. Fördert schnelle Reaktion und klare Schlagtechnik. Besonders gut für: Kontertechnik, Reflexe."},
  {id:"wk20", gruppe:"Fortgeschrittene", name:"Diagonal-Duell",         icon:"↗️",
    beschreibung:"Nur diagonal spielen",
    details:"Material: Tischtennisball. Ablauf: Beide Spieler spielen ausschließlich diagonal. Parallelball = Fehler, Punkt für Gegner. Aufschlag diagonal. Bis 11 Punkte. Variation: Nur Vorhand-diagonal oder Rückhand-diagonal. Besonders gut für: Diagonalspielen, Taktik."},
  {id:"wk21", gruppe:"Fortgeschrittene", name:"Parallel-Duell",         icon:"↕️",
    beschreibung:"Nur parallel spielen",
    details:"Material: Tischtennisball. Ablauf: Beide Spieler spielen ausschließlich parallel (gerade). Diagonalball = Fehler, Punkt für Gegner. Bis 11 Punkte. Gut kombinierbar nach dem Diagonal-Duell. Besonders gut für: Parallelspielen, Bahngefühl."},
  {id:"wk22", gruppe:"Fortgeschrittene", name:"Topspin-König",          icon:"🌊",
    beschreibung:"Punkt nur wenn Topspin gespielt wird",
    details:"Material: Tischtennisball. Ablauf: Jeder Punkt zählt nur wenn der Angriff mit Topspin gespielt wurde. Blocker-Punkte zählen nicht. Bis 15 Punkte. Trainer kann prüfen ob Rotation vorhanden ist. Besonders gut für: Topspin-Motivation, Angriffsspiel."},
  {id:"wk23", gruppe:"Fortgeschrittene", name:"Runden-Turnier",         icon:"🏅",
    beschreibung:"Jeder gegen jeden, Tabelle führen",
    details:"Material: Whiteboard oder Zettel. Ablauf: Alle Spieler spielen einmal gegeneinander (Jeder-gegen-Jeden). Bis 11 Punkte. 3 Punkte für Sieg, 1 für Unentschieden. Am Ende Tabelle auswerten. Besonders gut für: Wettkampferfahrung, Fairplay."},
  {id:"wk24", gruppe:"Fortgeschrittene", name:"Doppel-Turnier",         icon:"👫",
    beschreibung:"Zufällige Doppelpaare, klassisches Doppelturnier",
    details:"Material: Los-System (Zettel). Ablauf: Zufällige Doppelpaare auslosen. Doppelturnier bis 21. Aufschlag wechselt nach 5 Punkten, innerhalb eines Paares abwechselnd schlagen. Besonders gut für: Teamgeist, Doppelregeln kennenlernen."},
  {id:"wk25", gruppe:"Fortgeschrittene", name:"Handicap-Match",         icon:"⚖️",
    beschreibung:"Stärkerer Spieler startet mit -5 Punkten",
    details:"Material: Tischtennisball. Ablauf: Stärkerer Spieler startet bei -5 (oder mehr), schwächerer bei 0. Bis 11 Punkte. Handicap kann angepasst werden. Hält Motivation beider Spieler hoch. Besonders gut für: Ausgeglichene Duelle, Fairness."},
  {id:"wk26", gruppe:"Fortgeschrittene", name:"Zonen-Fünfer",           icon:"5️⃣",
    beschreibung:"Tisch in 5 Zonen, Punkte nach getroffener Zone",
    details:"Material: Klebeband. Ablauf: Tisch in 5 Zonen (1-5 Punkte) einteilen, hintere Ecken = 5P. Aufschlag muss in Zone landen. Pro Runde 5 Aufschläge, Punkte summieren. Wechseln. Besonders gut für: Präzision, Strategie beim Aufschlag."},
  {id:"wk27", gruppe:"Fortgeschrittene", name:"Schweizer System",       icon:"🇨🇭",
    beschreibung:"4 Runden à 5 Punkte — immer ähnlich starke Spieler",
    details:"Material: Zettel mit Paarungen. Ablauf: Runde 1 zufällig. Ab Runde 2 spielen Gewinner gegen Gewinner, Verlierer gegen Verlierer. 4 Runden à 5 Punkte. Gesamtpunkte addieren. Besonders gut für: Viele Spiele, immer passende Gegner."},
  {id:"wk28", gruppe:"Fortgeschrittene", name:"Comeback-King",          icon:"📈",
    beschreibung:"Startet immer mit 0:5 Rückstand",
    details:"Material: Tischtennisball. Ablauf: Spieler A startet immer mit 0:5 Rückstand und muss von hinten kommen. Bis 11 Punkte. Dann tauschen. Zählt wie oft der Rückstand aufgeholt wird. Besonders gut für: Mentalstärke, Comeback-Fähigkeit."},
  {id:"wk29", gruppe:"Fortgeschrittene", name:"Stille-Post-Duell",      icon:"🗣️",
    beschreibung:"Trainer gibt Taktik vor — sofort umsetzen",
    details:"Material: Tischtennisball. Ablauf: Trainer flüstert vor dem Punkt einen taktischen Auftrag (z.B. 'spiel kurz dann lang' oder 'Aufschlag in die Rückhand'). Spieler setzt es um. Nach 5 Punkten neuer Auftrag. Besonders gut für: Taktikverständnis, Spielintelligenz."},
  {id:"wk30", gruppe:"Fortgeschrittene", name:"Meisterschaft",          icon:"🏆",
    beschreibung:"Miniturnier mit Auf-/Abstieg nach jeder Runde",
    details:"Material: Alle Tische, Nummerierung. Ablauf: Tisch 1 = Königstisch. Gewinner steigt auf (zu niedrigerem Tisch = besser), Verlierer steigt ab. Jeder spielt bis 5. Nach 20 Minuten: Wer sitzt am Königstisch? Besonders gut für: Motivation, Wettkampfatmosphäre."},
];

const REFLEXIONS_FRAGEN = [
  "Was hat dir heute am meisten Spaß gemacht?",
  "Was war heute für dich besonders schwierig?",
  "Welche Übung möchtest du beim nächsten Mal nochmal machen?",
  "Was hast du heute Neues gelernt?",
  "Bist du heute mit deiner Leistung zufrieden? Warum?",
  "Was würdest du das nächste Mal anders machen?",
  "Wem möchtest du heute ein Lob aussprechen?",
  "Welches Spiel hat dir am besten gefallen und warum?",
  "Was hat dich heute überrascht?",
  "Was nimmst du dir für das nächste Training vor?",
];

const BALLGEWOEHNUNG = EXERCISES_BEGINNER.filter(e=>e.id>=3&&e.id<=10);
const TECHNIK_EX = EXERCISES_ADVANCED;

const ABSCHNITTE = [
  {id:"begruessung",    label:"1. Begrüßung & Aufbau",        icon:"👋", color:"#6366f1"},
  {id:"aufwaermen",     label:"2. Aufwärmen",                 icon:"🏃", color:"#f59e0b"},
  {id:"ballgewoehnung", label:"3. Ball- & Schlägergewöhnung", icon:"🏓", color:"#10b981"},
  {id:"technik",        label:"4. Technik & Hauptteil",       icon:"⚡", color:"#3b82f6"},
  {id:"wettkampf",      label:"5. Wettkampf & Spiele",        icon:"🏆", color:"#ef4444"},
  {id:"abschluss",      label:"6. Abbau & Abschluss",         icon:"🎯", color:"#8b5cf6"},
];

function EinheitenTab({user, players}) {
  const [einheiten,setEinheiten] = useState([]);
  const [editId,setEditId] = useState(null);
  const [showForm,setShowForm] = useState(false);
  const [form,setForm] = useState(null);
  const [loading,setLoading] = useState(true);
  const [toast,setToast] = useState(null);
  const [expandedId,setExpandedId] = useState(null);
  const [activeAbschnitt,setActiveAbschnitt] = useState("begruessung");
  const [detailExpandedId,setDetailExpandedId] = useState(null);
  const [filterZeit, setFilterZeit] = useState("kuenftig");
  const [filterGruppe, setFilterGruppe] = useState("alle");

  function showToast(msg,emoji="✅"){setToast({msg,emoji});setTimeout(()=>setToast(null),2500);}

  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"einheiten"),snap=>{
      setEinheiten(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    },()=>setLoading(false));
    return unsub;
  },[]);

  function newForm(){
    const todayStr=new Date().toLocaleDateString("sv");
    return {
      titel:"", gruppe:"Anfänger", datum:todayStr,
      aufwaermen:[], ballgewoehnung:[], technik:[], wettkampf:[],
      trainer1:"", trainer2:"", trainer3:"",
      notizen:{begruessung:"",abschluss:"",reflexion:""},
      nachbereitung:{gutGelaufen:"",wenigerGut:"",naechstesMal:""},
      status:"geplant",
    };
  }

  function dupForm(e){
    const todayStr=new Date().toLocaleDateString("sv");
    return {
      titel:(e.titel?e.titel+" (Kopie)":"Kopie"),
      gruppe:e.gruppe, datum:todayStr,
      aufwaermen:[...(e.aufwaermen||[])],
      ballgewoehnung:[...(e.ballgewoehnung||[])],
      technik:[...(e.technik||[])],
      wettkampf:[...(e.wettkampf||[])],
      trainer1:e.trainer1||"", trainer2:e.trainer2||"", trainer3:e.trainer3||"",
      notizen:{begruessung:e.notizen?.begruessung||"",abschluss:e.notizen?.abschluss||"",reflexion:e.notizen?.reflexion||""},
      // Nachbereitung wird geleert (Punkt 7)
      nachbereitung:{gutGelaufen:"",wenigerGut:"",naechstesMal:""},
      status:"geplant",
    };
  }

  async function saveEinheit() {
    if(!form.datum||!form.gruppe) return;
    try {
      if(editId){
        await updateDoc(doc(db,"einheiten",editId),{...form,updatedAt:Date.now()});
        showToast("Einheit gespeichert","💾");
      } else {
        await addDoc(collection(db,"einheiten"),{...form,createdBy:user?.email||"",createdAt:Date.now()});
        showToast("Einheit erstellt","✅");
      }
      setShowForm(false); setEditId(null); setForm(null);
    } catch(e){showToast("Fehler: "+e.message,"❌");}
  }

  async function deleteEinheit(id){
    if(!window.confirm("Einheit löschen?")) return;
    await deleteDoc(doc(db,"einheiten",id)).catch(()=>{});
    showToast("Gelöscht","🗑️");
  }

  function toggleSel(arr,val,max){
    if(arr.includes(val)) return arr.filter(x=>x!==val);
    if(arr.length>=max) return arr;
    return [...arr,val];
  }

  const todayFilter = new Date().toLocaleDateString("sv");
  const sorted = [...einheiten]
    .filter(e=>{
      if(filterGruppe!=="alle" && e.gruppe!==filterGruppe) return false;
      if(filterZeit==="kuenftig")  return (e.datum||"")>=todayFilter;
      if(filterZeit==="vergangen") return (e.datum||"")<todayFilter;
      return true;
    })
    .sort((a,b)=>{
      const dateCmp=(a.datum||"").localeCompare(b.datum||"");
      if(dateCmp!==0) return dateCmp;
      return (a.titel||"").localeCompare(b.titel||"","de",{sensitivity:"base"});
    });
  const GRUPPEN_COLORS = {Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6"};

  return <div style={{padding:14,paddingBottom:60}}>
    {toast&&<div style={{position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",
      background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:12,padding:"10px 20px",
      display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600,zIndex:900,
      boxShadow:"0 8px 32px #0008"}}><span style={{fontSize:18}}>{toast.emoji}</span>{toast.msg}</div>}

    {/* Header */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div style={{fontSize:17,fontWeight:800}}>📝 Trainingseinheiten</div>
      <button onClick={()=>{setForm(newForm());setEditId(null);setShowForm(true);setActiveAbschnitt("begruessung");}} style={{
        padding:"7px 14px",background:"linear-gradient(135deg,#10b981,#059669)",
        border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",
      }}>+ Neue Einheit</button>
    </div>

    {/* Formular */}
    {showForm&&form&&<div style={{background:"var(--bg2)",border:"1px solid #10b98144",borderRadius:14,padding:16,marginBottom:20}}>
      <div style={{fontSize:14,fontWeight:700,color:"#10b981",marginBottom:12}}>
        {editId?"✏️ Einheit bearbeiten":"🆕 Neue Einheit"}
      </div>

      {/* Grunddaten */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
        <div>
          <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Gruppe</label>
          <select value={form.gruppe} onChange={e=>setForm(p=>({...p,gruppe:e.target.value}))} style={{fontSize:13}}>
            {["Anfänger","Fortgeschrittene","Profis"].map(g=><option key={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Trainingstag</label>
          <input type="date" value={form.datum} onChange={e=>setForm(p=>({...p,datum:e.target.value}))}
            style={{padding:"7px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"}}/>
        </div>
      </div>
      {(()=>{
        const tL=players.filter(p=>p.roles?.trainer===true&&p.status!=="passiv").sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"","de"));
        const sel=[form.trainer1,form.trainer2,form.trainer3].filter(Boolean);
        return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
          {[["trainer1","Trainer 1"],["trainer2","Trainer 2"],["trainer3","Trainer 3"]].map(([k,l])=>(
            <div key={k}>
              <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:3}}>{l}</label>
              <select value={form[k]||""} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} style={{fontSize:11,padding:"5px 6px"}}>
                <option value="">—</option>
                {tL.filter(t=>!sel.includes(t.id)||form[k]===t.id).map(t=>(
                  <option key={t.id} value={t.id}>{t.firstName} {(t.lastName||"").charAt(0)}.</option>
                ))}
              </select>
            </div>
          ))}
        </div>;
      })()}
      <div style={{marginBottom:12}}>
        <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Titel (optional)</label>
        <input value={form.titel} onChange={e=>setForm(p=>({...p,titel:e.target.value}))} placeholder="z.B. Aufschlag-Training Dienstag"
          style={{width:"100%",padding:"8px 10px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
      </div>

      {/* Abschnitt-Navigation */}
      <div style={{display:"flex",gap:4,marginBottom:12,overflowX:"auto",paddingBottom:4}}>
        {ABSCHNITTE.map(a=><button key={a.id} onClick={()=>setActiveAbschnitt(a.id)} style={{
          flexShrink:0,padding:"5px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
          border:`2px solid ${activeAbschnitt===a.id?a.color:a.color+"44"}`,
          background:activeAbschnitt===a.id?a.color+"22":"transparent",
          color:activeAbschnitt===a.id?a.color:"var(--text3)",
        }}>{a.icon}</button>)}
        {/* Punkt 2: Zwischenspeichern jederzeit */}
        <button onClick={saveEinheit} style={{
          flexShrink:0,marginLeft:"auto",padding:"5px 12px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
          border:"2px solid #10b981",background:"#10b98122",color:"#10b981",
        }}>💾 Speichern</button>
      </div>

      {/* Abschnitt-Label */}
      {(()=>{const a=ABSCHNITTE.find(x=>x.id===activeAbschnitt); return <div style={{fontSize:13,fontWeight:700,color:a.color,marginBottom:10}}>{a.icon} {a.label}</div>;})()}

      {/* 1. Begrüßung */}
      {activeAbschnitt==="begruessung"&&<div>
        <div style={{background:"var(--bg)",borderRadius:10,padding:12,marginBottom:8,fontSize:12,color:"var(--text2)",lineHeight:1.8}}>
          <b>Ablauf:</b><br/>
          🤝 Alle Kinder kommen zusammen<br/>
          📋 Trainer begrüßt alle, macht die Anwesenheitsliste<br/>
          👥 Dienstags: Aufteilung in Profis, Fortgeschrittene, Anfänger<br/>
          🏓 Freitags: Nur Profis trainieren<br/>
          📌 Festlegung wer welche Gruppe übernimmt
        </div>
        <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Notizen zur Begrüßung</label>
        <textarea value={form.notizen.begruessung||""} rows={3} placeholder="z.B. Besondere Ankündigungen, wer welche Gruppe hat..."
          onChange={e=>setForm(p=>({...p,notizen:{...p.notizen,begruessung:e.target.value}}))}
          style={{width:"100%",padding:8,background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
      </div>}

      {/* 2. Aufwärmen */}
      {activeAbschnitt==="aufwaermen"&&<div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>1–2 Spiele auswählen (antippen für Details):</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:360,overflowY:"auto"}}>
          {AUFWAERM_SPIELE.map(sp=>{
            const sel=form.aufwaermen.includes(sp.id);
            const disabled=!sel&&form.aufwaermen.length>=2;
            const isExpAW=expandedId===("aw_"+sp.id);
            return <div key={sp.id} style={{borderRadius:9,border:`2px solid ${sel?"#f59e0b":"var(--border2)"}`,background:sel?"#f59e0b22":"var(--bg3)",opacity:disabled?0.5:1}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",cursor:"pointer"}}
                onClick={()=>setExpandedId(isExpAW?null:("aw_"+sp.id))}>
                <span style={{fontSize:20,flexShrink:0}}>{sp.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:sel?"#f59e0b":"var(--text)"}}>{sp.name}</div>
                  <div style={{fontSize:10,color:"var(--text3)"}}>{sp.dauer} · {sp.material}</div>
                </div>
                <button onClick={e=>{e.stopPropagation();!disabled&&setForm(p=>({...p,aufwaermen:toggleSel(p.aufwaermen,sp.id,2)}))} } style={{
                  flexShrink:0,padding:"4px 8px",borderRadius:7,border:`1px solid ${sel?"#f59e0b":"var(--border2)"}`,
                  background:sel?"#f59e0b":"var(--bg2)",color:sel?"#fff":"var(--text3)",fontSize:11,cursor:"pointer",
                }}>{sel?"✓ Gewählt":"+ Wählen"}</button>
                <span style={{color:"var(--text4)",fontSize:10}}>{isExpAW?"▲":"▼"}</span>
              </div>
              {isExpAW&&<div style={{padding:"0 12px 10px",borderTop:"1px solid var(--border)",marginTop:0}}>
                <p style={{fontSize:11,color:"var(--text2)",lineHeight:1.6,margin:"8px 0 0"}}>{sp.details}</p>
              </div>}
            </div>;
          })}
        </div>
        {form.aufwaermen.length>0&&<div style={{marginTop:8,fontSize:11,color:"#f59e0b",fontWeight:700}}>
          ✓ {form.aufwaermen.map(id=>AUFWAERM_SPIELE.find(s=>s.id===id)?.name).join(" + ")}
        </div>}
      </div>}

      {/* 3. Ballgewöhnung */}
      {activeAbschnitt==="ballgewoehnung"&&<div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>1–4 Übungen aus Anfänger-Bereich (Nr. 3–10):</div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {BALLGEWOEHNUNG.map(ex=>{
            const sel=form.ballgewoehnung.includes(ex.id);
            const disabled=!sel&&form.ballgewoehnung.length>=4;
            return <button key={ex.id} onClick={()=>!disabled&&setForm(p=>({...p,ballgewoehnung:toggleSel(p.ballgewoehnung,ex.id,4)}))} style={{
              display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:9,cursor:disabled?"not-allowed":"pointer",
              border:`2px solid ${sel?"#10b981":"var(--border2)"}`,
              background:sel?"#10b98122":"var(--bg3)",
              opacity:disabled?0.5:1,textAlign:"left",
            }}>
              <span style={{fontSize:16,flexShrink:0}}>🏓</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:sel?"#10b981":"var(--text)"}}>#{ex.id} {ex.name}</div>
                <div style={{fontSize:10,color:"var(--text3)"}}>{ex.description}</div>
              </div>
              {sel&&<span style={{color:"#10b981",fontSize:16}}>✓</span>}
            </button>;
          })}
        </div>
      </div>}

      {/* 4. Technik */}
      {activeAbschnitt==="technik"&&<div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>2–4 Technikübungen aus Fortgeschrittenen-Bereich:</div>
        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:320,overflowY:"auto"}}>
          {TECHNIK_EX.map(ex=>{
            const sel=form.technik.includes(ex.id);
            const disabled=!sel&&form.technik.length>=4;
            return <button key={ex.id} onClick={()=>!disabled&&setForm(p=>({...p,technik:toggleSel(p.technik,ex.id,4)}))} style={{
              display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:9,cursor:disabled?"not-allowed":"pointer",
              border:`2px solid ${sel?"#3b82f6":"var(--border2)"}`,
              background:sel?"#3b82f622":"var(--bg3)",
              opacity:disabled?0.5:1,textAlign:"left",
            }}>
              <span style={{fontSize:16,flexShrink:0}}>⚡</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:sel?"#3b82f6":"var(--text)"}}>#{ex.id} {ex.name}</div>
                <div style={{fontSize:10,color:"var(--text3)"}}>{ex.description}</div>
              </div>
              {sel&&<span style={{color:"#3b82f6",fontSize:16}}>✓</span>}
            </button>;
          })}
        </div>
      </div>}

      {/* 5. Wettkampf */}
      {activeAbschnitt==="wettkampf"&&<div>
        <div style={{fontSize:11,color:"var(--text3)",marginBottom:8}}>1–4 Spielformen auswählen (antippen für Details):</div>
        {(()=>{
          // Punkt 4: Filter by selected gruppe
          const isAnfaenger = form.gruppe==="Anfänger";
          const isProfi = form.gruppe==="Profis";
          // Anfänger → nur Anfänger-Wettkämpfe; Profis/Fortgeschrittene → nur Fortgeschrittene-Wettkämpfe
          const gruppeFilter = isAnfaenger ? "Anfänger" : "Fortgeschrittene";
          const filtered = WETTKAMPF_SPIELE.filter(w=>w.gruppe===gruppeFilter);
          return <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:360,overflowY:"auto"}}>
            {filtered.map(w=>{
              const sel=form.wettkampf.includes(w.id);
              const disabled=!sel&&form.wettkampf.length>=4;
              const isExpWK=expandedId===("wk_"+w.id);
              return <div key={w.id} style={{borderRadius:9,border:`2px solid ${sel?"#ef4444":"var(--border2)"}`,background:sel?"#ef444422":"var(--bg3)",opacity:disabled?0.5:1}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",cursor:"pointer"}}
                  onClick={()=>setExpandedId(isExpWK?null:("wk_"+w.id))}>
                  <span style={{fontSize:20,flexShrink:0}}>{w.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:sel?"#ef4444":"var(--text)"}}>{w.name}</div>
                    <div style={{fontSize:10,color:"var(--text3)"}}>{w.beschreibung}</div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();!disabled&&setForm(p=>({...p,wettkampf:toggleSel(p.wettkampf,w.id,4)}))}} style={{
                    flexShrink:0,padding:"4px 8px",borderRadius:7,border:`1px solid ${sel?"#ef4444":"var(--border2)"}`,
                    background:sel?"#ef4444":"var(--bg2)",color:sel?"#fff":"var(--text3)",fontSize:11,cursor:"pointer",
                  }}>{sel?"✓ Gewählt":"+ Wählen"}</button>
                  <span style={{color:"var(--text4)",fontSize:10}}>{isExpWK?"▲":"▼"}</span>
                </div>
                {isExpWK&&<div style={{padding:"0 12px 10px",borderTop:"1px solid var(--border)",marginTop:0}}>
                  <p style={{fontSize:11,color:"var(--text2)",lineHeight:1.6,margin:"8px 0 0"}}>{w.details}</p>
                </div>}
              </div>;
            })}
          </div>;
        })()}
      </div>}

      {/* 6. Abschluss */}
      {activeAbschnitt==="abschluss"&&<div>
        <div style={{background:"var(--bg)",borderRadius:10,padding:12,marginBottom:10,fontSize:12,color:"var(--text2)",lineHeight:1.8}}>
          <b>Ablauf Abschluss:</b><br/>
          🧹 Halle aufräumen, Bälle sammeln<br/>
          🎖️ Ggf. Urkunden vergeben<br/>
          📅 Ausblick nächste Turniere / Punktspiele<br/>
          👋 Kurze Verabschiedung
        </div>
        <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Reflexionsfrage(n) für heute</label>
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:10}}>
          {REFLEXIONS_FRAGEN.map((f,i)=>{
            const sel=(form.notizen.reflexion||"").includes(f);
            return <button key={i} onClick={()=>{
              const curr=form.notizen.reflexion||"";
              const updated=sel?curr.replace(f,"").trim():curr+(curr?"\n":"")+f;
              setForm(p=>({...p,notizen:{...p.notizen,reflexion:updated}}));
            }} style={{
              padding:"6px 10px",borderRadius:7,cursor:"pointer",textAlign:"left",fontSize:11,
              border:`1px solid ${sel?"#8b5cf6":"var(--border2)"}`,
              background:sel?"#8b5cf622":"var(--bg3)",
              color:sel?"#8b5cf6":"var(--text2)",
            }}>❓ {f}</button>;
          })}
        </div>
        <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:4}}>Weitere Notizen</label>
        <textarea value={form.notizen.abschluss||""} rows={2} placeholder="Urkundenvergabe, Turnierhinweise..."
          onChange={e=>setForm(p=>({...p,notizen:{...p.notizen,abschluss:e.target.value}}))}
          style={{width:"100%",padding:8,background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:8,color:"var(--text)",fontSize:12,resize:"vertical",outline:"none",boxSizing:"border-box"}}/>

        {/* Nachbereitung */}
        <div style={{marginTop:12,borderTop:"1px solid var(--border)",paddingTop:10}}>
          <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:8}}>📊 Nachbereitung (nach dem Training)</div>
          {[
            {key:"gutGelaufen",label:"✅ Was ist gut gelaufen?",placeholder:"z.B. Aufwärmphase hat super funktioniert"},
            {key:"wenigerGut",label:"⚠️ Was lief weniger gut?",placeholder:"z.B. Technikübungen zu komplex für Anfänger"},
            {key:"naechstesMal",label:"📌 Für nächstes Training beachten",placeholder:"z.B. Mehr Fokus auf Rückhand"},
          ].map(f=><div key={f.key} style={{marginBottom:8}}>
            <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>{f.label}</label>
            <textarea value={form.nachbereitung[f.key]||""} rows={2} placeholder={f.placeholder}
              onChange={e=>setForm(p=>({...p,nachbereitung:{...p.nachbereitung,[f.key]:e.target.value}}))}
              style={{width:"100%",padding:7,background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text)",fontSize:12,resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
          </div>)}
        </div>
      </div>}

      {/* Save/Cancel */}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <button onClick={saveEinheit} style={{flex:1,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
          💾 Einheit speichern
        </button>
        <button onClick={()=>{setShowForm(false);setEditId(null);setForm(null);}} style={{padding:"10px 14px",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:9,color:"var(--text2)",fontSize:13,cursor:"pointer"}}>
          ✕
        </button>
      </div>
    </div>}

    {/* P4: Filter Einheiten + Gruppe */}
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{display:"flex",gap:3}}>
        {[["kuenftig","Künftige"],["vergangen","Vergangene"],["alle","Alle"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilterZeit(v)} style={{
            padding:"5px 10px",borderRadius:7,fontSize:11,fontWeight:600,cursor:"pointer",
            background:filterZeit===v?"#10b981":"var(--bg3)",
            color:filterZeit===v?"#fff":"var(--text3)",
            border:`1px solid ${filterZeit===v?"#10b981":"var(--border2)"}`,
          }}>{l}</button>
        ))}
      </div>
      <select value={filterGruppe} onChange={ev=>setFilterGruppe(ev.target.value)} style={{
        padding:"5px 8px",borderRadius:7,fontSize:11,background:"var(--bg3)",
        border:"1px solid var(--border2)",color:"var(--text)",outline:"none",
      }}>
        <option value="alle">Alle Gruppen</option>
        <option value="Anfänger">Anfänger</option>
        <option value="Fortgeschrittene">Fortgeschrittene</option>
        <option value="Profis">Profis</option>
      </select>
    </div>

    {/* Liste der Einheiten */}
    {loading?<div style={{textAlign:"center",padding:30,color:"var(--text3)"}}>Lädt...</div>
    :sorted.length===0?<div style={{textAlign:"center",padding:30,color:"var(--text3)"}}>
        <div style={{fontSize:40,marginBottom:8}}>📝</div>
        <div>{filterZeit==="vergangen"?"Keine vergangenen Einheiten":filterZeit==="kuenftig"?"Keine künftigen Einheiten":"Noch keine Einheiten"}</div>
        <div style={{fontSize:12,marginTop:4}}>{filterZeit==="kuenftig"?"Erstelle deine erste Trainingseinheit!":""}</div>
      </div>
    :<div style={{display:"flex",flexDirection:"column",gap:10}}>
      {sorted.map(e=>{
        const isExp=expandedId===e.id;
        const gc=GRUPPEN_COLORS[e.gruppe]||"#6b7280";
        const datum=e.datum?new Date(e.datum).toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"}):"";
        const awSelNames=e.aufwaermen?.map(id=>AUFWAERM_SPIELE.find(s=>s.id===id)).filter(Boolean)||[];
        const bgSelNames=e.ballgewoehnung?.map(id=>BALLGEWOEHNUNG.find(x=>x.id===id)).filter(Boolean)||[];
        const tkSelNames=e.technik?.map(id=>TECHNIK_EX.find(x=>x.id===id)).filter(Boolean)||[];
        const wkSelNames=e.wettkampf?.map(id=>WETTKAMPF_SPIELE.find(x=>x.id===id)).filter(Boolean)||[];
        const hasNachbereitung=e.nachbereitung?.gutGelaufen||e.nachbereitung?.wenigerGut||e.nachbereitung?.naechstesMal;

        return <div key={e.id} style={{background:"var(--bg2)",borderRadius:13,border:"1px solid var(--border)",borderLeft:`4px solid ${gc}`,overflow:"hidden"}}>
          {/* Header */}
          <div onClick={()=>setExpandedId(isExp?null:e.id)} style={{padding:"11px 13px",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:800,color:gc}}>{e.titel||`Training ${e.gruppe}`}</div>
              <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>📅 {datum} · 👥 {e.gruppe}</div>
              {(e.trainer1||e.trainer2)&&<div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>
                👤 {[e.trainer1,e.trainer2].filter(Boolean).map(id=>{
                  const p=players.find(x=>x.id===id);
                  return p?`${p.firstName||""} ${p.lastName||""}`.trim():id;
                }).join(", ")}
              </div>}
              <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
                {awSelNames.length>0&&<span style={{fontSize:9,background:"#f59e0b22",color:"#f59e0b",borderRadius:4,padding:"1px 5px"}}>🏃 {awSelNames.length} Aufwärm</span>}
                {bgSelNames.length>0&&<span style={{fontSize:9,background:"#10b98122",color:"#10b981",borderRadius:4,padding:"1px 5px"}}>🏓 {bgSelNames.length} Ballgew.</span>}
                {tkSelNames.length>0&&<span style={{fontSize:9,background:"#3b82f622",color:"#3b82f6",borderRadius:4,padding:"1px 5px"}}>⚡ {tkSelNames.length} Technik</span>}
                {wkSelNames.length>0&&<span style={{fontSize:9,background:"#ef444422",color:"#ef4444",borderRadius:4,padding:"1px 5px"}}>🏆 {wkSelNames.length} Wettkampf</span>}
                {hasNachbereitung&&<span style={{fontSize:9,background:"#8b5cf622",color:"#8b5cf6",borderRadius:4,padding:"1px 5px"}}>📊 Nachbereitung</span>}
              </div>
            </div>
            <span style={{color:"var(--text3)",fontSize:12}}>{isExp?"▲":"▼"}</span>
          </div>

          {/* Detail */}
          {isExp&&<div style={{borderTop:"1px solid var(--border)",padding:"12px 14px"}}>
            {ABSCHNITTE.map(abschnitt=>{
              let content=null;
              if(abschnitt.id==="begruessung"&&e.notizen?.begruessung){
                content=<div style={{fontSize:12,color:"var(--text2)"}}>{e.notizen.begruessung}</div>;
              } else if(abschnitt.id==="begruessung"){
                content=<div style={{fontSize:11,color:"var(--text4)"}}>Begrüßung, Anwesenheitsliste, Gruppeneinteilung</div>;
              } else if(abschnitt.id==="aufwaermen"&&awSelNames.length>0){
                content=<div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {awSelNames.map(s=>{
                    const isDetExp=detailExpandedId===("detail_aw_"+e.id+"_"+s.id);
                    return <div key={s.id} style={{borderRadius:7,border:"1px solid var(--border2)",overflow:"hidden"}}>
                      <div onClick={ev=>{ev.stopPropagation();setDetailExpandedId(isDetExp?null:("detail_aw_"+e.id+"_"+s.id));}} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",cursor:"pointer",background:"#f59e0b11"}}>
                        <span style={{fontSize:14}}>{s.icon}</span>
                        <span style={{fontSize:11,fontWeight:700,color:"#f59e0b",flex:1}}>{s.name}</span>
                        <span style={{fontSize:9,color:"var(--text4)"}}>{isDetExp?"▲":"▼"}</span>
                      </div>
                      {isDetExp&&<div style={{padding:"6px 9px",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--text2)",lineHeight:1.6}}>{s.details}</div>}
                    </div>;
                  })}
                </div>;
              } else if(abschnitt.id==="ballgewoehnung"&&bgSelNames.length>0){
                content=<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {bgSelNames.map(s=><span key={s.id} style={{fontSize:11,background:"#10b98122",color:"#10b981",borderRadius:6,padding:"2px 8px"}}>🏓 {s.name} <span style={{fontSize:9,opacity:0.7}}>(Ü{String(s.id).padStart(3,"0")})</span></span>)}
                </div>;
              } else if(abschnitt.id==="technik"&&tkSelNames.length>0){
                content=<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {tkSelNames.map(s=><span key={s.id} style={{fontSize:11,background:"#3b82f622",color:"#3b82f6",borderRadius:6,padding:"2px 8px"}}>⚡ {s.name} <span style={{fontSize:9,opacity:0.7}}>(Ü{String(s.id).padStart(3,"0")})</span></span>)}
                </div>;
              } else if(abschnitt.id==="wettkampf"&&wkSelNames.length>0){
                content=<div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {wkSelNames.map(s=>{
                    const isDetExp=detailExpandedId===("detail_wk_"+e.id+"_"+s.id);
                    return <div key={s.id} style={{borderRadius:7,border:"1px solid var(--border2)",overflow:"hidden"}}>
                      <div onClick={ev=>{ev.stopPropagation();setDetailExpandedId(isDetExp?null:("detail_wk_"+e.id+"_"+s.id));}} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",cursor:"pointer",background:"#ef444411"}}>
                        <span style={{fontSize:14}}>{s.icon}</span>
                        <span style={{fontSize:11,fontWeight:700,color:"#ef4444",flex:1}}>{s.name}</span>
                        <span style={{fontSize:9,color:"var(--text4)"}}>{isDetExp?"▲":"▼"}</span>
                      </div>
                      {isDetExp&&<div style={{padding:"6px 9px",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--text2)",lineHeight:1.6}}>{s.details}</div>}
                    </div>;
                  })}
                </div>;
              } else if(abschnitt.id==="abschluss"){
                const rf=e.notizen?.reflexion;
                content=<>
                  {rf&&<div style={{fontSize:11,color:"#8b5cf6",marginBottom:4}}>{rf.split("\n").map((q,i)=><div key={i}>❓ {q}</div>)}</div>}
                  {e.notizen?.abschluss&&<div style={{fontSize:11,color:"var(--text2)"}}>{e.notizen.abschluss}</div>}
                </>;
              }
              if(!content) return null;
              return <div key={abschnitt.id} style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:abschnitt.color,marginBottom:4}}>{abschnitt.icon} {abschnitt.label}</div>
                {content}
              </div>;
            })}

            {hasNachbereitung&&<div style={{marginTop:12,borderTop:"1px solid var(--border)",paddingTop:10}}>
              <div style={{fontSize:12,fontWeight:700,color:"#8b5cf6",marginBottom:8}}>📊 Nachbereitung</div>
              {e.nachbereitung?.gutGelaufen&&<div style={{marginBottom:5}}><span style={{fontSize:10,color:"#10b981",fontWeight:700}}>✅ Gut gelaufen: </span><span style={{fontSize:11,color:"var(--text2)"}}>{e.nachbereitung.gutGelaufen}</span></div>}
              {e.nachbereitung?.wenigerGut&&<div style={{marginBottom:5}}><span style={{fontSize:10,color:"#f59e0b",fontWeight:700}}>⚠️ Weniger gut: </span><span style={{fontSize:11,color:"var(--text2)"}}>{e.nachbereitung.wenigerGut}</span></div>}
              {e.nachbereitung?.naechstesMal&&<div><span style={{fontSize:10,color:"#3b82f6",fontWeight:700}}>📌 Nächstes Mal: </span><span style={{fontSize:11,color:"var(--text2)"}}>{e.nachbereitung.naechstesMal}</span></div>}
            </div>}

            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button onClick={()=>{setForm({...e});setEditId(e.id);setShowForm(true);setActiveAbschnitt("begruessung");}} style={{flex:1,padding:"7px",background:"#3b82f622",border:"1px solid #3b82f644",borderRadius:8,color:"#3b82f6",fontSize:12,fontWeight:700,cursor:"pointer"}}>✏️ Bearbeiten</button>
              <button onClick={()=>{setForm(dupForm(e));setEditId(null);setShowForm(true);setActiveAbschnitt("begruessung");}} style={{flex:1,padding:"7px",background:"#10b98122",border:"1px solid #10b98144",borderRadius:8,color:"#10b981",fontSize:12,fontWeight:700,cursor:"pointer"}}>📋 Duplizieren</button>
              <button onClick={()=>deleteEinheit(e.id)} style={{padding:"7px 12px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,color:"#ef4444",fontSize:12,cursor:"pointer"}}>🗑️</button>
            </div>
          </div>}
        </div>;
      })}
    </div>}
  </div>;
}

// ─── BIRTHDAY BUTTON COMPONENT ────────────────────────────────────────────────
function BirthdayBtn({players, attendance}) {
  const [dismissed,setDismissed] = useState(false);
  const [showPopup,setShowPopup] = useState(false);

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toLocaleDateString("sv");

  // Punkt 4: Per-player last training day based on group+trainingDays
  function getLastTrainingForPlayer(p) {
    const grp = p.group||"Anfänger";
    const days = getTrainingDaysForGroup(grp, p.trainingDays);
    return [...days].reverse().find(d=>d<=todayStr) || null;
  }

  // Use single lastTraining date (most recent across all groups) for consistent window
  // Use OLDEST last training day across all groups (last Tuesday)
  // so Anfänger/Fortgeschrittene birthdays aren't missed because of a Friday training
  const todayDateStr = today.toLocaleDateString("sv");
  const lastTuesday = [...ALL_TUESDAYS].reverse().find(d=>d<=todayDateStr) || ALL_TUESDAYS[0];
  const lastFriday  = [...ALL_FRIDAYS].reverse().find(d=>d<=todayDateStr)  || ALL_FRIDAYS[0];
  // Use the LATER of the two = most recent actual training day
  const lastTrainingDay = lastTuesday > lastFriday ? lastTuesday : lastFriday;
  const birthdaySince2 = new Date(lastTrainingDay);
  birthdaySince2.setHours(0,0,0,0);

  const recentBirthdays = [];
  const activePlayers = players.filter(p=>p.birthdate && p.status!=="passiv" && p.group!=="Erwachsene");
  for (const p of activePlayers) {
    const bd = new Date(p.birthdate);
    const thisYear = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
    thisYear.setHours(0,0,0,0);
    if (thisYear >= birthdaySince2 && thisYear <= today) {
      recentBirthdays.push({...p, age: today.getFullYear()-bd.getFullYear(), bday:thisYear, lastDay:lastTrainingDay});
    }
  }

  if (recentBirthdays.length === 0) return null;

  return <>
    <button onClick={()=>{setShowPopup(true);setDismissed(false);}} style={{
      background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:8,
      color:"#f59e0b",fontSize:12,padding:"4px 8px",cursor:"pointer",flexShrink:0,
    }}>🎂 {recentBirthdays.length}</button>

    {showPopup&&!dismissed&&<div style={{
      position:"fixed",top:0,left:0,right:0,bottom:0,background:"#0008",zIndex:800,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20,
    }} onClick={()=>setShowPopup(false)}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"var(--bg2)",borderRadius:16,padding:20,maxWidth:400,width:"100%",maxHeight:"80vh",overflowY:"auto",
      }}>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:40,marginBottom:8}}>🎂</div>
          <div style={{fontSize:17,fontWeight:800,color:"var(--text)",marginBottom:4}}>Geburtstage seit letztem Training</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>Gruppenspezifische Trainingstage berücksichtigt</div>
        </div>
        {recentBirthdays.map(p=>(
          <div key={p.id} style={{background:"var(--bg3)",borderRadius:10,padding:"10px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:24}}>{p.avatar||"🎂"}</span>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,color:"var(--text)"}}>{p.firstName} {p.lastName}</div>
              <div style={{fontSize:12,color:"#f59e0b"}}>🎂 {p.bday.toLocaleDateString("de-DE")} — {p.age} Jahre</div>
              <div style={{fontSize:10,color:"var(--text4)"}}>seit {new Date(p.lastDay).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}</div>
            </div>
          </div>
        ))}
        <button onClick={()=>setShowPopup(false)} style={{width:"100%",marginTop:8,padding:10,background:"linear-gradient(135deg,#10b981,#059669)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Schließen</button>
      </div>
    </div>}
  </>;
}

// ─── MANNSCHAFTEN VERWALTUNG ──────────────────────────────────────────────────
// AufstellungUpload
function AufstellungUpload({showToast}) {
  const [uploading,setUploading]=useState(false);
  const [saved,setSaved]=useState([]);

  // Alle möglichen Keys — dynamisch erkennen via Meta-Doc
  const ALL_KEYS=[
    "aufstellung_2024_2025_R","aufstellung_2024_2025_V",
    "aufstellung_2025_2026_R","aufstellung_2025_2026_V",
    "aufstellung_2026_2027_R","aufstellung_2026_2027_V",
    "aufstellung_2027_2028_R","aufstellung_2027_2028_V",
  ];

  function mesz(ts){
    if(!ts) return "—";
    const d=new Date(ts+0);
    return d.toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})+" Uhr";
  }

  function reload(){
    Promise.all(ALL_KEYS.map(k=>
      getDoc(doc(db,"config",k))
        .then(s=>s.exists()?{
          id:k,
          saison:s.data().saison||k.replace(/aufstellung_/,"").replace(/_[RV]$/,"").replace(/_/g,"/"),
          runde:s.data().runde||(k.endsWith("_R")?"Rückrunde":"Vorrunde"),
          count:(s.data().spieler||[]).length,
          lastUpdated:s.data().lastUpdated||null
        }:null)
        .catch(()=>null)
    )).then(r=>{
      const list=r.filter(Boolean).sort((a,b)=>{
        const sA=a.id.replace(/_[RV]$/,""), sB=b.id.replace(/_[RV]$/,"");
        if(sA!==sB) return sB.localeCompare(sA);
        return a.id.endsWith("_R")?-1:1; // RR vor VR
      });
      setSaved(list);
    });
  }

  useEffect(()=>{ reload(); },[]);

  async function handleUpload(file) {
    if(!file||!file.name.endsWith('.pdf')){showToast("Bitte eine PDF-Datei hochladen","❌");return;}
    setUploading(true);
    try {
      const fn=file.name;
      const saisonMatch=fn.match(/(\d{4})[\-_]?(\d{2,4})/);
      const saison=saisonMatch?`${saisonMatch[1]}/${saisonMatch[2].length===2?"20"+saisonMatch[2]:saisonMatch[2]}`:"2025/2026";
      const isRueck=["rueck","rück","ruck","r_ck","rueckrunde","rückrunde"].some(w=>fn.toLowerCase().includes(w));
      const runde=isRueck?"Rückrunde":"Vorrunde";
      const key=`aufstellung_${saison.replace("/","_")}_${isRueck?"R":"V"}`;
      const spielerData = AUFSTELLUNG_DATA[key] || AUFSTELLUNG_2025_2026_R;
      const ts=Date.now();

      // 1. Spielerdaten + Timestamp speichern
      await setDoc(doc(db,"config",key),{saison,runde,spieler:spielerData,lastUpdated:ts});

      // 2. PDF separat (on-demand geladen)
      const reader=new FileReader();
      reader.onload=async(ev)=>{
        try {
          await setDoc(doc(db,"config","pdf_"+key),{pdfUrl:ev.target.result,name:file.name,lastUpdated:ts});
        } catch(e){ showToast("PDF zu groß für Speicherung","⚠️"); }
        setUploading(false);
        reload();
      };
      reader.onerror=()=>{ setUploading(false); reload(); };
      reader.readAsDataURL(file);
      showToast(`Aufstellung ${saison} ${runde}: ${spielerData.length} Spieler gespeichert`,"📋");
    } catch(e){showToast("Fehler: "+e.message,"❌");setUploading(false);}
  }

  async function openPdf(id) {
    const snap=await getDoc(doc(db,"config","pdf_"+id)).catch(()=>null);
    const pdfUrl=snap?.data()?.pdfUrl;
    if(!pdfUrl){showToast("Kein PDF gespeichert — bitte neu hochladen","❌");return;}
    // Anchor-Download statt window.open (kein Popup-Blocker Problem)
    const b64=pdfUrl.split(",")[1];
    const bin=atob(b64);const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blobUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
    const a=document.createElement("a");
    a.href=blobUrl;
    a.download="Aufstellung_"+id+".pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(blobUrl),5000);
  }

  async function deleteEntry(id,label) {
    if(!window.confirm(`"${label}" wirklich löschen?`)) return;
    try {
      await deleteDoc(doc(db,"config",id));
      await deleteDoc(doc(db,"config","pdf_"+id)).catch(()=>{});
      showToast("Gelöscht","✅");
      reload();
    } catch(e){showToast("Fehler: "+e.message,"❌");}
  }

  return <div>
    <label style={{display:"block",padding:"9px 12px",background:"var(--bg3)",border:"2px dashed var(--border2)",
      borderRadius:9,textAlign:"center",cursor:uploading?"not-allowed":"pointer",fontSize:12,color:"var(--text3)"}}>
      {uploading?"⏳ Wird verarbeitet...":"📎 Aufstellungs-PDF hochladen"}
      <input type="file" accept=".csv,.pdf" style={{display:"none"}} disabled={uploading}
        onChange={e=>handleUpload(e.target.files?.[0])}/>
    </label>
    <div style={{fontSize:10,color:"var(--text4)",marginTop:4,marginBottom:10}}>
      Dateiname enthält Saison (z.B. 2025_2026) und "Rueck" oder "Vor".
    </div>
    {saved.length>0&&<div>
      <div style={{fontSize:11,fontWeight:700,color:"var(--text2)",marginBottom:6}}>Gespeicherte Aufstellungen:</div>
      {saved.map(a=>{
        const label=`${a.runde==="Rückrunde"?"RR":"VR"} ${a.saison}`;
        return <div key={a.id} style={{marginBottom:6,padding:"8px 10px",background:"var(--bg)",
          borderRadius:8,border:"1px solid var(--border)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:12,fontWeight:700,flex:1}}>{label}</span>
            <span style={{fontSize:10,color:"var(--text4)"}}>{a.count} Spieler</span>
            <button onClick={()=>openPdf(a.id)}
              style={{fontSize:11,color:"#3b82f6",background:"none",border:"none",cursor:"pointer",padding:"0 4px"}}>📄 PDF</button>
            <button onClick={()=>deleteEntry(a.id,label)}
              style={{fontSize:11,color:"#ef4444",background:"none",border:"none",cursor:"pointer",padding:"0 4px"}}>🗑️</button>
          </div>
          {a.lastUpdated&&<div style={{fontSize:10,color:"var(--text4)",marginTop:3}}>
            Hochgeladen: {mesz(a.lastUpdated)}
          </div>}
        </div>;
      })}
    </div>}
  </div>;
}

function MannschaftenVerwaltung({showToast}) {
  const [teamFiles,setTeamFiles] = useState({});
  const [uploading,setUploading] = useState({});

  useEffect(()=>{
    const unsub = onSnapshot(doc(db,"config","teamFiles"),snap=>{
      if(snap.exists()) setTeamFiles(snap.data());
    },()=>{});
    return unsub;
  },[]);

  async function handleUpload(teamId, type, file) {
    if(!file) return;
    setUploading(p=>({...p,[teamId+type]:true}));
    const reader = new FileReader();
    reader.onload = async(e)=>{
      const dataUrl = e.target.result;
      const key = `${teamId}_${type}`;
      const updated = {...teamFiles, [key]:dataUrl, [`${key}_name`]:file.name};
      await setDoc(doc(db,"config","teamFiles"),updated,{merge:true}).catch(()=>{});
      setTeamFiles(updated);
      showToast(`${file.name} hochgeladen`,"📎");
      setUploading(p=>({...p,[teamId+type]:false}));
    };
    reader.readAsDataURL(file);
  }

  async function handleDelete(teamId, type) {
    const key = `${teamId}_${type}`;
    const updated = {...teamFiles};
    delete updated[key]; delete updated[`${key}_name`];
    await setDoc(doc(db,"config","teamFiles"),updated).catch(()=>{});
    setTeamFiles(updated);
    showToast("Gelöscht","🗑️");
  }

  return <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:14,marginBottom:16}}>
    <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:12}}>📋 Mannschaften — Spiel-PINs & Spielcodes</div>
    <div style={{fontSize:11,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>
      Lade pro Mannschaft Dateien mit Spiel-PINs und Spielcodes hoch. Diese erscheinen dann im Spielbetrieb-Tab.
    </div>

    {TEAMS.map(t=>{
      const pinKey = `${t.id}_pin`; const codeKey = `${t.id}_code`;
      const pinFile = teamFiles[pinKey]; const codFile = teamFiles[codeKey];
      const pinName = teamFiles[`${pinKey}_name`]; const codName = teamFiles[`${codeKey}_name`];
      return <div key={t.id} style={{borderTop:"1px solid var(--border)",paddingTop:10,marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:t.color,marginBottom:6}}>{t.name}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {/* Spiel-PINs */}
          <div style={{background:"var(--bg3)",borderRadius:8,padding:8}}>
            <div style={{fontSize:10,color:"var(--text3)",marginBottom:4,fontWeight:700}}>🔑 Spiel-PINs</div>
            {pinFile
              ? <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,color:"#10b981",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pinName}</span>
                  <button onClick={()=>handleDelete(t.id,"pin")} style={{padding:"2px 5px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:4,color:"#ef4444",fontSize:9,cursor:"pointer",flexShrink:0}}>✕</button>
                </div>
              : <label style={{display:"block",padding:"4px 8px",background:"var(--bg2)",border:"1px dashed var(--border2)",borderRadius:6,fontSize:10,color:"var(--text3)",cursor:uploading[t.id+"pin"]?"not-allowed":"pointer",textAlign:"center"}}>
                  {uploading[t.id+"pin"]?"⏳ Lädt…":"📎 Datei hochladen"}
                  <input type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg" style={{display:"none"}}
                    onChange={e=>handleUpload(t.id,"pin",e.target.files?.[0])} disabled={uploading[t.id+"pin"]}/>
                </label>}
          </div>
          {/* Spielcodes */}
          <div style={{background:"var(--bg3)",borderRadius:8,padding:8}}>
            <div style={{fontSize:10,color:"var(--text3)",marginBottom:4,fontWeight:700}}>🎫 Spielcodes</div>
            {codFile
              ? <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,color:"#10b981",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{codName}</span>
                  <button onClick={()=>handleDelete(t.id,"code")} style={{padding:"2px 5px",background:"#ef444422",border:"1px solid #ef444466",borderRadius:4,color:"#ef4444",fontSize:9,cursor:"pointer",flexShrink:0}}>✕</button>
                </div>
              : <label style={{display:"block",padding:"4px 8px",background:"var(--bg2)",border:"1px dashed var(--border2)",borderRadius:6,fontSize:10,color:"var(--text3)",cursor:uploading[t.id+"code"]?"not-allowed":"pointer",textAlign:"center"}}>
                  {uploading[t.id+"code"]?"⏳ Lädt…":"📎 Datei hochladen"}
                  <input type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg" style={{display:"none"}}
                    onChange={e=>handleUpload(t.id,"code",e.target.files?.[0])} disabled={uploading[t.id+"code"]}/>
                </label>}
          </div>
        </div>
      </div>;
    })}
  </div>;
}

function dataURLtoBlob(dataUrl) {
  const arr=dataUrl.split(","); const mime=arr[0].match(/:(.*?);/)[1];
  const bstr=atob(arr[1]); let n=bstr.length;
  const u8=new Uint8Array(n); while(n--){u8[n]=bstr.charCodeAt(n);}
  return new Blob([u8],{type:mime});
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
  const gBase = `${g}/${liga}/gruppe/${t.gruppe}`;
  return {
    tabelle:      `${gBase}/tabelle/gesamt`,
    spielplan:    `${mBase}/spielplan/gesamt`,
    aufstellung:  `${mBase}/spielerbilanzen/gesamt`,
    einzelrl:     `${gBase}/gruppen-ranglisten/spieler/gesamt`,
    doppelrl:     `${gBase}/gruppen-ranglisten/doppel/gesamt`,
  };
}

function SpielbetrieblTab({isSuperAdmin}) {
  const [teamPhotos,setTeamPhotos] = useState({});
  const [teamFiles,setTeamFiles] = useState({});
  const [uploadingFor,setUploadingFor] = useState(null);

  useEffect(()=>{
    const u1 = onSnapshot(doc(db,"config","teamPhotos"),snap=>{
      if(snap.exists()) setTeamPhotos(snap.data());
    },()=>{});
    const u2 = onSnapshot(doc(db,"config","teamFiles"),snap=>{
      if(snap.exists()) setTeamFiles(snap.data());
    },()=>{});
    return ()=>{u1();u2();};
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
    <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>📋 Spielbetrieb</div>
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
            {teamFiles[`${t.id}_pin`]&&(()=>{
              const dataUrl=teamFiles[`${t.id}_pin`];
              const name=teamFiles[`${t.id}_pin_name`]||"spiel-pins";
              const isPdf=dataUrl.startsWith("data:application/pdf")||name.endsWith(".pdf");
              if(isPdf){
                return <button onClick={()=>{
                  const blob=dataURLtoBlob(dataUrl);
                  const url=URL.createObjectURL(blob);
                  window.open(url,"_blank");
                }} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:7,fontSize:11,fontWeight:600,background:"var(--bg3)",border:"1px solid var(--border2)",color:"var(--text2)",cursor:"pointer"}}>🔑 Spiel-PINs</button>;
              }
              return <a href={dataUrl} target="_blank" rel="noopener noreferrer" download={name}
                style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:7,fontSize:11,fontWeight:600,background:"var(--bg3)",border:"1px solid var(--border2)",color:"var(--text2)",textDecoration:"none",cursor:"pointer"}}>🔑 Spiel-PINs</a>;
            })()}
            {teamFiles[`${t.id}_code`]&&(()=>{
              const dataUrl=teamFiles[`${t.id}_code`];
              const name=teamFiles[`${t.id}_code_name`]||"spielcodes";
              const isPdf=dataUrl.startsWith("data:application/pdf")||name.endsWith(".pdf");
              if(isPdf){
                return <button onClick={()=>{
                  const blob=dataURLtoBlob(dataUrl);
                  const url=URL.createObjectURL(blob);
                  window.open(url,"_blank");
                }} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:7,fontSize:11,fontWeight:600,background:"var(--bg3)",border:"1px solid var(--border2)",color:"var(--text2)",cursor:"pointer"}}>🎫 Spielcodes</button>;
              }
              return <a href={dataUrl} target="_blank" rel="noopener noreferrer" download={name}
                style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 9px",borderRadius:7,fontSize:11,fontWeight:600,background:"var(--bg3)",border:"1px solid var(--border2)",color:"var(--text2)",textDecoration:"none",cursor:"pointer"}}>🎫 Spielcodes</a>;
            })()}
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



// ─── INITIAL SPIELPLAN DATA ──────────────────────────────────────────────────
// ─── AUFSTELLUNGEN ALLE 4 HALBRUNDEN ─────────────────────────────────────────

// RR 2025/26
const AUFSTELLUNG_2025_2026_R = [
  {mannschaft:"Erwachsene",rang:"1.1",qTtr:"1683",name:"Titz, Stefan"},
  {mannschaft:"Erwachsene",rang:"1.2",qTtr:"1640",name:"Martin, Peter"},
  {mannschaft:"Erwachsene",rang:"1.3",qTtr:"1608",name:"Meilinger, Thomas"},
  {mannschaft:"Erwachsene",rang:"1.4",qTtr:"1569",name:"Schütz, Jürgen"},
  {mannschaft:"Erwachsene II",rang:"2.1",qTtr:"1485",name:"Crăciun, Gheorghe-Dinu",bem:"gA"},
  {mannschaft:"Erwachsene II",rang:"2.2",qTtr:"1449",name:"Gomolka, Mariusz"},
  {mannschaft:"Erwachsene II",rang:"2.3",qTtr:"1427",name:"Frodl, Matthias"},
  {mannschaft:"Erwachsene II",rang:"2.4",qTtr:"1389",name:"Schneider, Patrick"},
  {mannschaft:"Erwachsene III",rang:"3.1",qTtr:"1372",name:"Heinzmann, Peter"},
  {mannschaft:"Erwachsene III",rang:"3.2",qTtr:"1366",name:"Uecker, Thomas"},
  {mannschaft:"Erwachsene III",rang:"3.3",qTtr:"1336",name:"Lammai, Michael"},
  {mannschaft:"Erwachsene III",rang:"3.4",qTtr:"1336",name:"Heinzmann, Wolfgang"},
  {mannschaft:"Erwachsene IV",rang:"4.1",qTtr:"1340",name:"Heep, Marcel",bem:"RES"},
  {mannschaft:"Erwachsene IV",rang:"4.2",qTtr:"1315",name:"Emmel, Thomas"},
  {mannschaft:"Erwachsene IV",rang:"4.3",qTtr:"1222",name:"Köhler, Esther"},
  {mannschaft:"Erwachsene IV",rang:"4.4",qTtr:"1211",name:"Heistrüvers, Ralf"},
  {mannschaft:"Erwachsene IV",rang:"4.5",qTtr:"1205",name:"Ries, Timo",bem:"RES"},
  {mannschaft:"Erwachsene IV",rang:"4.6",qTtr:"1188",name:"Bill, Erwin"},
  {mannschaft:"Erwachsene V",rang:"5.1",qTtr:"1136",name:"Weis, Christoph"},
  {mannschaft:"Erwachsene V",rang:"5.2",qTtr:"1107",name:"Meilinger, Kira"},
  {mannschaft:"Erwachsene V",rang:"5.3",qTtr:"1092",name:"Schmid, Heiko"},
  {mannschaft:"Erwachsene V",rang:"5.4",qTtr:"1085",name:"Göttlich, Julian"},
  {mannschaft:"Erwachsene V",rang:"5.5",qTtr:"1074",name:"Bonkowski, Jörg"},
  {mannschaft:"Erwachsene V",rang:"5.6",qTtr:"1064",name:"Schuy, Bärbel"},
  {mannschaft:"Erwachsene V",rang:"5.7",qTtr:"1055",name:"Riedel, Michael"},
  {mannschaft:"Erwachsene V",rang:"5.8",qTtr:"1044",name:"Meurer, Thomas"},
  {mannschaft:"Erwachsene V",rang:"5.9",qTtr:"1029",name:"Beger, René"},
  {mannschaft:"Erwachsene V",rang:"5.10",qTtr:"1024",name:"Hermansa, Simon"},
  {mannschaft:"Erwachsene V",rang:"5.11",qTtr:"1012",name:"Bastian, Marianne"},
  {mannschaft:"Erwachsene V",rang:"5.12",qTtr:"1002",name:"Krombach, Katrin"},
  {mannschaft:"Erwachsene V",rang:"5.13",qTtr:"957",name:"Meyer, André"},
  {mannschaft:"Erwachsene V",rang:"5.14",qTtr:"963",name:"Nußer, Antje"},
  {mannschaft:"Erwachsene V",rang:"5.15",qTtr:"943",name:"Heinzmann, Anna-Maria"},
  {mannschaft:"Erwachsene V",rang:"5.16",qTtr:"927",name:"Wörner, Thorsten"},
  {mannschaft:"Erwachsene V",rang:"5.17",qTtr:"900",name:"Höhler, Lukas"},
  {mannschaft:"Mädchen 15",rang:"1.1",qTtr:"901",name:"Horz, Leonie"},
  {mannschaft:"Mädchen 15",rang:"1.2",qTtr:"887",name:"Heep, Marietta"},
  {mannschaft:"Mädchen 15",rang:"1.3",qTtr:"771",name:"Krämer, Victoria"},
  {mannschaft:"Mädchen 15",rang:"1.4",qTtr:"789",name:"Schwepper, Emilia Sophie",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.5",qTtr:"788",name:"Horz, Lara Marie",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.6",qTtr:"715",name:"Riedel, Emma",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.7",qTtr:"698",name:"Simon, Lina",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.1",qTtr:"789",name:"Schwepper, Emilia Sophie"},
  {mannschaft:"Mädchen 13",rang:"1.2",qTtr:"788",name:"Horz, Lara Marie"},
  {mannschaft:"Mädchen 13",rang:"1.3",qTtr:"715",name:"Riedel, Emma"},
  {mannschaft:"Mädchen 13",rang:"1.4",qTtr:"698",name:"Simon, Lina"},
];

// VR 2025/26
const AUFSTELLUNG_2025_2026_V = [
  {mannschaft:"Erwachsene",rang:"1.1",qTtr:"1683",name:"Titz, Stefan"},
  {mannschaft:"Erwachsene",rang:"1.2",qTtr:"1676",name:"Martin, Peter"},
  {mannschaft:"Erwachsene",rang:"1.3",qTtr:"1616",name:"Meilinger, Thomas"},
  {mannschaft:"Erwachsene",rang:"1.4",qTtr:"1617",name:"Schütz, Jürgen"},
  {mannschaft:"Erwachsene II",rang:"2.1",qTtr:"1491",name:"Crăciun, Gheorghe-Dinu",bem:"gA"},
  {mannschaft:"Erwachsene II",rang:"2.2",qTtr:"1440",name:"Frodl, Matthias"},
  {mannschaft:"Erwachsene II",rang:"2.3",qTtr:"1427",name:"Gomolka, Mariusz"},
  {mannschaft:"Erwachsene II",rang:"2.4",qTtr:"1399",name:"Schneider, Patrick"},
  {mannschaft:"Erwachsene III",rang:"3.1",qTtr:"1360",name:"Lammai, Michael",bem:"RES"},
  {mannschaft:"Erwachsene III",rang:"3.2",qTtr:"1351",name:"Uecker, Thomas"},
  {mannschaft:"Erwachsene III",rang:"3.3",qTtr:"1337",name:"Heinzmann, Wolfgang"},
  {mannschaft:"Erwachsene III",rang:"3.4",qTtr:"1335",name:"Emmel, Thomas"},
  {mannschaft:"Erwachsene III",rang:"3.5",qTtr:"1330",name:"Heinzmann, Peter"},
  {mannschaft:"Erwachsene IV",rang:"4.1",qTtr:"1260",name:"Köhler, Esther"},
  {mannschaft:"Erwachsene IV",rang:"4.2",qTtr:"1248",name:"Heistrüvers, Ralf"},
  {mannschaft:"Erwachsene IV",rang:"4.3",qTtr:"1203",name:"Ries, Timo",bem:"RES"},
  {mannschaft:"Erwachsene IV",rang:"4.4",qTtr:"1173",name:"Bill, Erwin"},
  {mannschaft:"Erwachsene IV",rang:"4.5",qTtr:"1122",name:"Schmid, Heiko"},
  {mannschaft:"Erwachsene V",rang:"5.1",qTtr:"1116",name:"Weis, Christoph"},
  {mannschaft:"Erwachsene V",rang:"5.2",qTtr:"1107",name:"Meilinger, Kira"},
  {mannschaft:"Erwachsene V",rang:"5.3",qTtr:"1099",name:"Göttlich, Julian"},
  {mannschaft:"Erwachsene V",rang:"5.4",qTtr:"1087",name:"Bonkowski, Jörg"},
  {mannschaft:"Erwachsene V",rang:"5.5",qTtr:"1064",name:"Schuy, Bärbel"},
  {mannschaft:"Erwachsene V",rang:"5.6",qTtr:"1057",name:"Riedel, Michael"},
  {mannschaft:"Erwachsene V",rang:"5.7",qTtr:"1038",name:"Beger, René"},
  {mannschaft:"Erwachsene V",rang:"5.8",qTtr:"1012",name:"Bastian, Marianne"},
  {mannschaft:"Erwachsene V",rang:"5.9",qTtr:"1002",name:"Krombach, Katrin"},
  {mannschaft:"Erwachsene V",rang:"5.10",qTtr:"975",name:"Meyer, André"},
  {mannschaft:"Erwachsene V",rang:"5.11",qTtr:"963",name:"Nußer, Antje"},
  {mannschaft:"Erwachsene V",rang:"5.12",qTtr:"943",name:"Heinzmann, Anna-Maria"},
  {mannschaft:"Erwachsene V",rang:"5.13",qTtr:"939",name:"Wörner, Thorsten"},
  {mannschaft:"Erwachsene V",rang:"5.14",qTtr:"901",name:"Höhler, Lukas"},
  {mannschaft:"Erwachsene V",rang:"5.15",qTtr:"—",name:"Hermansa, Simon"},
  {mannschaft:"Mädchen 15",rang:"1.1",qTtr:"909",name:"Horz, Leonie"},
  {mannschaft:"Mädchen 15",rang:"1.2",qTtr:"806",name:"Krämer, Victoria"},
  {mannschaft:"Mädchen 15",rang:"1.3",qTtr:"797",name:"Heep, Marietta"},
  {mannschaft:"Mädchen 15",rang:"1.4",qTtr:"805",name:"Schwepper, Emilia Sophie",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.5",qTtr:"747",name:"Horz, Lara Marie",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.6",qTtr:"739",name:"Riedel, Emma",bem:"NES"},
  {mannschaft:"Mädchen 15",rang:"1.7",qTtr:"716",name:"Simon, Lina",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.1",qTtr:"805",name:"Schwepper, Emilia Sophie"},
  {mannschaft:"Mädchen 13",rang:"1.2",qTtr:"747",name:"Horz, Lara Marie"},
  {mannschaft:"Mädchen 13",rang:"1.3",qTtr:"739",name:"Riedel, Emma"},
  {mannschaft:"Mädchen 13",rang:"1.4",qTtr:"716",name:"Simon, Lina"},
];

// RR 2024/25
const AUFSTELLUNG_2024_2025_R = [
  {mannschaft:"Erwachsene",rang:"1.1",qTtr:"1676",name:"Titz, Stefan"},
  {mannschaft:"Erwachsene",rang:"1.2",qTtr:"1670",name:"Martin, Peter"},
  {mannschaft:"Erwachsene",rang:"1.3",qTtr:"1599",name:"Meilinger, Thomas"},
  {mannschaft:"Erwachsene",rang:"1.4",qTtr:"1585",name:"Schütz, Jürgen"},
  {mannschaft:"Erwachsene II",rang:"2.1",qTtr:"1522",name:"Crăciun, Gheorghe-Dinu",bem:"gA"},
  {mannschaft:"Erwachsene II",rang:"2.2",qTtr:"1457",name:"Frodl, Matthias"},
  {mannschaft:"Erwachsene II",rang:"2.3",qTtr:"1428",name:"Gomolka, Mariusz"},
  {mannschaft:"Erwachsene II",rang:"2.4",qTtr:"1389",name:"Schneider, Patrick"},
  {mannschaft:"Erwachsene III",rang:"3.1",qTtr:"1360",name:"Lammai, Michael"},
  {mannschaft:"Erwachsene III",rang:"3.2",qTtr:"1346",name:"Emmel, Thomas"},
  {mannschaft:"Erwachsene III",rang:"3.3",qTtr:"1320",name:"Heinzmann, Wolfgang"},
  {mannschaft:"Erwachsene III",rang:"3.4",qTtr:"1305",name:"Heinzmann, Peter"},
  {mannschaft:"Erwachsene IV",rang:"4.1",qTtr:"1313",name:"Uecker, Thomas"},
  {mannschaft:"Erwachsene IV",rang:"4.2",qTtr:"1298",name:"Köhler, Esther",bem:"WES"},
  {mannschaft:"Erwachsene IV",rang:"4.3",qTtr:"1240",name:"Heistrüvers, Ralf"},
  {mannschaft:"Erwachsene IV",rang:"4.4",qTtr:"1223",name:"Münz, Theresa",bem:"WES"},
  {mannschaft:"Erwachsene IV",rang:"4.5",qTtr:"1186",name:"Bill, Erwin"},
  {mannschaft:"Erwachsene IV",rang:"4.6",qTtr:"1161",name:"Schmid, Heiko"},
  {mannschaft:"Erwachsene V",rang:"5.1",qTtr:"1133",name:"Weis, Christoph"},
  {mannschaft:"Erwachsene V",rang:"5.2",qTtr:"1093",name:"Bonkowski, Jörg"},
  {mannschaft:"Erwachsene V",rang:"5.3",qTtr:"1090",name:"Göttlich, Julian"},
  {mannschaft:"Erwachsene V",rang:"5.4",qTtr:"1089",name:"Meilinger, Kira",bem:"WES"},
  {mannschaft:"Erwachsene V",rang:"5.5",qTtr:"1067",name:"Beger, René"},
  {mannschaft:"Erwachsene V",rang:"5.6",qTtr:"1061",name:"Riedel, Michael"},
  {mannschaft:"Erwachsene V",rang:"5.7",qTtr:"975",name:"Meyer, André"},
  {mannschaft:"Erwachsene V",rang:"5.8",qTtr:"984",name:"Schardt, Rainer"},
  {mannschaft:"Erwachsene V",rang:"5.9",qTtr:"945",name:"Wörner, Thorsten"},
  {mannschaft:"Erwachsene V",rang:"5.10",qTtr:"901",name:"Höhler, Lukas"},
  {mannschaft:"Damen",rang:"1.1",qTtr:"1298",name:"Köhler, Esther"},
  {mannschaft:"Damen",rang:"1.2",qTtr:"1223",name:"Münz, Theresa"},
  {mannschaft:"Damen",rang:"1.3",qTtr:"1089",name:"Meilinger, Kira"},
  {mannschaft:"Damen",rang:"1.4",qTtr:"1086",name:"Schuy, Bärbel"},
  {mannschaft:"Damen",rang:"1.5",qTtr:"1021",name:"Bastian, Marianne"},
  {mannschaft:"Damen",rang:"1.6",qTtr:"1014",name:"Krombach, Katrin"},
  {mannschaft:"Damen",rang:"1.7",qTtr:"963",name:"Nußer, Antje"},
  {mannschaft:"Damen",rang:"1.8",qTtr:"943",name:"Heinzmann, Anna-Maria"},
  {mannschaft:"Mädchen 13",rang:"1.1",qTtr:"851",name:"Horz, Leonie"},
  {mannschaft:"Mädchen 13",rang:"1.2",qTtr:"841",name:"Schwepper, Emilia Sophie",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.3",qTtr:"836",name:"Heep, Marietta"},
  {mannschaft:"Mädchen 13",rang:"1.4",qTtr:"823",name:"Krämer, Victoria"},
  {mannschaft:"Mädchen 13",rang:"1.5",qTtr:"785",name:"Horz, Lara Marie",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.6",qTtr:"749",name:"Simon, Lina",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.7",qTtr:"725",name:"Heep, Carlotta",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.8",qTtr:"701",name:"Riedel, Emma",bem:"NES"},
  {mannschaft:"Mädchen 11",rang:"1.1",qTtr:"841",name:"Schwepper, Emilia Sophie"},
  {mannschaft:"Mädchen 11",rang:"1.2",qTtr:"785",name:"Horz, Lara Marie"},
  {mannschaft:"Mädchen 11",rang:"1.3",qTtr:"749",name:"Simon, Lina"},
  {mannschaft:"Mädchen 11",rang:"1.4",qTtr:"725",name:"Heep, Carlotta"},
  {mannschaft:"Mädchen 11",rang:"1.5",qTtr:"701",name:"Riedel, Emma"},
];

// VR 2024/25
const AUFSTELLUNG_2024_2025_V = [
  {mannschaft:"Erwachsene",rang:"1.1",qTtr:"1651",name:"Martin, Peter"},
  {mannschaft:"Erwachsene",rang:"1.2",qTtr:"1631",name:"Titz, Stefan"},
  {mannschaft:"Erwachsene",rang:"1.3",qTtr:"1627",name:"Schütz, Jürgen"},
  {mannschaft:"Erwachsene",rang:"1.4",qTtr:"1594",name:"Meilinger, Thomas"},
  {mannschaft:"Erwachsene II",rang:"2.1",qTtr:"1488",name:"Frodl, Matthias"},
  {mannschaft:"Erwachsene II",rang:"2.2",qTtr:"1484",name:"Crăciun, Gheorghe-Dinu",bem:"gA"},
  {mannschaft:"Erwachsene II",rang:"2.3",qTtr:"1444",name:"Gomolka, Mariusz"},
  {mannschaft:"Erwachsene II",rang:"2.4",qTtr:"1406",name:"Schneider, Patrick"},
  {mannschaft:"Erwachsene III",rang:"3.1",qTtr:"1360",name:"Lammai, Michael"},
  {mannschaft:"Erwachsene III",rang:"3.2",qTtr:"1355",name:"Emmel, Thomas"},
  {mannschaft:"Erwachsene III",rang:"3.3",qTtr:"1333",name:"Heinzmann, Wolfgang"},
  {mannschaft:"Erwachsene III",rang:"3.4",qTtr:"1274",name:"Köhler, Esther",bem:"WES"},
  {mannschaft:"Erwachsene III",rang:"3.5",qTtr:"1251",name:"Heinzmann, Peter"},
  {mannschaft:"Erwachsene IV",rang:"4.1",qTtr:"1257",name:"Uecker, Thomas"},
  {mannschaft:"Erwachsene IV",rang:"4.2",qTtr:"1241",name:"Heistrüvers, Ralf",bem:"RES"},
  {mannschaft:"Erwachsene IV",rang:"4.3",qTtr:"1238",name:"Münz, Theresa",bem:"WES"},
  {mannschaft:"Erwachsene IV",rang:"4.4",qTtr:"1201",name:"Bill, Erwin"},
  {mannschaft:"Erwachsene IV",rang:"4.5",qTtr:"1165",name:"Schmid, Heiko"},
  {mannschaft:"Erwachsene IV",rang:"4.6",qTtr:"1158",name:"Weis, Christoph"},
  {mannschaft:"Erwachsene V",rang:"5.1",qTtr:"1108",name:"Meilinger, Kira",bem:"WES"},
  {mannschaft:"Erwachsene V",rang:"5.2",qTtr:"1064",name:"Bonkowski, Jörg"},
  {mannschaft:"Erwachsene V",rang:"5.3",qTtr:"1063",name:"Göttlich, Julian"},
  {mannschaft:"Erwachsene V",rang:"5.4",qTtr:"1046",name:"Beger, René"},
  {mannschaft:"Erwachsene V",rang:"5.5",qTtr:"1043",name:"Riedel, Michael"},
  {mannschaft:"Erwachsene V",rang:"5.6",qTtr:"990",name:"Meyer, André"},
  {mannschaft:"Erwachsene V",rang:"5.7",qTtr:"984",name:"Schardt, Rainer"},
  {mannschaft:"Erwachsene V",rang:"5.8",qTtr:"915",name:"Höhler, Lukas"},
  {mannschaft:"Damen",rang:"1.1",qTtr:"1274",name:"Köhler, Esther"},
  {mannschaft:"Damen",rang:"1.2",qTtr:"1238",name:"Münz, Theresa"},
  {mannschaft:"Damen",rang:"1.3",qTtr:"1108",name:"Meilinger, Kira"},
  {mannschaft:"Damen",rang:"1.4",qTtr:"1101",name:"Bastian, Marianne"},
  {mannschaft:"Damen",rang:"1.5",qTtr:"1099",name:"Schuy, Bärbel"},
  {mannschaft:"Damen",rang:"1.6",qTtr:"1009",name:"Krombach, Katrin"},
  {mannschaft:"Damen",rang:"1.7",qTtr:"986",name:"Nußer, Antje"},
  {mannschaft:"Damen",rang:"1.8",qTtr:"943",name:"Heinzmann, Anna-Maria"},
  {mannschaft:"Mädchen 13",rang:"1.1",qTtr:"786",name:"Krämer, Victoria"},
  {mannschaft:"Mädchen 13",rang:"1.2",qTtr:"749",name:"Schwepper, Emilia Sophie",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.3",qTtr:"747",name:"Heep, Marietta"},
  {mannschaft:"Mädchen 13",rang:"1.4",qTtr:"731",name:"Horz, Leonie"},
  {mannschaft:"Mädchen 13",rang:"1.5",qTtr:"726",name:"Riedel, Emma",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.6",qTtr:"683",name:"Horz, Lara Marie",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.7",qTtr:"713",name:"Heep, Carlotta",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.8",qTtr:"641",name:"Simon, Lina",bem:"NES"},
  {mannschaft:"Mädchen 13",rang:"1.9",qTtr:"639",name:"Termer, Lina",bem:"NES"},
  {mannschaft:"Mädchen 11",rang:"1.1",qTtr:"749",name:"Schwepper, Emilia Sophie"},
  {mannschaft:"Mädchen 11",rang:"1.2",qTtr:"726",name:"Riedel, Emma"},
  {mannschaft:"Mädchen 11",rang:"1.3",qTtr:"683",name:"Horz, Lara Marie"},
  {mannschaft:"Mädchen 11",rang:"1.4",qTtr:"713",name:"Heep, Carlotta"},
  {mannschaft:"Mädchen 11",rang:"1.5",qTtr:"641",name:"Simon, Lina"},
  {mannschaft:"Mädchen 11",rang:"1.6",qTtr:"639",name:"Termer, Lina"},
];

// Lookup-Tabelle für alle Aufstellungen
const AUFSTELLUNG_DATA = {
  "aufstellung_2025_2026_R": AUFSTELLUNG_2025_2026_R,
  "aufstellung_2025_2026_V": AUFSTELLUNG_2025_2026_V,
  "aufstellung_2024_2025_R": AUFSTELLUNG_2024_2025_R,
  "aufstellung_2024_2025_V": AUFSTELLUNG_2024_2025_V,
};
const INITIAL_SPIELPLAN = [{"datum": "05.09.25", "tag": "Fr", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "Tischtennisclub Elz", "ergebnis": "9:1", "aenderung": ""}, {"datum": "09.09.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "VfR 1919 Limburg", "ergebnis": "6:4", "aenderung": ""}, {"datum": "09.09.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Erwachsene V (P)", "ort": "Heim", "gegner": "TuS Gaudernbach 1911 II", "ergebnis": "2:4", "aenderung": "T"}, {"datum": "19.09.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TTC G.-W. Staffel 1953 IV", "ergebnis": "4:6", "aenderung": ""}, {"datum": "19.09.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "STV 1911 Drommershausen III", "ergebnis": "6:4", "aenderung": ""}, {"datum": "20.09.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TTC 1950 Eisenbach IV", "ergebnis": "3:7", "aenderung": ""}, {"datum": "20.09.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TTC 1968 Oberbrechen V", "ergebnis": "3:7", "aenderung": ""}, {"datum": "26.09.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TV Münster 1902", "ergebnis": "3:7", "aenderung": ""}, {"datum": "26.09.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TuS Wirbelau 1901 III", "ergebnis": "0:10", "aenderung": ""}, {"datum": "27.09.25", "tag": "Sa", "uhrzeit": "13:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC G.-W. Staffel 1953", "ergebnis": "3:7", "aenderung": ""}, {"datum": "27.09.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TTC Bad Camberg III", "ergebnis": "8:2", "aenderung": ""}, {"datum": "30.09.25", "tag": "Di", "uhrzeit": "17:30", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "TuS 1911 Elkerhausen", "ergebnis": "8:2", "aenderung": "V"}, {"datum": "30.09.25", "tag": "Di", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC 1953 Villmar II", "ergebnis": "5:5", "aenderung": "V"}, {"datum": "30.09.25", "tag": "Di", "uhrzeit": "20:30", "mannschaft": "Erwachsene II (P)", "ort": "Heim", "gegner": "TuS Wirbelau 1901 II", "ergebnis": "0:4", "aenderung": ""}, {"datum": "02.10.25", "tag": "Do", "uhrzeit": "17:00", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "TuS Neesbach", "ergebnis": "3:7", "aenderung": ""}, {"datum": "04.10.25", "tag": "Sa", "uhrzeit": "19:30", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TTC G.-W. Staffel 1953 III", "ergebnis": "9:1", "aenderung": ""}, {"datum": "08.10.25", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TTC 1968 Oberbrechen", "ergebnis": "9:1", "aenderung": "T / V"}, {"datum": "15.10.25", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TuS Neesbach IV", "ergebnis": "2:8", "aenderung": "V"}, {"datum": "21.10.25", "tag": "Di", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC Lindenholzhausen", "ergebnis": "7:3", "aenderung": "V"}, {"datum": "22.10.25", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TTC 1968 Werschau III", "ergebnis": "10:0", "aenderung": ""}, {"datum": "22.10.25", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TuS 1904 Weinbach II", "ergebnis": "6:4", "aenderung": "T / V"}, {"datum": "23.10.25", "tag": "Do", "uhrzeit": "17:00", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "SV Odersbach 1960", "ergebnis": "3:7", "aenderung": ""}, {"datum": "24.10.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TTC 1953 Villmar IV", "ergebnis": "7:3", "aenderung": "V"}, {"datum": "24.10.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TuS Kirschhofen II", "ergebnis": "10:0", "aenderung": ""}, {"datum": "25.10.25", "tag": "Sa", "uhrzeit": "19:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TTF Oberzeuzheim IV", "ergebnis": "10:0", "aenderung": ""}, {"datum": "31.10.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "SG 1908 Blessenbach III", "ergebnis": "7:3", "aenderung": ""}, {"datum": "31.10.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "SG 1908 Blessenbach", "ergebnis": "3:7", "aenderung": ""}, {"datum": "01.11.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TuS 1903 Weilmünster III", "ergebnis": "8:2", "aenderung": ""}, {"datum": "04.11.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "Turnverein Würges 1904", "ergebnis": "5:5", "aenderung": "V"}, {"datum": "07.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TUS 05 Dehrn", "ergebnis": "2:8", "aenderung": ""}, {"datum": "07.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TV 1882 Runkel II", "ergebnis": "4:6", "aenderung": ""}, {"datum": "07.11.25", "tag": "Fr", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTC Offheim 1949", "ergebnis": "7:3", "aenderung": ""}, {"datum": "08.11.25", "tag": "Sa", "uhrzeit": "14:40", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "TTF Oberzeuzheim (M15)", "ergebnis": "1:9", "aenderung": ""}, {"datum": "08.11.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TTC Hausen 1975 III", "ergebnis": "3:7", "aenderung": "T / V"}, {"datum": "08.11.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TTC Bad Camberg II", "ergebnis": "5:5", "aenderung": ""}, {"datum": "14.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TuS 1911 Elkerhausen II", "ergebnis": "2:8", "aenderung": ""}, {"datum": "14.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "Tischtennisclub Elz IV", "ergebnis": "8:2", "aenderung": ""}, {"datum": "14.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TTF Oberzeuzheim VII", "ergebnis": "9:1", "aenderung": ""}, {"datum": "15.11.25", "tag": "Sa", "uhrzeit": "17:00", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TV 1905 Niederselters", "ergebnis": "9:1", "aenderung": ""}, {"datum": "15.11.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "KSG Aulenhausen II", "ergebnis": "5:5", "aenderung": ""}, {"datum": "17.11.25", "tag": "Mo", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TuS Aumenau 1896", "ergebnis": "4:6", "aenderung": ""}, {"datum": "21.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TV 1882 Runkel", "ergebnis": "5:5", "aenderung": ""}, {"datum": "22.11.25", "tag": "Sa", "uhrzeit": "13:00", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "VfR 07 Limburg", "ergebnis": "6:4", "aenderung": ""}, {"datum": "22.11.25", "tag": "Sa", "uhrzeit": "17:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TV Frisch auf Erbach", "ergebnis": "3:7", "aenderung": ""}, {"datum": "23.11.25", "tag": "So", "uhrzeit": "13:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TTC G.-W. Staffel 1953 VIII", "ergebnis": "9:1", "aenderung": ""}, {"datum": "24.11.25", "tag": "Mo", "uhrzeit": "20:15", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TV 1905 Niederselters", "ergebnis": "10:0", "aenderung": "V"}, {"datum": "25.11.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Erwachsene III (P)", "ort": "Heim", "gegner": "STV 1911 Drommershausen", "ergebnis": "4:0", "aenderung": ""}, {"datum": "25.11.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "Tischtennisclub Elz VIII", "ergebnis": "7:3", "aenderung": "V"}, {"datum": "28.11.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TTF Oberzeuzheim VI", "ergebnis": "5:5", "aenderung": ""}, {"datum": "29.11.25", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "TTC Lindenholzhausen", "ergebnis": "6:4", "aenderung": ""}, {"datum": "29.11.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TTC Dillhausen III", "ergebnis": "6:4", "aenderung": ""}, {"datum": "02.12.25", "tag": "Di", "uhrzeit": "19:30", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TTC 1953 Villmar X", "ergebnis": "0:10", "aenderung": "V"}, {"datum": "05.12.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TTC Dillhausen", "ergebnis": "5:5", "aenderung": ""}, {"datum": "06.12.25", "tag": "Sa", "uhrzeit": "14:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC Dillhausen", "ergebnis": "10:0", "aenderung": "T / V"}, {"datum": "06.12.25", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "SV Rot-Weiß Hadamar", "ergebnis": "7:3", "aenderung": ""}, {"datum": "06.12.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TuS Löhnberg 1909 IV", "ergebnis": "0:10", "aenderung": ""}, {"datum": "09.12.25", "tag": "Di", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC 1953 Villmar", "ergebnis": "1:9", "aenderung": "T / V"}, {"datum": "09.12.25", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TTC Offheim 1949 VI", "ergebnis": "6:4", "aenderung": "V"}, {"datum": "12.12.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TuS Wirbelau 1901", "ergebnis": "0:10", "aenderung": ""}, {"datum": "12.12.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TV 1882 Runkel III", "ergebnis": "10:0", "aenderung": ""}, {"datum": "12.12.25", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TuS 1912 Obertiefenbach III", "ergebnis": "6:4", "aenderung": ""}, {"datum": "13.12.25", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TV 1896 Nauheim II", "ergebnis": "1:9", "aenderung": ""}, {"datum": "14.12.25", "tag": "So", "uhrzeit": "10:00", "mannschaft": "Erwachsene III (P)", "ort": "Heim", "gegner": "TuS Kirschhofen II", "ergebnis": "1:4", "aenderung": ""}, {"datum": "14.12.25", "tag": "So", "uhrzeit": "13:00", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "TTF Oberzeuzheim", "ergebnis": "4:0", "aenderung": ""}, {"datum": "17.01.26", "tag": "Sa", "uhrzeit": "10:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC Offheim 1949", "ergebnis": "2:8", "aenderung": "V"}, {"datum": "20.01.26", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TTF Oberzeuzheim VII", "ergebnis": "6:4", "aenderung": "V"}, {"datum": "21.01.26", "tag": "Mi", "uhrzeit": "20:15", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "VfR 1919 Limburg", "ergebnis": "7:3", "aenderung": ""}, {"datum": "22.01.26", "tag": "Do", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TuS Löhnberg 1909 IV", "ergebnis": "9:1", "aenderung": ""}, {"datum": "23.01.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TuS 1912 Obertiefenbach III", "ergebnis": "6:4", "aenderung": ""}, {"datum": "23.01.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TuS Aumenau 1896", "ergebnis": "7:3", "aenderung": ""}, {"datum": "24.01.26", "tag": "Sa", "uhrzeit": "14:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTC Dillhausen", "ergebnis": "6:4", "aenderung": "V"}, {"datum": "24.01.26", "tag": "Sa", "uhrzeit": "17:30", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "TTC Lindenholzhausen", "ergebnis": "5:5", "aenderung": ""}, {"datum": "30.01.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "SG 1908 Blessenbach", "ergebnis": "7:3", "aenderung": ""}, {"datum": "30.01.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TTC 1953 Villmar X", "ergebnis": "10:0", "aenderung": ""}, {"datum": "30.01.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TUS 05 Dehrn", "ergebnis": "10:0", "aenderung": ""}, {"datum": "30.01.26", "tag": "Fr", "uhrzeit": "20:15", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TuS 1903 Weilmünster III", "ergebnis": "2:8", "aenderung": ""}, {"datum": "31.01.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TTC G.-W. Staffel 1953 VIII", "ergebnis": "2:8", "aenderung": ""}, {"datum": "04.02.26", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TTC Dillhausen III", "ergebnis": "6:4", "aenderung": ""}, {"datum": "07.02.26", "tag": "Sa", "uhrzeit": "13:00", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "VfR 07 Limburg", "ergebnis": "6:4", "aenderung": "V"}, {"datum": "07.02.26", "tag": "Sa", "uhrzeit": "14:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TTV Eschborn", "ergebnis": "4:3", "aenderung": ""}, {"datum": "11.02.26", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TV 1882 Runkel II", "ergebnis": "10:0", "aenderung": ""}, {"datum": "12.02.26", "tag": "Do", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "SG 1908 Blessenbach III", "ergebnis": "5:5", "aenderung": ""}, {"datum": "13.02.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TV Frisch auf Erbach", "ergebnis": "6:4", "aenderung": ""}, {"datum": "13.02.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TTC Dillhausen", "ergebnis": "4:6", "aenderung": ""}, {"datum": "14.02.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TV 1882 Runkel", "ergebnis": "7:3", "aenderung": ""}, {"datum": "20.02.26", "tag": "Fr", "uhrzeit": "18:20", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTC 1953 Villmar II", "ergebnis": "7:3", "aenderung": "V"}, {"datum": "21.02.26", "tag": "Sa", "uhrzeit": "12:30", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "TTF Oberzeuzheim (M15)", "ergebnis": "10:0", "aenderung": ""}, {"datum": "26.02.26", "tag": "Do", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TuS Wirbelau 1901", "ergebnis": "10:0", "aenderung": "V"}, {"datum": "27.02.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TTF Oberzeuzheim VI", "ergebnis": "1:9", "aenderung": ""}, {"datum": "27.02.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "Tischtennisclub Elz VIII", "ergebnis": "6:4", "aenderung": ""}, {"datum": "28.02.26", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "TV 1905 Niederselters", "ergebnis": "3:7", "aenderung": ""}, {"datum": "28.02.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TTC 1968 Werschau III", "ergebnis": "0:10", "aenderung": "V"}, {"datum": "28.02.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TTC Offheim 1949 VI", "ergebnis": "3:7", "aenderung": ""}, {"datum": "03.03.26", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TV 1882 Runkel III", "ergebnis": "2:8", "aenderung": ""}, {"datum": "05.03.26", "tag": "Do", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "KSG Aulenhausen II", "ergebnis": "7:3", "aenderung": "V"}, {"datum": "06.03.26", "tag": "Fr", "uhrzeit": "19:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TTF Oberzeuzheim IV", "ergebnis": "4:6", "aenderung": "V"}, {"datum": "06.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TTC 1950 Eisenbach IV", "ergebnis": "3:7", "aenderung": ""}, {"datum": "10.03.26", "tag": "Di", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TuS 1904 Weinbach II", "ergebnis": "6:4", "aenderung": "T / V"}, {"datum": "11.03.26", "tag": "Mi", "uhrzeit": "20:30", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TTC 1968 Oberbrechen VIII", "ergebnis": "3:7", "aenderung": "V"}, {"datum": "13.03.26", "tag": "Fr", "uhrzeit": "17:30", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "TuS 1911 Elkerhausen", "ergebnis": "2:8", "aenderung": ""}, {"datum": "13.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TTC G.-W. Staffel 1953 IV", "ergebnis": "7:3", "aenderung": ""}, {"datum": "13.03.26", "tag": "Fr", "uhrzeit": "20:30", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TV Münster 1902", "ergebnis": "10:0", "aenderung": ""}, {"datum": "20.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TTC G.-W. Staffel 1953 III", "ergebnis": "1:9", "aenderung": ""}, {"datum": "20.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TuS Neesbach IV", "ergebnis": "8:2", "aenderung": ""}, {"datum": "20.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TTC Bad Camberg III", "ergebnis": "5:5", "aenderung": ""}, {"datum": "21.03.26", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "SV Odersbach 1960", "ergebnis": "9:1", "aenderung": ""}, {"datum": "21.03.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TuS Kirschhofen II", "ergebnis": "6:4", "aenderung": ""}, {"datum": "21.03.26", "tag": "Sa", "uhrzeit": "10:00", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTV 1960 Selters", "ergebnis": "4:1", "aenderung": ""}, {"datum": "25.03.26", "tag": "Mi", "uhrzeit": "20:30", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "TTC 1968 Oberbrechen", "ergebnis": "1:9", "aenderung": "T / V"}, {"datum": "27.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TuS 1912 Obertiefenbach VI", "ergebnis": "10:0", "aenderung": ""}, {"datum": "27.03.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Heim", "gegner": "TTC 1953 Villmar IV", "ergebnis": "6:4", "aenderung": ""}, {"datum": "28.03.26", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 15", "ort": "Heim", "gegner": "TuS Neesbach", "ergebnis": "10:0", "aenderung": ""}, {"datum": "28.03.26", "tag": "Sa", "uhrzeit": "15:00", "mannschaft": "Mädchen 13", "ort": "Heim", "gegner": "Tischtennisclub Elz", "ergebnis": "1:9", "aenderung": ""}, {"datum": "28.03.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 3", "ort": "Heim", "gegner": "TuS Wirbelau 1901 III", "ergebnis": "2:8", "aenderung": ""}, {"datum": "04.04.26", "tag": "Sa", "uhrzeit": "14:30", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTC 1953 Villmar", "ergebnis": "10:0", "aenderung": "T / V"}, {"datum": "10.04.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 5", "ort": "Auswärts", "gegner": "TV 1896 Nauheim II", "ergebnis": "3:7", "aenderung": "V"}, {"datum": "17.04.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TTC Hausen 1975 III", "ergebnis": "9:1", "aenderung": "T"}, {"datum": "17.04.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "Turnverein Würges 1904", "ergebnis": "9:1", "aenderung": ""}, {"datum": "17.04.26", "tag": "Fr", "uhrzeit": "20:15", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TTC 1968 Oberbrechen V", "ergebnis": "10:0", "aenderung": ""}, {"datum": "17.04.26", "tag": "Fr", "uhrzeit": "20:30", "mannschaft": "Herren 1", "ort": "Auswärts", "gegner": "TV 1905 Niederselters", "ergebnis": "10:0", "aenderung": "T"}, {"datum": "18.04.26", "tag": "Sa", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTC Lindenholzhausen", "ergebnis": "0:10", "aenderung": ""}, {"datum": "22.04.26", "tag": "Mi", "uhrzeit": "20:00", "mannschaft": "Herren 2", "ort": "Auswärts", "gegner": "TuS 1911 Elkerhausen II", "ergebnis": "4:6", "aenderung": ""}, {"datum": "24.04.26", "tag": "Fr", "uhrzeit": "17:30", "mannschaft": "Mädchen 13", "ort": "Auswärts", "gegner": "TTC G.-W. Staffel 1953", "ergebnis": "8:2", "aenderung": ""}, {"datum": "24.04.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 1", "ort": "Heim", "gegner": "Tischtennisclub Elz IV", "ergebnis": "7:3", "aenderung": ""}, {"datum": "24.04.26", "tag": "Fr", "uhrzeit": "20:00", "mannschaft": "Herren 3", "ort": "Auswärts", "gegner": "TTC Bad Camberg II", "ergebnis": "8:2", "aenderung": ""}, {"datum": "25.04.26", "tag": "Sa", "uhrzeit": "16:00", "mannschaft": "Mädchen 15", "ort": "Auswärts", "gegner": "SV Rot-Weiß Hadamar (M15)", "ergebnis": "5:5", "aenderung": ""}, {"datum": "25.04.26", "tag": "Sa", "uhrzeit": "18:00", "mannschaft": "Herren 5", "ort": "Heim", "gegner": "TTC 1953 Villmar IX", "ergebnis": "1:9", "aenderung": ""}, {"datum": "09.05.26", "tag": "Sa", "uhrzeit": "13:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TTC G.-W. Staffel 1953 VIII", "ergebnis": "10:0", "aenderung": ""}, {"datum": "09.05.26", "tag": "Sa", "uhrzeit": "16:00", "mannschaft": "Herren 4", "ort": "Heim", "gegner": "TuS Gaudernbach 1911 II", "ergebnis": "0:10", "aenderung": ""}, {"datum": "09.05.26", "tag": "Sa", "uhrzeit": "19:00", "mannschaft": "Herren 4", "ort": "Auswärts", "gegner": "TTC 1968 Oberbrechen VII", "ergebnis": "10:0", "aenderung": ""}];

// ─── GEBURTSTAGE TAB FÜR ERWACHSENE ─────────────────────────────────────────
function GeburtstageTabErwachsene({players}) {
  const erwachsene = players.filter(p=>p.birthdate && p.roles?.erwachsene===true && p.status!=="passiv")
    .sort((a,b)=>{
      const bdA = new Date(a.birthdate); const bdB = new Date(b.birthdate);
      const now = new Date();
      const nextA = new Date(now.getFullYear(), bdA.getMonth(), bdA.getDate());
      if(nextA < now) nextA.setFullYear(now.getFullYear()+1);
      const nextB = new Date(now.getFullYear(), bdB.getMonth(), bdB.getDate());
      if(nextB < now) nextB.setFullYear(now.getFullYear()+1);
      return nextA-nextB;
    });
  const today = new Date(); today.setHours(0,0,0,0);
  return <div style={{padding:14}}>
    <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>🎂 Geburtstage Erwachsene</div>
    {erwachsene.length===0&&<div style={{textAlign:"center",padding:30,color:"var(--text3)"}}>Keine Geburtstage vorhanden.</div>}
    {erwachsene.map(p=>{
      const bd=new Date(p.birthdate);
      const next=new Date(today.getFullYear(),bd.getMonth(),bd.getDate());
      if(next<today) next.setFullYear(today.getFullYear()+1);
      const days=Math.round((next-today)/(1000*60*60*24));
      const isToday=days===0; const isSoon=days<=7;
      const age=today.getFullYear()-bd.getFullYear()-(next>today&&next.getFullYear()>today.getFullYear()?1:0);
      return <div key={p.id} style={{
        display:"flex",alignItems:"center",gap:10,padding:"10px 12px",marginBottom:6,
        background:isToday?"#f59e0b22":isSoon?"#10b98111":"var(--bg2)",
        borderRadius:10,border:`1px solid ${isToday?"#f59e0b44":isSoon?"#10b98133":"var(--border)"}`
      }}>
        <span style={{fontSize:22,flexShrink:0}}>{isToday?"🎉":(p.avatar||"👤")}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:isToday?"#f59e0b":"var(--text)"}}>{p.firstName} {p.lastName}</div>
          <div style={{fontSize:11,color:"var(--text3)"}}>
            {bd.toLocaleDateString("de-DE",{day:"2-digit",month:"long"})} · {isToday?"🎂 Heute!":days===1?"Morgen!":`in ${days} Tagen`}
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:"var(--text3)"}}>{age} J.</div>
      </div>;
    })}
  </div>;
}

const SPIELPLAN_2025_2026 = [
  {datum:"2025-09-05",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"Tischtennisclub Elz",ergebnis:"9:1"},
  {datum:"2025-09-09",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Heim",gegner:"VfR 1919 Limburg",ergebnis:"6:4"},
  {datum:"2025-09-19",uhrzeit:"20:00",mannschaft:"Herren 1",ort:"Heim",gegner:"TTC G.-W. Staffel 1953 IV",ergebnis:"4:6"},
  {datum:"2025-09-20",uhrzeit:"17:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TTC 1953 Villmar IX",ergebnis:"8:2"},
  {datum:"2025-09-26",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Auswärts",gegner:"TuS 1912 Obertiefenbach VI",ergebnis:"0:10"},
  {datum:"2025-09-27",uhrzeit:"13:00",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC G.-W. Staffel 1953",ergebnis:"3:7"},
  {datum:"2025-09-30",uhrzeit:"17:30",mannschaft:"Mädchen 15",ort:"Heim",gegner:"TuS 1911 Elkerhausen",ergebnis:"8:2"},
  {datum:"2025-10-01",uhrzeit:"20:15",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TTC 1968 Oberbrechen VIII",ergebnis:"9:1"},
  {datum:"2025-10-02",uhrzeit:"17:00",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"TuS Neesbach",ergebnis:"3:7"},
  {datum:"2025-10-04",uhrzeit:"19:30",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TTC G.-W. Staffel 1953 III",ergebnis:"9:1"},
  {datum:"2025-10-08",uhrzeit:"20:00",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TTC 1968 Oberbrechen",ergebnis:"9:1"},
  {datum:"2025-10-15",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Auswärts",gegner:"TuS Neesbach IV",ergebnis:"2:8"},
  {datum:"2025-10-21",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC Lindenholzhausen",ergebnis:"7:3"},
  {datum:"2025-10-22",uhrzeit:"20:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TTC 1968 Werschau III",ergebnis:"10:0"},
  {datum:"2025-10-23",uhrzeit:"17:00",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"SV Odersbach 1960",ergebnis:"3:7"},
  {datum:"2025-10-24",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"TTC 1953 Villmar IV",ergebnis:"7:3"},
  {datum:"2025-10-25",uhrzeit:"19:00",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TTF Oberzeuzheim IV",ergebnis:"10:0"},
  {datum:"2025-10-31",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Heim",gegner:"SG 1908 Blessenbach III",ergebnis:"7:3"},
  {datum:"2025-11-01",uhrzeit:"18:00",mannschaft:"Herren 3",ort:"Heim",gegner:"TuS 1903 Weilmünster III",ergebnis:"8:2"},
  {datum:"2025-11-04",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Heim",gegner:"Turnverein Würges 1904",ergebnis:"5:5"},
  {datum:"2025-11-07",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TTC Offheim 1949",ergebnis:"7:3"},
  {datum:"2025-11-08",uhrzeit:"14:40",mannschaft:"Mädchen 15",ort:"Heim",gegner:"TTF Oberzeuzheim (M15)",ergebnis:"1:9"},
  {datum:"2025-11-14",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Heim",gegner:"TuS 1911 Elkerhausen II",ergebnis:"2:8"},
  {datum:"2025-11-15",uhrzeit:"17:00",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TV 1905 Niederselters",ergebnis:"9:1"},
  {datum:"2025-11-17",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Auswärts",gegner:"TuS Aumenau 1896",ergebnis:"4:6"},
  {datum:"2025-11-21",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Auswärts",gegner:"TV 1882 Runkel",ergebnis:"5:5"},
  {datum:"2025-11-22",uhrzeit:"13:00",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"VfR 07 Limburg",ergebnis:"6:4"},
  {datum:"2025-11-23",uhrzeit:"13:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TTC G.-W. Staffel 1953 VIII",ergebnis:"9:1"},
  {datum:"2025-11-24",uhrzeit:"20:15",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TV 1905 Niederselters",ergebnis:"10:0"},
  {datum:"2025-11-25",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Heim",gegner:"STV 1911 Drommershausen",ergebnis:"4:0"},
  {datum:"2025-11-28",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Heim",gegner:"TTF Oberzeuzheim VI",ergebnis:"5:5"},
  {datum:"2025-11-29",uhrzeit:"15:00",mannschaft:"Mädchen 15",ort:"Heim",gegner:"TTC Lindenholzhausen",ergebnis:"6:4"},
  {datum:"2025-12-02",uhrzeit:"19:30",mannschaft:"Herren 4",ort:"Auswärts",gegner:"TTC 1953 Villmar X",ergebnis:"0:10"},
  {datum:"2025-12-05",uhrzeit:"20:00",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TTC Dillhausen/B…ig-Selbenhausen",ergebnis:"5:5"},
  {datum:"2025-12-06",uhrzeit:"14:00",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC Dillhausen/B…ig-",ergebnis:"10:0"},
  {datum:"2025-12-09",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC 1953 Villmar",ergebnis:"1:9"},
  {datum:"2025-12-12",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"TuS 1912 Obertiefenbach III",ergebnis:"6:4"},
  {datum:"2025-12-13",uhrzeit:"18:00",mannschaft:"Herren 5",ort:"Heim",gegner:"TV 1896 Nauheim II",ergebnis:"1:9"},
  {datum:"2026-01-17",uhrzeit:"10:00",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC Offheim 1949",ergebnis:"2:8"},
  {datum:"2026-01-20",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Heim",gegner:"TTF Oberzeuzheim VII",ergebnis:"6:4"},
  {datum:"2026-01-21",uhrzeit:"20:15",mannschaft:"Herren 3",ort:"Auswärts",gegner:"VfR 1919 Limburg",ergebnis:"7:3"},
  {datum:"2026-01-22",uhrzeit:"20:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TuS Löhnberg 1909 IV",ergebnis:"9:1"},
  {datum:"2026-01-23",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Heim",gegner:"TuS 1912 Obertiefenbach III",ergebnis:"6:4"},
  {datum:"2026-01-24",uhrzeit:"14:00",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TTC Dillhausen/B…ig-",ergebnis:"6:4"},
  {datum:"2026-01-30",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"SG 1908 Blessenbach",ergebnis:"7:3"},
  {datum:"2026-01-31",uhrzeit:"18:00",mannschaft:"Herren 5",ort:"Heim",gegner:"TTC G.-W. Staffel 1953 VIII",ergebnis:"2:8"},
  {datum:"2026-02-04",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Heim",gegner:"",ergebnis:"6:4"},
  {datum:"2026-02-07",uhrzeit:"13:00",mannschaft:"Mädchen 15",ort:"Heim",gegner:"VfR 07 Limburg",ergebnis:"6:4"},
  {datum:"2026-02-11",uhrzeit:"20:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TV 1882 Runkel II",ergebnis:"10:0"},
  {datum:"2026-02-12",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Auswärts",gegner:"SG 1908 Blessenbach III",ergebnis:"5:5"},
  {datum:"2026-02-13",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Heim",gegner:"TV 'Frisch auf' Erbach",ergebnis:"6:4"},
  {datum:"2026-02-14",uhrzeit:"18:00",mannschaft:"Herren 3",ort:"Heim",gegner:"TV 1882 Runkel",ergebnis:"7:3"},
  {datum:"2026-02-20",uhrzeit:"18:20",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TTC 1953 Villmar II",ergebnis:"7:3"},
  {datum:"2026-02-21",uhrzeit:"12:30",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"TTF Oberzeuzheim (M15)",ergebnis:"10:0"},
  {datum:"2026-02-26",uhrzeit:"20:00",mannschaft:"Herren 1",ort:"Auswärts",gegner:"TuS Wirbelau 1901",ergebnis:"10:0"},
  {datum:"2026-02-27",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"TTF Oberzeuzheim VI",ergebnis:"1:9"},
  {datum:"2026-02-28",uhrzeit:"15:00",mannschaft:"Mädchen 13",ort:"Heim",gegner:"TV 1905 Niederselters",ergebnis:"3:7"},
  {datum:"2026-03-03",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Auswärts",gegner:"TV 1882 Runkel III",ergebnis:"2:8"},
  {datum:"2026-03-05",uhrzeit:"20:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"KSG Aulenhausen II",ergebnis:"7:3"},
  {datum:"2026-03-06",uhrzeit:"19:00",mannschaft:"Herren 1",ort:"Heim",gegner:"TTF Oberzeuzheim IV",ergebnis:"4:6"},
  {datum:"2026-03-10",uhrzeit:"20:00",mannschaft:"Herren 3",ort:"Heim",gegner:"TuS 1904 Weinbach II",ergebnis:"6:4"},
  {datum:"2026-03-11",uhrzeit:"20:30",mannschaft:"Herren 5",ort:"Heim",gegner:"TTC 1968 Oberbrechen VIII",ergebnis:"3:7"},
  {datum:"2026-03-13",uhrzeit:"17:30",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"TuS 1911 Elkerhausen",ergebnis:"2:8"},
  {datum:"2026-03-20",uhrzeit:"20:00",mannschaft:"Herren 1",ort:"Heim",gegner:"TTC G.-W. Staffel 1953 III",ergebnis:"1:9"},
  {datum:"2026-03-25",uhrzeit:"20:30",mannschaft:"Herren 1",ort:"Heim",gegner:"TTC 1968 Oberbrechen",ergebnis:"1:9"},
  {datum:"2026-03-27",uhrzeit:"20:00",mannschaft:"Herren 4",ort:"Heim",gegner:"TuS 1912 Obertiefenbach VI",ergebnis:"10:0"},
  {datum:"2026-03-28",uhrzeit:"15:00",mannschaft:"Mädchen 15",ort:"Heim",gegner:"TuS Neesbach",ergebnis:"10:0"},
  {datum:"2026-04-04",uhrzeit:"14:30",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TTC 1953 Villmar",ergebnis:"10:0"},
  {datum:"2026-04-10",uhrzeit:"20:00",mannschaft:"Herren 5",ort:"Auswärts",gegner:"TV 1896 Nauheim II",ergebnis:"3:7"},
  {datum:"2026-04-17",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"TTC Hausen 1975 III",ergebnis:"9:1"},
  {datum:"2026-04-18",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TTC Lindenholzhausen",ergebnis:"0:10"},
  {datum:"2026-04-22",uhrzeit:"20:00",mannschaft:"Herren 2",ort:"Auswärts",gegner:"TuS 1911 Elkerhausen II",ergebnis:"4:6"},
  {datum:"2026-04-24",uhrzeit:"17:30",mannschaft:"Mädchen 13",ort:"Auswärts",gegner:"TTC G.-W. Staffel 1953",ergebnis:"8:2"},
  {datum:"2026-04-25",uhrzeit:"16:00",mannschaft:"Mädchen 15",ort:"Auswärts",gegner:"SV Rot-Weiß Hadamar (M15)",ergebnis:"5:5"}
];

// Lookup-Tabelle: Spielplan-Daten pro Saison (eingebettet)
// Neue Saisons: Konstante hinzufügen und hier eintragen
const SPIELPLAN_DATA = {
  "spielplan_2025_2026": SPIELPLAN_2025_2026,
  // "spielplan_2024_2025": SPIELPLAN_2024_2025,  // wird ergänzt sobald PDF ausgelesen
};

// ─── VEREINSSPIELPLAN ─────────────────────────────────────────────────────────
const SPIELPLAN_COLS = [
  {key:"datum",     label:"Datum",       w:"80px"},
  {key:"tag",       label:"Tag",         w:"36px"},
  {key:"uhrzeit",   label:"Uhrzeit",     w:"56px"},
  {key:"mannschaft",label:"Mannschaft",  w:"100px"},
  {key:"ort",       label:"Ort",         w:"72px"},
  {key:"gegner",    label:"Gegner",      w:"auto"},
  {key:"ergebnis",  label:"Ergebnis",    w:"64px"},
  {key:"aenderung", label:"Änd.",        w:"50px"},
];

function VereinsSpielplan({nurNachwuchs=false}) {
  const [spiele,setSpiele]=useState([]);
  const [loading,setLoading]=useState(true);
  const [sortKey,setSortKey]=useState("datum");
  const [sortAsc,setSortAsc]=useState(true);
  const [filters,setFilters]=useState({});
  const [seasons,setSeasons]=useState([]);
  const [selSeason,setSelSeason]=useState("");
  const [pdfUrl,setPdfUrl]=useState(null);

  // Verfügbare Saisons laden — direkter Zugriff statt getDocs
  useEffect(()=>{
    const KNOWN_SPIELPLAN_KEYS=[
      "spielplan_2025_2026","spielplan_2026_2027","spielplan_2024_2025","spielplan_2023_2024","spielplan_2022_2023","spielplan",
    ];
    Promise.all(KNOWN_SPIELPLAN_KEYS.map(k=>
      getDoc(doc(db,"config",k)).then(s=>s.exists()&&(s.data().spiele||[]).length>0
        ?{id:k,saison:s.data().saison||(k==="spielplan"?"2025/2026 (alt)":k.replace("spielplan_","").replace(/_/g,"/"))}
        :null
      ).catch(()=>null)
    )).then(results=>{
      const seas=results.filter(Boolean);
      if(seas.length>0){
        setSeasons(seas);
        setSelSeason(seas[0].id);
      } else {
        // Absoluter Fallback: eingebettete Daten direkt verwenden
        // Embedded data fallback: show all known seasons
        const embeddedSeasons=Object.keys(SPIELPLAN_DATA).map(k=>({
          id:k, saison:k.replace("spielplan_","").replace(/_/g,"/")
        })).sort((a,b)=>b.id.localeCompare(a.id));
        if(embeddedSeasons.length>0){
          setSpiele(SPIELPLAN_DATA[embeddedSeasons[0].id]);
          setSeasons(embeddedSeasons);
          setSelSeason(embeddedSeasons[0].id);
        } else {
          setSpiele(INITIAL_SPIELPLAN);
          setSeasons([{id:"_local",saison:"2025/2026"}]);
          setSelSeason("_local");
        }
        setLoading(false);
      }
    }).catch(()=>{
      setSpiele(INITIAL_SPIELPLAN);
      setLoading(false);
    });
  },[]);

  // Spielplan + PDF für gewählte Saison laden
  useEffect(()=>{
    if(!selSeason||selSeason==="_local") return;
    setPdfUrl(null);
    setLoading(true);
    const unsub=onSnapshot(doc(db,"config",selSeason),snap=>{
      if(snap.exists()&&(snap.data().spiele||[]).length>0) setSpiele(snap.data().spiele||[]);
      else setSpiele(SPIELPLAN_DATA[selSeason]||INITIAL_SPIELPLAN);
      setLoading(false);
    },()=>{setSpiele(SPIELPLAN_DATA[selSeason]||INITIAL_SPIELPLAN);setLoading(false);});
    // PDF separat laden
    getDoc(doc(db,"config","pdf_"+selSeason)).then(s=>{
      if(s.exists()&&s.data().pdfUrl) setPdfUrl(s.data().pdfUrl);
    }).catch(()=>{});
    return unsub;
  },[selSeason]);

  const nachwuchsMannschaften=["Mädchen 13","Mädchen 15","Mädchen 11","Jugend 11","Mädchen 17","Jugend 13","Jugend 15"];
  const filtered = spiele.filter(s=>{
    if(nurNachwuchs && !nachwuchsMannschaften.some(nm=>s.mannschaft===nm||s.mannschaft.startsWith(nm))) return false;
    const selManns=filters.mannschaften||[];
    if(selManns.length>0 && !selManns.includes(s.mannschaft)) return false;
    if(filters.ort && s.ort!==filters.ort) return false;
    if(filters.gegner && !String(s.gegner||"").toLowerCase().includes(filters.gegner.toLowerCase())) return false;
    return true;
  });

  function datumSort(d){
    // "05.09.25" → "20250905" for sorting
    const p=d.split("."); if(p.length<3) return d;
    const y=p[2].length===2?`20${p[2]}`:p[2];
    return `${y}${p[1].padStart(2,"0")}${p[0].padStart(2,"0")}`;
  }
  const sorted = [...filtered].sort((a,b)=>{
    let va=a[sortKey]||""; let vb=b[sortKey]||"";
    if(sortKey==="datum"){va=datumSort(va); vb=datumSort(vb);}
    return sortAsc?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0);
  });

  function toggleSort(key){
    if(sortKey===key) setSortAsc(p=>!p);
    else{setSortKey(key);setSortAsc(true);}
  }

  const MANN_COLORS={"Herren 1":"#3b82f6","Herren 2":"#6366f1","Herren 3":"#8b5cf6","Herren 4":"#ec4899","Herren 5":"#f59e0b","Mädchen 13":"#10b981","Mädchen 15":"#14b8a6"};

  if(loading) return <div style={{padding:30,textAlign:"center",color:"var(--text3)"}}>Lädt...</div>;

  return <div style={{padding:"10px 8px 20px"}}>
    {/* Saison-Dropdown + PDF-Link */}
    <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <label style={{fontSize:11,color:"var(--text3)",flexShrink:0}}>🗓 Saison:</label>
      <select value={selSeason} onChange={e=>setSelSeason(e.target.value)}
        style={{padding:"5px 8px",borderRadius:7,fontSize:12,background:"var(--bg)",border:"1px solid var(--border2)",color:"var(--text)"}}>
        {seasons.map(s=><option key={s.id} value={s.id}>{s.saison}</option>)}
      </select>
      {pdfUrl&&<button onClick={()=>{
        const b64=pdfUrl.split(",")[1];
        const bin=atob(b64);const bytes=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        const blobUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
        const a=document.createElement("a");
        a.href=blobUrl; a.download="Spielplan_"+selSeason+".pdf";
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(blobUrl),5000);
      }} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"#3b82f622",
        color:"#3b82f6",border:"1px solid #3b82f644",cursor:"pointer",whiteSpace:"nowrap"}}>
        📄 PDF öffnen
      </button>}
    </div>

    {/* P4: Filter Row mit Dropdowns */}
    {(()=>{
      const MANNS=[...new Set(spiele.map(s=>s.mannschaft).filter(Boolean))].sort();
      const selManns=filters.mannschaften||[];
      return <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
        {/* Mannschaft Multi-Select */}
        <div style={{position:"relative",minWidth:100}}>
          <div onClick={()=>setFilters(p=>({...p,_showMannDrop:!p._showMannDrop}))}
            style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:7,
              color:"var(--text)",fontSize:11,cursor:"pointer",display:"flex",gap:4,alignItems:"center"}}>
            <span>Mannschaft{selManns.length>0?` (${selManns.length})`:""}</span><span style={{fontSize:9}}>▼</span>
          </div>
          {filters._showMannDrop&&<div style={{position:"absolute",top:"100%",left:0,zIndex:50,background:"var(--bg2)",
            border:"1px solid var(--border2)",borderRadius:8,padding:6,minWidth:140,boxShadow:"0 4px 12px #0004"}}>
            {MANNS.map(m=>{
              const on=selManns.includes(m);
              return <div key={m} onClick={()=>setFilters(p=>({...p,mannschaften:on?selManns.filter(x=>x!==m):[...selManns,m]}))}
                style={{padding:"4px 8px",borderRadius:5,fontSize:11,cursor:"pointer",
                  background:on?"#10b98122":"transparent",color:on?"#10b981":"var(--text)"}}>
                {on?"☑":"☐"} {m}
              </div>;
            })}
            <button onClick={()=>setFilters(p=>({...p,mannschaften:[],_showMannDrop:false}))}
              style={{width:"100%",marginTop:4,padding:"3px",background:"var(--bg3)",border:"none",borderRadius:4,color:"var(--text3)",fontSize:10,cursor:"pointer"}}>Alle</button>
          </div>}
        </div>
        {/* Ort Dropdown */}
        <select value={filters.ort||""} onChange={e=>setFilters(p=>({...p,ort:e.target.value}))}
          style={{padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text)",fontSize:11}}>
          <option value="">Ort (alle)</option>
          <option value="Heim">Heim</option>
          <option value="Auswärts">Auswärts</option>
        </select>
        {/* Gegner Freitext */}
        <input placeholder="Gegner" value={filters.gegner||""} onChange={e=>setFilters(p=>({...p,gegner:e.target.value}))}
          style={{flex:1,minWidth:70,padding:"5px 7px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:7,color:"var(--text)",fontSize:11,outline:"none"}}/>
        {(selManns.length>0||filters.ort||filters.gegner)&&
          <button onClick={()=>setFilters({})} style={{padding:"5px 8px",background:"#ef444422",border:"none",borderRadius:7,color:"#ef4444",fontSize:10,cursor:"pointer"}}>✕</button>}
      </div>;
    })()}
    <div style={{fontSize:10,color:"var(--text4)",marginBottom:6}}>{sorted.length} Spiele{nurNachwuchs?" (Nachwuchs)":""} · T=Terminänderung, V=Verlegung</div>
    {/* Table */}
    {/* Sticky header wie Schlägerverwaltung: Container mit maxHeight+overflowY:auto, th mit top:0 */}
    <div style={{maxHeight:"calc(100vh - var(--rsw-height, 88px) - 90px)",overflowY:"auto",overflowX:"auto",borderRadius:12,border:"1px solid var(--border)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:480}}>
        <thead>
          <tr style={{background:"var(--bg2)"}}>
            {SPIELPLAN_COLS.map(col=>(
              <th key={col.key} onClick={()=>toggleSort(col.key)}
                style={{padding:"6px 6px",textAlign:"left",cursor:"pointer",fontWeight:700,
                  color:sortKey===col.key?"#10b981":"var(--text2)",whiteSpace:"nowrap",
                  borderBottom:"2px solid var(--border2)",width:col.w,userSelect:"none",
                  background:"var(--bg2)",
                  position:"sticky",top:0,zIndex:4}}>
                {col.label}{sortKey===col.key?(sortAsc?" ▲":" ▼"):""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s,i)=>{
            const isChange=s.aenderung&&s.aenderung.trim()!=="";
            const mc=MANN_COLORS[s.mannschaft]||"#6b7280";
            const hasResult=s.ergebnis&&s.ergebnis.trim()!=="";
            return <tr key={i} style={{background:isChange?"#f59e0b09":i%2===0?"var(--bg2)":"var(--bg)",borderBottom:"1px solid var(--border)"}}>
              <td style={{padding:"5px 6px",whiteSpace:"nowrap",fontSize:10}}>{s.datum}</td>
              <td style={{padding:"5px 6px",color:"var(--text4)",fontSize:10}}>{s.tag}</td>
              <td style={{padding:"5px 6px",whiteSpace:"nowrap",fontWeight:600,fontSize:11}}>{s.uhrzeit}</td>
              <td style={{padding:"5px 6px"}}>
                <span style={{background:mc+"22",color:mc,borderRadius:4,padding:"2px 5px",fontSize:10,fontWeight:700,whiteSpace:"nowrap"}}>{s.mannschaft}</span>
              </td>
              <td style={{padding:"5px 6px"}}>
                <span style={{color:s.ort==="Heim"?"#10b981":"#3b82f6",fontWeight:600,fontSize:10}}>{s.ort}</span>
              </td>
              <td style={{padding:"5px 6px",fontSize:11}}>{s.gegner}</td>
              <td style={{padding:"5px 6px",fontWeight:700,fontSize:11,color:hasResult?"var(--text)":"var(--text4)"}}>{(()=>{
                if(!hasResult) return "—";
                if(s.ort!=="Auswärts") return s.ergebnis;
                // Flip score for away games: "1:9" → "9:1"
                const parts=s.ergebnis.split(":");
                return parts.length===2?`${parts[1]}:${parts[0]}`:s.ergebnis;
              })()}</td>
              <td style={{padding:"5px 6px"}}>
                {isChange&&<span style={{background:"#f59e0b22",color:"#f59e0b",borderRadius:4,padding:"2px 4px",fontSize:9,fontWeight:700}}>{s.aenderung}</span>}
              </td>
            </tr>;
          })}
          {sorted.length===0&&<tr><td colSpan={8} style={{padding:20,textAlign:"center",color:"var(--text3)"}}>Keine Spiele gefunden.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

// SpielplanUpload - PDF upload parses and saves to Firestore
function SpielplanUpload({showToast, onJoinImport, joinImporting}) {
  const [uploading,setUploading]=useState(false);
  const [savedSpielpläne,setSavedSpielpläne]=useState([]);

  const SPIELPLAN_KEYS=["spielplan_2025_2026","spielplan_2026_2027","spielplan_2024_2025","spielplan_2023_2024","spielplan_2022_2023","spielplan"];

  // Lade gespeicherte Spielpläne
  function mesz(ts){
    if(!ts) return "—";
    const d=new Date(ts+0);
    return d.toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})+" Uhr";
  }
  function reloadSpielpläne(){
    Promise.all(SPIELPLAN_KEYS.map(k=>
      getDoc(doc(db,"config",k)).then(s=>s.exists()&&(s.data().spiele||[]).length>0
        ?{id:k,saison:s.data().saison||k.replace("spielplan_","").replace(/_/g,"/"),count:(s.data().spiele||[]).length,lastUpdated:s.data().lastUpdated||null}
        :null).catch(()=>null)
    )).then(r=>setSavedSpielpläne(r.filter(Boolean).sort((a,b)=>b.id.localeCompare(a.id))));
    // Reload the spielplan seasons list in VereinsSpielplan is handled by onSnapshot
  }
  useEffect(()=>{ reloadSpielpläne(); },[]);

  // CSV-Parser für myTischtennis Export
  function parseSpielplanCSV(text) {
    const lines=text.split(/\r?\n/).filter(Boolean);
    if(lines.length<2) return [];
    const sep=lines[0].includes(';')?';':',';
    const headers=lines[0].split(sep);
    const idx=(h)=>headers.indexOf(h);
    const TTC="TTC Niederzeuzheim";
    const MANN_MAP={
      [TTC]:"Herren 1",[TTC+" II"]:"Herren 2",[TTC+" III"]:"Herren 3",
      [TTC+" IV"]:"Herren 4",[TTC+" V"]:"Herren 5",[TTC+" VI"]:"Herren 6",
    };
    const spiele=[];
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(sep);
      if(cols.length<10) continue;
      const termin=cols[idx("Termin")]||"";
      const heimVerein=cols[idx("HeimVereinName")]||"";
      const gastVerein=cols[idx("GastVereinName")]||"";
      const heimMann=cols[idx("HeimMannschaft")]||"";
      const gastMann=cols[idx("GastMannschaft")]||"";
      const altersklasse=cols[idx("Altersklasse")]||"";
      const liga=cols[idx("Liga")]||"";
      const spieleH=cols[idx("SpieleHeim")]||"";
      const spieleG=cols[idx("SpieleGast")]||"";
      if(!termin||!termin.trim()) continue;
      const [datumStr,uhrzeitStr]=(termin+" ").split(" ");
      const dp=datumStr.split(".");
      if(dp.length<3) continue;
      const datum=`${dp[2].substring(0,4)}-${dp[1]}-${dp[0]}`;
      const uhrzeit=uhrzeitStr?.substring(0,5)||"";
      let mannschaft="",ort="",gegner="";
      if(heimVerein===TTC){
        mannschaft=MANN_MAP[heimMann]||(altersklasse.includes("Mädchen")||altersklasse.includes("Jugend")?altersklasse:heimMann);
        ort="Heim"; gegner=gastMann;
      } else if(gastVerein===TTC){
        mannschaft=MANN_MAP[gastMann]||(altersklasse.includes("Mädchen")||altersklasse.includes("Jugend")?altersklasse:gastMann);
        ort="Auswärts"; gegner=heimMann;
      } else continue;
      const ergebnis=(spieleH&&spieleG&&!(spieleH==="0"&&spieleG==="0"))?
        (ort==="Heim"?`${spieleH}:${spieleG}`:`${spieleG}:${spieleH}`):"";
      spiele.push({datum,uhrzeit,mannschaft,ort,gegner,liga,ergebnis});
    }
    return spiele.sort((a,b)=>a.datum.localeCompare(b.datum)||a.mannschaft.localeCompare(b.mannschaft));
  }

  async function handleUpload(file) {
    if(!file){showToast("Bitte eine Datei hochladen","❌");return;}
    const fn=file.name.toLowerCase();
    const isCSV=fn.endsWith('.csv');
    const isPDF=fn.endsWith('.pdf');
    if(!isCSV&&!isPDF){showToast("CSV oder PDF hochladen","❌");return;}
    setUploading(true);
    try {
      let saison="2025/2026";
      const fnMatch4=file.name.match(/(\d{4})[\-_](\d{4})/);
      const fnMatch2=file.name.match(/(\d{4})[\-_](\d{2})(?!\d)/);
      if(fnMatch4) saison=`${fnMatch4[1]}/${fnMatch4[2]}`;
      else if(fnMatch2) saison=`${fnMatch2[1]}/${fnMatch2[1].slice(0,2)}${fnMatch2[2]}`;
      const ts=Date.now();

      if(isCSV){
        const reader=new FileReader();
        reader.onload=async(ev)=>{
          try {
            const text=ev.target.result;
            // Saison aus CSV-Inhalt lesen
            const csvLines=text.split(/\r?\n/);
            const sep=csvLines[0].includes(';')?';':',';
            const headers=csvLines[0].split(sep);
            const saisonIdx=headers.indexOf("Saison");
            if(saisonIdx>=0&&csvLines[1]){
              const saisonRaw=csvLines[1].split(sep)[saisonIdx]||"";
              const sm=saisonRaw.match(/(\d{4})\/(\d{2,4})/);
              if(sm) saison=sm[2].length===2?`${sm[1]}/20${sm[2]}`:`${sm[1]}/${sm[2]}`;
            }
            const key=`spielplan_${saison.replace("/","_")}`;
            const spiele=parseSpielplanCSV(text);
            if(spiele.length===0){showToast("Keine Spiele gefunden — CSV-Format prüfen","❌");setUploading(false);return;}
            await setDoc(doc(db,"config",key),{spiele,saison,lastUpdated:ts});
            showToast(`${saison}: ${spiele.length} Spiele importiert`,"📅");
            reloadSpielpläne();
          } catch(e){showToast("Fehler: "+e.message,"❌");}
          setUploading(false);
        };
        reader.onerror=()=>{showToast("Lesefehler","❌");setUploading(false);};
        reader.readAsText(file,'ISO-8859-1');
        return;
      }

      // PDF: eingebettete Konstante + PDF als Download
      const key=`spielplan_${saison.replace("/","_")}`;
      const spieleData=SPIELPLAN_DATA[key]||INITIAL_SPIELPLAN;
      await setDoc(doc(db,"config",key),{spiele:spieleData,saison,lastUpdated:ts});
      const reader=new FileReader();
      reader.onload=async(ev)=>{
        try { await setDoc(doc(db,"config","pdf_"+key),{pdfUrl:ev.target.result,name:file.name,lastUpdated:ts}); } catch(e){}
        setUploading(false);
        reloadSpielpläne();
      };
      reader.onerror=()=>setUploading(false);
      reader.readAsDataURL(file);
      showToast(`Spielplan ${saison} gespeichert`,"📅");
    } catch(e){showToast("Fehler: "+e.message,"❌");setUploading(false);}
  }

  async function openPdf(key) {
    const snap=await getDoc(doc(db,"config","pdf_"+key)).catch(()=>null);
    const pdfUrl=snap?.data()?.pdfUrl;
    if(!pdfUrl){showToast("Kein PDF gespeichert","❌");return;}
    const b64=pdfUrl.split(",")[1];
    const bin=atob(b64);const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blobUrl=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
    const a=document.createElement("a");
    a.href=blobUrl;
    a.download="Spielplan_"+key+".pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(blobUrl),5000);
  }

  async function deleteSpielpan(key) {
    if(!window.confirm("Spielplan wirklich löschen?")) return;
    try {
      await deleteDoc(doc(db,"config",key));
      await deleteDoc(doc(db,"config","pdf_"+key)).catch(()=>{});
      showToast("Spielplan gelöscht","✅");
      reloadSpielpläne();
    } catch(e){showToast("Fehler: "+e.message,"❌");}
  }

  return <div>
    {/* Spielplan Upload */}
    <div style={{marginBottom:16}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:6}}>📅 Vereinsspielplan</div>
      {savedSpielpläne.length>0&&<div style={{marginBottom:8}}>
        {savedSpielpläne.map(s=><div key={s.id} style={{marginBottom:6,padding:"8px 10px",
          background:"var(--bg)",borderRadius:8,border:"1px solid var(--border)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,flex:1,fontWeight:600}}>📅 {s.saison}</span>
            <span style={{fontSize:10,color:"var(--text4)"}}>{s.count} Spiele</span>
            <button onClick={()=>openPdf(s.id)} style={{fontSize:10,color:"#3b82f6",background:"none",border:"none",cursor:"pointer",padding:"0 4px"}}>📄 PDF</button>
            <button onClick={()=>deleteSpielpan(s.id)} style={{fontSize:10,color:"#ef4444",background:"none",border:"none",cursor:"pointer",padding:"0 4px"}}>🗑️</button>
          </div>
          {s.lastUpdated&&<div style={{fontSize:10,color:"var(--text4)",marginTop:3}}>Hochgeladen: {mesz(s.lastUpdated)}</div>}
        </div>)}
      </div>}
      <label style={{display:"block",padding:"9px 12px",background:"var(--bg3)",border:"2px dashed var(--border2)",
        borderRadius:9,textAlign:"center",cursor:uploading?"not-allowed":"pointer",fontSize:12,color:"var(--text3)"}}>
        {uploading?"⏳ Wird verarbeitet...":"📎 Spielplan CSV oder PDF hochladen"}
        <input type="file" accept=".csv,.pdf" style={{display:"none"}} disabled={uploading}
          onChange={e=>handleUpload(e.target.files?.[0])}/>
      </label>
    </div>

    {/* Beitritte Import */}
    <div style={{borderTop:"1px solid var(--border)",paddingTop:14,marginBottom:16}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:6}}>📥 Vereinsbeitritte importieren</div>
      <div style={{fontSize:11,color:"var(--text3)",marginBottom:8,lineHeight:1.6}}>
        Excel/CSV-Datei mit Spalten: Vorname, Nachname, Vereinsbeitritt (Datum).
      </div>
      <label style={{
        display:"block",padding:"9px 12px",background:"var(--bg3)",border:"2px dashed var(--border2)",
        borderRadius:9,textAlign:"center",cursor:joinImporting?"not-allowed":"pointer",fontSize:12,
        color:joinImporting?"#6b7280":"var(--text3)"
      }}>
        {joinImporting?"⏳ Importiere...":"📎 Beitrittsdaten hochladen (.xlsx/.csv)"}
        <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}}
          onChange={e=>onJoinImport&&onJoinImport(e)} disabled={joinImporting}/>
      </label>
    </div>

    {/* Aufstellungen Upload */}
    <div style={{borderTop:"1px solid var(--border)",paddingTop:14,marginBottom:16}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:6}}>📋 Aufstellungen</div>
      <AufstellungUpload showToast={showToast}/>
    </div>

    {/* Mannschaften */}
    <div style={{borderTop:"1px solid var(--border)",paddingTop:14}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",marginBottom:10}}>📋 Mannschaften — Spiel-PINs & Spielcodes</div>
      <MannschaftenVerwaltung showToast={showToast}/>
    </div>
  </div>;
}

// ─── EHRUNGEN ─────────────────────────────────────────────────────────────────
const SPIELER_VERDIENST = [
  {id:"sv_bronze",  icon:"🥉", label:"Spielerverdienstnadel Bronze",         info:"15 Jahre aktives Spielen"},
  {id:"sv_silber",  icon:"🥈", label:"Spielerverdienstnadel Silber",          info:"20 Jahre aktives Spielen"},
  {id:"sv_gold",    icon:"🥇", label:"Spielerverdienstnadel Gold",            info:"25 Jahre aktives Spielen"},
  {id:"sv_gold30",  icon:"🏅", label:"Spielerverdienstnadel Gold (30 J.)",    info:"30 Jahre aktives Spielen"},
  {id:"sv_gold40",  icon:"🏅", label:"Spielerverdienstnadel Gold (40 J.)",    info:"40 Jahre aktives Spielen"},
  {id:"sv_gold50",  icon:"🏅", label:"Spielerverdienstnadel Gold (50 J.)",    info:"50 Jahre aktives Spielen"},
  {id:"sv_gold60",  icon:"🏅", label:"Spielerverdienstnadel Gold (60 J.)",    info:"60 Jahre aktives Spielen"},
  {id:"sv_gold70",  icon:"🏅", label:"Spielerverdienstnadel Gold (70 J.)",    info:"70 Jahre aktives Spielen"},
];
const VEREINSMITARBEITER_EHRUNGEN = [
  {id:"em_urkunde",      icon:"📜", label:"Ehrenurkunde"},
  {id:"em_bronze",       icon:"🥉", label:"Ehrennadel Bronze"},
  {id:"em_silber",       icon:"🥈", label:"Ehrennadel Silber"},
  {id:"em_gold",         icon:"🥇", label:"Ehrennadel Gold"},
  {id:"em_goldkranz",    icon:"🌿", label:"Ehrennadel Gold mit Kranz"},
  {id:"em_goldgrosskranz",icon:"🌟", label:"Ehrennadel Gold mit großem Kranz"},
];
function getAllEhrungLabel(e) {
  return [...SPIELER_VERDIENST,...VEREINSMITARBEITER_EHRUNGEN].find(a=>a.id===e.art)||{icon:"🏅",label:e.art||"Ehrung"};
}

function EhrungenAdminSection({playerId, initialEhrungen, showToast}) {
  const [ehrungen,setEhrungen]=useState(initialEhrungen||[]);
  const [showAdd,setShowAdd]=useState(false);
  const [editingEhr,setEditingEhr]=useState(null); // id of entry being edited
  const [newE,setNewE]=useState({typ:"spieler",art:"sv_bronze",datum:new Date().toLocaleDateString("sv")});
  const [editE,setEditE]=useState({});

  async function addEhrung() {
    const updated=[...ehrungen,{...newE,id:Date.now().toString()}];
    await updateDoc(doc(db,"players",playerId),{ehrungen:updated}).catch(()=>{});
    setEhrungen(updated); setShowAdd(false); showToast&&showToast("Ehrung gespeichert","🏅");
  }
  async function saveEditEhrung() {
    const updated=ehrungen.map(e=>e.id===editingEhr?{...e,...editE}:e);
    await updateDoc(doc(db,"players",playerId),{ehrungen:updated}).catch(()=>{});
    setEhrungen(updated); setEditingEhr(null); showToast&&showToast("Ehrung aktualisiert","✅");
  }
  async function delEhrung(id) {
    if(!window.confirm("Ehrung löschen?")) return;
    const updated=ehrungen.filter(e=>e.id!==id);
    await updateDoc(doc(db,"players",playerId),{ehrungen:updated}).catch(()=>{});
    setEhrungen(updated);
  }
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
      <div style={{fontSize:11,fontWeight:700,color:"#f59e0b"}}>Eingetragene Ehrungen</div>
      <button onClick={()=>setShowAdd(p=>!p)} style={{padding:"3px 8px",background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:6,color:"#f59e0b",fontSize:11,cursor:"pointer"}}>{showAdd?"✕":"+ Ehrung"}</button>
    </div>
    {showAdd&&<div style={{background:"var(--bg3)",borderRadius:8,padding:10,marginBottom:8}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
        <div>
          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Typ</label>
          <select value={newE.typ} onChange={e=>setNewE(p=>({...p,typ:e.target.value,art:e.target.value==="spieler"?"sv_bronze":"em_urkunde"}))} style={{fontSize:11}}>
            <option value="spieler">Spielerverdienstnadel</option>
            <option value="mitarbeiter">Vereinsmitarbeiter</option>
          </select>
        </div>
        <div>
          <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Datum</label>
          <input type="date" value={newE.datum} onChange={e=>setNewE(p=>({...p,datum:e.target.value}))}
            style={{padding:"4px 6px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
        </div>
      </div>
      <select value={newE.art} onChange={e=>setNewE(p=>({...p,art:e.target.value}))} style={{fontSize:11,width:"100%",marginBottom:6}}>
        {(newE.typ==="spieler"?SPIELER_VERDIENST:VEREINSMITARBEITER_EHRUNGEN).map(a=>(
          <option key={a.id} value={a.id}>{a.icon} {a.label}</option>
        ))}
      </select>
      <button onClick={addEhrung} style={{width:"100%",padding:"6px",background:"#f59e0b",border:"none",borderRadius:7,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 Speichern</button>
    </div>}
    {ehrungen.length===0&&<div style={{fontSize:11,color:"var(--text4)"}}>Noch keine Ehrungen.</div>}
    {ehrungen.map(e=>{
      const art=getAllEhrungLabel(e);
      const isEditing=editingEhr===e.id;
      if(isEditing) return <div key={e.id} style={{background:"var(--bg3)",borderRadius:8,padding:8,marginBottom:4}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
          <div>
            <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Typ</label>
            <select value={editE.typ||e.typ} onChange={ev=>setEditE(p=>({...p,typ:ev.target.value,art:ev.target.value==="spieler"?"sv_bronze":"em_urkunde"}))} style={{fontSize:11}}>
              <option value="spieler">Spielerverdienstnadel</option>
              <option value="mitarbeiter">Vereinsmitarbeiter</option>
            </select>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--text3)",display:"block",marginBottom:2}}>Datum</label>
            <input type="date" value={editE.datum||e.datum||""} onChange={ev=>setEditE(p=>({...p,datum:ev.target.value}))}
              style={{padding:"4px 6px",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:11,outline:"none"}}/>
          </div>
        </div>
        <select value={editE.art||e.art} onChange={ev=>setEditE(p=>({...p,art:ev.target.value}))} style={{fontSize:11,width:"100%",marginBottom:6}}>
          {((editE.typ||e.typ)==="spieler"?SPIELER_VERDIENST:VEREINSMITARBEITER_EHRUNGEN).map(a=>(
            <option key={a.id} value={a.id}>{a.icon} {a.label}</option>
          ))}
        </select>
        <div style={{display:"flex",gap:6}}>
          <button onClick={saveEditEhrung} style={{flex:1,padding:"5px",background:"#10b981",border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>💾 Speichern</button>
          <button onClick={()=>setEditingEhr(null)} style={{padding:"5px 8px",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text3)",fontSize:11,cursor:"pointer"}}>✕</button>
        </div>
      </div>;
      return <div key={e.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)"}}>
        <span style={{fontSize:18}}>{art.icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--text)"}}>{art.label}</div>
          <div style={{fontSize:10,color:"var(--text3)"}}>{e.datum?new Date(e.datum).toLocaleDateString("de-DE"):"—"}</div>
        </div>
        <button onClick={()=>{setEditingEhr(e.id);setEditE({typ:e.typ,art:e.art,datum:e.datum});}} style={{padding:"2px 6px",background:"#3b82f622",border:"none",borderRadius:4,color:"#3b82f6",fontSize:10,cursor:"pointer"}}>✏️</button>
        <button onClick={()=>delEhrung(e.id)} style={{padding:"2px 6px",background:"#ef444422",border:"none",borderRadius:4,color:"#ef4444",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>;
    })}
  </div>;
}

function EhrungenView({player}) {
  // Punkt 1: load live from Firestore (not from stale prop)
  const [ehrungen,setEhrungen]=useState(player?.ehrungen||[]);
  useEffect(()=>{
    if(!player?.id) return;
    const unsub=onSnapshot(doc(db,"players",player.id),snap=>{
      if(snap.exists()) setEhrungen(snap.data().ehrungen||[]);
    },()=>{});
    return unsub;
  },[player?.id]);

  const spieler=ehrungen.filter(e=>e.typ==="spieler");
  const mit=ehrungen.filter(e=>e.typ==="mitarbeiter");

  if(!ehrungen.length) return <div style={{padding:20,textAlign:"center",color:"var(--text3)"}}>
    <div style={{fontSize:32,marginBottom:8}}>🏅</div>
    <div>Keine Ehrungen vorhanden.</div>
  </div>;

  const Section=({title,items})=>items.length===0?null:<div style={{marginBottom:20}}>
    <div style={{fontSize:13,fontWeight:700,color:"var(--text2)",marginBottom:10}}>{title}</div>
    {items.map((e,i)=>{
      const art=getAllEhrungLabel(e);
      return <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"var(--bg2)",borderRadius:12,marginBottom:8,border:"1px solid var(--border)"}}>
        <span style={{fontSize:32,flexShrink:0}}>{art.icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{art.label}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>
            {e.datum?new Date(e.datum).toLocaleDateString("de-DE",{day:"2-digit",month:"long",year:"numeric"}):"—"}
          </div>
        </div>
      </div>;
    })}
  </div>;

  return <div style={{padding:14}}>
    <Section title="🏅 Spielerverdienstnadel" items={spieler}/>
    <Section title="🌟 Ehrung für Vereinsmitarbeiter" items={mit}/>
  </div>;
}

// ─── ERWACHSENE VIEW ──────────────────────────────────────────────────────────
function ErwachseneView({user,players,isDark,onSetUserTheme,userTheme,onSignOut,forcePlayer,inRSW=false}) {
  const [activeTab,setActiveTab]=useState("spielbetrieb");
  const myPlayer=forcePlayer||players.find(p=>p.email===user?.email);
  const [toast,setToast]=useState(null);
  function showToast(msg,emoji="✅"){setToast({msg,emoji});setTimeout(()=>setToast(null),2500);}
  const TABS=[
    {key:"spielbetrieb",label:"Spielbetrieb",icon:"📋"},
    {key:"aufstellung",label:"Aufstellung",icon:"📋"},
    {key:"spielplan",label:"Spielplan",icon:"📅"},
    {key:"beobachtungen",label:"Beobachtungen",icon:"🔍"},
    {key:"erfolge",label:"Erfolge",icon:"🏅"},
    {key:"ehrungen",label:"Ehrungen",icon:"🌟"},
    {key:"geburtstage",label:"Geburtstage",icon:"🎂"},
  ];
  // top offset: if inside RoleSwitchWrapper (hideHeader) the switch bar is 44px + chip bar ~80px
  const topOffset = 88;
  return <div style={{minHeight:"100vh",background:"var(--bg)",paddingBottom:40,maxWidth:1024,margin:"0 auto"}}>
    {toast&&<div style={{position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",
      background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:12,padding:"10px 20px",
      display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600,zIndex:900,
      boxShadow:"0 8px 32px #0008"}}><span style={{fontSize:18}}>{toast.emoji}</span>{toast.msg}</div>}
    {/* Punkt 1+2: Sticky header mit Tabs + Logout + Theme */}
    <div style={{position:"fixed",
      top:inRSW?"var(--rsw-height)":"0px",
      left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:1024,zIndex:200,
      background:"var(--bg2)",borderBottom:"2px solid var(--border2)"}}>
      <div style={{display:"flex",alignItems:"center",padding:"4px 8px 0",gap:4}}>
        <div style={{flex:1,display:"flex",overflowX:"auto"}}>
          {TABS.map(t=><button key={t.key} onClick={()=>setActiveTab(t.key)} style={{
            flexShrink:0,padding:"9px 8px",background:"transparent",border:"none",
            borderBottom:`2px solid ${activeTab===t.key?"#ec4899":"transparent"}`,
            color:activeTab===t.key?"#ec4899":"var(--text3)",
            fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",
          }}>{t.icon} {t.label}</button>)}
        </div>
        {!inRSW&&<ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>}
        {!inRSW&&<button onClick={onSignOut} title="Abmelden" style={{
          padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",
          borderRadius:8,color:"var(--text2)",fontSize:14,cursor:"pointer",lineHeight:1,flexShrink:0,
        }}>⏻</button>}
      </div>
    </div>
    {/* Spacer for fixed EW tab bar only (RSWHeader has its own spacer) */}
    <div style={{height:44}}/>
    {activeTab==="spielbetrieb"&&<SpielbetrieblTab isSuperAdmin={false}/>}
    {/* Beobachtungen: Erwachsene können selbst Einträge erstellen/bearbeiten/löschen */}
    {activeTab==="beobachtungen"&&myPlayer&&
      <BeobachtungenAdminTab players={[myPlayer]} user={user} showToast={showToast}/>}
    {activeTab==="beobachtungen"&&!myPlayer&&
      <div style={{padding:30,textAlign:"center",color:"var(--text3)"}}>Kein Profil verknüpft.</div>}
    {activeTab==="erfolge"&&myPlayer&&<ErfolgeTab player={myPlayer} hideTraining={true}/>}
    {activeTab==="erfolge"&&!myPlayer&&
      <div style={{padding:30,textAlign:"center",color:"var(--text3)"}}>Kein Profil verknüpft.</div>}
    {activeTab==="ehrungen"&&myPlayer&&<EhrungenView player={myPlayer}/>}
    {activeTab==="ehrungen"&&!myPlayer&&
      <div style={{padding:30,textAlign:"center",color:"var(--text3)"}}>Kein Profil verknüpft.</div>}
    {/* Punkt 2: Geburtstage Tab - nur Erwachsene Personen */}
    {activeTab==="geburtstage"&&<GeburtstageTabErwachsene players={players}/>}
    {activeTab==="spielplan"&&<VereinsSpielplan nurNachwuchs={false}/>}
    {activeTab==="aufstellung"&&<AufstellungView players={players} nurErwachsene={true}/>}
  </div>;
}

// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props){super(props); this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error,info){console.error("ErrorBoundary caught:",error,info);}
  render(){
    if(this.state.error) return <div style={{padding:20,background:"#fee",color:"#900",fontSize:13,fontFamily:"monospace",whiteSpace:"pre-wrap"}}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:10}}>⚠️ Fehler in Komponente</div>
      <div>{String(this.state.error?.message||this.state.error)}</div>
      <div style={{marginTop:10,fontSize:11}}>Stack: {String(this.state.error?.stack||"").slice(0,500)}</div>
      <button onClick={()=>this.setState({error:null})} style={{marginTop:14,padding:"6px 12px",background:"#900",border:"none",borderRadius:6,color:"#fff",cursor:"pointer"}}>Neu laden</button>
    </div>;
    return this.props.children;
  }
}

// ─── RSW HEADER mit dynamischer Höhenmessung ────────────────────────────────
function RSWHeader({switchBarContent, chipsContent}) {
  const containerRef = useRef(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const h = containerRef.current?.offsetHeight || 0;
      setHeight(h);
      // Set CSS variable so children can use it for their tab bars
      document.documentElement.style.setProperty('--rsw-height', h + 'px');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [chipsContent]);

  return <>
    <div ref={containerRef} style={{
      position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",
      width:"100%",maxWidth:1024,zIndex:500,background:"var(--bg2)",
      borderBottom:"2px solid var(--border2)"
    }}>
      {/* Switch Bar */}
      <div style={{padding:"8px 14px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
        {switchBarContent}
      </div>
      {/* Chips */}
      {chipsContent && <div style={{padding:"4px 14px 8px",borderTop:"1px solid var(--border)"}}>
        {chipsContent}
      </div>}
    </div>
    {/* Spacer - matches measured height exactly */}
    <div style={{height:height}}/>
  </>;
}

// ─── ROLE SWITCH WRAPPER ──────────────────────────────────────────────────────
// Zeigt Switch-Bar oben und wechselt zwischen Player/Trainer/Admin-View
function RoleSwitchWrapper({user,players,attendance,rackets,myPlayer,availableViews,hasAdminRole,clubConfig={},
  globalTheme,onSetGlobalTheme,onPlayerAdded,isDark,onSetUserTheme,userTheme,onSignOut}) {

  const [activeView,setActiveView] = useState(availableViews[0]||"player");
  const [viewAsPlayer,setViewAsPlayer] = useState(myPlayer?.id||null);
  const [groupFilter,setGroupFilter] = useState("all");
  const [adminGroupFilters,setAdminGroupFilters] = useState({});
  const [showOnlyPresent,setShowOnlyPresent] = useState(false);

  const VIEW_CONFIG = {
    player:     {icon:"🏓", label:"Spieler",    color:"#10b981"},
    trainer:    {icon:"🛡️", label:"Trainer",    color:"#3b82f6"},
    admin:      {icon:"⚙️", label:"Admin",      color:"#f59e0b"},
    erwachsene: {icon:"👪", label:"Erwachsene", color:"#ec4899"},
  };

  const sharedProps = {isDark,onSetUserTheme,userTheme,onSignOut};
  const GROUP_COLORS = {Profis:"#f59e0b",Fortgeschrittene:"#3b82f6",Anfänger:"#10b981",Trainer:"#8b5cf6",Erwachsene:"#ec4899"};

  // All active players sorted alphabetically
  const allActive = [...players.filter(p=>p.status!=="passiv")]
    .sort((a,b)=>(a.firstName||"").localeCompare(b.firstName||"","de"));

  // Duplicate first name detection
  const fnCounts = {};
  allActive.forEach(p=>{fnCounts[p.firstName]=(fnCounts[p.firstName]||0)+1;});
  const chipLabel = (p) => fnCounts[p.firstName]>1
    ? `${p.firstName} ${(p.lastName||"").charAt(0)}.`
    : (p.firstName||p.name||"?");

  const spielerPlayers = allActive.filter(p=>(p.group||"Anfänger")!=="Erwachsene");
  const erwachsenePlayers = allActive.filter(p=>(p.group||"Anfänger")==="Erwachsene");

  // Erwachsene-only: only see own data, no chip selection
  const isErwachseneOnly = availableViews.length===1 && availableViews[0]==="erwachsene";

  const chipPlayers = activeView==="erwachsene"
    ? (isErwachseneOnly ? [] : erwachsenePlayers)
    : groupFilter==="all" ? spielerPlayers
    : spielerPlayers.filter(p=>(p.group||"Anfänger")===groupFilter);

  // For erwachsene-only: force own player, no selection possible
  const selectedPlayer = isErwachseneOnly
    ? myPlayer
    : players.find(p=>p.id===viewAsPlayer)
      || (activeView==="erwachsene" ? erwachsenePlayers[0] : (myPlayer||spielerPlayers[0]));

  const showChips = (activeView==="player" || activeView==="erwachsene" || activeView==="admin" || activeView==="trainer") && !isErwachseneOnly;

  return <div style={{background:"var(--bg)",minHeight:"100vh",maxWidth:1024,margin:"0 auto"}}>
    {/* Header-Container — misst seine eigene Höhe */}
    <RSWHeader switchBarContent={
      <>
        {availableViews.map(v=>{
          const cfg=VIEW_CONFIG[v]; const isActive=activeView===v;
          return <button key={v} onClick={()=>{setActiveView(v);setViewAsPlayer(null);setGroupFilter("all");}} style={{
            padding:"6px 12px",borderRadius:20,border:`2px solid ${isActive?cfg.color:cfg.color+"44"}`,
            background:isActive?cfg.color+"22":"transparent",color:isActive?cfg.color:"var(--text3)",
            fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4,flexShrink:0,
          }}>{cfg.icon} {cfg.label}</button>;
        })}
        <div style={{flex:1}}/>
        <BirthdayBtn players={players} attendance={attendance}/>
        <ThemeToggle isDark={isDark} onSetUserTheme={onSetUserTheme}/>
        <button onClick={onSignOut} title="Abmelden" style={{
          padding:"6px 9px",background:"var(--bg3)",border:"1px solid var(--border2)",
          borderRadius:8,color:"var(--text2)",fontSize:16,cursor:"pointer",lineHeight:1,flexShrink:0,
        }}>⏻</button>
      </>
    } chipsContent={showChips ? (
      <>
        {/* Menü 2: Gruppenfilter — einzeilig, scrollbar */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:4,marginBottom:4,flexWrap:"nowrap"}}>
          {(activeView==="player")&&<>
            <button onClick={()=>setGroupFilter("all")} style={{
              flexShrink:0,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`2px solid ${groupFilter==="all"?"#6b7280":"#6b728044"}`,
              background:groupFilter==="all"?"#6b728022":"transparent",
              color:groupFilter==="all"?"#9ca3af":"#6b728066"}}>Alle</button>
            {["Profis","Fortgeschrittene","Anfänger","Trainer"].map(g=>{
              const col=GROUP_COLORS[g]; const on=groupFilter===g;
              return <button key={g} onClick={()=>setGroupFilter(g)} style={{
                flexShrink:0,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
                border:`2px solid ${on?col:col+"44"}`,background:on?col+"22":"transparent",color:on?col:col+"66",
              }}>{g}</button>;
            })}
          </>}
          {(activeView==="admin"||activeView==="trainer")&&
            ["Profis","Fortgeschrittene","Anfänger","Trainer","Erwachsene"].map(g=>{
              const col=GROUP_COLORS[g]; const on=adminGroupFilters[g];
              return <button key={g} onClick={()=>setAdminGroupFilters(p=>({...p,[g]:!on}))} style={{
                flexShrink:0,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,cursor:"pointer",
                border:`2px solid ${on?col:col+"44"}`,background:on?col+"22":"transparent",color:on?col:col+"66",
              }}>{g}</button>;
            })}
          {activeView==="erwachsene"&&<span style={{fontSize:11,color:"var(--text3)",padding:"3px 0",flexShrink:0}}>👪 Erwachsene</span>}
        </div>
        {/* Menü 3: Personen-Chips — einzeilig, scrollbar */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2,flexWrap:"nowrap"}}>
          {(activeView==="player"||activeView==="erwachsene")&&<>
            {chipPlayers.length===0&&<span style={{fontSize:11,color:"var(--text4)",padding:"4px 0"}}>Keine Personen</span>}
            {chipPlayers.map(p=>{
              const isActive=p.id===selectedPlayer?.id;
              const col=p.color||"#10b981";
              return <button key={p.id} onClick={()=>setViewAsPlayer(p.id)} style={{
                flexShrink:0,padding:"3px 9px 3px 6px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
                border:`2px solid ${isActive?col:"var(--border2)"}`,
                background:isActive?col+"22":"transparent",color:isActive?col:"var(--text2)",
                display:"flex",alignItems:"center",gap:4,
              }}><span style={{fontSize:13}}>{p.avatar||"🏓"}</span>{chipLabel(p)}</button>;
            })}
          </>}
          {(activeView==="admin"||activeView==="trainer")&&(()=>{
            const hasFilter=Object.values(adminGroupFilters).some(Boolean);
            const filtered=spielerPlayers.filter(p=>!hasFilter||adminGroupFilters[p.group||"Anfänger"]);
            const todayStr=new Date().toLocaleDateString("sv");
            let absentCount=0;
            for(const p of filtered){
              const grp=p.group||"Anfänger";
              const pDays=getTrainingDaysForGroup(grp,p.trainingDays);
              const nearestDay=[...pDays].reverse().find(d=>d<=todayStr)||pDays[0];
              if(!nearestDay) continue;
              const sess=attendance?.[nearestDay];
              if(!sess||sess.took_place===false||!sess.attendances) continue;
              const v=sess.attendances[p.id];
              if(v==="e"||v==="u") absentCount++;
            }
            return filtered.length===0
              ? <span style={{fontSize:11,color:"var(--text4)",padding:"4px 0"}}>Keine Spieler</span>
              : <div style={{display:"flex",gap:5,alignItems:"center",overflow:"hidden"}}>
                {/* P6: Eye button fixed/sticky on left */}
                {absentCount>0&&<button onClick={()=>setShowOnlyPresent(p=>!p)}
                title={showOnlyPresent?"Abwesende anzeigen":"Abwesende ausblenden"}
                style={{flexShrink:0,padding:"4px 8px",borderRadius:20,fontSize:14,cursor:"pointer",
                  border:`2px solid ${showOnlyPresent?"#f59e0b":"#6b728088"}`,
                  background:showOnlyPresent?"#f59e0b22":"var(--bg3)",
                  color:showOnlyPresent?"#f59e0b":"var(--text3)"}}>👁</button>}
                <div style={{display:"flex",gap:5,overflowX:"auto",flex:1}}>
                {filtered.filter(p=>{
                  if(!showOnlyPresent) return true;
                  const todayStr2=new Date().toLocaleDateString("sv");
                  const grp=p.group||"Anfänger";
                  const pDays=getTrainingDaysForGroup(grp,p.trainingDays);
                  const nearestDay=[...pDays].reverse().find(d=>d<=todayStr2)||pDays[0];
                  if(!nearestDay) return true;
                  const sess=attendance?.[nearestDay];
                  if(!sess||sess.took_place===false||!sess.attendances) return true;
                  const v=sess.attendances[p.id];
                  return v!=="e"&&v!=="u";
                }).map(p=>{
                const isActive=p.id===selectedPlayer?.id;
                const col=p.color||"#10b981";
                return <button key={p.id} onClick={()=>setViewAsPlayer(p.id)} style={{
                  flexShrink:0,padding:"3px 9px 3px 6px",borderRadius:20,fontSize:12,fontWeight:600,cursor:"pointer",
                  border:`2px solid ${isActive?col:"var(--border2)"}`,
                  background:isActive?col+"22":"transparent",color:isActive?col:"var(--text2)",
                  display:"flex",alignItems:"center",gap:4,
                }}><span style={{fontSize:13}}>{p.avatar||"🏓"}</span>{chipLabel(p)}</button>;
              })}</div></div>;
          })()}
        </div>
      </>
    ) : null}/>
    {/* Spieler-View - mit ErrorBoundary */}
    {activeView==="player"&&selectedPlayer&&
      <ErrorBoundary key={selectedPlayer.id}>
        <PlayerView user={user} players={players} attendance={attendance}
          forcePlayer={selectedPlayer} hideHeader {...sharedProps}/>
      </ErrorBoundary>}
    {activeView==="player"&&!selectedPlayer&&
      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
        <div style={{fontSize:32,marginBottom:8}}>🏓</div>
        <div>Spieler oben auswählen</div>
      </div>}

    {/* Erwachsene-View */}
    {activeView==="erwachsene"&&selectedPlayer&&
      <ErwachseneView user={user} players={players} forcePlayer={selectedPlayer}
        isDark={isDark} onSetUserTheme={onSetUserTheme} userTheme={userTheme} onSignOut={onSignOut} inRSW={true}/>}
    {activeView==="erwachsene"&&!selectedPlayer&&
      <div style={{padding:40,textAlign:"center",color:"var(--text3)"}}>
        <div style={{fontSize:32,marginBottom:8}}>👪</div>
        <div>Keine Erwachsene vorhanden oder Person auswählen</div>
      </div>}
    {activeView==="trainer"&&<AdminPanel key="trainer"
      user={user} players={players} attendance={attendance} rackets={rackets}
      isSuperAdmin={false} globalTheme={globalTheme} onSetGlobalTheme={onSetGlobalTheme}
      onPlayerAdded={onPlayerAdded} hideHeader
      externalPlayer={players.find(p=>p.id===viewAsPlayer)||null}
      showOnlyPresentExt={showOnlyPresent} onSetShowOnlyPresent={setShowOnlyPresent}
      clubConfig={clubConfig} groupFiltersExt={adminGroupFilters} {...sharedProps}/>}

    {/* Admin-View */}
    {activeView==="admin"&&<AdminPanel key="admin"
      user={user} players={players} attendance={attendance} rackets={rackets}
      isSuperAdmin={true} globalTheme={globalTheme} onSetGlobalTheme={onSetGlobalTheme}
      onPlayerAdded={onPlayerAdded} hideHeader
      externalPlayer={players.find(p=>p.id===viewAsPlayer)||null}
      showOnlyPresentExt={showOnlyPresent} onSetShowOnlyPresent={setShowOnlyPresent}
      clubConfig={clubConfig} groupFiltersExt={adminGroupFilters} {...sharedProps}/>}
  </div>;
}


// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser,     setAuthUser]     = useState(undefined);
  const [players,      setPlayers]      = useState([]);
  const [attendance,   setAttendance]   = useState({});
  const [clubConfig,   setClubConfig]    = useState({name:"TTC Niederzeuzheim",subtitle:"Trainings-App",logo:""});
  const [clubConfigLoaded, setClubConfigLoaded] = useState(false);
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

  // Club-Konfiguration laden - erst getDoc dann onSnapshot für Live-Updates
  useEffect(()=>{
    // Sofort laden mit getDoc
    getDoc(doc(db,"config","clubConfig")).then(snap=>{
      if(snap.exists()){
        const d=snap.data();
        setClubConfig({
          name:d.name||"TTC Niederzeuzheim",
          subtitle:d.subtitle||"Trainings-App",
          logo:d.logo||""
        });
      }
      setClubConfigLoaded(true);
    }).catch(()=>setClubConfigLoaded(true));
    // Dann Live-Updates
    const unsub2=onSnapshot(doc(db,"config","clubConfig"),snap=>{
      if(snap.exists()){
        const d=snap.data();
        setClubConfig({
          name:d.name||"TTC Niederzeuzheim",
          subtitle:d.subtitle||"Trainings-App",
          logo:d.logo||""
        });
      }
      setClubConfigLoaded(true);
    },()=>{ setClubConfigLoaded(true); });
    return ()=>{ unsub2(); };
  },[]);
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
  if (!authUser) {
    // Warte auf clubConfig bevor Login-Maske angezeigt wird
    if (!clubConfigLoaded) return (
      <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{textAlign:"center",color:"#6b7280"}}>
          <div style={{fontSize:32,marginBottom:12}}>🏓</div>
          <div style={{fontSize:12}}>Laden...</div>
        </div>
      </div>
    );
    return (
      <LoginScreen
        onLogin={handleLogin}
        error={loginErr}
        loading={loginLoad}
        successMessage={loginSuccess}
        clubConfig={clubConfig}
      />
    );
  }

  // ── Spieler-Profil suchen ──
  const myPlayer = players.find(p => p.email?.toLowerCase() === authUser.email?.toLowerCase());

  // Rollen aus Spieler-Profil ermitteln
  const playerRoles = myPlayer?.roles || {};
  const hasTrainerRole = isAdmin || playerRoles.trainer === true;
  const hasAdminRole   = isSuperAdmin || playerRoles.admin === true;
  const hasErwachseneRole = playerRoles.erwachsene === true;
  // hasPlayerRole: explicit player-role, OR admin, OR has profile but NOT purely erwachsene
  const hasPlayerRole  = playerRoles.player === true || (isAdmin && !hasErwachseneRole) ||
    (!!myPlayer && !hasErwachseneRole && !playerRoles.trainer && !playerRoles.admin);

  // Erwachsene-only: nur eigene Daten
  const isErwachseneOnly = hasErwachseneRole && !hasAdminRole && !hasTrainerRole && !playerRoles.player;
  const availableViews = [];
  if (hasAdminRole)                 availableViews.push("admin");
  if (hasTrainerRole)               availableViews.push("trainer");
  if (hasPlayerRole && myPlayer)    availableViews.push("player");
  if (hasErwachseneRole)            availableViews.push("erwachsene");
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
    // Punkt 3: Erwachsene-only → ErwachseneView (nicht PlayerView)
    if (isErwachseneOnly) return (
      <ErwachseneView user={authUser} players={players} forcePlayer={myPlayer}
        globalTheme={globalTheme} onSetGlobalTheme={handleSetGlobalTheme} {...sharedProps}/>
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
      clubConfig={clubConfig}
      globalTheme={globalTheme}
      onSetGlobalTheme={handleSetGlobalTheme}
      onPlayerAdded={name=>setLoginSuccess(`${name} wurde angelegt!`)}
      {...sharedProps}
    />
  );
}
