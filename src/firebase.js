/* global __firebase_config, __initial_auth_token */

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";

// --- Mandatory Global Variable Check ---
// The Canvas environment provides configuration via global variables.
const firebaseConfigRaw = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
let firebaseConfig = {};

try {
    firebaseConfig = JSON.parse(firebaseConfigRaw);
} catch (e) {
    console.error("Failed to parse __firebase_config, using fallback:", e);
}

// Fallback configuration if the environment variable is empty or invalid.
// This ensures that 'projectId' is always present to prevent the initialization error.
if (!firebaseConfig.projectId) {
    console.warn("Using fallback Firebase configuration as projectId was missing.");
    firebaseConfig = {
        apiKey: "placeholder",
        authDomain: "placeholder.firebaseapp.com",
        projectId: "fallback-project-id", // Crucial addition to prevent the error
        storageBucket: "placeholder.appspot.com",
        messagingSenderId: "000000000000",
        appId: "0:000000000000:web:0000000000000000000000"
    };
}

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

// Authentication Logic
export const initializeAuth = async () => {
  try {
    if (initialAuthToken) {
      await signInWithCustomToken(auth, initialAuthToken);
      console.log("AUTH DEBUG: Successfully signed in using Canvas Custom Token.");
    } else {
      // Fallback for environments without a custom token
      await signInAnonymously(auth);
      console.log("AUTH DEBUG: Successfully signed in anonymously.");
    }
  } catch (error) {
    console.error("AUTH ERROR: Firebase Auth failed during sign-in:", error);
  }
};

export { db, storage, auth, onAuthStateChanged };