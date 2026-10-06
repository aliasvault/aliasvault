/**
 * Helper of audit-dependencies.sh: parses audit output, looks up advisories and prints the report.
 * Findings go to the AUDIT_FINDINGS TSV file, see `emit`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , cmd, ...args] = process.argv;
const { AUDIT_REPO_ROOT: repoRoot = '.', AUDIT_ALLOWLIST: allowFile, AUDIT_FINDINGS: findingsFile } = process.env;
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4, unknown: 3 };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clean = (s) => String(s ?? '').replace(/[\t\n\r]+/g, ' ').trim();

/* ---- Shared helpers ---- */

/** Absolute path of a repo-relative path. */
const repoPath = (...parts) => path.join(repoRoot, ...parts);

/** Allowlist entries per ecosystem, empty when disabled. */
const allowEntries = !allowFile || allowFile === '-' || !fs.existsSync(allowFile) ? {} : readJson(allowFile);

/** Whether an advisory (id plus aliases in `ids`) for a package is allowlisted. */
function isAllowed(eco, ids, pkg) {
    return (allowEntries[eco] ?? []).some((e) => ids.includes(e.id) && (!e.package || e.package === pkg));
}

/** Append one finding row to the findings file; `ids` are the advisory id and its aliases, used for the allowlist. */
function emit({ ids, ...row }) {
    const allowed = isAllowed(row.eco, ids ?? [row.id], row.pkg);
    fs.appendFileSync(findingsFile, [row.eco, row.project, row.pkg, row.version, row.severity, row.id, row.title, row.fix, allowed ? 'yes' : 'no'].map(clean).join('\t') + '\n');
}

/** Fetch JSON, or null on a non-2xx response. */
async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers });
    return res.ok ? res.json() : null;
}

/** Split a version into numeric parts and a prerelease/qualifier label. */
function parseVersion(v) {
    const [main, ...rest] = String(v).split('+')[0].split('-');
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre: rest.join('-') };
}

/** Whether a version is a release (no prerelease label, Maven -jre/-android style qualifiers allowed). */
function isStable(v) {
    const pre = parseVersion(v).pre.toLowerCase();
    return !pre || /^(jre|android|final|release|ga)$/.test(pre);
}

/** Compare two dotted versions; a prerelease sorts before its release. */
function compareVersions(a, b) {
    const pa = parseVersion(a), pb = parseVersion(b);
    for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
        const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
        if (d) return d;
    }
    if (isStable(a) && isStable(b)) return 0;
    if (isStable(a)) return 1;
    if (isStable(b)) return -1;
    return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
}

/** The semver "breaking change" key: the major, or major.minor for 0.x versions. */
function majorKey(v) {
    const { nums } = parseVersion(v);
    return nums[0] === 0 ? `0.${nums[1] ?? 0}` : String(nums[0]);
}

/** CVSS 3.x base severity from a vector string; "unknown" for anything else. */
function cvssSeverity(vector) {
    if (!vector || !/^CVSS:3\.[01]\//.test(vector)) return 'unknown';
    const m = Object.fromEntries(vector.split('/').slice(1).map((p) => p.split(':')));
    const changed = m.S === 'C';
    const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
    const ac = { L: 0.77, H: 0.44 }[m.AC];
    const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
    const ui = { N: 0.85, R: 0.62 }[m.UI];
    const cia = (x) => ({ H: 0.56, L: 0.22, N: 0 }[x]);
    const iss = 1 - (1 - cia(m.C)) * (1 - cia(m.I)) * (1 - cia(m.A));
    const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
    const exploitability = 8.22 * av * ac * pr * ui;
    if (impact <= 0) return 'low';
    const score = Math.ceil(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10) * 10) / 10;
    return score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'moderate' : 'low';
}

/* ---- OSV (used for Gradle and CocoaPods, which have no local audit tool) ---- */

const osvCache = {};

/** Run OSV queries ({ package: { name, ecosystem }, version }) and return the vulnerability ids per query. */
async function osvQueryBatch(queries) {
    const result = [];
    for (let i = 0; i < queries.length; i += 500) {
        const res = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', body: JSON.stringify({ queries: queries.slice(i, i + 500) }) });
        if (!res.ok) throw new Error(`OSV query failed: HTTP ${res.status}`);
        for (const r of (await res.json()).results) result.push((r.vulns ?? []).map((v) => v.id));
    }
    return result;
}

