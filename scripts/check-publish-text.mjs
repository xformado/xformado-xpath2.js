/**
 * Refuse to publish a tarball that carries internal engineering text.
 *
 * ⭐⭐ WHY IT MEASURES THE TARBALL AND NOT THE WORKING COPY. What goes out of
 * this repository is decided by `files` in package.json and by `.npmignore`, not
 * by what is on disk — so a scan over the working tree answers a different
 * question and can be green while the published package is not. The file list
 * here comes from `npm pack --dry-run --json`, which is npm's own answer to
 * "what would I ship", and every file in that list is then read.
 *
 * ⛔ WHAT IT IS FOR. A library published to a public registry is read by people
 * who have no business with how it was built. An internal requirement number, a
 * person's name next to a dated decision, a reference to a planning tree or a
 * sentence in a language the rest of the file is not written in are all things
 * that were written for a colleague and then shipped to strangers. One such line
 * reached `lib/` and survived two releases, which is why this exists as a guard
 * in the repository instead of a step someone is supposed to remember.
 *
 * Hooked to `prepublishOnly`, which npm runs for `npm publish` and NOT for
 * `npm pack` — so the pack below cannot re-enter this script.
 *
 * Exit codes: 0 clean · 1 something would be published · 2 the scan itself could
 * not be carried out, which must never read as "clean".
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ⭐⭐ WHERE A REAL NAME IS THE POINT OF THE LINE, and therefore not a leak.
 *
 * ⛔ This list exists so that the guard can be strict everywhere else. A guard
 * that reports the copyright holder of the LICENCE as a finding is a guard
 * somebody switches off within a week, and then it reports nothing at all. Each
 * entry is a PLACE whose whole function is to carry an identity:
 *
 *   · a licence names its copyright holder — that is what makes it a licence;
 *   · the author, maintainer and repository fields of package.json are what npm
 *     renders as "who publishes this", and they are declared, not narrated.
 *
 * ⚠️ IT IS SCOPED TO LINES, NOT TO FILES. package.json is still scanned for
 * everything else, so a requirement number or a Slovak sentence in `description`
 * or `keywords` is still refused — those are prose about the package and are
 * read by strangers.
 */
const IDENTITY_LINES = [
    {
        file: 'LICENSE',
        pattern: /^\s*Copyright \(c\)/,
        why: 'the copyright holder of the licence'
    },
    {
        file: 'package.json',
        pattern: /^\s*"(?:name|email|url|type)"\s*:/,
        why: 'an authorship or repository field npm renders as declared metadata'
    }
];

/** Rules that are about identity, and so answer to the list above. */
const IDENTITY_RULES = new Set(['personal name', 'Slovak text']);

function isDeclaredIdentity(rel, line) {
    return IDENTITY_LINES.some((e) => e.file === rel && e.pattern.test(line));
}

/**
 * Each rule says what it looks for and, in `why`, what to do about a hit — a
 * guard that only says "found something" sends the reader back to guessing.
 */
const RULES = [
    {
        name: 'requirement number',
        pattern: /\bREQ-\d{2,4}\b/g,
        why: 'an internal requirement identifier — describe the behaviour instead'
    },
    {
        name: 'finding number',
        pattern: /\bBUG-\d{2,4}\b/g,
        why: 'an internal finding identifier — describe the defect instead'
    },
    {
        name: 'personal name',
        pattern: /\bIvan\b/g,
        why: 'a colleague named next to a decision — keep the REASON, drop the name and the date'
    },
    {
        name: 'engineering repository',
        pattern: /xformado-engineering/g,
        why: 'a reference to the private planning repository'
    },
    {
        name: 'planning tree or phase',
        pattern: /\b(?:f[aá]za|v[ĺl]na|blok)\s*\d|\bimplementations\/\d{4}-\d{2}-\d{2}/gi,
        why: 'an internal planning identifier — a published file cannot cite one'
    },
    {
        // The diacritics that do not occur in English or in the specification
        // vocabulary this library quotes. Deliberately not every accented
        // letter: a published file may legitimately quote a specification
        // example or a test value containing one.
        name: 'Slovak text',
        pattern: /[ľščťžňďĺŕôäĽŠČŤŽŇĎĹŔÔÄ]/g,
        why: 'a sentence in a language the rest of the file is not written in — translate it'
    }
];

function tarballFiles() {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const parsed = JSON.parse(out);
    const files = parsed?.[0]?.files;
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('npm pack --dry-run --json listed no files');
    }
    return files.map((f) => f.path);
}

let paths;
try {
    paths = tarballFiles();
} catch (e) {
    // ⛔ Exit 2, never 0. A scan that could not run is not a clean scan, and the
    // whole point of this guard is that nobody has to check by eye.
    console.error(`check-publish-text: the scan could not be carried out — ${e.message}`);
    process.exit(2);
}

const hits = [];
for (const rel of paths) {
    let text;
    try {
        text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
        console.error(`check-publish-text: ${rel} is in the tarball and could not be read — ${e.message}`);
        process.exit(2);
    }
    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
        const identity = IDENTITY_RULES.has(rule.name);
        lines.forEach((line, i) => {
            if (identity && isDeclaredIdentity(rel, line)) return;
            rule.pattern.lastIndex = 0;
            const m = rule.pattern.exec(line);
            if (m) hits.push({ rel, line: i + 1, rule, found: m[0], text: line.trim() });
        });
    }
}

console.log(`check-publish-text: ${paths.length} files would be published`);

if (hits.length === 0) {
    console.log('OK — no internal engineering text in the tarball.');
    process.exit(0);
}

console.error(`\n⛔ REFUSED: ${hits.length} line(s) of internal text would be published.\n`);
for (const h of hits) {
    console.error(`  ${h.rel}:${h.line} — ${h.rule.name} ("${h.found}")`);
    console.error(`      ${h.text.length > 150 ? h.text.slice(0, 150) + '…' : h.text}`);
    console.error(`      ⇒ ${h.rule.why}`);
}
console.error('\nNothing was published. Fix the lines above and run the publish again.');
process.exit(1);
