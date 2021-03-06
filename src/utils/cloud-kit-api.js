import * as qs from 'querystring';

import { ENV, LocaleError } from './common';

const API_TOKENS = {
  'development':
    'a549ed0b287668fdcef031438d4350e1e96ec12e758499bc1360a03564becaf8',
  'production': 
    'cd95e9dcb918b2d45b94a10416eaed02df8727d7b6fdde4669a5fbcacefafe1b',
};

const AUTH_TOKEN_KEY = 'derivepass/cloud-kit/auth-token';

export default class CloudKitAPI {
  constructor(env = ENV) {
    this.env = env;
    this.apiToken = API_TOKENS[env];
    this.authToken = localStorage.getItem(AUTH_TOKEN_KEY);
    this.base = 'https://api.apple-cloudkit.com/database/1/' +
      `iCloud.com.indutny.DerivePass/${env}`;

    this.authURL = null;
  }

  async request(path, { method = 'GET', query = {}, body } = {}) {
    query = Object.assign({}, query, {
      ckAPIToken: this.apiToken,
    });

    if (this.authToken) {
      query = Object.assign({}, query, {
        ckWebAuthToken: this.authToken,
      });
    }

    const uri = `${this.base}${path}?${qs.stringify(query)}`;
    const res = await fetch(uri, {
      method,
      headers: body ? {
        'content-type': 'application/json; charset=UTF-8'
      } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    return { ok: res.ok, response: await res.json() };
  }

  async getUser() {
    const user = await this.request('/public/users/current');
    if (user.ok) {
      return user.response;
    }

    this.authURL = user.response.redirectURL;
    if (!this.authURL) {
      throw new LocaleError('No authorization URL in response',
        'error.cloud-kit.no-auth-url');
    }

    return null;
  }

  async signIn() {
    if (!this.authURL) {
      throw new LocaleError('No authorization URL in response',
        'error.cloud-kit.no-auth-url');
    }

    const child = window.open(this.authURL,
      'derivepass.iCloud.Auth',
      'width=500,height=500');
    if (!child) {
      throw new LocaleError('Pop-up blocked, please try again',
        'error.cloud-kit.popup-blocked');
    }

    await new Promise((resolve, reject) => {
      let fired = false;
      const once = () => {
        if (fired) {
          return false;
        }
        fired = true;
        window.removeEventListener('message', onMessage);
        return true;
      };

      const onMessage = ({ source, data }) => {
        if (source !== child) {
          return;
        }

        if (!once()) {
          return;
        }

        if (data.errorMessage) {
          return reject(new Error(data.errorMessage));
        }

        const authToken = data.ckWebAuthToken || data.ckSession;
        if (!authToken) {
          return reject(new LocaleError('Authentication failure',
            'error.cloud-kit.auth-failure'));
        }

        this.authToken = authToken;
        localStorage.setItem(AUTH_TOKEN_KEY, authToken);
        resolve();
      };
      window.addEventListener('message', onMessage);

      child.addEventListener('beforeunload', () => {
        if (!once()) {
          return;
        }

        reject(new LocaleError('Sign-in window was prematurely closed',
          'error.cloud-kit.premature-close'));
      });
    });
  }

  async signOut() {
    this.authToken = undefined;
    localStorage.removeItem(AUTH_TOKEN_KEY);

    // Update auth url
    await this.getUser();
  }

  async fetchRecords({ db = 'private', recordType, continuationMarker }) {
    const res = await this.request(`/${db}/records/query`, {
      method: 'POST',
      body: {
        query: {
          recordType,
        },
        continuationMarker,
      }
    });

    if (!res.ok) {
      throw new Error(res.response.reason);
    }

    return res.response;
  }

  async saveRecords(records, { db = 'private', atomic = false } = {}) {
    const res = await this.request(`/${db}/records/modify`, {
      method: 'POST',
      body: {
        operations: records.map((record) => {
          return {
            operationType: record.recordChangeTag ? 'update' : 'create',
            record,
          };
        }),
        atomic,
      },
    });

    if (!res.ok) {
      throw new Error(res.response.reason);
    }

    return res.response;
  }
}
