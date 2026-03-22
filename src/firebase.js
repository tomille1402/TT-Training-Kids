// src/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// SCHRITT 1: Erstelle ein kostenloses Firebase-Projekt auf https://console.firebase.google.com
// SCHRITT 2: Aktiviere "Authentication" → "E-Mail/Passwort"
// SCHRITT 3: Aktiviere "Firestore Database" (im Produktionsmodus)
// SCHRITT 4: Kopiere deine Firebase-Konfiguration hierher (Projekteinstellungen → Allgemein → Web-App)
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // ⚠️ ERSETZE DIESE WERTE MIT DEINER EIGENEN FIREBASE-KONFIGURATION:
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  projectId: "DEIN_PROJEKT_ID",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId: "DEINE_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
