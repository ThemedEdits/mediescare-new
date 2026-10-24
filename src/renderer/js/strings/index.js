import en from './en.js';

const tables = { en };
let current = en;

export function setLanguage(lang) {
  current = tables[lang] || en;
}

// t('users.created', { username: 'ali' })
export function t(key, params) {
  let text = current[key] ?? en[key];
  if (text === undefined) {
    console.warn(`Missing string: ${key}`);
    return key;
  }
  if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  return text;
}