/** Full OSV record of a vulnerability. */
async function osvVuln(id) {
    osvCache[id] ??= await getJson(`https://api.osv.dev/v1/vulns/${id}`);
    return osvCache[id];
}

/** Severity of an OSV record: the GitHub severity label when present, else from the CVSS 3 vector. */
function osvSeverity(vuln) {
    const label = String(vuln.database_specific?.severity ?? '').toLowerCase();
    if (SEVERITY_RANK[label] !== undefined) return label;
    if (label === 'medium') return 'moderate';
    const v3 = (vuln.severity ?? []).find((s) => s.type === 'CVSS_V3');
    return cvssSeverity(v3?.score);
}

/** Preferred display id of an OSV record (the GHSA id when it has one). */
function osvDisplayId(vuln) {
    return [vuln.id, ...(vuln.aliases ?? [])].find((id) => id.startsWith('GHSA-')) ?? vuln.id;
}

/** Lowest "fixed" version above the current one for a package in an OSV record, or null. */
function osvFixedAbove(vuln, ecosystem, name, current) {
    const fixed = (vuln.affected ?? [])
        .filter((a) => a.package?.ecosystem === ecosystem && a.package?.name === name)
        .flatMap((a) => (a.ranges ?? []).flatMap((r) => (r.events ?? []).map((e) => e.fixed)))
        .filter((v) => v && compareVersions(v, current) > 0)
        .sort(compareVersions);
    return fixed[0] ?? null;
}

/* ---- npm ---- */

/** Whether a version satisfies an npm advisory range such as ">=4.0.0 <4.3.2" or "<=3.0.3". */
function npmRangeMatch(version, range) {
    return range.split('||').some((part) => part.trim().split(/\s+/).filter(Boolean).every((token) => {
        if (token === '*') return true;
        const [, op = '=', v] = token.match(/^(>=|<=|>|<|=)?v?(.+)$/);
        const c = compareVersions(version, v);
        return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[op];
    }));
}

/** Installed versions of a package according to package-lock.json. */
function lockedVersions(lock, name) {
    return [...new Set(Object.entries(lock.packages ?? {}).filter(([key, p]) => key.endsWith(`node_modules/${name}`) && p.version && !p.link).map(([, p]) => p.version))];
}

/** Published release versions of an npm package. */
async function npmVersions(name) {
    const meta = await getJson(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { Accept: 'application/vnd.npm.install-v1+json' });
    return Object.keys(meta?.versions ?? {}).filter(isStable).sort(compareVersions);
}

/** Advisories from `npm audit --json`, grouped per vulnerable package. */
function npmAdvisories(audit) {
    const byPackage = {};
    for (const vuln of Object.values(audit.vulnerabilities ?? {})) {
        for (const via of vuln.via) {
            if (typeof via !== 'object') continue;
            const id = via.url ? via.url.split('/').pop() : String(via.source);
            const list = (byPackage[via.name] ??= []);
            if (!list.some((a) => a.id === id)) list.push({ id, range: via.range, severity: via.severity, title: via.title });
        }
    }
    return byPackage;
}

/**
 * How a vulnerable npm package can be fixed. npm's own fixAvailable is unreliable here (it suggests
 * downgrades such as expo@44), so this checks the registry for a patched release instead.
 */
async function npmFixPlan(name, advisories, lock, overrides) {
    const vulnerable = (v) => advisories.some((a) => npmRangeMatch(v, a.range));
    const patched = (await npmVersions(name)).filter((v) => !vulnerable(v));
    const installed = lockedVersions(lock, name).filter(vulnerable);
    const pin = typeof overrides[name] === 'string' && /^\d+\.\d+\.\d+$/.test(overrides[name]) ? overrides[name] : null;
    const sameMajor = (v) => patched.filter((p) => majorKey(p) === majorKey(v) && compareVersions(p, v) > 0).at(-1);
    if (!patched.length) return { fix: 'no patched release' };
    if (pin) {
        const raise = sameMajor(pin);
        return raise ? { fix: `override pins ${pin}, raise to ${raise}`, raise } : { fix: `override pins ${pin}, patched only in ${patched.find((p) => compareVersions(p, pin) > 0)}` };
    }
    const blocked = installed.filter((v) => !sameMajor(v));
    if (!blocked.length) return { fix: 'npm audit fix' };
    const next = patched.find((p) => compareVersions(p, blocked[0]) > 0) ?? patched.at(-1);
    return { fix: `major: ${next} (override or newer parent)` };
}

