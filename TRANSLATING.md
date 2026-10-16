# Translating WE Budget

The interface texts live in `src/i18n/`, one file per language. English (`en.js`) is the source; every other file has exactly the same keys. The list of languages is `src/i18n/languages.js`.

## What a translation touches

Only two places, so several languages can be translated at the same time without conflicts:

1. Your locale file, `src/i18n/<code>.js`. Until it is translated it is a one-line stub that re-exports English:

   ```js
   export { en as sk } from './en.js';
   ```

   Replace it with the full dictionary:

   ```js
   // Slovak interface texts.
   export const sk = {
     // Navigation
     'nav-overview': 'Prehľad',
     'nav-month': 'Mesiac',
     // ...every key of en.js, in the same order
   };
   ```

   The export is named after the language code (`sk`, `zh`, `ar`...). Keep the order and the section comments of `en.js`; it makes later comparisons easy.

2. Your line in `src/i18n/languages.js`: set `ready: true` once the file is complete and checked, and nothing else on the line unless the locale or the decimal separator is wrong. A language appears in the picker only when it is ready. Do not touch `en.js`, `ru.js`, other languages' files or other lines.

## Keys

- Every key of `en.js` must be there, and no others. The tests fail on a missing or an unknown key. When a new feature adds keys to `en.js` and `ru.js`, they have to be added to every translated file as well.
- Translate the meaning for this app, not word by word. Keep texts about as short as the English ones: they sit in buttons, table headers and phone tabs.
- Keys ending in `-title` are tooltips, `-hint` are explanations under a field, `-placeholder` go inside empty fields.

## Plurals

A text that depends on a number comes as a family of keys with suffixes, used through `tn('cal-entries', n)`:

| CLDR category | key suffix |
|---|---|
| zero | `-zero` |
| one | `-one` |
| two | `-two` |
| few | `-few` |
| many | `-many` |
| other | `-many` |

`other` is written as `-many` because the keys started with Russian and English. Every family in `en.js` has `-one`, `-few` and `-many`. Fill the forms your language uses (as `Intl.PluralRules` reports them) and put your best general form into the ones it does not use: English, German and Spanish use `-one` and `-many` (fill `-few` with the `-many` text), Russian, Ukrainian, Czech and Slovak `-one`, `-few` and `-many`. A language that needs `-zero` or `-two` may add them to each family; no other extra keys are allowed. A form that is missing at run time falls back to `-many`.

To see the categories of a language:

```js
new Intl.PluralRules('cs-CZ').resolvedOptions().pluralCategories
```

## Placeholders

`{n}`, `{amount}`, `{date}`, `{name}`, `{mod}` and the others are filled in by the app. Each translation must contain exactly the same placeholders as the English text, no more and no fewer; move them where your grammar needs them. `{amount}` is already formatted money ("2,450.50€"), `{date}` an already formatted date, `{mod}` the Cmd or Ctrl key.

## Typography

- No long dashes (U+2014, U+2013): use a comma, a colon, brackets or a plain hyphen. The tests reject them.
- No space before `%` or `€`: "84%", "12€". Amounts in the app always carry the symbol attached; texts follow the same rule.
- No invisible characters (no-break spaces, zero-width spaces, bidi marks). Where a language would normally use a narrow no-break space, write a plain space. The hygiene test scans every file.
- Quotation marks of your language are welcome ("...", «...», „...“), as long as they are used the same way throughout the file.
- A right to left language would get `dir: 'rtl'` in the registry; the layout already mirrors through logical properties.

## The app's own terms

Use one translation for each of these and keep it everywhere, in buttons, hints and the help:

| English | Russian | What it means |
|---|---|---|
| free money | свободные деньги | what is on the accounts minus what is set aside and goal money |
| set aside | отложено | money already reserved for a planned payment |
| envelope | конверт | a sub-account inside an account, for one purpose |
| done | состоялось | a payment or income that really happened |
| planned | план | expected, not happened yet |
| cancelled | отменено | will not happen, kept for the record |
| tracking start | начало учёта | the day from which balances are counted |
| recurring payment | регулярный платёж | a template that fills the plan every month, year... |
| quick entry | быстрая запись | the small dialog for an expense or an income |

Look at how `en.js` and `ru.js` say it before inventing a new word.

## Testing

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --force
npm test
npm run lint
```

`tests/languages.test.js` checks for every language: the keys, the placeholders, the plural forms (for ready languages), dashes and spaces before `%` and `€`, and that dates and money format. `tests/i18n.test.js` checks that every key the code uses exists.

To look at the language in the app before it is ready, run `npm run dev`, open the browser console and set it for the demo budget:

```js
const d = JSON.parse(localStorage.getItem('we_budget_data')); d.settings.language = 'sk'; localStorage.setItem('we_budget_data', JSON.stringify(d)); location.reload();
```

Check the screens with the longest texts: Settings, the Month table, the entry dialog, Analytics and, in a narrow window (under 760px), the phone layout.

## Done

Set `ready: true` only when the file is complete: every key translated (no English left except names such as Google Drive), the tests pass and the main screens have been looked at. Until then the stub or a partial file stays hidden from the picker, and missing texts show in English.
