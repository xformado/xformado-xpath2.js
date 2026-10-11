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
        //
        // ⚠️ `ä` and `ô` were in this class and are now out. They belong to
        // German and French as well, and the test suite quotes a German
        // sentence from a specification example — "Fängt er auch schon an zu
        // krähen" — which this rule refused on four lines. A rule that fires on
        // a legitimate test value teaches people to switch the check off.
        name: 'Slovak text',
        pattern: /[ľščťžňďĺŕĽŠČŤŽŇĎĹŔ]/g,
        why: 'a sentence in a language the rest of the file is not written in — translate it'
    },
    {
        // ⭐⭐ THE RULE THE OTHERS MISSED, AND IT IS THE ONE THAT MATTERS.
        //
        // Every rule above looks for an IDENTIFIER — a number, a name, a path.
        // The sentence that announced those rules carried none of them and went
        // out anyway: "a push can no longer add internal engineering text", "the
        // private planning repository", "it is the maintainer's decision". Prose
        // about how the work is organised is exactly what does not belong in a
        // public repository, and it is invisible to a pattern that hunts for
        // numbers.
        //
        // ⚠️ PHRASES, NOT WORDS. "internal" alone is a legitimate word in this
        // library ("internal representation"), and "maintainer" is ordinary open
        // source vocabulary. What is refused is the phrase that can only be
        // about our own process.
        name: 'process prose',
        pattern: /\b(?:internal (?:engineering|planning|requirement|finding|text)|engineering (?:text|process|repositor)|private planning|planning (?:document|repositor|tree)|implementation tree|maintainer's decision|requirement identifier|phase name|sign-?off|closeout|backlog item)\b/gi,
        why: 'prose about how the work is organised — a published file says what changed, not how it was decided'
    }
];

function tarballFiles() {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const parsed = JSON.parse(out);

    // Two shapes, because npm changed this between majors and the release
    // workflow installs the newest npm:
    //
    //   npm 11 — an array, one entry per packed package:  [ { files: [...] } ]
    //   npm 12 — an object keyed by package name:         { "@scope/name": { files: [...] } }
    //
    // Read whichever is there rather than assuming one. Measured on 11.16.0 and
    // 12.2.0, both listing the same 131 files for this package.
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed ?? {})[0];
    const files = entry?.files;
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error(
            'npm pack --dry-run --json listed no files — the shape it returned is '
            + `${Array.isArray(parsed) ? 'an array' : typeof parsed}`
            + ', and neither form carried a file list'
        );
    }
    return files.map((f) => f.path);
}

/**
 * Every file git tracks — which is what a public remote shows.
 *
 * ⭐ The tarball is the smaller question. `files` is `["lib"]`, so CHANGELOG.md,
 * the workflows and the whole of `test/` are outside it — and all of them are on
 * the public remote for anyone to read. Measured: the sentence that announced
 * this very guard sat in CHANGELOG.md, outside the tarball, invisible to the
 * scan that was supposed to catch it.
 */
function trackedFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const files = out.split('\0').filter((f) => f.length > 0 && !BINARY.test(f));
    if (files.length === 0) throw new Error('git ls-files listed no files');
    return files;
}

/** Read as text below, so anything that is not text is left out by name. */
const BINARY = /\.(?:png|jpe?g|gif|ico|woff2?|ttf|eot|pdf|zip|gz|tgz)$/i;

/**
 * The two checks themselves, and nothing else.
 *
 * ⚠️ A check has to name what it refuses: the patterns below spell out the
 * vocabulary they look for, so running the check over its own source reports
 * every pattern as a hit. Measured when the scope widened to the whole
 * repository: 23 of the 25 hits were these two files describing their own job.
 *
 * ⛔ The exemption is by exact path and covers nothing else — not the workflows,
 * not the tests, not the changelog. Whoever edits these two files is the one
 * person who already knows what does not belong in a public file.
 */
const SELF = new Set([
    'scripts/check-publish-text.mjs',
    'scripts/check-git-text.mjs'
]);

const SCOPE = process.argv.includes('--tarball') ? 'tarball' : 'tracked';

let paths;
try {
    paths = SCOPE === 'tarball' ? tarballFiles() : trackedFiles();
} catch (e) {
    // ⛔ Exit 2, never 0. A scan that could not run is not a clean scan, and the
    // whole point of this guard is that nobody has to check by eye.
    console.error(`check-publish-text: the scan could not be carried out — ${e.message}`);
    process.exit(2);
}

const hits = [];
for (const rel of paths) {
    if (SELF.has(rel)) continue;
    let text;
    try {
        text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
        console.error(`check-publish-text: ${rel} is published and could not be read — ${e.message}`);
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

console.log(
    SCOPE === 'tarball'
        ? `check-publish-text: ${paths.length} files would go out in the tarball`
        : `check-publish-text: ${paths.length} files are tracked and visible on the remote`
);

if (hits.length === 0) {
    console.log(
        SCOPE === 'tarball'
            ? 'OK — the tarball carries nothing that does not belong in it.'
            : 'OK — no file on the remote carries anything that does not belong in a public repository.'
    );
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
