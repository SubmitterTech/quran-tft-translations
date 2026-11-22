#!/usr/bin/env node
/**
 * Checks the translation files before they are committed or released.
 *
 * The apps in people's hands decide for themselves whether a downloaded file is usable, and
 * they cannot be changed after the fact. So the same rules are applied here first: a file an
 * app would refuse, or one that would make every device download text that did not change,
 * is stopped before it is published.
 *
 *   node scrapper/translation-work/validate.mjs [--base <git ref>] [--english <dir>]
 *                                               [--allow <code>]... [--summary <file>]
 *                                               [--result <file>]
 *
 * --base     The committed state to compare with. Default: HEAD, which is what a pull changes.
 *            The release workflow passes the last released commit.
 * --english  Directory with the English base files (qurantft.json, appendices.json, ...).
 *            They belong to the app repository; when this repository is its submodule they are
 *            one directory up and found without the option. The ENGLISH_BASE_DIR environment
 *            variable names them too. Without them the comparison with the English
 *            structure is skipped and said so.
 * --allow    Accept one reported problem on purpose, by the code printed with it
 *            (for example removed:map_fr). May be repeated.
 * --summary  Append a Markdown summary to this file.
 * --result   Write the outcome as JSON to this file: whether it passed, whether there was a
 *            base to compare with, and which published files changed, were added or were
 *            removed.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const KINDS = ['quran', 'appendices', 'introduction', 'map', 'application', 'cover'];

// English is the base language; its files do not follow the <kind>_<lang>.json convention.
const ENGLISH_FILES = {
    quran: 'qurantft.json',
    appendices: 'appendices.json',
    introduction: 'introduction.json',
    application: 'application.json',
    cover: 'cover.json',
};

// The floor each kind of content stays above. Same numbers as MINIMUM_BYTES_BY_KIND in the
// app's utils/ContentUpdater.js: an app treats an answer below them as an error page.
const MINIMUM_BYTES_BY_KIND = {
    quran: 40000,
    appendices: 10000,
    introduction: 2000,
    map: 10000,
    application: 800,
    cover: 100,
    languages: 200,
};

// A file this much smaller than its last committed version is more likely a cut short export
// than an edit.
const SHRINK_LIMIT = 0.8;

// Same test as isContentShaped in the app's utils/ContentStore.js: an app drops a downloaded
// file that fails it and goes back to the copy in its own package.
const isContentShaped = (kind, data) => {
    if (!data || typeof data !== 'object') {
        return false;
    }
    if (kind === 'quran') {
        const pages = Object.keys(data);
        if (pages.length < 300) return false;
        const page = data[pages[Math.floor(pages.length / 2)]];
        const suras = Object.values(page?.sura || {});
        return suras.length > 0 && Object.values(suras[0]?.verses || {}).some((v) => typeof v === 'string');
    }
    if (kind === 'appendices' || kind === 'introduction') {
        return Array.isArray(data) && data.length > 0 && typeof data[0] === 'object';
    }
    if (kind === 'application') {
        return Object.keys(data).length > 20 && typeof data.gw === 'string';
    }
    if (kind === 'cover') {
        return typeof data.quran === 'string' && typeof data.title === 'string';
    }
    return Object.keys(data).length > 0;
};

const parseArgs = (argv) => {
    const options = { base: 'HEAD', english: null, allow: new Set(), summary: null, result: null };
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        const value = argv[index + 1];
        if (name === '--base' && value) {
            options.base = value;
        } else if (name === '--english' && value) {
            options.english = path.resolve(value);
        } else if (name === '--allow' && value) {
            options.allow.add(value);
        } else if (name === '--summary' && value) {
            options.summary = path.resolve(value);
        } else if (name === '--result' && value) {
            options.result = path.resolve(value);
        } else {
            process.stderr.write(`Unknown or incomplete option: ${name}\n`);
            process.exit(2);
        }
        index += 1;
    }
    return options;
};

const options = parseArgs(process.argv.slice(2));

const errors = [];
const warnings = [];
const notes = [];
// Files that are there but could not be parsed; they are reported once, as invalid.
const unreadable = new Set();

// Every problem carries a code. Naming the code with --allow turns that one problem into a
// note, so an exception is a visible decision and not a switched off check.
const report = (code, message) => {
    if (options.allow.has(code)) {
        notes.push(`allowed ${code}: ${message}`);
    } else {
        errors.push(`${message} [${code}]`);
    }
};

const git = (...args) => execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
});

// The text an app receives: minified, UTF-8, exactly as the app's build publishes it.
const publish = (data) => Buffer.from(JSON.stringify(data));

// Key order aside, is it the same content? Arrays keep their order, objects do not count it.
const canonical = (value) => {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const readJson = (filePath, code) => {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        report(code, `${path.relative(repoRoot, filePath)} cannot be read: ${error.message}`);
        return undefined;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        report(code, `${path.relative(repoRoot, filePath)} is not valid JSON: ${error.message}`);
        return undefined;
    }
};

// --- What is in the working tree -------------------------------------------------------------

const isLanguageCode = (name) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(name);

const languages = fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isLanguageCode(entry.name))
    .map((entry) => entry.name)
    .filter((lang) => fs.readdirSync(path.join(repoRoot, lang)).some((file) => file.endsWith(`_${lang}.json`)))
    .sort();

// Published name -> { kind, lang, relativePath, data, bytes }
const current = new Map();

languages.forEach((lang) => {
    fs.readdirSync(path.join(repoRoot, lang)).sort().forEach((file) => {
        const match = file.match(/^([a-z]+)_(.+)\.json$/);
        if (!match || match[2] !== lang || !KINDS.includes(match[1])) {
            warnings.push(`${lang}/${file} is not a file the apps read`);
            return;
        }
        const kind = match[1];
        const name = `${kind}_${lang}`;
        const data = readJson(path.join(repoRoot, lang, file), `invalid:${name}`);
        if (data !== undefined) {
            current.set(name, { kind, lang, relativePath: `${lang}/${file}`, data, bytes: publish(data) });
        } else {
            unreadable.add(name);
        }
    });
});

const catalog = readJson(path.join(repoRoot, 'languages.json'), 'invalid:languages');
if (catalog === undefined) {
    unreadable.add('languages');
} else {
    current.set('languages', {
        kind: 'languages',
        lang: null,
        relativePath: 'languages.json',
        data: catalog,
        bytes: publish(catalog),
    });
}

// --- What an app would accept ----------------------------------------------------------------

current.forEach((file, name) => {
    if (file.kind !== 'languages' && !isContentShaped(file.kind, file.data)) {
        report(`shape:${name}`, `${file.relativePath} does not have the shape the apps expect of ${file.kind} content`);
    }

    // An app holds two sizes against the floor: the length the server announces, which may be
    // the compressed one, and the size of the file it ends up with.
    const floor = MINIMUM_BYTES_BY_KIND[file.kind];
    const compressed = zlib.gzipSync(file.bytes).length;
    if (Math.min(compressed, file.bytes.length) < floor) {
        report(
            `small:${name}`,
            `${file.relativePath} is ${file.bytes.length} bytes, ${compressed} compressed, below the ${floor} bytes the apps take for real ${file.kind} content`
        );
    }
});

// The catalog decides which languages are offered, and "comp" decides whether one can be
// picked. An entry an app cannot read that way must never reach it.
if (catalog !== undefined) {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        report('shape:languages', 'languages.json must be an object keyed by language code');
    } else {
        Object.entries(catalog).forEach(([code, entry]) => {
            const problems = [];
            if (!entry || typeof entry !== 'object') {
                problems.push('is not an object');
            } else {
                if (typeof entry.name !== 'string' || !entry.name.trim()) problems.push('has no name');
                if (entry.dir !== 'ltr' && entry.dir !== 'rtl') problems.push('has no dir of ltr or rtl');
                if (typeof entry.nums !== 'string' || !entry.nums.trim()) problems.push('has no nums');
                if (typeof entry.comp !== 'number' || !(entry.comp >= 0 && entry.comp <= 100)) {
                    problems.push('has no comp between 0 and 100');
                }
            }
            if (problems.length > 0) {
                report(`catalog:${code}`, `languages.json: "${code}" ${problems.join(', ')}`);
            }
        });

        languages.forEach((lang) => {
            if (current.has(`quran_${lang}`) && !catalog[lang]) {
                report(`catalog:${lang}`, `${lang}/ has a Quran text but languages.json has no "${lang}" entry`);
            }
        });
    }
}

// --- Same structure as the English base ------------------------------------------------------

const mountedEnglish = path.resolve(repoRoot, '..');
const englishRoot = options.english
    || (process.env.ENGLISH_BASE_DIR ? path.resolve(process.env.ENGLISH_BASE_DIR) : null)
    || (fs.existsSync(path.join(mountedEnglish, ENGLISH_FILES.quran)) ? mountedEnglish : null);

const quranSlots = (data) => {
    const slots = new Set();
    Object.keys(data || {}).forEach((page) => {
        const suras = data[page]?.sura || {};
        Object.keys(suras).forEach((sura) => {
            Object.keys(suras[sura]?.verses || {}).forEach((verse) => slots.add(`page ${page}, ${sura}:${verse}`));
        });
    });
    return slots;
};

const difference = (from, other) => [...from].filter((item) => !other.has(item));
const sample = (items) => `${items.slice(0, 3).join('; ')}${items.length > 3 ? `; and ${items.length - 3} more` : ''}`;
const count = (number, noun) => `${number} ${noun}${number === 1 ? '' : 's'}`;

if (englishRoot) {
    const english = {};
    Object.entries(ENGLISH_FILES).forEach(([kind, fileName]) => {
        const filePath = path.join(englishRoot, fileName);
        if (!fs.existsSync(filePath)) {
            warnings.push(`English ${fileName} was not found in ${englishRoot}; ${kind} files are not compared with it`);
            return;
        }
        try {
            english[kind] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            warnings.push(`English ${fileName} could not be parsed; ${kind} files are not compared with it`);
        }
    });

    const englishSlots = english.quran ? quranSlots(english.quran) : null;

    current.forEach((file, name) => {
        const base = english[file.kind];
        if (!base || file.kind === 'languages') {
            return;
        }

        if (file.kind === 'quran') {
            const slots = quranSlots(file.data);
            const missing = difference(englishSlots, slots);
            const extra = difference(slots, englishSlots);
            if (missing.length > 0) {
                report(`structure:${name}`, `${file.relativePath} lacks ${count(missing.length, 'verse')} the English text has: ${sample(missing)}`);
            }
            if (extra.length > 0) {
                report(`structure:${name}`, `${file.relativePath} has ${count(extra.length, 'verse')} the English text does not: ${sample(extra)}`);
            }
        } else if (file.kind === 'appendices' || file.kind === 'introduction') {
            if (Array.isArray(file.data) && file.data.length !== base.length) {
                report(`structure:${name}`, `${file.relativePath} has ${file.data.length} entries, the English text has ${base.length}`);
            }
        } else if (file.kind === 'application' || file.kind === 'cover') {
            const known = new Set(Object.keys(base));
            const unknown = Object.keys(file.data || {}).filter((key) => !known.has(key));
            const untranslated = [...known].filter((key) => !(key in (file.data || {})));
            if (unknown.length > 0) {
                report(`structure:${name}`, `${file.relativePath} has keys the English file does not: ${sample(unknown)}`);
            }
            if (untranslated.length > 0) {
                // The app falls back to English for a missing key, so this is worth knowing, not wrong.
                warnings.push(`${file.relativePath} lacks ${untranslated.length} keys the English file has: ${sample(untranslated)}`);
            }
        }
    });
} else {
    notes.push('the English base files are not here, so the structure was not compared with them (see --english)');
}

// --- Against the last committed state --------------------------------------------------------

let baseNames = null;
try {
    baseNames = git('ls-tree', '-r', '--name-only', options.base).split('\n').filter(Boolean);
} catch (error) {
    notes.push(`"${options.base}" does not exist yet, so every file counts as new`);
}

const changed = [];
const added = [];
const removed = [];

if (!baseNames) {
    // Nothing has been published before, so all of it is about to be.
    current.forEach((file, name) => added.push(name));
} else {
    const baseFiles = new Map();
    baseNames.forEach((relativePath) => {
        if (relativePath === 'languages.json') {
            baseFiles.set('languages', relativePath);
            return;
        }
        const match = relativePath.match(/^([^/]+)\/([a-z]+)_(.+)\.json$/);
        if (match && match[1] === match[3] && isLanguageCode(match[1]) && KINDS.includes(match[2])) {
            baseFiles.set(`${match[2]}_${match[1]}`, relativePath);
        }
    });

    baseFiles.forEach((relativePath, name) => {
        if (!current.has(name) && !unreadable.has(name)) {
            removed.push(name);
            // An app that asks for it would get nothing; a reader of that language loses it.
            report(`removed:${name}`, `${relativePath} is in ${options.base} and missing now`);
        }
    });

    current.forEach((file, name) => {
        const basePath = baseFiles.get(name);
        if (!basePath) {
            added.push(name);
            return;
        }

        let before;
        try {
            before = JSON.parse(git('show', `${options.base}:${basePath}`));
        } catch (error) {
            // The committed version was not valid JSON, so there is nothing sound to compare with.
            changed.push(name);
            return;
        }
        const beforeBytes = publish(before);
        if (beforeBytes.equals(file.bytes)) {
            return;
        }
        changed.push(name);

        if (canonical(before) === canonical(file.data)) {
            // Only the order of keys moved. The text is the same, but its bytes are not, and
            // every device reading this language would download the file again for nothing.
            report(`reordered:${name}`, `${file.relativePath} holds the same content as in ${options.base} in a different key order`);
        } else if (file.bytes.length < beforeBytes.length * SHRINK_LIMIT) {
            report(
                `shrunk:${name}`,
                `${file.relativePath} shrank from ${beforeBytes.length} to ${file.bytes.length} bytes since ${options.base}`
            );
        }

        if (name === 'languages') {
            Object.keys(before || {}).filter((code) => !(code in (file.data || {}))).forEach((code) => {
                report(`removed:catalog:${code}`, `languages.json no longer lists "${code}", which ${options.base} does`);
            });
        }
    });
}

// --- Report ----------------------------------------------------------------------------------

const lines = [];
lines.push(`${current.size} files for ${languages.length} languages checked`);
if (baseNames) {
    lines.push(`compared with ${options.base}: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
}
[...changed.sort(), ...added.sort().map((name) => `${name} (new)`)].forEach((name) => lines.push(`  ${name}`));
notes.forEach((note) => lines.push(`note: ${note}`));
warnings.forEach((warning) => lines.push(`warning: ${warning}`));
errors.forEach((error) => lines.push(`error: ${error}`));
lines.push(errors.length > 0 ? `FAILED: ${errors.length} problem(s)` : 'OK');
process.stdout.write(`${lines.join('\n')}\n`);

if (options.summary) {
    const listed = [...changed.sort(), ...added.sort().map((name) => `${name} (new)`)];
    const summary = [
        errors.length > 0 ? `### Validation failed: ${errors.length} problem(s)` : '### Validation passed',
        '',
        `${current.size} files for ${languages.length} languages checked${baseNames ? `, compared with \`${options.base}\`` : ''}.`,
        '',
        listed.length > 0
            ? `Files whose published bytes change. A device reading one of these languages downloads them again:\n\n${listed.map((name) => `- \`${name}\``).join('\n')}`
            : 'No published file changes.',
        '',
        ...errors.map((error) => `- **error:** ${error}`),
        ...warnings.map((warning) => `- warning: ${warning}`),
        ...notes.map((note) => `- note: ${note}`),
        '',
    ].join('\n');
    fs.appendFileSync(options.summary, summary);
}

if (options.result) {
    fs.writeFileSync(options.result, `${JSON.stringify({
        ok: errors.length === 0,
        // False when the base does not exist yet, which is the case before the first release.
        compared: Boolean(baseNames),
        changed: changed.sort(),
        added: added.sort(),
        removed: removed.sort(),
    }, null, 4)}\n`);
}

process.exit(errors.length > 0 ? 1 : 0);
