/**
 * Refuse to ADD internal engineering text to a public git history.
 *
 * ⭐⭐ WHY A SECOND GUARD, when check-publish-text.mjs already exists. That one
 * measures the TARBALL, and the tarball is not the only thing that leaves this
 * repository: the git history does too, and this remote is public. A sentence
 * deleted from `lib/` in a later commit is gone from every future tarball and
 * still sits in `git log -p` for anyone who clones. ⛔ So the first guard going
 * green says nothing at all about the history — closing one door is not closing
 * the other, and that was measured rather than argued: the sentence the tarball
 * guard was written for is still readable in this repository's public history.
 *
 * ⭐ WHAT IT CHECKS, AND WHY ONLY THAT. It scans the commits a push WOULD ADD —
 * `<upstream>..HEAD` — and in each one both the message and the lines it adds.
 * That is the part that is still preventable.
 *
 * ⛔ IT DOES NOT SCAN THE WHOLE HISTORY, and that is deliberate rather than
 * lazy. What is already public cannot be made unpublic by a check: undoing it
 * means rewriting published history, which breaks every existing clone and is
 * somebody's decision, not a script's. A guard that failed on it would fail for
 * ever and be switched off within a week — which is exactly how the first leak
 * survived. Use `--all` to report over the whole history when somebody is
 * weighing that decision; it reports and never fails.
 *
 * ⚠️ NOT WIRED TO prepublishOnly, for the same reason: `npm publish` ships the
 * tarball, which the other guard covers, and blocking a release on history that
 * is already out would be a script taking a decision it cannot carry.
 *
 *     npm run check:git-text          what a push would add
 *     npm run check:git-text -- --all  the whole history, as a report
 *
 * Exit codes: 0 clean · 1 a push would add internal text · 2 the scan itself
 * could not be carried out, which must never read as "clean".
 */
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportOnly = process.argv.includes('--all');

/** The same rules as the tarball guard, and deliberately the same wording. */
const RULES = [
    { name: 'requirement number', pattern: /\bREQ-\d{2,4}\b/,
      why: 'an internal requirement identifier' },
    { name: 'finding number', pattern: /\bBUG-\d{2,4}\b/,
      why: 'an internal finding identifier' },
    { name: 'personal name', pattern: /\bIvan\b/,
      why: 'a colleague named next to a decision' },
    { name: 'engineering repository', pattern: /xformado-engineering/,
      why: 'a reference to the private planning repository' },
    { name: 'planning tree or phase', pattern: /\b(?:f[aá]za|v[ĺl]na|blok)\s*\d|\bimplementations\/\d{4}-\d{2}-\d{2}/i,
      why: 'an internal planning identifier' },
    // ⚠️ `ä` and `ô` are deliberately out: German and French have them too, and
    // this very check refused a commit message that named them as its subject.
    { name: 'Slovak text', pattern: /[ľščťžňďĺŕĽŠČŤŽŇĎĹŔ]/,
      why: 'a sentence in a language the repository is not written in' }
];

/** A licence names its copyright holder, and an author field is an author. */
RULES.push({
    name: 'process prose',
    // Phrases, not words: "internal" alone is legitimate in this library and
    // "maintainer" is ordinary open source vocabulary. What is refused is the
    // phrasing that can only be about how the work is organised.
    pattern: /\b(?:internal (?:engineering|planning|requirement|finding|text)|engineering (?:text|process|repositor)|private planning|planning (?:document|repositor|tree)|implementation tree|maintainer's decision|requirement identifier|phase name|sign-?off|closeout|backlog item)\b/i,
    why: 'prose about how the work is organised — a public repository says what changed, not how it was decided'
});

const IDENTITY = [
    { file: 'LICENSE', pattern: /^\s*\+?\s*Copyright \(c\)/ },
    { file: 'package.json', pattern: /^\s*\+?\s*"(?:name|email|url|type)"\s*:/ }
];
const IDENTITY_RULES = new Set(['personal name', 'Slovak text']);

/**
 * ⭐ THE GUARDS THEMSELVES, which have to contain what they look for.
 *
 * ⛔ Not a convenience. These two files hold the patterns as source code, so
 * every rule matches them by construction — and a guard that reports itself is
 * one somebody silences. ⚠️ Scoped to these two paths by name and to nothing
 * else: any other file that mentions a requirement number is still a finding.
 * ⭐ Their COMMIT MESSAGES are still scanned, because nothing makes a message
 * about a guard need an internal identifier in it.
 */
const SELF = new Set(['scripts/check-publish-text.mjs', 'scripts/check-git-text.mjs']);

function git(args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The commits a push would add, or the whole history under --all. */
function range() {
    if (reportOnly) return [];
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const upstream = `origin/${branch}`;
    try {
        git(['rev-parse', '--verify', upstream]);
    } catch {
        // ⛔ Not "nothing to check": a branch with no upstream is a branch whose
        // every commit a push would add. Fall back to the whole history rather
        // than to silence.
        return ['HEAD'];
    }
    return [`${upstream}..HEAD`];
}

let shas;
try {
    shas = git(['log', '--format=%H', ...range()]).split('\n').filter(Boolean);
} catch (e) {
    console.error(`check-git-text: the scan could not be carried out — ${e.message}`);
    process.exit(2);
}

if (shas.length === 0) {
    console.log('check-git-text: a push would add no commits — nothing to check.');
    process.exit(0);
}

const hits = [];
for (const sha of shas) {
    const subject = git(['log', '-1', '--format=%s%n%b', sha]);
    for (const rule of RULES) {
        for (const [i, line] of subject.split('\n').entries()) {
            if (rule.pattern.test(line)) {
                hits.push({ sha, where: `message line ${i + 1}`, rule, text: line.trim() });
                break;
            }
        }
    }
    // Only the lines a commit ADDS — a commit that DELETES a leaking line is
    // the repair, and reporting it would punish the fix.
    let added;
    try {
        added = git(['show', '--format=', '--unified=0', sha]);
    } catch { continue; }
    let file = '';
    for (const line of added.split('\n')) {
        if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        if (SELF.has(file)) continue;
        if (IDENTITY.some((e) => e.file === file && e.pattern.test(line))) continue;
        for (const rule of RULES) {
            if (rule.pattern.test(line)) {
                hits.push({ sha, where: file, rule, text: line.slice(1).trim() });
            }
        }
    }
}

console.log(`check-git-text: ${shas.length} commit(s) examined`
    + (reportOnly ? ' (whole history — report only)' : ' (what a push would add)'));

if (hits.length === 0) {
    console.log('OK — no internal engineering text.');
    process.exit(0);
}

const head = reportOnly ? '⚠️ REPORT' : '⛔ REFUSED';
console.error(`\n${head}: ${hits.length} place(s) carrying internal text.\n`);
for (const h of hits) {
    console.error(`  ${h.sha.slice(0, 7)} ${h.where} — ${h.rule.name}`);
    console.error(`      ${h.text.length > 140 ? h.text.slice(0, 140) + '…' : h.text}`);
    console.error(`      ⇒ ${h.rule.why}`);
}

if (reportOnly) {
    console.error('\n⚠️ Already public. Undoing this means rewriting published history, which'
        + '\n   breaks every existing clone — a decision for the maintainer, not for a script.');
    process.exit(0);
}
console.error('\nNothing was pushed. Reword the commits above before pushing.');
process.exit(1);
