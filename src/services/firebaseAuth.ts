import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Request Google Sheets scope
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

// Flag to indicate if we are currently in the middle of a sign-in flow
let isSigningIn = false;
// Cache the access token in memory and sessionStorage for seamless user experience
const TOKEN_STORAGE_KEY = 'rw_google_sheets_token';
const TOKEN_EXPIRY_KEY = 'rw_google_sheets_token_expiry';
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

const storeAccessToken = (token: string, expiresInSeconds = 3500) => {
  cachedAccessToken = token;
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
  } catch (e) {
    console.warn('Unable to persist token in sessionStorage:', e);
  }
};

export const clearAccessToken = (): void => {
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch (e) {
    // ignore
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const storedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const expiryStr = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    if (storedToken && expiryStr) {
      const expiry = parseInt(expiryStr, 10);
      // Valid if more than 2 minutes remain
      if (expiry > Date.now() + 2 * 60 * 1000) {
        cachedAccessToken = storedToken;
        return storedToken;
      }
    }
  } catch (e) {
    console.warn('Unable to read token from sessionStorage:', e);
  }
  return null;
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    cachedUser = user;
    if (user) {
      const token = await getAccessToken();
      if (token) {
        if (onAuthSuccess) onAuthSuccess(user, token);
      } else if (!isSigningIn) {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      clearAccessToken();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (forceConsent = false): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;

    // Check if we already have a valid unexpired token
    const existingToken = await getAccessToken();
    if (existingToken && !forceConsent) {
      const currentUser = getCurrentUser();
      if (currentUser) {
        return { user: currentUser, accessToken: existingToken };
      }
    }

    const freshProvider = new GoogleAuthProvider();
    freshProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
    freshProvider.addScope('https://www.googleapis.com/auth/drive.file');

    // Only force prompt if consent was missing or user explicitly clicked Reconnect
    if (forceConsent) {
      freshProvider.setCustomParameters({
        prompt: 'consent select_account',
        access_type: 'offline',
      });
    } else {
      freshProvider.setCustomParameters({
        access_type: 'offline',
      });
    }

    const result = await signInWithPopup(auth, freshProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google access token with Sheets permissions.');
    }

    // Verify granted scopes with Google tokeninfo endpoint
    try {
      const tokenCheckRes = await fetch(
        `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${credential.accessToken}`
      );
      if (tokenCheckRes.ok) {
        const tokenInfo = await tokenCheckRes.json();
        const grantedScopes: string = tokenInfo.scope || '';
        console.log('Google OAuth granted scopes:', grantedScopes);

        if (!grantedScopes.includes('spreadsheets')) {
          clearAccessToken();
          throw new Error(
            'Google Sheets permission was not granted on the consent screen. Please try again and make sure to check the box next to "See, edit, create, and delete all your Google Sheets spreadsheets".'
          );
        }
      }
    } catch (checkErr: any) {
      if (checkErr.message?.includes('Google Sheets permission was not granted')) {
        throw checkErr;
      }
      console.warn('Could not verify token scopes:', checkErr);
    }

    storeAccessToken(credential.accessToken);
    cachedUser = result.user;
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    clearAccessToken();
    console.error('Google Sign In error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getCurrentUser = (): User | null => {
  return cachedUser || auth.currentUser;
};

export const logout = async (): Promise<void> => {
  await signOut(auth);
  cachedAccessToken = null;
  cachedUser = null;
};