/** The `npm audit --json` advisories of a project, with its package.json text and lock file. */
function npmProject(project, auditFile) {
    const audit = readJson(auditFile);
    if (audit.error) { console.error(audit.error.summary ?? JSON.stringify(audit.error)); process.exit(3); }
    const packageFile = repoPath(project, 'package.json');
    const lockFile = repoPath(project, 'package-lock.json');
    const packageText = fs.readFileSync(packageFile, 'utf8');
    return { advisories: npmAdvisories(audit), packageFile, packageText, pkg: JSON.parse(packageText), lock: fs.existsSync(lockFile) ? readJson(lockFile) : {} };
}

/** Parse `npm audit --json` for one project into findings. */
async function npmParse([project, auditFile]) {
    const { advisories, pkg, lock } = npmProject(project, auditFile);
    for (const [name, list] of Object.entries(advisories)) {
        const { fix } = await npmFixPlan(name, list, lock, pkg.overrides ?? {});
        for (const a of list) emit({ eco: 'npm', project, pkg: name, version: a.range, severity: a.severity, id: a.id, title: a.title, fix });
    }
}

/** Raise every exact-version override that is vulnerable and has a patched release in the same major; prints "name version" per change. */
async function npmRaiseOverrides([project, auditFile]) {
    const { advisories, packageFile, packageText, pkg, lock } = npmProject(project, auditFile);
    let changed = false;
    for (const [name, list] of Object.entries(advisories)) {
        if (typeof pkg.overrides?.[name] !== 'string') continue;
        const { raise } = await npmFixPlan(name, list, lock, pkg.overrides);
        if (!raise) continue;
        pkg.overrides[name] = raise;
        changed = true;
        console.log(`${name} ${raise}`);
    }
    // Keep the file's indentation; JSON.stringify keeps the key order.
    const indent = packageText.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? '  ';
    if (changed) fs.writeFileSync(packageFile, JSON.stringify(pkg, null, indent) + '\n');
}

/* ---- NuGet ---- */

/** NuGet vulnerability database (package id lowercased -> ranges), from the nuget.org VulnerabilityInfo resource. */
async function nugetVulnDb() {
    const index = await getJson('https://api.nuget.org/v3/vulnerabilities/index.json');
    const db = {};
    for (const page of index) {
        const data = await getJson(page['@id']);
        for (const [id, list] of Object.entries(data)) db[id] = [...(db[id] ?? []), ...list];
    }
    return db;
}

/** Whether a version falls in a NuGet interval such as "(, 2.1.11]" or "[1.0.0, 2.0.0)". */
function nugetInRange(version, range) {
    const m = range.trim().match(/^([[(])\s*([^,\])]*)\s*(?:,\s*([^\])]*))?\s*([\])])$/);
    if (!m) return false;
    const [, open, low, high, close] = m;
    if (high === undefined) return compareVersions(version, low) === 0;
    if (low && (open === '[' ? compareVersions(version, low) < 0 : compareVersions(version, low) <= 0)) return false;
    if (high && (close === ']' ? compareVersions(version, high) > 0 : compareVersions(version, high) >= 0)) return false;
    return true;
}

/** Lowest-risk patched version: the highest stable non-vulnerable release in the same major, else any later one. */
async function nugetCandidate(db, pkg, resolved) {
    const ranges = (db[pkg.toLowerCase()] ?? []).map((v) => v.versions);
    const index = await getJson(`https://api.nuget.org/v3-flatcontainer/${pkg.toLowerCase()}/index.json`);
    if (!index) return null;
    const versions = index.versions
        .filter((v) => !v.includes('-') && compareVersions(v, resolved) > 0 && !ranges.some((r) => nugetInRange(v, r)))
        .sort(compareVersions);
    if (!versions.length) return null;
    const major = parseVersion(resolved).nums[0];
    const sameMajor = versions.filter((v) => parseVersion(v).nums[0] === major);
    return sameMajor.length ? { version: sameMajor.at(-1), major: false } : { version: versions.at(-1), major: true };
}

