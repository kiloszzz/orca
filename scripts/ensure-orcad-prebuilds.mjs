#!/usr/bin/env node
// Populate out/orcad-prebuilds/ and .build/ Windows native addons from a persistent local cache,
// fetching only the ~2-4 MB native slot files via HTTP Range from the matching official release.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  COMPAT_SERVER_TARGETS,
  NODE_RUNTIME_PIN,
  ORCAD_TEMPLATE_TARGETS
} from '../src/shared/node-runtime/node-runtime-pin.ts'
import {
  ORCAD_NODE_PTY_DIR,
  ORCAD_PROVIDER_EXEC_FILENAME,
  ORCAD_PROVIDER_EXEC_SLOT_FILE,
  ORCAD_TEMPLATE_MANIFEST_FILENAME,
  ORCAD_TEMPLATE_TARGETS_DIR,
  ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME,
  ORCAD_WINDOWS_PROCESS_TREE_FILENAME,
  ORCAD_WINDOWS_SECURITY_FILENAME,
  isOrcadExecutableArtifact,
  orcadNodePtySlotFiles
} from '../src/shared/remote-runtime/orcad-distribution/orcad-artifacts.ts'
import {
  COMPAT_SLOT_ADDONS,
  MANIFEST_SCHEMA_VERSION,
  SLOT_NAPI_VERSION,
  findPostBaselineNodeApiNames,
  findSlotProblems,
  isCompatSlot,
  readManifest,
  sha256Of,
  slotNeedsProviderExec
} from '../config/scripts/orcad-distribution/prebuilds/orcad-prebuild-slot-contents.mjs'
import { openRemoteZip } from './zip-range-reader.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const ROOT = resolve(import.meta.dirname, '..')
const PREBUILDS_DIR = join(ROOT, 'out', 'orcad-prebuilds')
const ZIP_TEMPLATE_PREFIX = 'Orca.app/Contents/Resources/orcad-template/'
const LATEST_MAC_YML_URL =
  'https://github.com/stablyai/orca/releases/latest/download/latest-mac.yml'
const WINDOWS_ARCHES = ['x64', 'arm64']
const WINDOWS_ADDONS_MANIFEST = 'windows-addons.json'
const CONCURRENCY = 6

async function resolveLatestReleaseVersion() {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--connect-timeout',
      '15',
      LATEST_MAC_YML_URL
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 }
  )
  const match = /^version:\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)\s*$/m.exec(stdout)
  if (!match) {
    throw new Error(`Could not parse version from ${LATEST_MAC_YML_URL}`)
  }
  return match[1]
}

function expectedInventoryHash() {
  const signature = [
    ...ORCAD_TEMPLATE_TARGETS.map(
      (slot) =>
        `${slot}:${slotFileMappings(slot)
          .map((m) => m.slotRel)
          .join(',')}`
    ),
    ...windowsAddonMappings().map((addon) => addon.cacheRel)
  ].join('\n')
  return sha256Buffer(Buffer.from(signature)).slice(0, 12)
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function windowsAddonMappings() {
  return WINDOWS_ARCHES.flatMap((arch) => {
    const target = `win32-${arch}`
    return [
      {
        target,
        templatePath: ORCAD_WINDOWS_PROCESS_TREE_FILENAME,
        cacheRel: `windows-process-tree/${arch}/${ORCAD_WINDOWS_PROCESS_TREE_FILENAME}`,
        buildPath: join(
          ROOT,
          '.build',
          'windows-process-tree',
          arch,
          ORCAD_WINDOWS_PROCESS_TREE_FILENAME
        )
      },
      {
        target,
        templatePath: ORCAD_WINDOWS_CLI_LAUNCHER_FILENAME,
        cacheRel: `windows-cli-launcher/${arch}/orca.exe`,
        buildPath: join(ROOT, '.build', 'windows-cli-launcher', arch, 'orca.exe')
      },
      {
        target,
        templatePath: ORCAD_WINDOWS_SECURITY_FILENAME,
        cacheRel: `windows-security/${arch}/${ORCAD_WINDOWS_SECURITY_FILENAME}`,
        buildPath: join(ROOT, '.build', 'windows-security', arch, ORCAD_WINDOWS_SECURITY_FILENAME)
      }
    ]
  })
}

function slotMeta(slot) {
  const [platform, arch] = slot.split('-')
  const libc = platform === 'linux' ? (slot.endsWith('-musl') ? 'musl' : 'glibc') : 'none'
  return { platform, arch, libc }
}

function slotFileMappings(slot) {
  const mappings = orcadNodePtySlotFiles(slot).map((file) => ({
    slotRel: file,
    templateRel: `${ORCAD_NODE_PTY_DIR}/build/Release/${file}`
  }))
  if (slotNeedsProviderExec(slot)) {
    mappings.push({
      slotRel: ORCAD_PROVIDER_EXEC_SLOT_FILE,
      templateRel: ORCAD_PROVIDER_EXEC_FILENAME
    })
  }
  if (isCompatSlot(slot)) {
    for (const [slotRel, templateRel] of Object.entries(COMPAT_SLOT_ADDONS)) {
      mappings.push({ slotRel, templateRel })
    }
  }
  return mappings
}

function verifyWindowsAddons(baseDir, manifestPath, useBuildPaths = false) {
  if (!existsSync(manifestPath)) {
    return false
  }
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const addon of windowsAddonMappings()) {
    const hash = expected[addon.cacheRel]
    const filePath = useBuildPaths ? addon.buildPath : join(baseDir, ...addon.cacheRel.split('/'))
    if (!hash || !existsSync(filePath) || sha256Of(filePath) !== hash) {
      return false
    }
  }
  return true
}

