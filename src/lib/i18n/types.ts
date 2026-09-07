export type Locale = 'zh' | 'en';

export interface TranslationDict {
	[key: string]: string | TranslationDict;
}
