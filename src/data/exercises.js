// src/data/exercises.js

export const EXERCISES_BEGINNER = [
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

export const EXERCISES_ADVANCED = [
  { id:11, name:"Roll-Aufschlag Vorhand diagonal",                         description:"Von 20 Aufschlägen im Ziel (diagonal)",     thresholds:["5×","10×","15×","18×","20×"] },
  { id:12, name:"Roll-Aufschlag Vorhand parallel",                         description:"Von 20 Aufschlägen im Ziel (parallel)",     thresholds:["5×","10×","15×","18×","20×"] },
  { id:13, name:"Roll-Aufschlag Rückhand diagonal",                        description:"Von 20 Aufschlägen im Ziel (diagonal)",     thresholds:["5×","10×","15×","18×","20×"] },
  { id:14, name:"Roll-Aufschlag Rückhand parallel",                        description:"Von 20 Aufschlägen im Ziel (parallel)",     thresholds:["5×","10×","15×","18×","20×"] },
  { id:15, name:"Roll-Aufschlag VH diagonal/parallel im Wechsel",          description:"VH diagonal/parallel im Wechsel",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:16, name:"Roll-Aufschlag RH diagonal/parallel im Wechsel",          description:"RH diagonal/parallel im Wechsel",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:17, name:"Roll-Aufschlag VH diagonal auf 6 Becher",                 description:"6 Becher mit VH diagonal räumen",           thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:18, name:"Roll-Aufschlag VH parallel auf 6 Becher",                 description:"6 Becher mit VH parallel räumen",           thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:19, name:"Roll-Aufschlag RH diagonal auf 6 Becher",                 description:"6 Becher mit RH diagonal räumen",           thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:20, name:"Roll-Aufschlag RH parallel auf 6 Becher",                 description:"6 Becher mit RH parallel räumen",           thresholds:["≤20 AS","≤15 AS","≤10 AS","≤5 AS","≤3 AS"] },
  { id:21, name:"Unterschnitt-Aufschlag Vorhand diagonal",                  description:"US-Aufschlag VH diagonal (20)",             thresholds:["5×","10×","15×","18×","20×"] },
  { id:22, name:"Unterschnitt-Aufschlag Vorhand parallel",                  description:"US-Aufschlag VH parallel (20)",             thresholds:["5×","10×","15×","18×","20×"] },
  { id:23, name:"Unterschnitt-Aufschlag Rückhand diagonal",                 description:"US-Aufschlag RH diagonal (20)",             thresholds:["5×","10×","15×","18×","20×"] },
  { id:24, name:"Unterschnitt-Aufschlag Rückhand parallel",                 description:"US-Aufschlag RH parallel (20)",             thresholds:["5×","10×","15×","18×","20×"] },
  { id:25, name:"Unterschnitt-AS Vorhand diagonal / Ball zurück",           description:"Ball rollt nach US-AS zurück (20 Versuche)", thresholds:["5×","10×","15×","18×","20×"] },
  { id:26, name:"Unterschnitt-AS Vorhand parallel / Ball zurück",           description:"Ball rollt nach US-AS zurück (20 Versuche)", thresholds:["5×","10×","15×","18×","20×"] },
  { id:27, name:"Unterschnitt-AS Rückhand diagonal / Ball zurück",          description:"Ball rollt nach US-AS zurück (20 Versuche)", thresholds:["5×","10×","15×","18×","20×"] },
  { id:28, name:"Unterschnitt-AS Rückhand parallel / Ball zurück",          description:"Ball rollt nach US-AS zurück (20 Versuche)", thresholds:["5×","10×","15×","18×","20×"] },
  { id:29, name:"Vorhand Schupf diagonal",                                  description:"Schupf-Schläge korrekt (beide Spieler)",    thresholds:["10×","25×","50×","100×","200×"] },
  { id:30, name:"Rückhand Schupf diagonal",                                 description:"Schupf-Schläge korrekt (beide Spieler)",    thresholds:["10×","25×","50×","100×","200×"] },
  { id:31, name:"Vorhand Kontern diagonal",                                 description:"Konterschläge korrekt (beide Spieler)",     thresholds:["10×","25×","50×","100×","200×"] },
  { id:32, name:"Rückhand Kontern diagonal",                                description:"Konterschläge korrekt (beide Spieler)",     thresholds:["10×","25×","50×","100×","200×"] },
  { id:33, name:"Vorhand auf Rückhand Kontern parallel",                    description:"VH auf RH Kontern parallel",                thresholds:["10×","25×","50×","100×","200×"] },
  { id:34, name:"Rückhand auf Vorhand Kontern parallel",                    description:"RH auf VH Kontern parallel",                thresholds:["10×","25×","50×","100×","200×"] },
  { id:35, name:"Vorhand-Topspin diagonal auf Balleimer (Unterschnitt)",    description:"VH-Topspin diagonal auf US (20)",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:36, name:"Vorhand-Topspin parallel auf Balleimer (Unterschnitt)",    description:"VH-Topspin parallel auf US (20)",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:37, name:"Vorhand-Topspin diagonal/parallel Wechsel auf Balleimer",  description:"VH-Topspin dia/para Wechsel (20)",          thresholds:["5×","10×","15×","18×","20×"] },
  { id:38, name:"Rückhand-Topspin diagonal auf Balleimer (Unterschnitt)",   description:"RH-Topspin diagonal auf US (20)",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:39, name:"Rückhand-Topspin parallel auf Balleimer (Unterschnitt)",   description:"RH-Topspin parallel auf US (20)",           thresholds:["5×","10×","15×","18×","20×"] },
  { id:40, name:"Rückhand-Topspin diagonal/parallel Wechsel auf Balleimer", description:"RH-Topspin dia/para Wechsel (20)",          thresholds:["5×","10×","15×","18×","20×"] },
];

export const ALL_EXERCISES = [...EXERCISES_BEGINNER, ...EXERCISES_ADVANCED];

export const AVATARS = [
  "🏓","🐯","🦁","🐻","🦊","🐼","🐸","🦋","🐬","🦄",
  "🐙","🦅","🦈","🐲","🌟","🔥","⚡","🎯","🚀","🏆",
  "💎","🎸","🤖","👾","🦸","🧙","🎃","🌈","🐺","🦝",
];

export const PLAYER_COLORS = [
  "#10b981","#3b82f6","#f59e0b","#ef4444","#8b5cf6",
  "#ec4899","#14b8a6","#f97316","#a3e635","#e879f9",
];

export const BEGINNER_AWARDS = [
  { stars:10, label:"Bronze Anfänger",  emoji:"🥉", color:"#cd7f32", note:"" },
  { stars:25, label:"Silber Anfänger",  emoji:"🥈", color:"#b8b8b8", note:"" },
  { stars:40, label:"Gold Anfänger",    emoji:"🥇", color:"#ffd700", note:"→ Aufstieg!" },
  { stars:45, label:"Platin Anfänger",  emoji:"💎", color:"#7dd3e8", note:"" },
  { stars:50, label:"Diamant Anfänger", emoji:"💠", color:"#00bfff", note:"" },
];

export const ADVANCED_AWARDS = [
  { stars:75,  label:"Bronze Fortgeschrittene",  emoji:"🥉", color:"#cd7f32", note:"" },
  { stars:100, label:"Silber Fortgeschrittene",  emoji:"🥈", color:"#b8b8b8", note:"" },
  { stars:125, label:"Gold Fortgeschrittene",    emoji:"🥇", color:"#ffd700", note:"" },
  { stars:150, label:"Platin Fortgeschrittene",  emoji:"💎", color:"#7dd3e8", note:"" },
  { stars:175, label:"Diamant Fortgeschrittene", emoji:"💠", color:"#00bfff", note:"" },
];

export function getAward(player) {
  const stars = player.stars || {};
  const beginnerStars  = EXERCISES_BEGINNER.reduce((s,ex)=>s+(stars[ex.id]||0),0);
  const advancedStars  = EXERCISES_ADVANCED.reduce((s,ex)=>s+(stars[ex.id]||0),0);
  const totalStars     = beginnerStars + advancedStars;
  const isAdvanced     = beginnerStars >= 40;
  let currentAward = null;
  if (isAdvanced) {
    for (const a of ADVANCED_AWARDS) if (advancedStars >= a.stars) currentAward = a;
    if (!currentAward) for (const a of BEGINNER_AWARDS) if (beginnerStars >= a.stars) currentAward = a;
  } else {
    for (const a of BEGINNER_AWARDS) if (beginnerStars >= a.stars) currentAward = a;
  }
  return { currentAward, beginnerStars, advancedStars, totalStars, isAdvanced };
}

export function nextAward(player) {
  const { beginnerStars, advancedStars, isAdvanced } = getAward(player);
  if (isAdvanced) {
    for (const a of ADVANCED_AWARDS) if (advancedStars < a.stars) return { ...a, needed: a.stars - advancedStars };
  } else {
    for (const a of BEGINNER_AWARDS) if (beginnerStars < a.stars) return { ...a, needed: a.stars - beginnerStars };
  }
  return null;
}