function isCacheValid(cacheDir) {
  const prebuildsDir = join(cacheDir, 'prebuilds')
  const manifest = readManifest(prebuildsDir)
  if (findSlotProblems(manifest, prebuildsDir, ORCAD_TEMPLATE_TARGETS).length > 0) {
    return false
  }
  return verifyWindowsAddons(
    join(cacheDir, 'windows-addons'),
    join(cacheDir, WINDOWS_ADDONS_MANIFEST)
  )
}

function isWorkspaceStaged(cacheDir) {
  const manifest = readManifest(PREBUILDS_DIR)
  if (findSlotProblems(manifest, PREBUILDS_DIR, ORCAD_TEMPLATE_TARGETS).length > 0) {
    return false
  }
  return verifyWindowsAddons(ROOT, join(cacheDir, WINDOWS_ADDONS_MANIFEST), true)
}

function syncCacheToWorkspace(cacheDir) {
  rmSync(PREBUILDS_DIR, { recursive: true, force: true })
  cpSync(join(cacheDir, 'prebuilds'), PREBUILDS_DIR, { recursive: true })
  for (const addon of windowsAddonMappings()) {
    mkdirSync(dirname(addon.buildPath), { recursive: true })
    cpSync(join(cacheDir, 'windows-addons', ...addon.cacheRel.split('/')), addon.buildPath)
  }
}

