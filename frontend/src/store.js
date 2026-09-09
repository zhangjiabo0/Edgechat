import { reactive } from 'vue';
import { isDemoMode, runtimeSessionToken } from './runtime.js';
import api from './api.js';
import {
  addAuthInvalidListener,
  clearStoredToken,
  getStoredToken,
  setStoredToken
} from './auth-storage.js';

const DEFAULT_SITE_ICON_URL = '/logo.svg';
const SITE_METADATA_STORAGE_KEY = 'edgechat_site_metadata';

function getStoredSiteMetadata() {
  if (typeof window === 'undefined') {
    return { siteName: 'Edgechat', siteIconUrl: '' };
  }
  try {
    const raw = localStorage.getItem(SITE_METADATA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.siteName === 'string' && parsed.siteName.trim()) {
        return {
          siteName: parsed.siteName.trim(),
          siteIconUrl: String(parsed.siteIconUrl || '').trim()
        };
      }
    }
  } catch {}
  return { siteName: 'Edgechat', siteIconUrl: '' };
}

const state = reactive({
  ready: false,
  token: isDemoMode ? runtimeSessionToken : getStoredToken(),
  session: null,
  site: getStoredSiteMetadata()
});

function clearAuthState() {
  clearStoredToken();
  state.token = '';
  state.session = null;
}

function applySiteMetadata(site) {
  if (typeof window === 'undefined') {
    return;
  }

  const siteName = String(site?.siteName || 'Edgechat').trim() || 'Edgechat';
  const siteIconUrl = String(site?.siteIconUrl || '').trim();
  document.title = siteName;

  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.setAttribute('rel', 'icon');
    document.head.appendChild(favicon);
  }

  if (siteIconUrl) {
    favicon.setAttribute('href', siteIconUrl);
  } else {
    favicon.setAttribute('href', DEFAULT_SITE_ICON_URL);
  }
}

// 模块首次装载时，立即同步应用已缓存的 metadata
if (typeof window !== 'undefined') {
  applySiteMetadata(state.site);
}

async function loadSite() {
  try {
    const payload = await api.getSite();
    setSite(payload.site);
  } catch {
    applySiteMetadata(state.site);
  }
}

async function initialize() {
  if (state.ready) {
    return;
  }

  await loadSite();

  if (!state.token) {
    state.ready = true;
    return;
  }

  try {
    const payload = await api.session();
    state.session = payload.session;
  } catch {
    clearAuthState();
  } finally {
    state.ready = true;
  }
}

async function login(credentials) {
  const payload = await api.login(credentials);
  state.token = payload.token;
  state.session = payload.session;
  state.ready = true;
  setStoredToken(payload.token);
}

async function logout() {
  try {
    if (state.token) {
      await api.logout();
    }
  } finally {
    clearAuthState();
  }
}

function setSession(session) {
  state.session = session;
}

function setSite(site) {
  const siteName = String(site?.siteName || 'Edgechat').trim() || 'Edgechat';
  const siteIconUrl = String(site?.siteIconUrl || '').trim();
  state.site = { siteName, siteIconUrl };
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SITE_METADATA_STORAGE_KEY, JSON.stringify(state.site));
    }
  } catch {}
  applySiteMetadata(state.site);
}

if (typeof window !== 'undefined') {
  addAuthInvalidListener(() => {
    clearAuthState();
  });
}

export default {
  get ready() {
    return state.ready;
  },
  get token() {
    return state.token;
  },
  get session() {
    return state.session;
  },
  get site() {
    return state.site;
  },
  initialize,
  login,
  logout,
  setSession,
  setSite,
  loadSite
};
