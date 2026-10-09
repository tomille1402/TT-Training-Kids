// === TTC-App · Version 519 · netlify/functions/manifest.js · erstellt 07.10.2026 (V519: Manifest und Symbol je Verein) ===
// Liefert /manifest.webmanifest und die Startbildschirm-Symbole passend zur aufgerufenen
// Adresse (eigene Domain bzw. Subdomain je Verein, siehe system/datenbereich.domains /
// basisDomain). Name, Farben und Logo kommen aus vereine/<id>/config/clubConfig.
// Ohne Vereinslogo wird auf die bisherigen Symbole (/icon-192.png, /icon-512.png) umgeleitet.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const API_KEY = process.env.FIREBASE_API_KEY || "";

function convertFields(f){ const o={}; for(const k in f) o[k]=convertValue(f[k]); return o; }
function convertValue(v){
  if(v.stringValue!==undefined) return v.stringValue;
  if(v.integerValue!==undefined) return Number(v.integerValue);
  if(v.doubleValue!==undefined) return v.doubleValue;
  if(v.booleanValue!==undefined) return v.booleanValue;
  if(v.arrayValue!==undefined) return (v.arrayValue.values||[]).map(convertValue);
  if(v.mapValue!==undefined) return convertFields(v.mapValue.fields||{});
  return null;
}
async function lies(pfad, masken){
  const m=(masken||[]).map(x=>`mask.fieldPaths=${encodeURIComponent(x)}`).join("&");
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${pfad}?${m}${API_KEY?`&key=${API_KEY}`:""}`;
  const r=await fetch(url); if(!r.ok) return null;
  const j=await r.json(); return j.fields?convertFields(j.fields):{};
}
// Verein zur Adresse: eigene Domain (domains) → Subdomain der Basis-Domain → Standardverein
async function vereinZurAdresse(host){
  const sys=await lies("system/datenbereich",["modus","vereinId","domains","basisDomain"])||{};
  const h=String(host||"").toLowerCase().split(":")[0];
  let vid="";
  if(sys.domains && sys.domains[h]) vid=sys.domains[h];
  else if(sys.basisDomain && h.endsWith("."+sys.basisDomain)){
    const label=h.slice(0, -(sys.basisDomain.length+1));
    if(label && !label.includes(".") && !["www","app"].includes(label)) vid=label;
  }
  if(!vid) vid=sys.vereinId||"ttc-niederzeuzheim";
  return { vid:String(vid).replace(/[^a-z0-9-]/gi,""), modus:sys.modus||"oben" };
}
exports.handler = async (event) => {
  // Art aus dem aufgerufenen Pfad (Umleitung in netlify.toml) oder ?art=
  const q=event.queryStringParameters||{};
  const pfadReq=String(event.path||event.rawUrl||"");
  const art=q.art || (/icon/.test(pfadReq) ? "icon" : "manifest");
  const groesse=q.groesse || (/512/.test(pfadReq) ? "512" : "192");
  const host=(event.headers&&(event.headers["x-forwarded-host"]||event.headers.host))||"";
  try{
    const { vid, modus } = await vereinZurAdresse(host);
    const pfad = modus==="verein" ? `vereine/${vid}/config/clubConfig` : "config/clubConfig";
    const cfg = await lies(pfad,["name","subtitle","farbschema","verein","logo"]) || {};
    const v = cfg.verein || {};
    const ttc = vid==="ttc-niederzeuzheim";
    if(art==="icon"){
      const m=/^data:(image\/(png|jpe?g|webp));base64,(.+)$/i.exec(cfg.logo||"");
      if(!m) return { statusCode:302, headers:{ Location: groesse==="512" ? "/icon-512.png" : "/icon-192.png", "Cache-Control":"no-cache" }, body:"" };
      return { statusCode:200, isBase64Encoded:true, body:m[3],
        headers:{ "Content-Type":m[1], "Cache-Control":"public, max-age=3600" } };
    }
    const lang = v.vollname || (ttc ? "TT-App des TTC 1979 Niederzeuzheim e. V." : (cfg.name||"Vereins-App"));
    const kurz = (v.kuerzel ? `${v.kuerzel} App` : "") || (ttc ? "TTC App" : (cfg.name||"Vereins-App")).slice(0,20);
    const manifest = {
      name: lang, short_name: kurz,
      description: `Trainings-, Spielplan- und Vereinsverwaltung – ${v.kurzname||cfg.name||""}`.trim(),
      start_url:"/", scope:"/", display:"standalone", orientation:"portrait",
      background_color:"#0d1117", theme_color:"#0d1117", lang:"de",
      icons:[
        { src:"/vereins-icon-192.png", sizes:"192x192", type:"image/png", purpose:"any" },
        { src:"/vereins-icon-512.png", sizes:"512x512", type:"image/png", purpose:"any" },
        { src:"/vereins-icon-512.png", sizes:"512x512", type:"image/png", purpose:"maskable" },
      ],
    };
    return { statusCode:200, headers:{ "Content-Type":"application/manifest+json; charset=utf-8", "Cache-Control":"no-cache" }, body:JSON.stringify(manifest) };
  }catch(e){
    return { statusCode:302, headers:{ Location: art==="icon" ? "/icon-192.png" : "/manifest-standard.webmanifest" }, body:"" };
  }
};