async function runPool(items, limit, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

function resolveLocalTemplateDir(fromPath) {
  const resolved = resolve(fromPath)
  const appCandidate = join(resolved, 'Contents', 'Resources', 'orcad-template')
  if (existsSync(join(appCandidate, ORCAD_TEMPLATE_MANIFEST_FILENAME))) {
    return appCandidate
  }
  if (existsSync(join(resolved, ORCAD_TEMPLATE_MANIFEST_FILENAME))) {
    return resolved
  }
  throw new Error(`No orcad-template found under ${resolved}`)
}

async function populateCache({ cacheDir, releaseVersion, fromPath, nodePtyVersion }) {
  let readTemplateFile
  let reportBytes = null
  if (fromPath) {
    const templateDir = resolveLocalTemplateDir(fromPath)
    console.log(`[ensure-orcad-prebuilds] extracting native slots from ${templateDir}`)
    readTemplateFile = async (relPath) => readFileSync(join(templateDir, ...relPath.split('/')))
  } else {
    const url =
      process.env.ORCA_PREBUILDS_ZIP_URL ||
      `https://github.com/stablyai/orca/releases/download/v${releaseVersion}/Orca-${releaseVersion}-arm64-mac.zip`
    console.log(`[ensure-orcad-prebuilds] fetching native slots via HTTP Range from ${url}`)
    const zip = await openRemoteZip(url)
    readTemplateFile = (relPath) => zip.readEntry(`${ZIP_TEMPLATE_PREFIX}${relPath}`)
    reportBytes = () => zip.downloadedBytes()
  }

  const templateManifest = JSON.parse(
    (await readTemplateFile(ORCAD_TEMPLATE_MANIFEST_FILENAME)).toString('utf8')
  )
  const slots = [
    ...ORCAD_TEMPLATE_TARGETS,
    ...COMPAT_SERVER_TARGETS.filter((slot) => Object.hasOwn(templateManifest.targets ?? {}, slot))
  ]

  const stagingDir = `${cacheDir}.staging-${process.pid}`
  rmSync(stagingDir, { recursive: true, force: true })
  const stagingPrebuilds = join(stagingDir, 'prebuilds')
  const stagingWindows = join(stagingDir, 'windows-addons')

  const tasks = []
  const manifestSlots = {}
  for (const slot of slots) {
    const targetEntry = templateManifest.targets?.[slot]
    if (!targetEntry?.files) {
      throw new Error(`Official orcad-template manifest is missing target ${slot}`)
    }
    const files = {}
    manifestSlots[slot] = { ...slotMeta(slot), glibc: null, napi: SLOT_NAPI_VERSION, files }
    for (const { slotRel, templateRel } of slotFileMappings(slot)) {
      const expectedSha = targetEntry.files[templateRel]
      if (!expectedSha) {
        throw new Error(`Official orcad-template manifest omits ${slot}/${templateRel}`)
      }
      files[slotRel] = expectedSha
      tasks.push({
        label: `${slot}/${slotRel}`,
        templatePath: `${ORCAD_TEMPLATE_TARGETS_DIR}/${slot}/${templateRel}`,
        expectedSha,
        destination: join(stagingPrebuilds, slot, ...slotRel.split('/')),
        executable: isOrcadExecutableArtifact(templateRel)
      })
    }
  }

  const windowsHashes = {}
  for (const addon of windowsAddonMappings()) {
    const expectedSha = templateManifest.targets?.[addon.target]?.files?.[addon.templatePath]
    if (!expectedSha) {
      throw new Error(
        `Official orcad-template manifest omits ${addon.target}/${addon.templatePath}`
      )
    }
    windowsHashes[addon.cacheRel] = expectedSha
    tasks.push({
      label: addon.cacheRel,
      templatePath: `${ORCAD_TEMPLATE_TARGETS_DIR}/${addon.target}/${addon.templatePath}`,
      expectedSha,
      destination: join(stagingWindows, ...addon.cacheRel.split('/')),
      executable: false
    })
  }

  try {
    await runPool(tasks, CONCURRENCY, async (task) => {
      const bytes = await readTemplateFile(task.templatePath)
      const actualSha = sha256Buffer(bytes)
      if (actualSha !== task.expectedSha) {
        throw new Error(
          `SHA-256 mismatch for ${task.label}: expected ${task.expectedSha}, got ${actualSha}`
        )
      }
      if (task.label.endsWith('.node') && !task.label.includes('windows-')) {
        const postBaseline = findPostBaselineNodeApiNames(bytes)
        if (postBaseline.length > 0) {
          throw new Error(
            `${task.label} imports ${postBaseline.join(', ')}, above N-API ${SLOT_NAPI_VERSION}`
          )
        }
      }
      mkdirSync(dirname(task.destination), { recursive: true })
      writeFileSync(task.destination, bytes)
      if (task.executable) {
        chmodSync(task.destination, 0o755)
      }
    })

    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      module: 'node-pty',
      version: nodePtyVersion,
      napi: SLOT_NAPI_VERSION,
      nodeHeaders: NODE_RUNTIME_PIN.version,
      slots: Object.fromEntries(
        Object.entries(manifestSlots).sort(([a], [b]) => a.localeCompare(b))
      )
    }
    writeFileSync(join(stagingPrebuilds, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(
      join(stagingDir, WINDOWS_ADDONS_MANIFEST),
      `${JSON.stringify(windowsHashes, null, 2)}\n`
    )

    const problems = findSlotProblems(manifest, stagingPrebuilds, slots)
    if (problems.length > 0) {
      throw new Error(`Staged orcad prebuilds failed verification: ${problems.join('; ')}`)
    }

    mkdirSync(dirname(cacheDir), { recursive: true })
    rmSync(cacheDir, { recursive: true, force: true })
    renameSync(stagingDir, cacheDir)
    const mb = reportBytes ? ` (${(reportBytes() / (1024 * 1024)).toFixed(2)} MB fetched)` : ''
    console.log(`[ensure-orcad-prebuilds] cached ${slots.length} slot(s) -> ${cacheDir}${mb}`)
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
}

async function main() {
  const explicitVersion = argValue('--version') || process.env.ORCA_PREBUILDS_VERSION || null
  const fromPath = argValue('--from')
  const nodePtyVersion = require('node-pty/package.json').version
  const cacheRoot =
    process.env.ORCA_PREBUILDS_CACHE_DIR ||
    join(homedir(), '.cache', 'orca-custom', 'orcad-prebuilds')
  const cacheKey = explicitVersion
    ? `v${explicitVersion}-node${NODE_RUNTIME_PIN.version}-pty${nodePtyVersion}-${expectedInventoryHash()}`
    : `node${NODE_RUNTIME_PIN.version}-pty${nodePtyVersion}-${expectedInventoryHash()}`
  const cacheDir = join(cacheRoot, cacheKey)

  if (!fromPath && isCacheValid(cacheDir) && isWorkspaceStaged(cacheDir)) {
    console.log(`[ensure-orcad-prebuilds] OK (already staged: ${cacheKey})`)
    return
  }

  if (fromPath || !isCacheValid(cacheDir)) {
    const releaseVersion =
      fromPath || process.env.ORCA_PREBUILDS_ZIP_URL
        ? (explicitVersion ?? 'local')
        : (explicitVersion ?? (await resolveLatestReleaseVersion()))
    await populateCache({ cacheDir, releaseVersion, fromPath, nodePtyVersion })
  } else {
    console.log(`[ensure-orcad-prebuilds] restoring from cache ${cacheDir}`)
  }
  syncCacheToWorkspace(cacheDir)
  const finalProblems = findSlotProblems(
    readManifest(PREBUILDS_DIR),
    PREBUILDS_DIR,
    ORCAD_TEMPLATE_TARGETS
  )
  if (finalProblems.length > 0) {
    throw new Error(`Workspace orcad prebuilds invalid: ${finalProblems.join('; ')}`)
  }
  console.log(
    `[ensure-orcad-prebuilds] staged ${ORCAD_TEMPLATE_TARGETS.length} required slots + Windows addons`
  )
}

await main()