/** Flatten `dotnet list package --vulnerable --format json` into one entry per project and package. */
function nugetEntries(listFile) {
    const list = readJson(listFile);
    const rows = [];
    for (const project of list.projects ?? []) {
        for (const fw of project.frameworks ?? []) {
            for (const [kind, packages] of [['direct', fw.topLevelPackages], ['transitive', fw.transitivePackages]]) {
                for (const p of packages ?? []) {
                    if (!p.vulnerabilities?.length) continue;
                    rows.push({ csproj: project.path, kind, pkg: p.id, version: p.resolvedVersion, vulns: p.vulnerabilities });
                }
            }
        }
    }
    return rows;
}

/** Parse the NuGet list into findings, with a suggested patched version per package. */
async function nugetParse([listFile]) {
    const rows = nugetEntries(listFile);
    const db = rows.length ? await nugetVulnDb() : {};
    const candidates = {};
    for (const row of rows) {
        const key = row.pkg + '@' + row.version;
        if (!(key in candidates)) candidates[key] = await nugetCandidate(db, row.pkg, row.version);
        const c = candidates[key];
        const fix = !c ? 'no fix' : `${row.kind === 'direct' ? 'update to' : 'pin'} ${c.version}${c.major ? ' (major)' : ''}`;
        const project = path.relative(repoRoot, path.dirname(row.csproj));
        for (const v of row.vulns) {
            const id = v.advisoryurl.split('/').pop();
            emit({ eco: 'nuget', project, pkg: row.pkg, version: row.version, severity: String(v.severity).toLowerCase(), id, title: `${row.kind} dependency`, fix });
        }
    }
}

/** ProjectReference paths of a csproj, resolved to absolute paths. */
function projectReferences(csproj) {
    const xml = fs.readFileSync(csproj, 'utf8');
    return [...xml.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)].map((m) => path.resolve(path.dirname(csproj), m[1].replace(/\\/g, '/')));
}

/**
 * Print "csproj<TAB>package<TAB>version" for each vulnerable transitive package that needs a pin.
 * The pin goes only on the lowest projects in the reference graph; projects referencing them inherit it.
 */
async function nugetPins([listFile]) {
    const rows = nugetEntries(listFile).filter((r) => r.kind === 'transitive');
    if (!rows.length) return;
    const db = await nugetVulnDb();
    const closure = (csproj, acc = new Set()) => {
        for (const ref of projectReferences(csproj)) {
            if (!acc.has(ref) && fs.existsSync(ref)) { acc.add(ref); closure(ref, acc); }
        }
        return acc;
    };
    const byPackage = {};
    for (const r of rows) (byPackage[r.pkg] ??= []).push(r);
    for (const [pkg, list] of Object.entries(byPackage)) {
        const resolved = list.map((r) => r.version).sort(compareVersions)[0];
        const c = await nugetCandidate(db, pkg, resolved);
        if (!c) { console.error(`no patched version of ${pkg} found`); continue; }
        if (c.major) { console.error(`${pkg}: the only patched version is a major bump (${c.version}), pin it by hand`); continue; }
        const listed = new Set(list.map((r) => r.csproj));
        for (const csproj of listed) {
            const refs = closure(csproj);
            if (![...listed].some((other) => other !== csproj && refs.has(other))) console.log(`${csproj}\t${pkg}\t${c.version}`);
        }
    }
}

/* ---- Cargo ---- */

/** Vulnerabilities plus unmaintained/unsound/yanked warnings (severity info) from `cargo audit --json`. */
function cargoItems(auditFile) {
    const audit = readJson(auditFile);
    return [
        ...(audit.vulnerabilities?.list ?? []).map((v) => ({ ...v, severity: cvssSeverity(v.advisory.cvss) })),
        ...Object.values(audit.warnings ?? {}).flat().map((w) => ({ ...w, severity: 'info' })),
    ];
}

