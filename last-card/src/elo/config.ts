/**
 * Firebase connection details.
 *
 * Blank until you paste your own in, exactly like docs/push-config.js for the
 * morning nudge: while these are empty the rankings screen says it is not set
 * up and explains what to do, rather than pointing at a database that is not
 * there.
 *
 * None of these are secrets. A Firebase web config is public by design — it
 * identifies the project, it does not authorise anything. What protects the
 * data is the security rules, and see ELO-SETUP.md for exactly what the rules
 * this feature needs do and do not allow.
 */

export interface FirebaseConfigValues {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const FIREBASE_CONFIG: FirebaseConfigValues = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

/** The collections the security rules open up, and nothing else. */
export const PLAYERS_COLLECTION = 'eloPlayers';
export const GAMES_COLLECTION = 'eloGames';

export function isFirebaseConfigured(config: FirebaseConfigValues = FIREBASE_CONFIG): boolean {
  return config.apiKey.trim() !== '' && config.projectId.trim() !== '';
}
