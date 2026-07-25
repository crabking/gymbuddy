import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import {
  languageOrDefault,
  translate,
  type Language,
  type TranslationKey,
  type TranslationValues,
} from "@/lib/i18n";

type LanguageContextValue = {
  language: Language;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  t: (key, values) => translate("en", key, values),
});

export function LanguageProvider({
  language,
  children,
}: {
  language: Language | string | null | undefined;
  children: ReactNode;
}) {
  const normalized = languageOrDefault(language);
  const value = useMemo<LanguageContextValue>(
    () => ({
      language: normalized,
      t: (key, values) => translate(normalized, key, values),
    }),
    [normalized],
  );
  useEffect(() => {
    document.documentElement.lang = normalized;
  }, [normalized]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// Context and provider intentionally live together so every route consumes one
// type-safe language contract.
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  return useContext(LanguageContext);
}
