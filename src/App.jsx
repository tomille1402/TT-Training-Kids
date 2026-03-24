import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";
import {
  getFirestore, doc, setDoc, getDoc, collection,
  onSnapshot, deleteDoc, updateDoc
} from "firebase/firestore";

// ─── FIREBASE CONFIG ─────────────────────────────────────────────────────────
// Werte kommen aus Netlify-Umgebungsvariablen
import { firebaseConfig } from "./firebaseConfig";

// Haupt-App (für Trainer-Login)
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);

// Zweite App-Instanz NUR zum Anlegen neuer Nutzer
// → verhindert dass der Trainer beim Anlegen eines Spielers ausgeloggt wird
const appHelper  = initializeApp(firebaseConfig, "helper");
const authHelper = getAuth(appHelper);

// Admin-E-Mails – hier alle Trainer-E-Mails eintragen (Kleinschreibung egal)
const ADMIN_EMAILS = [
  "trainer@ttc-niederzeuzheim.de",
  // weitere Trainer hier hinzufügen:
  // "trainer2@ttc-niederzeuzheim.de",
];

// Robuster Admin-Check: vergleicht immer in Kleinbuchstaben
// UND prüft zusätzlich die Firestore-Rolle
function checkIsAdminByEmail(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  return ADMIN_EMAILS.some(a => a.toLowerCase().trim() === emailLower);
}

// ─── AVATARS ─────────────────────────────────────────────────────────────────
const AVATARS = [
  "🏓","🐯","🦁","🐻","🦊","🐼","🐸","🦋","🐬","🦄",
  "🐙","🦅","🦈","🐲","🌟","🔥","⚡","🎯","🚀","🏆",
  "💎","🎸","🤖","👾","🦸","🧙","🎃","🌈","🐺","🦝",
];

// ─── EXERCISES ───────────────────────────────────────────────────────────────
const EXERCISES_BEGINNER = [
  { id:1,  name:"Seilspringen",                          description:"Anzahl Sprünge in 1 Minute",                 thresholds:["25 Sprünge","50 Sprünge","75 Sprünge","100 Sprünge","125 Sprünge"] },
  { id:2,  name:"Wandsitzen",                            description:"Oberschenkel & Unterschenkel im rechten Winkel", thresholds:["1 Minute","2 Minuten","3 Minuten","4 Minuten","5 Minuten"] },
  { id:3,  name:"Vorhand tippen",                        description:"Ball ohne Fehler auf Vorhand tippen",         thresholds:["10×","25×","50×","100×","150×"] },
  { id:4,  name:"Rückhand tippen",                       description:"Ball ohne Fehler auf Rückhand tippen",        thresholds:["10×","25×","50×","100×","150×"] },
  { id:5,  name:"Vorhand/Rückhand abwechselnd tippen",   description:"Abwechselnd Vorhand & Rückhand tippen",       thresholds:["5×","15×","25×","50×","100×"] },
  { id:6,  name:"Vorhand balancieren",                   description:"Ball auf Vorhand balancieren (Strecke)",      thresholds:["10 m","25 m","50 m","100 m","200 m"] },
  { id:7,  name:"Rückhand balancieren",                  description:"Ball auf Rückhand balancieren (Strecke)",     thresholds:["10 m","25 m","50 m","100 m","200 m"] },
  { id:8,  name:"Vorhand prellen",                       description:"Ball mit Vorhand auf Boden prellen",          thresholds:["10×","25×","50×","100×","150×"] },
  { id:9,  name:"Rückhand prellen",                      description:"Ball mit Rückhand auf Boden prellen",         thresholds:["10×","25×","50×","100×","150×"] },
  { id:10, name:"Vorhand/Rückhand abwechselnd prellen",  description:"Abwechselnd VH & RH auf Boden prellen",       thresholds:["10×","25×","50×","75×","100×"] },
];
const EXERCISES_ADVANCED = [
  { id:11, name:"Roll-Aufschlag Vorhand diagonal",                         description:"Von 20 Aufschlägen im Ziel (diagonal)",    thresholds:["5×","10×","15×","18×","20×"] },
  { id:12, name:"Roll-Aufschlag Vorhand parallel",                         description:"Von 20 Aufschlägen im Ziel (parallel)",    thresholds:["5×","10×","15×","18×","20×"] },
  { id:13, name:"Roll-Aufschlag Rückhand diagonal",                        description:"Von 20 Aufschlägen im Ziel (diagonal)",    thresholds:["5×","10×","15×","18×","20×"] },
  { id:14, name:"Roll-Aufschlag Rückhand parallel",                        description:"Von 20 Aufschlägen im Ziel (parallel)",    thresholds:["5×","10×","15×","18×","20×"] },
  { id:15, name:"Roll-Aufschlag VH diagonal/parallel im Wechsel",          description:"VH diagonal/parallel im Wechsel",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:16, name:"Roll-Aufschlag RH diagonal/parallel im Wechsel",          description:"RH diagonal/parallel im Wechsel",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:17, name:"Roll-Aufschlag VH diagonal auf 6 Becher",                 description:"6 Becher mit VH diagonal räumen",          thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:18, name:"Roll-Aufschlag VH parallel auf 6 Becher",                 description:"6 Becher mit VH parallel räumen",          thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:19, name:"Roll-Aufschlag RH diagonal auf 6 Becher",                 description:"6 Becher mit RH diagonal räumen",          thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:20, name:"Roll-Aufschlag RH parallel auf 6 Becher",                 description:"6 Becher mit RH parallel räumen",          thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:21, name:"Unterschnitt-Aufschlag Vorhand diagonal",                  description:"US-Aufschlag VH diagonal (20)",            thresholds:["5×","10×","15×","18×","20×"] },
  { id:22, name:"Unterschnitt-Aufschlag Vorhand parallel",                  description:"US-Aufschlag VH parallel (20)",            thresholds:["5×","10×","15×","18×","20×"] },
  { id:23, name:"Unterschnitt-Aufschlag Rückhand diagonal",                 description:"US-Aufschlag RH diagonal (20)",            thresholds:["5×","10×","15×","18×","20×"] },
  { id:24, name:"Unterschnitt-Aufschlag Rückhand parallel",                 description:"US-Aufschlag RH parallel (20)",            thresholds:["5×","10×","15×","18×","20×"] },
  { id:25, name:"Unterschnitt-AS Vorhand diagonal / Ball zurück",           description:"Ball rollt nach US-AS zurück (20)",        thresholds:["5×","10×","15×","18×","20×"] },
  { id:26, name:"Unterschnitt-AS Vorhand parallel / Ball zurück",           description:"Ball rollt nach US-AS zurück (20)",        thresholds:["5×","10×","15×","18×","20×"] },
  { id:27, name:"Unterschnitt-AS Rückhand diagonal / Ball zurück",          description:"Ball rollt nach US-AS zurück (20)",        thresholds:["5×","10×","15×","18×","20×"] },
  { id:28, name:"Unterschnitt-AS Rückhand parallel / Ball zurück",          description:"Ball rollt nach US-AS zurück (20)",        thresholds:["5×","10×","15×","18×","20×"] },
  { id:29, name:"Vorhand Schupf diagonal",                                  description:"Schupf-Schläge korrekt (beide Spieler)",   thresholds:["10×","25×","50×","100×","200×"] },
  { id:30, name:"Rückhand Schupf diagonal",                                 description:"Schupf-Schläge korrekt (beide Spieler)",   thresholds:["10×","25×","50×","100×","200×"] },
  { id:31, name:"Vorhand Kontern diagonal",                                 description:"Konterschläge korrekt (beide Spieler)",    thresholds:["10×","25×","50×","100×","200×"] },
  { id:32, name:"Rückhand Kontern diagonal",                                description:"Konterschläge korrekt (beide Spieler)",    thresholds:["10×","25×","50×","100×","200×"] },
  { id:33, name:"Vorhand auf Rückhand Kontern parallel",                    description:"VH auf RH Kontern parallel",               thresholds:["10×","25×","50×","100×","200×"] },
  { id:34, name:"Rückhand auf Vorhand Kontern parallel",                    description:"RH auf VH Kontern parallel",               thresholds:["10×","25×","50×","100×","200×"] },
  { id:35, name:"Vorhand-Topspin diagonal auf Balleimer (Unterschnitt)",    description:"VH-Topspin diagonal auf US (20)",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:36, name:"Vorhand-Topspin parallel auf Balleimer (Unterschnitt)",    description:"VH-Topspin parallel auf US (20)",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:37, name:"Vorhand-Topspin diagonal/parallel Wechsel auf Balleimer",  description:"VH-Topspin dia/para Wechsel (20)",         thresholds:["5×","10×","15×","18×","20×"] },
  { id:38, name:"Rückhand-Topspin diagonal auf Balleimer (Unterschnitt)",   description:"RH-Topspin diagonal auf US (20)",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:39, name:"Rückhand-Topspin parallel auf Balleimer (Unterschnitt)",   description:"RH-Topspin parallel auf US (20)",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:40, name:"Rückhand-Topspin diagonal/parallel Wechsel auf Balleimer", description:"RH-Topspin dia/para Wechsel (20)",         thresholds:["5×","10×","15×","18×","20×"] },
];
const ALL_EXERCISES = [...EXERCISES_BEGINNER, ...EXERCISES_ADVANCED];

