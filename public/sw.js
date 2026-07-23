/* TTC Niederzeuzheim – Service Worker
   Aufgabe: Push-Nachrichten empfangen und anzeigen.
   Bewusst OHNE Caching: die App setzt auf "no-cache", damit Aktualisierungen
   sofort ankommen. Der Service Worker soll dieses Verhalten nicht verändern.
*/

// Neuen Service Worker sofort aktivieren (kein Warten auf Schließen aller Tabs)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Push-Nachricht empfangen und als Systembenachrichtigung anzeigen
self.addEventListener("push", (event) => {
  let daten = {};
  try {
    daten = event.data ? event.data.json() : {};
  } catch (e) {
    // Falls die Nachricht kein JSON ist, den Text als Inhalt verwenden
    daten = { titel: "TTC Niederzeuzheim", text: event.data ? event.data.text() : "" };
  }

  const titel = daten.titel || "TTC Niederzeuzheim";
  const optionen = {
    body: daten.text || "",
    icon: daten.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: daten.tag || "ttc-termin",          // gleiche tag => ersetzt alte Meldung
    renotify: !!daten.erneutMelden,
    requireInteraction: false,
    data: {
      url: daten.url || "/",
      zeit: daten.zeit || null
    }
  };

  event.waitUntil(self.registration.showNotification(titel, optionen));
});

// Klick auf die Benachrichtigung: App öffnen bzw. vorhandenes Fenster fokussieren
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) {
        // Bereits geöffnetes Fenster der App in den Vordergrund holen
        if (f.url.indexOf(self.location.origin) === 0 && "focus" in f) {
          f.navigate(ziel).catch(() => {});
          return f.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(ziel);
    })
  );
});

// Wenn der Browser das Push-Abo erneuert, muss die App es neu speichern.
// Wir benachrichtigen offene Fenster; die App meldet sich dann neu an.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenster) => {
      for (const f of fenster) f.postMessage({ typ: "push-abo-erneuern" });
    })
  );
});
