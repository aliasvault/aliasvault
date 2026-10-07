/**
 * Every language bundled up front, for hosts without code splitting (the mobile app).
 */

import da from '../locales/da.json';
import de from '../locales/de.json';
import en from '../locales/en.json';
import es from '../locales/es.json';
import fi from '../locales/fi.json';
import fr from '../locales/fr.json';
import ga from '../locales/ga.json';
import he from '../locales/he.json';
import hu from '../locales/hu.json';
import id from '../locales/id.json';
import it from '../locales/it.json';
import ko from '../locales/ko.json';
import nl from '../locales/nl.json';
import pl from '../locales/pl.json';
import pt from '../locales/pt.json';
import ro from '../locales/ro.json';
import ru from '../locales/ru.json';
import sv from '../locales/sv.json';
import uk from '../locales/uk.json';
import zh from '../locales/zh.json';

import type { TranslationTree } from './index';

/**
 * The translations of every UI language.
 */
export const ALL_TRANSLATIONS: Record<string, TranslationTree> = { da, de, en, es, fi, fr, ga, he, hu, id, it, ko, nl, pl, pt, ro, ru, sv, uk, zh };