/** Parse `cargo audit --json` into findings. */
function cargoParse([project, auditFile]) {
    for (const item of cargoItems(auditFile)) {
        const adv = item.advisory ?? { id: item.kind, title: item.kind, aliases: [] };
        const patched = item.versions?.patched ?? [];
        const title = item.kind && item.kind !== 'vulnerability' ? `${item.kind}: ${adv.title}` : adv.title;
        emit({ eco: 'cargo', project, pkg: item.package.name, version: item.package.version, severity: item.severity, id: adv.id, ids: [adv.id, ...(adv.aliases ?? [])], title, fix: patched.length ? `cargo update (patched ${patched.join(', ')})` : 'no fix' });
    }
}

/** Print "name@version" for every cargo advisory or warning that has a patched version. */
function cargoUpdates([auditFile]) {
    const items = cargoItems(auditFile);
    const specs = new Set(items.filter((i) => (i.versions?.patched ?? []).length || i.kind === 'yanked').map((i) => `${i.package.name}@${i.package.version}`));
    for (const s of specs) console.log(s);
}

/* ---- Gradle (Android): resolved runtime classpath checked against OSV ---- */

/** Resolved "group:artifact" -> version map from `gradlew :app:dependencies` output. */
function gradleResolved(depsFile) {
    const resolved = {};
    for (const line of fs.readFileSync(depsFile, 'utf8').split('\n')) {
        const m = line.match(/--- (\S+)(?: -> (\S+))?/);
        if (!m || m[1] === 'project') continue;
        const [group, artifact, declared] = m[1].split(':');
        if (!artifact) continue;
        let coord = `${group}:${artifact}`, version = declared;
        if (m[2]?.includes(':')) {
            const [g2, a2, v2] = m[2].split(':');
            coord = `${g2}:${a2}`;
            version = v2;
        } else if (m[2]) {
            version = m[2];
        }
        if (version && version !== '+') resolved[coord] = version;
    }
    return resolved;
}

/** Vulnerable Gradle dependencies with the version that fixes all their advisories. */
async function gradleFindings(depsFile, build) {
    const resolved = Object.entries(gradleResolved(depsFile));
    const ids = await osvQueryBatch(resolved.map(([name, version]) => ({ package: { name, ecosystem: 'Maven' }, version })));
    const findings = [];
    for (let i = 0; i < resolved.length; i++) {
        if (!ids[i].length) continue;
        const [name, version] = resolved[i];
        const vulns = await Promise.all(ids[i].map(osvVuln));
        const fixes = vulns.map((v) => osvFixedAbove(v, 'Maven', name, version));
        const target = fixes.includes(null) ? null : fixes.sort(compareVersions).at(-1);
        findings.push({ name, version, vulns, target, declared: build.includes(`${name}:${version}`) });
    }
    return findings;
}

/** Emit one finding per OSV record affecting a package. */
function emitOsv(eco, project, pkg, version, vulns, fix) {
    for (const v of vulns) {
        emit({ eco, project, pkg, version, severity: osvSeverity(v), id: osvDisplayId(v), ids: [v.id, ...(v.aliases ?? [])], title: v.summary ?? v.details?.slice(0, 120), fix: typeof fix === 'function' ? fix(v) : fix });
    }
}

/** Parse the Gradle dependency tree of a project into findings. */
async function gradleParse([project, depsFile]) {
    for (const f of await gradleFindings(depsFile, fs.readFileSync(repoPath(project, 'app/build.gradle'), 'utf8'))) {
        emitOsv('gradle', project, f.name, f.version, f.vulns, !f.target ? 'no fix' : f.declared ? `update to ${f.target} (app/build.gradle)` : `transitive, needs ${f.target}`);
    }
}

/** Bump vulnerable dependencies declared with a literal version in app/build.gradle; prints each change. */
async function gradleApply([project, depsFile]) {
    const buildFile = repoPath(project, 'app/build.gradle');
    let build = fs.readFileSync(buildFile, 'utf8');
    for (const f of await gradleFindings(depsFile, build)) {
        if (!f.declared || !f.target) continue;
        build = build.split(`${f.name}:${f.version}`).join(`${f.name}:${f.target}`);
        console.log(`${f.name} ${f.version} -> ${f.target}`);
    }
    fs.writeFileSync(buildFile, build);
}