// ─── AWARDS ──────────────────────────────────────────────────────────────────
const BEGINNER_AWARDS = [
  { stars:10, label:"Bronze Anfänger",  emoji:"🥉", color:"#cd7f32", note:"" },
  { stars:25, label:"Silber Anfänger",  emoji:"🥈", color:"#b8b8b8", note:"" },
  { stars:40, label:"Gold Anfänger",    emoji:"🥇", color:"#ffd700", note:"→ Aufstieg!" },
  { stars:45, label:"Platin Anfänger",  emoji:"💎", color:"#7dd3e8", note:"" },
  { stars:50, label:"Diamant Anfänger", emoji:"💠", color:"#00bfff", note:"" },
];
const ADVANCED_AWARDS = [
  { stars:75,  label:"Bronze Fortgeschrittene",  emoji:"🥉", color:"#cd7f32", note:"" },
  { stars:100, label:"Silber Fortgeschrittene",  emoji:"🥈", color:"#b8b8b8", note:"" },
  { stars:125, label:"Gold Fortgeschrittene",    emoji:"🥇", color:"#ffd700", note:"" },
  { stars:150, label:"Platin Fortgeschrittene",  emoji:"💎", color:"#7dd3e8", note:"" },
  { stars:175, label:"Diamant Fortgeschrittene", emoji:"💠", color:"#00bfff", note:"" },
];

function getAward(player) {
  const bs = EXERCISES_BEGINNER.reduce((s,ex)=>s+(player.stars?.[ex.id]||0),0);
  const as = EXERCISES_ADVANCED.reduce((s,ex)=>s+(player.stars?.[ex.id]||0),0);
  const ts = bs + as;
  const isAdv = bs >= 40;
  let cur = null;
  if (isAdv) {
    for (const a of ADVANCED_AWARDS) if (as >= a.stars) cur = a;
    if (!cur) for (const a of BEGINNER_AWARDS) if (bs >= a.stars) cur = a;
  } else {
    for (const a of BEGINNER_AWARDS) if (bs >= a.stars) cur = a;
  }
  return { currentAward:cur, beginnerStars:bs, advancedStars:as, totalStars:ts, isAdvanced:isAdv };
}
function nextAward(player) {
  const { beginnerStars:bs, advancedStars:as, isAdvanced } = getAward(player);
  if (isAdvanced) {
    for (const a of ADVANCED_AWARDS) if (as < a.stars) return { ...a, needed: a.stars - as };
  } else {
    for (const a of BEGINNER_AWARDS) if (bs < a.stars) return { ...a, needed: a.stars - bs };
  }
  return null;
}

const PLAYER_COLORS = ["#10b981","#3b82f6","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#a3e635","#e879f9"];

// ─── UI COMPONENTS ───────────────────────────────────────────────────────────
function StarRating({ stars, onRate, readonly=false }) {
  const [hov, setHov] = useState(null);
  const disp = hov !== null ? hov : stars;
  return (
    <div style={{display:"flex",gap:3}}>
      {[1,2,3,4,5].map(v=>(
        <span key={v}
          onClick={()=>!readonly&&onRate&&onRate(v===stars?0:v)}
          onMouseEnter={()=>!readonly&&setHov(v)}
          onMouseLeave={()=>!readonly&&setHov(null)}
          style={{
            fontSize:readonly?17:22, cursor:readonly?"default":"pointer",
            color:v<=disp?"#f59e0b":"#374151",
            transition:"color .12s,transform .1s",
            transform:(!readonly&&hov===v)?"scale(1.3)":"scale(1)",
            userSelect:"none", display:"inline-block",
          }}>★</span>
      ))}
    </div>
  );
}
function AwardBadge({ award, small }) {
  if (!award) return null;
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",gap:4,
      background:award.color+"22",border:`1px solid ${award.color}88`,
      borderRadius:20,padding:small?"2px 8px":"4px 12px",
      fontSize:small?11:13,fontWeight:700,color:award.color,whiteSpace:"nowrap",
    }}>
      {award.emoji} {award.label}
      {award.note&&<span style={{fontSize:10,opacity:.8,marginLeft:2}}>{award.note}</span>}
    </span>
  );
}
function ProgressBar({ value, max, color }) {
  return (
    <div style={{background:"#1f2937",borderRadius:6,height:7,overflow:"hidden",width:"100%"}}>
      <div style={{
        width:`${Math.min(100,Math.round((value/max)*100))}%`,height:"100%",
        background:`linear-gradient(90deg,${color},${color}bb)`,
        borderRadius:6,transition:"width .5s cubic-bezier(.4,0,.2,1)",
      }}/>
    </div>
  );
}
function Avatar({ avatar, color, size=40 }) {
  return (
    <div style={{
      width:size,height:size,borderRadius:"50%",flexShrink:0,
      background:`${color}22`,border:`2px solid ${color}66`,
      display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:size*.5,userSelect:"none",
    }}>{avatar||"🏓"}</div>
  );
}

