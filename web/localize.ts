import translations from './translations.json';
export type TranslationKeys = keyof typeof translations['zh-Hans'];
export function useLocalize() {
  const language = navigator.language.toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en';
  return (key: TranslationKeys) => translations[language][key];
}
