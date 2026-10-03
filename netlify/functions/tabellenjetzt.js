// === TTC-App · Version 502 · netlify/functions/tabellenjetzt.js · erstellt 03.10.2026 (V502: Tabellen manuell abrufen) ===
// Manueller Tabellenabruf aus der App („Tabellen jetzt aktualisieren“, Spielbetrieb).
// Nutzt dieselbe Logik wie der geplante Lauf (tabellen.js). Schutz vor Dauerauslösung:
// Liegt der letzte Abruf weniger als 5 Minuten zurück, wird der vorhandene Stand gemeldet.
const tab = require("./tabellen.js");
const pv  = require("./pushversand.js");

exports.handler = async (event) => {
  const cors = tab.cors();
  if(event && event.httpMethod==="OPTIONS") return { statusCode:204, headers:cors, body:"" };
  try{
    const b = await pv.getDocData("config/tabellen");
    if(b && b.stand && Date.now()-b.stand < tab.MIN_ABSTAND_MS){
      return { statusCode:200, headers:cors, body:JSON.stringify({ ok:true, saison:b.saison, bericht:b.bericht||[],
        hinweis:"Erst vor wenigen Minuten aktualisiert – vorhandener Stand." }) };
    }
    const erg = await tab.aktualisieren();
    return { statusCode:200, headers:cors, body:JSON.stringify(erg) };
  }catch(e){
    return { statusCode:500, headers:cors, body:JSON.stringify({ ok:false, meldung:String(e && e.message || e) }) };
  }
};
