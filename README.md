# Quran: The Final Testament — Translations

The translations of *Quran: The Final Testament* (Authorized English Version, translated from
the original by Rashad Khalifa, Ph.D.), as the [quran-tft](https://github.com/SubmitterTech/quran-tft)
apps show them: [qurantft.com](https://qurantft.com), the iOS app and the Android app.

Translators work on [Transifex](https://explore.transifex.com/submittertech/quranthefinaltestament/).
A bot brings their work here on its own, checks it and commits it. Nobody edits the texts in
this repository, so what you find here is what the translators wrote, and it keeps itself up
to date.

You are welcome to use the translations in your own app or site, as they are and free of
charge.

## License

### The translation texts

The translation texts are the files in the language directories, the ones named by a language
code.

Each translation is the work of its translators, and the copyright in it is theirs. The texts
are published under the **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
International** license ([CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)).
Its full text is in [LICENSE](LICENSE).

In short, you may:

- read, copy and share the texts as much as you like, in any medium or format;
- use them as they are in your own app, site or publication.

On three conditions:

- **No changes.** You may not share a text you have changed: nothing added, nothing removed,
  nothing reworded, and no new translation made from it. Technical changes needed to show a
  text in another medium or format are not changes in this sense, and neither is sharing a
  part of a text, such as a verse, exactly as it is.
- **Not for profit.** The texts are not to be sold or used to make money. Any use primarily
  intended for commercial advantage or payment is outside the license.
- **Credit.** Say what the text is and that its copyright belongs to its translators, link to
  this repository, and name the license. For example:

  > *Quran: The Final Testament*, Turkish translation. © its translators. Unchanged, from
  > github.com/SubmitterTech/quran-tft-translations, under CC BY-NC-ND 4.0.

This work is done in the service of God. A translation of scripture is trusted because it
says what its translators wrote, and it is given freely. That is why the texts may travel as
far as anyone carries them, but may not be altered and may not be sold.

If you find a mistake, please report it, on Transifex or in an issue here, so the translators
can correct it for everyone. A copy you corrected yourself may not be shared.

This summary is not the license. The license is.

### Everything else

Everything that is not a translation text is under the **Apache License 2.0**. Its full text
is in [LICENSE-CODE](LICENSE-CODE).

## Using the translations

### What to read

Take the texts from the **`release`** branch. It holds the latest state that passed the
checks and it only ever moves forward. `main` is where the bot's commits land before they are
checked.

| File | What it holds |
|---|---|
| `languages.json` | Every language: its name, direction, digits, and how complete its translation is (`comp`, in percent) |
| `<lang>/quran_<lang>.json` | The text, page by page |
| `<lang>/introduction_<lang>.json`, `<lang>/appendices_<lang>.json` | The introduction and the appendices |
| `<lang>/map_<lang>.json` | The subject index |
| `<lang>/cover_<lang>.json`, `<lang>/application_<lang>.json` | The cover page and the app's own interface |

`languages.json` is the list to go by: languages are added as translators take them up, and
none of this needs a change in your code. A language is ready to offer when its `comp` is
high enough for you.

Each file has a stable address:

```
https://raw.githubusercontent.com/SubmitterTech/quran-tft-translations/release/tr/quran_tr.json
https://cdn.jsdelivr.net/gh/SubmitterTech/quran-tft-translations@release/tr/quran_tr.json
```

### Staying up to date

The repository updates itself, so the only question is how you want to hear about it. Every
change to the published texts becomes a [release](https://github.com/SubmitterTech/quran-tft-translations/releases)
that lists the files that changed.

- **Ask when you need it.** Both addresses above answer with an `ETag`. Send it back in
  `If-None-Match` and you download a file only when it changed. The quran-tft apps compare
  ETags in the same way when they start.
- **Follow the releases.** Use **Watch → Custom → Releases** on GitHub for a notification, or
  read the feed at
  `https://github.com/SubmitterTech/quran-tft-translations/releases.atom` from a scheduled
  job and rebuild when it has a new entry.
- **Pin it in your repository.** Add this repository as a git submodule that follows
  `release`. Dependabot can then open a pull request whenever the texts change:

  ```yaml
  # .github/dependabot.yml
  version: 2
  updates:
    - package-ecosystem: gitsubmodule
      directory: /
      schedule:
        interval: daily
  ```

GitHub only lets a repository's own maintainers add webhooks to it, so there is no public
webhook to subscribe to. The feed and the conditional request above do the same job from your
side.

### What stays the same

Apps that are already installed read these files by address and cannot be told a new one. So
the name of this repository, the `release` branch, the layout above and the shape of the files
do not change.

## Do not edit the texts here

The files in the language directories are written by the bot, and its next run overwrites
them. A correction made here is lost. Make it on Transifex.
