// === TTC-App · netlify/functions/pushtest.js · erstellt 23.08.2026 (V392) ===
// Per-URL aufrufbarer TROCKENLAUF des Push-Versands.
//
// Hintergrund: pushversand.js ist in netlify.toml als "Scheduled Function"
// konfiguriert (läuft täglich um 6 Uhr). Scheduled Functions lassen sich bei
// Netlify NICHT direkt über eine URL aufrufen – ein Browser-Aufruf von
// /.netlify/functions/pushversand zeigt daher nichts an.
//
// Diese Funktion ist eine NORMALE (nicht geplante) Function und damit ganz
// normal per URL erreichbar:
//   /.netlify/functions/pushtest
//   /.netlify/functions/pushtest?datum=2026-12-08
//
// Sie ruft denselben Handler wie pushversand auf, erzwingt aber IMMER den
// Trockenlauf (dry=1). Es wird also NIE etwas wirklich versendet – egal welche
// Parameter angegeben werden. Der Rückgabe-Bericht ist identisch zum Trockenlauf
// von pushversand (inkl. Empfängernamen und vollständigem Nachrichtentext).
//
// Optionaler Parameter:
//   ?datum=YYYY-MM-DD  – Tag, an dem die Erinnerung laufen würde (Standard: heute).
//                        Das ist das Spieldatum minus der in der Push-Regel
//                        eingestellten Vorlauftage.

const pushversand = require("./pushversand.js");

exports.handler = async (event) => {
  // Query-Parameter übernehmen, aber dry=1 fest erzwingen (kein echter Versand).
  const q = Object.assign({}, (event && event.queryStringParameters) || {});
  q.dry = "1";
  const safeEvent = Object.assign({}, event, { queryStringParameters: q });
  return pushversand.handler(safeEvent);
};
