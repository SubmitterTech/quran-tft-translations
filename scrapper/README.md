# Tools

What keeps the translations in this repository. The bot in `.github/workflows/release.yml`
runs them every six hours; this is how to run them by hand.

This repository is usually checked out inside the app repository, at
`app/src/assets/translations`. A submodule sits on a commit, not on a branch, so before
pulling:

```bash
git switch main && git pull --ff-only
```

Set up once:

```bash
python3 -m venv scrapper/.venv
scrapper/.venv/bin/pip install -r scrapper/requirements.txt
```

and put the Transifex API key in `scrapper/translation-work/transifex-api-key`, which git
ignores, or in the `TRANSIFEX_API_TOKEN` environment variable.

Pull:

```bash
scrapper/.venv/bin/python scrapper/translation-work/pull_translations.py
```

It writes the files, checks them, and asks before it commits. `--help` lists the options.
Pushing `main` starts the release.

Check without pulling:

```bash
node scrapper/translation-work/validate.mjs
```

A check that fails prints a code with each problem, such as `removed:map_fr`. When the change
is intended, run the release workflow by hand and give that code in its `allow` field.

When the English subject index changes, follow [map-work/README.md](map-work/README.md).

`scraping-work/` and `playground/` hold how the English text was first extracted, and one-off
helpers. Some of them expect the app repository's `source/` directory.