/* ---- CocoaPods (iOS): trunk pods from Podfile.lock checked against OSV ---- */

/**
 * Pods from the CocoaPods trunk, plus pods pinned to a remote :podspec, with their locked version.
 * Pods with a :path into node_modules are covered by npm.
 */
function trunkPods(lockFile) {
    const text = fs.readFileSync(lockFile, 'utf8');
    const versions = {};
    for (const m of text.split('\nDEPENDENCIES:')[0].matchAll(/^ {2}- "?([^\s/"]+)(?:\/[^\s"]+)? \(([^)]+)\)/gm)) versions[m[1]] ??= m[2];
    const trunk = text.match(/SPEC REPOS:\n\s+trunk:\n((?:\s+- .+\n)+)/)?.[1] ?? '';
    const names = trunk.split('\n').map((l) => l.trim().replace(/^- "?|"$/g, '')).filter(Boolean);
    for (const m of text.matchAll(/^ {2}"?([^\s:"]+)"?:\n {4}:podspec: https?:\/\//gm)) names.push(m[1]);
    return names.map((name) => ({ name, version: versions[name] }));
}

/** CDN shard prefix CocoaPods uses for a pod name. */
function podShard(name) {
    const h = crypto.createHash('md5').update(name).digest('hex');
    return [h[0], h[1], h[2]];
}

/**
 * OSV queries for one pod version. CocoaPods has no OSV ecosystem, so pods are matched by their
 * source repository (SwiftURL and GIT tag). OpenSSL-Universal repackages OpenSSL: 3.3.3001 is OpenSSL 3.3.3.
 */
async function podQueries(name, version) {
    if (name === 'OpenSSL-Universal') {
        const [major, minor, build] = version.split('.').map(Number);
        return [{ package: { name: 'https://github.com/openssl/openssl', ecosystem: 'GIT' }, version: `openssl-${major}.${minor}.${Math.floor(build / 1000)}` }];
    }
    const [a, b, c] = podShard(name);
    const spec = await getJson(`https://cdn.cocoapods.org/Specs/${a}/${b}/${c}/${name}/${version}/${name}.podspec.json`);
    const repo = spec?.source?.git?.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
    if (!repo) return [];
    const tag = spec.source.tag ?? version;
    return [
        { package: { name: `github.com/${repo}`, ecosystem: 'SwiftURL' }, version },
        { package: { name: `https://github.com/${repo}`, ecosystem: 'GIT' }, version: tag },
    ];
}

/** Latest released version of a pod on the CocoaPods CDN. */
async function podLatest(name) {
    const [a, b, c] = podShard(name);
    const res = await fetch(`https://cdn.cocoapods.org/all_pods_versions_${a}_${b}_${c}.txt`);
    const line = (await res.text()).split('\n').find((l) => l.startsWith(name + '/'));
    return line?.split('/').slice(1).filter(isStable).sort(compareVersions).at(-1) ?? null;
}

/** Vulnerability ids affecting one pod version. */
async function podVulnIds(name, version) {
    const queries = await podQueries(name, version);
    return queries.length ? [...new Set((await osvQueryBatch(queries)).flat())] : [];
}

/** Vulnerable pods of a project's Podfile.lock, each with its OSV records and the ids the latest release still has. */
async function podFindings(project) {
    const findings = [];
    for (const pod of trunkPods(repoPath(project, 'Podfile.lock'))) {
        const ids = await podVulnIds(pod.name, pod.version);
        if (!ids.length) continue;
        const latest = await podLatest(pod.name);
        const stillOpen = latest && compareVersions(latest, pod.version) > 0 ? new Set(await podVulnIds(pod.name, latest)) : new Set(ids);
        findings.push({ ...pod, latest, stillOpen, vulns: await Promise.all(ids.map(osvVuln)) });
    }
    return findings;
}

/** Parse a project's Podfile.lock into findings. */
async function podsParse([project]) {
    for (const p of await podFindings(project)) {
        emitOsv('cocoapods', project, p.name, p.version, p.vulns, (v) => p.stillOpen.has(v.id) ? `no fix (latest ${p.latest ?? '?'} affected)` : `pod update ${p.name} (latest ${p.latest})`);
    }
}

/** Print the pods with a non-allowlisted advisory that the latest release fixes, space-separated. */
async function podsUpdates([project]) {
    const pods = (await podFindings(project)).filter((p) => p.vulns.some((v) => !p.stillOpen.has(v.id) && !isAllowed('cocoapods', [v.id, ...(v.aliases ?? [])], p.name)));
    if (pods.length) console.log(pods.map((p) => p.name).join(' '));
}

/* ---- Report ---- */

/** Print the combined report; exits 1 when a non-allowlisted finding is at or above the level. */
function report([level]) {
    const file = findingsFile;
    const tty = process.stdout.isTTY;
    const color = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
    const sevColor = { critical: '1;31', high: '0;31', unknown: '0;31', moderate: '1;33', low: '0;36', info: '2' };
    const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
        const [eco, project, pkg, version, severity, id, title, fix, allowed] = l.split('\t');
        return { eco, project, pkg, version, severity, id, title, fix, allowed: allowed === 'yes' };
    }) : [];
    const groups = {};
    for (const r of rows) (groups[`${r.eco}: ${r.project}`] ??= []).push(r);
    const threshold = SEVERITY_RANK[level];
    let failing = 0;
    const counts = {};
    for (const [group, list] of Object.entries(groups).sort()) {
        list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.pkg.localeCompare(b.pkg));
        console.log(`\n${color('1', group)}`);
        for (const r of list) {
            const line = `  ${r.severity.toUpperCase().padEnd(9)} ${`${r.pkg} ${r.version}`.padEnd(42)} ${r.id.padEnd(20)} ${r.fix.padEnd(42)} ${r.title.slice(0, 90)}`;
            if (r.allowed) { console.log(color('2', line + '  [allowlisted]')); continue; }
            console.log(color(sevColor[r.severity] ?? '0', line));
            counts[r.severity] = (counts[r.severity] ?? 0) + 1;
            if (SEVERITY_RANK[r.severity] >= threshold) failing++;
        }
    }
    const allowedCount = rows.filter((r) => r.allowed).length;
    const summary = ['critical', 'high', 'unknown', 'moderate', 'low', 'info'].filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ') || 'none';
    console.log(`\n${color('1', 'Summary')}: ${summary}${allowedCount ? ` (${allowedCount} allowlisted)` : ''}`);
    if (rows.some((r) => !r.allowed && r.severity !== 'info' && !/^(npm audit fix|cargo update|pin |update to|pod update)/.test(r.fix))) {
        console.log(color('2', [
            'Fix column, for what `fix` cannot do on its own:',
            '  "major: x (override or newer parent)"  the patch only exists in a new major the parent\'s semver range excludes;',
            '                                          add an override in package.json or update the parent package',
            '  "override pins x"                       our own package.json override holds it back (`fix` raises exact pins within the major)',
            '  "transitive, needs x"                   Gradle: comes from an Expo/RN module; update that npm package or add a constraint',
            '  "no patched release" / "no fix"         nothing to upgrade to; allowlist it with a reason or replace the package',
        ].join('\n')));
    }
    console.log(failing ? color('0;31', `${failing} finding(s) at or above "${level}"`) : color('0;32', `No findings at or above "${level}"`));
    process.exit(failing ? 1 : 0);
}

const commands = {
    'npm-parse': npmParse,
    'npm-raise-overrides': npmRaiseOverrides,
    'nuget-parse': nugetParse,
    'nuget-pins': nugetPins,
    'cargo-parse': cargoParse,
    'cargo-updates': cargoUpdates,
    'gradle-parse': gradleParse,
    'gradle-apply': gradleApply,
    'pods-parse': podsParse,
    'pods-updates': podsUpdates,
    report,
};
if (!commands[cmd]) { console.error(`Unknown command: ${cmd}`); process.exit(1); }
await commands[cmd](args);