// ─── MODALS ──────────────────────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div style={{position:"fixed",inset:0,background:"#000b",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div style={{background:"#111827",border:"1px solid #374151",borderRadius:18,padding:22,maxWidth:400,width:"100%"}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function AvatarPicker({ current, onSelect, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{fontSize:16,fontWeight:800,marginBottom:14,color:"#e5e7eb"}}>Avatar wählen</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16}}>
        {AVATARS.map(av=>(
          <button key={av} onClick={()=>onSelect(av)} style={{
            background:av===current?"#10b98133":"#1f2937",
            border:`2px solid ${av===current?"#10b981":"#374151"}`,
            borderRadius:10,padding:"7px 3px",fontSize:24,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>{av}</button>
        ))}
      </div>
      <button onClick={onClose} style={{width:"100%",padding:10,background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:14,fontWeight:600,cursor:"pointer"}}>Schließen</button>
    </Modal>
  );
}
function DeleteConfirm({ name, onConfirm, onCancel }) {
  return (
    <Modal onClose={onCancel}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>🗑️</div>
        <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:8}}>Spieler löschen?</div>
        <div style={{fontSize:13,color:"#9ca3af",marginBottom:20}}><b style={{color:"#e5e7eb"}}>{name}</b> und alle Ergebnisse werden dauerhaft gelöscht.</div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:10,background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:14,fontWeight:600,cursor:"pointer"}}>Abbrechen</button>
          <button onClick={onConfirm} style={{flex:1,padding:10,background:"linear-gradient(135deg,#ef4444,#dc2626)",border:"none",borderRadius:9,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Löschen</button>
        </div>
      </div>
    </Modal>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, error, loading, successMessage }) {
  const [email,       setEmail]       = useState("");
  const [pass,        setPass]        = useState("");
  const [resetMode,   setResetMode]   = useState(false);
  const [resetEmail,  setResetEmail]  = useState("");
  const [resetSent,   setResetSent]   = useState(false);
  const [resetErr,    setResetErr]    = useState("");
  const [resetLoading,setResetLoading]= useState(false);

  async function handlePasswordReset() {
    if (!resetEmail.trim()) { setResetErr("Bitte E-Mail eingeben."); return; }
    setResetLoading(true); setResetErr("");
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetSent(true);
    } catch(e) {
      if (e.code==="auth/user-not-found"||e.code==="auth/invalid-credential")
        setResetErr("Kein Konto mit dieser E-Mail gefunden.");
      else if (e.code==="auth/invalid-email")
        setResetErr("Ungültige E-Mail-Adresse.");
      else
        setResetErr("Fehler: " + e.message);
    }
    setResetLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{maxWidth:360,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:56,marginBottom:12}}>🏓</div>
          <div style={{fontSize:22,fontWeight:800,color:"#e5e7eb",letterSpacing:"-0.02em"}}>TTC Niederzeuzheim</div>
          <div style={{fontSize:13,color:"#6b7280",marginTop:4}}>Nachwuchs Trainingsheft</div>
        </div>

        {/* ── LOGIN ── */}
        {!resetMode && (
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
            <div style={{fontSize:15,fontWeight:700,color:"#e5e7eb",marginBottom:18}}>Anmelden</div>
            {successMessage&&<div style={{background:"#10b98122",border:"1px solid #10b98166",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#10b981",marginBottom:14}}>✅ {successMessage}</div>}
            {error&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:14}}>{error}</div>}
            <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>E-Mail</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="deine@email.de"
              style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:12}}/>
            <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>Passwort</label>
            <input type="password" value={pass} onChange={e=>setPass(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e=>e.key==="Enter"&&onLogin(email,pass)}
              style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:18}}/>
            <button onClick={()=>onLogin(email,pass)} disabled={loading||!email||!pass} style={{
              width:"100%",padding:12,
              background:(!email||!pass||loading)?"#1f2937":"linear-gradient(135deg,#10b981,#059669)",
              border:"none",borderRadius:9,
              color:(!email||!pass||loading)?"#6b7280":"#fff",
              fontSize:15,fontWeight:700,
              cursor:(!email||!pass||loading)?"not-allowed":"pointer",transition:"all .2s",
            }}>{loading?"Anmelden…":"Anmelden"}</button>

            {/* Passwort vergessen Link */}
            <button onClick={()=>{ setResetMode(true); setResetEmail(email); }} style={{
              width:"100%",marginTop:12,padding:"8px",
              background:"transparent",border:"none",
              color:"#6b7280",fontSize:13,cursor:"pointer",
              textDecoration:"underline",
            }}>🔑 Passwort vergessen?</button>
          </div>
        )}

        {/* ── PASSWORT ZURÜCKSETZEN ── */}
        {resetMode && (
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
            {!resetSent ? (
              <>
                <div style={{fontSize:15,fontWeight:700,color:"#e5e7eb",marginBottom:6}}>🔑 Passwort zurücksetzen</div>
                <div style={{fontSize:13,color:"#6b7280",marginBottom:18,lineHeight:1.5}}>
                  Gib deine E-Mail-Adresse ein. Du bekommst einen Link zum Zurücksetzen zugeschickt.
                </div>
                {resetErr&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:14}}>{resetErr}</div>}
                <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>E-Mail</label>
                <input type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)}
                  placeholder="deine@email.de"
                  onKeyDown={e=>e.key==="Enter"&&handlePasswordReset()}
                  style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:15,outline:"none",boxSizing:"border-box",marginBottom:16}}/>
                <button onClick={handlePasswordReset} disabled={resetLoading||!resetEmail.trim()} style={{
                  width:"100%",padding:12,
                  background:(resetLoading||!resetEmail.trim())?"#1f2937":"linear-gradient(135deg,#3b82f6,#2563eb)",
                  border:"none",borderRadius:9,
                  color:(resetLoading||!resetEmail.trim())?"#6b7280":"#fff",
                  fontSize:15,fontWeight:700,
                  cursor:(resetLoading||!resetEmail.trim())?"not-allowed":"pointer",
                  marginBottom:10,
                }}>{resetLoading?"Wird gesendet…":"Reset-E-Mail senden"}</button>
                <button onClick={()=>{ setResetMode(false); setResetErr(""); }} style={{
                  width:"100%",padding:10,background:"transparent",border:"1px solid #374151",
                  borderRadius:9,color:"#6b7280",fontSize:13,cursor:"pointer",
                }}>← Zurück zur Anmeldung</button>
              </>
            ) : (
              <>
                <div style={{textAlign:"center",padding:"10px 0"}}>
                  <div style={{fontSize:48,marginBottom:14}}>📬</div>
                  <div style={{fontSize:16,fontWeight:800,color:"#e5e7eb",marginBottom:8}}>E-Mail gesendet!</div>
                  <div style={{fontSize:13,color:"#9ca3af",marginBottom:20,lineHeight:1.6}}>
                    Wir haben eine E-Mail an<br/>
                    <b style={{color:"#10b981"}}>{resetEmail}</b><br/>
                    gesendet. Bitte prüfe dein Postfach und klicke auf den Link.
                  </div>
                  <button onClick={()=>{ setResetMode(false); setResetSent(false); setResetErr(""); }} style={{
                    width:"100%",padding:12,
                    background:"linear-gradient(135deg,#10b981,#059669)",
                    border:"none",borderRadius:9,color:"#fff",
                    fontSize:14,fontWeight:700,cursor:"pointer",
                  }}>← Zurück zur Anmeldung</button>
                </div>
              </>
            )}
          </div>
        )}

        <div style={{textAlign:"center",fontSize:12,color:"#4b5563",marginTop:16}}>
          Noch kein Konto? Wende dich an deinen Trainer.
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
function AdminPanel({ user, players, onSignOut, onPlayerAdded }) {
  const [activeTab, setActiveTab]           = useState("players");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [exerciseFilter, setExerciseFilter] = useState("all");
  const [expandedEx, setExpandedEx]         = useState(null);
  const [avatarPickerFor, setAvatarPickerFor] = useState(null);
  const [deleteConfirmFor, setDeleteConfirmFor] = useState(null);
  const [newName,    setNewName]    = useState("");
  const [newAvatar,  setNewAvatar]  = useState("🏓");
  const [newEmail,   setNewEmail]   = useState("");
  const [newPass,    setNewPass]    = useState("");
  const [noEmail,    setNoEmail]    = useState(false); // kein eigenes Login
  const [toast,      setToast]      = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [userError,  setUserError]  = useState("");

  const curPlayer = players.find(p=>p.id===selectedPlayer) || players[0];
  const sortedRanking = [...players].sort((a,b)=>getAward(b).totalStars-getAward(a).totalStars);
  const filteredEx = exerciseFilter==="beginner"?EXERCISES_BEGINNER:exerciseFilter==="advanced"?EXERCISES_ADVANCED:ALL_EXERCISES;

  function showToast(msg,emoji="✅") {
    setToast({msg,emoji});
    setTimeout(()=>setToast(null),2200);
  }

  async function setStars(playerId, exId, value) {
    setSaving(true);
    try {
      await updateDoc(doc(db,"players",String(playerId)), { [`stars.${exId}`]: value });
      showToast("Gespeichert","💾");
    } catch(e) { showToast("Fehler beim Speichern","❌"); }
    setSaving(false);
  }

  async function addPlayer() {
    if (!newName.trim()) return;
    setAddingUser(true); setUserError("");
    const color = PLAYER_COLORS[players.length % PLAYER_COLORS.length];

    try {
      let newUid     = null;
      let finalEmail = null;

      // E-Mail und Passwort bestimmen
      if (noEmail) {
        const safeName = newName.trim()
          .toLowerCase()
          .replace(/\s+/g, ".")
          .replace(/[^a-z0-9.]/g, "") || "spieler";
        const rand = Math.random().toString(36).slice(2, 8);
        finalEmail = `${safeName}.${rand}@ttc-intern.de`;
        const dummyPass = "Tt" + Math.random().toString(36).slice(2,12) + "1!";
        const { user: newUser } = await createUserWithEmailAndPassword(auth, finalEmail, dummyPass);
        newUid = newUser.uid;
      } else {
        if (!newEmail.trim() || !newPass.trim()) {
          setUserError("Bitte E-Mail und Passwort eingeben.");
          setAddingUser(false); return;
        }
        finalEmail = newEmail.trim();
        const { user: newUser } = await createUserWithEmailAndPassword(auth, finalEmail, newPass.trim());
        newUid = newUser.uid;
      }

      // Firestore-Eintrag anlegen — funktioniert jetzt weil die Regel
      // "allow create: if isLoggedIn() && request.auth.uid == playerId" greift
      await setDoc(doc(db, "players", newUid), {
        id:        newUid,
        name:      newName.trim(),
        email:     finalEmail,
        noLogin:   noEmail,
        color,
        avatar:    newAvatar,
        stars:     {},
        createdAt: Date.now(),
      });

      // Formular zurücksetzen
      setNewName(""); setNewEmail(""); setNewPass("");
      setNewAvatar("🏓"); setNoEmail(false);
      showToast(`${newName.trim()} hinzugefügt!`, "🎉");

      // Erfolgsmeldung setzen, dann Trainer ausloggen
      // → Login-Bildschirm zeigt grüne Meldung damit Trainer weiß warum
      if (onPlayerAdded) onPlayerAdded(newName.trim());
      await signOut(auth);

    } catch(e) {
      if (e.code === "auth/email-already-in-use")
        setUserError("Diese E-Mail wird bereits verwendet.");
      else if (e.code === "auth/weak-password")
        setUserError("Passwort muss mindestens 6 Zeichen haben.");
      else
        setUserError("Fehler: " + e.message);
    }
    setAddingUser(false);
  }

  async function doDelete(id) {
    try {
      await deleteDoc(doc(db,"players",String(id)));
      showToast("Spieler gelöscht","🗑️");
      if (selectedPlayer===id) setSelectedPlayer(null);
    } catch(e) { showToast("Fehler","❌"); }
    setDeleteConfirmFor(null);
  }

  async function changeAvatar(playerId, av) {
    await updateDoc(doc(db,"players",String(playerId)), { avatar: av });
    setAvatarPickerFor(null);
  }

  const TABS = [
    {key:"players",  label:"Training",  icon:"🏋️"},
    {key:"ranking",  label:"Rangliste", icon:"🏆"},
    {key:"battle",   label:"Battle",    icon:"⚔️"},
    {key:"addPlayer",label:"+ Spieler", icon:"➕"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#0d1117",color:"#e5e7eb",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:720,margin:"0 auto",paddingBottom:80}}>
      {/* Modals */}
      {avatarPickerFor&&<AvatarPicker current={players.find(p=>p.id===avatarPickerFor)?.avatar||"🏓"} onSelect={av=>changeAvatar(avatarPickerFor,av)} onClose={()=>setAvatarPickerFor(null)}/>}
      {deleteConfirmFor&&<DeleteConfirm name={deleteConfirmFor.name} onConfirm={()=>doDelete(deleteConfirmFor.id)} onCancel={()=>setDeleteConfirmFor(null)}/>}
      {toast&&(
        <div style={{position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",background:"#1f2937",border:"1px solid #374151",borderRadius:12,padding:"10px 20px",display:"flex",alignItems:"center",gap:8,fontSize:15,fontWeight:600,zIndex:400,boxShadow:"0 8px 32px #0008",animation:"fadeIn .2s ease"}}>
          <span style={{fontSize:20}}>{toast.emoji}</span>{toast.msg}
        </div>
      )}

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
            {saving&&<span style={{fontSize:11,color:"#f59e0b"}}>💾 Speichert…</span>}
            <button onClick={onSignOut} style={{padding:"5px 10px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer"}}>Abmelden</button>
          </div>
        </div>
        {/* Player chips */}
        <div style={{display:"flex",gap:5,overflowX:"auto",paddingBottom:2}}>
          {players.map(p=>(
            <button key={p.id} onClick={()=>{setSelectedPlayer(p.id);setActiveTab("players");}} style={{
              flexShrink:0,padding:"3px 9px 3px 5px",borderRadius:20,
              border:`2px solid ${selectedPlayer===p.id||(!selectedPlayer&&curPlayer?.id===p.id)?p.color:"#374151"}`,
              background:(selectedPlayer===p.id||(!selectedPlayer&&curPlayer?.id===p.id))?p.color+"22":"transparent",
              color:(selectedPlayer===p.id||(!selectedPlayer&&curPlayer?.id===p.id))?p.color:"#9ca3af",
              fontSize:12,fontWeight:600,cursor:"pointer",
              display:"flex",alignItems:"center",gap:4,
            }}>
              <span style={{fontSize:14}}>{p.avatar||"🏓"}</span>{p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #1f2937",background:"#0d1117",position:"sticky",top:100,zIndex:99}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{
            flex:1,padding:"10px 0",background:"transparent",border:"none",
            borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,
            color:activeTab===t.key?"#10b981":"#6b7280",
            fontSize:11,fontWeight:600,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:4,
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* ── TRAINING TAB ── */}
      {activeTab==="players"&&curPlayer&&(()=>{
        const {currentAward,beginnerStars,advancedStars,totalStars,isAdvanced}=getAward(curPlayer);
        const next=nextAward(curPlayer);
        return (
          <div style={{padding:"13px 13px 0"}}>
            {/* Player card */}
            <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",border:`1px solid ${curPlayer.color}44`,borderRadius:14,padding:14,marginBottom:13}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
                <div style={{position:"relative",flexShrink:0}}>
                  <Avatar avatar={curPlayer.avatar} color={curPlayer.color} size={50}/>
                  <button onClick={()=>setAvatarPickerFor(curPlayer.id)} style={{position:"absolute",bottom:-2,right:-2,width:20,height:20,borderRadius:"50%",background:"#1f2937",border:"1px solid #374151",fontSize:10,cursor:"pointer",color:"#9ca3af",display:"flex",alignItems:"center",justifyContent:"center"}}>✏️</button>
                </div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div>
                      <div style={{fontSize:17,fontWeight:800,color:curPlayer.color}}>{curPlayer.name}</div>
                      <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · {totalStars} Sterne</div>
                    </div>
                    {currentAward?<AwardBadge award={currentAward} small/>:<span style={{fontSize:11,color:"#6b7280"}}>Noch keine Urkunde</span>}
                  </div>
                </div>
              </div>
              <div style={{marginBottom:7}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Anfänger (1–10)</span><span>{beginnerStars}/50 ★</span></div>
                <ProgressBar value={beginnerStars} max={50} color={curPlayer.color}/>
              </div>
              <div style={{marginBottom:next?10:0}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#9ca3af",marginBottom:3}}><span>Fortgeschrittene (11–40)</span><span>{advancedStars}/150 ★</span></div>
                <ProgressBar value={advancedStars} max={150} color="#3b82f6"/>
              </div>
              {next&&<div style={{background:"#0d1117",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                Nächste Urkunde: <AwardBadge award={next} small/> — noch <b style={{color:"#e5e7eb"}}>{next.needed} Sterne</b>
              </div>}
            </div>
            {/* Filter */}
            <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
              {[{key:"all",label:"Alle (40)"},{key:"beginner",label:"Anfänger"},{key:"advanced",label:"Fortgeschrittene"}].map(f=>(
                <button key={f.key} onClick={()=>setExerciseFilter(f.key)} style={{padding:"4px 11px",borderRadius:20,border:`1px solid ${exerciseFilter===f.key?"#10b981":"#374151"}`,background:exerciseFilter===f.key?"#10b98122":"transparent",color:exerciseFilter===f.key?"#10b981":"#6b7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>{f.label}</button>
              ))}
            </div>
            {/* Exercises */}
            <div style={{display:"flex",flexDirection:"column",gap:7,paddingBottom:20}}>
              {filteredEx.map(ex=>{
                const stars=curPlayer.stars?.[ex.id]||0;
                const isExp=expandedEx===ex.id;
                const isBeg=ex.id<=10;
                return (
                  <div key={ex.id} style={{background:"#111827",border:`1px solid ${stars>0?"#2d3748":"#1f2937"}`,borderRadius:11,overflow:"hidden"}}>
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
                    {isExp&&(
                      <div style={{borderTop:"1px solid #1f2937",padding:13,background:"#0d1117"}}>
                        <div style={{marginBottom:11,fontSize:12,color:"#9ca3af"}}>⚙️ Trainer: Sterne vergeben</div>
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── RANGLISTE ── */}
      {activeTab==="ranking"&&(
        <div style={{padding:13}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>🏆 Rangliste</div>
          {sortedRanking.map((player,idx)=>{
            const {currentAward,beginnerStars,advancedStars,totalStars,isAdvanced}=getAward(player);
            const next=nextAward(player);
            const rankEmoji=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
            return (
              <div key={player.id} style={{background:"#111827",border:`1px solid ${idx===0?"#f59e0b55":"#1f2937"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
                {idx===0&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#f59e0b,#fbbf24)"}}/>}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <span style={{fontSize:18,minWidth:28}}>{rankEmoji}</span>
                  <Avatar avatar={player.avatar} color={player.color} size={38}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                      <span style={{fontSize:14,fontWeight:800,color:"#e5e7eb"}}>{player.name}</span>
                      {currentAward&&<AwardBadge award={currentAward} small/>}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280",marginTop:1}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · {totalStars} Sterne</div>
                  </div>
                  <button onClick={()=>setDeleteConfirmFor(player)} style={{background:"transparent",border:"1px solid #374151",borderRadius:7,color:"#6b7280",fontSize:13,cursor:"pointer",padding:"4px 8px"}}>🗑️</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:9}}>
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
                <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                  {ALL_EXERCISES.map(ex=>{const s=player.stars?.[ex.id]||0;const isBeg=ex.id<=10;return(
                    <div key={ex.id} title={`Ü${ex.id}: ${ex.name} – ${s}★`} style={{width:15,height:15,borderRadius:3,background:s===0?"#1f2937":s===5?"#f59e0b":s>=3?"#10b981":"#6b7280",opacity:s===0?.3:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:"#000",border:`1px solid ${isBeg?"#10b98122":"#3b82f622"}`}}>{s>0?s:""}</div>
                  );})}
                </div>
                {next&&<div style={{marginTop:9,fontSize:11,color:"#6b7280",display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>Nächstes Ziel: <AwardBadge award={next} small/> — noch {next.needed} Sterne</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* ── BATTLE ── */}
      {activeTab==="battle"&&(
        <div style={{padding:13}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>⚔️ Battle</div>
          <div style={{fontSize:12,color:"#6b7280",marginBottom:18}}>Alle Spieler im Vergleich</div>
          {sortedRanking.length>=2&&(
            <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",border:"1px solid #1f2937",borderRadius:14,padding:16,marginBottom:14}}>
              <div style={{fontSize:11,color:"#6b7280",fontWeight:600,marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>Podium</div>
              <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:8}}>
                {[sortedRanking[1],sortedRanking[0],sortedRanking[2]].map((p,i)=>{
                  if(!p)return<div key={i} style={{flex:1}}/>;
                  const {totalStars,currentAward}=getAward(p);
                  const h=[70,100,55][i]; const medal=["🥈","🥇","🥉"][i];
                  return(
                    <div key={p.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                      <Avatar avatar={p.avatar} color={p.color} size={i===1?44:34}/>
                      <span style={{fontSize:10,color:i===1?"#e5e7eb":"#9ca3af",fontWeight:i===1?800:600,textAlign:"center"}}>{p.name}</span>
                      {currentAward&&<AwardBadge award={currentAward} small/>}
                      <div style={{width:"100%",background:p.color+(i===1?"44":"33"),border:`2px solid ${p.color+(i===1?"":"66")}`,borderRadius:"8px 8px 0 0",height:h,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",boxShadow:i===1?`0 0 20px ${p.color}44`:"none"}}>
                        <div style={{fontSize:i===1?26:20}}>{medal}</div>
                        <div style={{fontSize:i===1?22:16,fontWeight:900,color:p.color}}>{totalStars}</div>
                        <div style={{fontSize:9,color:"#6b7280"}}>Sterne</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{height:6,background:"#1f2937",borderRadius:"0 0 6px 6px"}}/>
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {sortedRanking.map((player,idx)=>{
              const {totalStars,beginnerStars,advancedStars,currentAward}=getAward(player);
              const leaderStars=getAward(sortedRanking[0]).totalStars;
              const barPct=leaderStars>0?Math.round((totalStars/leaderStars)*100):0;
              const rankLabel=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
              return(
                <div key={player.id} style={{background:"#111827",border:`1px solid ${idx===0?player.color+"77":"#1f2937"}`,borderRadius:12,padding:"12px 13px",display:"flex",alignItems:"center",gap:11,position:"relative",overflow:"hidden"}}>
                  {idx===0&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:player.color,borderRadius:"3px 0 0 3px"}}/>}
                  <div style={{width:34,height:34,flexShrink:0,borderRadius:9,background:idx<3?player.color+"22":"#1f2937",border:`1.5px solid ${idx<3?player.color+"66":"#374151"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:idx<3?17:12,fontWeight:800,color:idx<3?"inherit":"#9ca3af"}}>{rankLabel}</div>
                  <Avatar avatar={player.avatar} color={player.color} size={36}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:800,color:"#e5e7eb"}}>{player.name}</span>
                      {currentAward&&<AwardBadge award={currentAward} small/>}
                    </div>
                    <div style={{background:"#1f2937",borderRadius:6,height:9,overflow:"hidden",marginBottom:4}}>
                      <div style={{width:`${barPct}%`,height:"100%",background:`linear-gradient(90deg,${player.color},#3b82f6)`,borderRadius:6,transition:"width .6s"}}/>
                    </div>
                    <div style={{display:"flex",gap:10,fontSize:10,color:"#6b7280"}}>
                      <span>A: <b style={{color:player.color}}>{beginnerStars}</b></span>
                      <span>F: <b style={{color:"#3b82f6"}}>{advancedStars}</b></span>
                    </div>
                  </div>
                  <div style={{flexShrink:0,textAlign:"center",background:"#0d1117",borderRadius:10,padding:"6px 11px",border:`1px solid ${player.color}44`}}>
                    <div style={{fontSize:20,fontWeight:900,color:player.color,lineHeight:1}}>{totalStars}</div>
                    <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>★ gesamt</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ADD PLAYER ── */}
      {activeTab==="addPlayer"&&(
        <div style={{padding:18}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:18}}>➕ Neuen Spieler anlegen</div>
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:14,padding:18,marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"#e5e7eb",marginBottom:14}}>Spieler-Konto erstellen</div>
            {userError&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{userError}</div>}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:6}}>Avatar</label>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:50,height:50,borderRadius:"50%",background:"#10b98122",border:"2px solid #10b98166",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>{newAvatar}</div>
                <button onClick={()=>setAvatarPickerFor("__new__")} style={{padding:"7px 14px",background:"#1f2937",border:"1px solid #374151",borderRadius:9,color:"#9ca3af",fontSize:13,fontWeight:600,cursor:"pointer"}}>Wählen ✏️</button>
              </div>
            </div>

            {/* Name */}
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>Name</label>
              <input type="text" value={newName} onChange={e=>setNewName(e.target.value)}
                placeholder="Max Mustermann"
                style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
            </div>

            {/* Toggle: eigener Login oder nicht */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:8}}>Login-Typ</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button onClick={()=>setNoEmail(false)} style={{
                  padding:"10px 8px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                  border:`2px solid ${!noEmail?"#10b981":"#374151"}`,
                  background:!noEmail?"#10b98122":"#1f2937",
                  color:!noEmail?"#10b981":"#6b7280",
                }}>
                  📧 Mit eigenem Login<br/>
                  <span style={{fontSize:10,fontWeight:400,opacity:.7}}>Spieler kann sich selbst anmelden</span>
                </button>
                <button onClick={()=>setNoEmail(true)} style={{
                  padding:"10px 8px",borderRadius:9,fontSize:12,fontWeight:700,cursor:"pointer",
                  border:`2px solid ${noEmail?"#f59e0b":"#374151"}`,
                  background:noEmail?"#f59e0b22":"#1f2937",
                  color:noEmail?"#f59e0b":"#6b7280",
                }}>
                  👤 Ohne Login<br/>
                  <span style={{fontSize:10,fontWeight:400,opacity:.7}}>Nur Trainer trägt Ergebnisse ein</span>
                </button>
              </div>
            </div>

            {/* E-Mail + Passwort — nur wenn Login gewünscht */}
            {!noEmail && (
              <>
                <div style={{marginBottom:12}}>
                  <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>E-Mail</label>
                  <input type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)}
                    placeholder="spieler@email.de"
                    style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:"#9ca3af",display:"block",marginBottom:5}}>Passwort</label>
                  <input type="password" value={newPass} onChange={e=>setNewPass(e.target.value)}
                    placeholder="Mindestens 6 Zeichen"
                    style={{width:"100%",padding:"11px 13px",background:"#0d1117",border:"1px solid #374151",borderRadius:9,color:"#e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                </div>
              </>
            )}

            {/* Hinweis bei kein Login */}
            {noEmail && (
              <div style={{background:"#f59e0b11",border:"1px solid #f59e0b33",borderRadius:9,padding:"10px 12px",marginBottom:14,fontSize:12,color:"#f59e0b",lineHeight:1.6}}>
                👤 Dieser Spieler bekommt keinen Login.<br/>
                <span style={{color:"#9ca3af"}}>Er erscheint in Rangliste & Battle, kann sich aber nicht selbst anmelden. Nur du als Trainer kannst seine Sterne eintragen.</span>
              </div>
            )}

            {userError&&<div style={{background:"#ef444422",border:"1px solid #ef444466",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fca5a5",marginBottom:12}}>{userError}</div>}

            <button onClick={addPlayer}
              disabled={addingUser||!newName.trim()||(!noEmail&&(!newEmail.trim()||!newPass.trim()))}
              style={{
                width:"100%",padding:11,
                background:(addingUser||!newName.trim()||(!noEmail&&(!newEmail.trim()||!newPass.trim())))
                  ?"#1f2937"
                  :`linear-gradient(135deg,${noEmail?"#f59e0b,#d97706":"#10b981,#059669"})`,
                border:"none",borderRadius:9,
                color:(addingUser||!newName.trim()||(!noEmail&&(!newEmail.trim()||!newPass.trim())))?"#6b7280":"#fff",
                fontSize:14,fontWeight:700,
                cursor:(addingUser||!newName.trim()||(!noEmail&&(!newEmail.trim()||!newPass.trim())))?"not-allowed":"pointer",
              }}>
              {addingUser?"Wird erstellt…": noEmail?"👤 Spieler ohne Login anlegen":"📧 Spieler-Konto erstellen"}
            </button>

            <div style={{fontSize:11,color:"#6b7280",marginTop:10,lineHeight:1.5}}>
              {noEmail
                ? "ℹ️ Der Spieler wird in der Rangliste angezeigt, kann sich aber nicht einloggen."
                : "ℹ️ Der Spieler kann sich mit dieser E-Mail & Passwort selbst anmelden."}
            </div>
          </div>
          {players.length>0&&(
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#9ca3af",marginBottom:10}}>Alle Spieler ({players.length})</div>
              {players.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:9,background:"#111827",border:"1px solid #1f2937",borderRadius:10,padding:"9px 13px",marginBottom:6}}>
                  <span style={{fontSize:18}}>{p.avatar||"🏓"}</span>
                  <span style={{width:8,height:8,borderRadius:"50%",background:p.color,display:"inline-block",flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:"#e5e7eb"}}>{p.name}</div>
                    <div style={{fontSize:10,color:"#6b7280",marginTop:1,display:"flex",alignItems:"center",gap:4}}>
                      {p.noLogin
                        ? <span style={{color:"#f59e0b"}}>👤 Kein Login</span>
                        : <span style={{color:"#10b981"}}>📧 {p.email}</span>
                      }
                    </div>
                  </div>
                  <span style={{fontSize:12,color:"#6b7280",flexShrink:0}}>{getAward(p).totalStars} ★</span>
                  <button onClick={()=>setAvatarPickerFor(p.id)} style={{background:"transparent",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14}}>✏️</button>
                  <button onClick={()=>setDeleteConfirmFor(p)} style={{background:"transparent",border:"none",color:"#6b7280",cursor:"pointer",fontSize:14}}>🗑️</button>
                </div>
              ))}
            </div>
          )}
          {/* Special avatar picker for new player */}
          {avatarPickerFor==="__new__"&&<AvatarPicker current={newAvatar} onSelect={av=>{setNewAvatar(av);setAvatarPickerFor(null);}} onClose={()=>setAvatarPickerFor(null)}/>}
        </div>
      )}

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0d1117}
        ::-webkit-scrollbar-thumb{background:#374151;border-radius:4px}
        input::placeholder{color:#4b5563}
      `}</style>
    </div>
  );
}

// ─── PLAYER VIEW (read-only) ──────────────────────────────────────────────────
function PlayerView({ user, players, onSignOut }) {
  const myPlayer = players.find(p=>p.email===user.email);
  const sortedRanking = [...players].sort((a,b)=>getAward(b).totalStars-getAward(a).totalStars);
  const [activeTab, setActiveTab] = useState("meine");

  if (!myPlayer) return (
    <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:16}}>
      <div style={{fontSize:40}}>⏳</div>
      <div style={{fontSize:16,fontWeight:700,color:"#e5e7eb",textAlign:"center"}}>Dein Trainerprofil wird noch eingerichtet.</div>
      <div style={{fontSize:13,color:"#6b7280",textAlign:"center"}}>Bitte wende dich an deinen Trainer.</div>
      <button onClick={onSignOut} style={{padding:"8px 16px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:13,cursor:"pointer"}}>Abmelden</button>
    </div>
  );

  const {currentAward,beginnerStars,advancedStars,totalStars,isAdvanced}=getAward(myPlayer);
  const next=nextAward(myPlayer);
  const myRank=sortedRanking.findIndex(p=>p.id===myPlayer.id)+1;

  const TABS=[{key:"meine",label:"Meine Stats",icon:"⭐"},{key:"ranking",label:"Rangliste",icon:"🏆"},{key:"battle",label:"Battle",icon:"⚔️"}];

  return (
    <div style={{minHeight:"100vh",background:"#0d1117",color:"#e5e7eb",fontFamily:"'Segoe UI',system-ui,sans-serif",maxWidth:680,margin:"0 auto",paddingBottom:80}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#111827,#1a2332)",borderBottom:"1px solid #1f2937",padding:"14px 14px 12px",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={42}/>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:myPlayer.color}}>{myPlayer.name}</div>
              <div style={{fontSize:11,color:"#6b7280"}}>TTC Niederzeuzheim · Rang #{myRank}</div>
            </div>
          </div>
          <button onClick={onSignOut} style={{padding:"5px 10px",background:"#1f2937",border:"1px solid #374151",borderRadius:8,color:"#9ca3af",fontSize:12,cursor:"pointer"}}>Abmelden</button>
        </div>
      </div>
      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid #1f2937",background:"#0d1117",position:"sticky",top:70,zIndex:99}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)} style={{flex:1,padding:"11px 0",background:"transparent",border:"none",borderBottom:`2px solid ${activeTab===t.key?"#10b981":"transparent"}`,color:activeTab===t.key?"#10b981":"#6b7280",fontSize:13,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── MEINE STATS ── */}
      {activeTab==="meine"&&(
        <div style={{padding:14}}>
          {/* Summary */}
          <div style={{background:`linear-gradient(135deg,${myPlayer.color}11,#111827)`,border:`1px solid ${myPlayer.color}44`,borderRadius:16,padding:18,marginBottom:16,textAlign:"center"}}>
            <Avatar avatar={myPlayer.avatar} color={myPlayer.color} size={64} />
            <div style={{fontSize:22,fontWeight:900,color:myPlayer.color,marginTop:12}}>{myPlayer.name}</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · Rang #{myRank} von {players.length}</div>
            {currentAward&&<div style={{marginBottom:12}}><AwardBadge award={currentAward}/></div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
              {[
                {label:"Gesamt",val:totalStars,color:myPlayer.color},
                {label:"Anfänger",val:beginnerStars,color:"#10b981"},
                {label:"Fortgeschr.",val:advancedStars,color:"#3b82f6"},
              ].map(s=>(
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
            {next&&<div style={{marginTop:12,background:"#0d1117",borderRadius:8,padding:"8px 12px",fontSize:12,color:"#9ca3af",display:"flex",alignItems:"center",justifyContent:"center",gap:6,flexWrap:"wrap"}}>
              Nächste Urkunde: <AwardBadge award={next} small/> — noch {next.needed} Sterne
            </div>}
          </div>
          {/* Exercise overview — read only */}
          <div style={{fontSize:14,fontWeight:700,marginBottom:10,color:"#e5e7eb"}}>Meine Übungen</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,paddingBottom:20}}>
            {ALL_EXERCISES.map(ex=>{
              const stars=myPlayer.stars?.[ex.id]||0;
              const isBeg=ex.id<=10;
              return(
                <div key={ex.id} style={{background:"#111827",border:`1px solid ${stars>0?"#2d3748":"#1f2937"}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:26,height:26,borderRadius:6,flexShrink:0,background:isBeg?"#10b98122":"#3b82f622",border:`1px solid ${isBeg?"#10b98144":"#3b82f644"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:isBeg?"#10b981":"#3b82f6"}}>{ex.id}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#e5e7eb",lineHeight:1.4,wordBreak:"break-word"}}>{ex.name}</div>
                  </div>
                  <StarRating stars={stars} readonly/>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── RANGLISTE (player view) ── */}
      {activeTab==="ranking"&&(
        <div style={{padding:14}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:14}}>🏆 Rangliste</div>
          {sortedRanking.map((player,idx)=>{
            const {currentAward,totalStars,beginnerStars,advancedStars,isAdvanced}=getAward(player);
            const isMe=player.id===myPlayer.id;
            const rankEmoji=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
            return(
              <div key={player.id} style={{background:isMe?"#10b98111":"#111827",border:`2px solid ${isMe?myPlayer.color+"88":idx===0?"#f59e0b44":"#1f2937"}`,borderRadius:14,padding:14,marginBottom:9,position:"relative",overflow:"hidden"}}>
                {isMe&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:myPlayer.color}}/>}
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18,minWidth:28}}>{rankEmoji}</span>
                  <Avatar avatar={player.avatar} color={player.color} size={36}/>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                      <span style={{fontSize:14,fontWeight:800,color:isMe?myPlayer.color:"#e5e7eb"}}>{player.name}{isMe&&" (Du)"}</span>
                      {currentAward&&<AwardBadge award={currentAward} small/>}
                    </div>
                    <div style={{fontSize:11,color:"#6b7280"}}>{isAdvanced?"Fortgeschrittene":"Anfänger"} · {totalStars} Sterne</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── BATTLE (player view) ── */}
      {activeTab==="battle"&&(
        <div style={{padding:14}}>
          <div style={{fontSize:17,fontWeight:800,marginBottom:4}}>⚔️ Battle</div>
          <div style={{fontSize:12,color:"#6b7280",marginBottom:18}}>Wer hat die meisten Sterne?</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {sortedRanking.map((player,idx)=>{
              const {totalStars,beginnerStars,advancedStars,currentAward}=getAward(player);
              const leaderStars=getAward(sortedRanking[0]).totalStars;
              const barPct=leaderStars>0?Math.round((totalStars/leaderStars)*100):0;
              const rankLabel=idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`#${idx+1}`;
              const isMe=player.id===myPlayer.id;
              return(
                <div key={player.id} style={{background:isMe?"#10b98111":"#111827",border:`2px solid ${isMe?myPlayer.color+"88":"#1f2937"}`,borderRadius:12,padding:"12px 13px",display:"flex",alignItems:"center",gap:11,position:"relative",overflow:"hidden"}}>
                  <div style={{width:32,height:32,flexShrink:0,borderRadius:9,background:idx<3?player.color+"22":"#1f2937",border:`1.5px solid ${idx<3?player.color+"66":"#374151"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:idx<3?16:11,fontWeight:800}}>{rankLabel}</div>
                  <Avatar avatar={player.avatar} color={player.color} size={34}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:800,color:isMe?myPlayer.color:"#e5e7eb"}}>{player.name}{isMe&&" (Du)"}</span>
                      {currentAward&&<AwardBadge award={currentAward} small/>}
                    </div>
                    <div style={{background:"#1f2937",borderRadius:6,height:8,overflow:"hidden",marginBottom:3}}>
                      <div style={{width:`${barPct}%`,height:"100%",background:`linear-gradient(90deg,${player.color},#3b82f6)`,borderRadius:6}}/>
                    </div>
                    <div style={{fontSize:10,color:"#6b7280"}}>A: <b style={{color:player.color}}>{beginnerStars}</b> · F: <b style={{color:"#3b82f6"}}>{advancedStars}</b></div>
                  </div>
                  <div style={{flexShrink:0,textAlign:"center",background:"#0d1117",borderRadius:10,padding:"5px 10px",border:`1px solid ${player.color}44`}}>
                    <div style={{fontSize:18,fontWeight:900,color:player.color,lineHeight:1}}>{totalStars}</div>
                    <div style={{fontSize:9,color:"#6b7280",marginTop:1}}>★</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <style>{`*{box-sizing:border-box}input::placeholder{color:#4b5563}`}</style>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser,  setAuthUser]  = useState(undefined);
  const [players,   setPlayers]   = useState([]);
  const [loginErr,  setLoginErr]  = useState("");
  const [loginLoad, setLoginLoad] = useState(false);
  const [isAdmin,   setIsAdmin]   = useState(false);
  const [loginSuccess, setLoginSuccess] = useState("");

  // Auth listener — so einfach wie möglich
  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u => {
      setAuthUser(u || null);
      if (!u) { setIsAdmin(false); return; }
      setIsAdmin(checkIsAdminByEmail(u.email));
    });
    return unsub;
  },[]);

  // Spieler in Echtzeit laden
  useEffect(()=>{
    if (!authUser) return;
    const unsub = onSnapshot(collection(db,"players"), snap=>{
      setPlayers(snap.docs.map(d=>d.data()));
    }, err => {
      console.error("Firestore Fehler:", err.message);
    });
    return unsub;
  },[authUser]);

  async function handleLogin(email, pass) {
    setLoginLoad(true); setLoginErr(""); setLoginSuccess("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch(e) {
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
    setPlayers([]); setIsAdmin(false); setLoginSuccess("");
  }

  // Noch nicht geprüft → Ladebildschirm
  if (authUser === undefined) return (
    <div style={{minHeight:"100vh",background:"#0d1117",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>🏓</div>
      <div style={{fontSize:14,color:"#6b7280"}}>TTC Niederzeuzheim wird geladen…</div>
    </div>
  );

  // Nicht angemeldet → Login
  if (!authUser) return (
    <LoginScreen
      onLogin={handleLogin}
      error={loginErr}
      loading={loginLoad}
      successMessage={loginSuccess}
    />
  );

  // Angemeldet als Trainer
  if (isAdmin) return (
    <AdminPanel
      user={authUser}
      players={players}
      onSignOut={handleSignOut}
      onPlayerAdded={(name) => setLoginSuccess(`✅ ${name} wurde angelegt! Bitte melde dich neu an.`)}
    />
  );

  // Angemeldet als Spieler
  return <PlayerView user={authUser} players={players} onSignOut={handleSignOut}/>;
}
