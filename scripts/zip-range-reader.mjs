import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { inflateRawSync } from 'node:zlib'

const execFileAsync = promisify(execFile)
const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff
const EOCD_TAIL_BYTES = 65_558
const LOCAL_HEADER_SLACK_BYTES = 1024

async function curlRange(url, start, end) {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '2',
      '--connect-timeout',
      '20',
      '--max-time',
      '90',
      '-r',
      `${start}-${end}`,
      url
    ],
    { encoding: 'buffer', maxBuffer: Math.max(4 * 1024 * 1024, end - start + 1024 * 1024) }
  )
  return stdout
}

async function probeRemoteZip(url) {
  const { stdout } = await execFileAsync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--retry',
      '2',
      '--connect-timeout',
      '20',
      '--max-time',
      '30',
      '-D',
      '-',
      '-o',
      '/dev/null',
      '-r',
      '0-0',
      '-w',
      '\n__FINAL_URL__:%{url_effective}\n',
      url
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  )
  const rangeMatch = /^content-range:\s*bytes\s+0-0\/(\d+)\s*$/im.exec(stdout)
  if (!rangeMatch) {
    throw new Error(`Remote ZIP does not advertise HTTP Range size: ${url}`)
  }
  const urlMatch = /^__FINAL_URL__:(.+)$/m.exec(stdout)
  return {
    size: Number(rangeMatch[1]),
    resolvedUrl: urlMatch ? urlMatch[1].trim() : url
  }
}

function findEocdOffset(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset
    }
  }
  throw new Error('Could not find ZIP End of Central Directory record')
}

function parseZip64Extra(extra, entry) {
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(cursor)
    const dataSize = extra.readUInt16LE(cursor + 2)
    cursor += 4
    if (headerId === 0x0001) {
      let field = cursor
      if (entry.uncompressedSize === MAX_UINT32 && field + 8 <= cursor + dataSize) {
        entry.uncompressedSize = Number(extra.readBigUInt64LE(field))
        field += 8
      }
      if (entry.compressedSize === MAX_UINT32 && field + 8 <= cursor + dataSize) {
        entry.compressedSize = Number(extra.readBigUInt64LE(field))
        field += 8
      }
      if (entry.localHeaderOffset === MAX_UINT32 && field + 8 <= cursor + dataSize) {
        entry.localHeaderOffset = Number(extra.readBigUInt64LE(field))
      }
      return
    }
    cursor += dataSize
  }
}

function parseCentralDirectory(buffer) {
  const entries = new Map()
  let cursor = 0
  while (cursor + 46 <= buffer.length) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`Unexpected ZIP central directory header at offset ${cursor}`)
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLen = buffer.readUInt16LE(cursor + 28)
    const extraLen = buffer.readUInt16LE(cursor + 30)
    const commentLen = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const extraStart = nameStart + nameLen
    const name = buffer.subarray(nameStart, extraStart).toString('utf8')
    const entry = {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    }
    if (
      compressedSize === MAX_UINT32 ||
      uncompressedSize === MAX_UINT32 ||
      localHeaderOffset === MAX_UINT32
    ) {
      parseZip64Extra(buffer.subarray(extraStart, extraStart + extraLen), entry)
    }
    entries.set(name, entry)
    cursor = extraStart + extraLen + commentLen
  }
  return entries
}

/** Open a remote ZIP over HTTP Range requests, fetching only its directory and requested entries. */
export async function openRemoteZip(url) {
  const { size, resolvedUrl } = await probeRemoteZip(url)
  let activeUrl = resolvedUrl
  let downloadedBytes = 1

  async function fetchRange(start, end) {
    const clampedEnd = Math.min(end, size - 1)
    let bytes
    try {
      bytes = await curlRange(activeUrl, start, clampedEnd)
    } catch (error) {
      if (activeUrl === url) {
        throw error
      }
      // Signed redirect URLs expire; fall back to the original release URL once.
      activeUrl = url
      bytes = await curlRange(activeUrl, start, clampedEnd)
    }
    downloadedBytes += bytes.length
    return bytes
  }

  const tailStart = Math.max(0, size - EOCD_TAIL_BYTES)
  const tail = await fetchRange(tailStart, size - 1)
  const eocdOffset = findEocdOffset(tail)
  let cdSize = tail.readUInt32LE(eocdOffset + 12)
  let cdOffset = tail.readUInt32LE(eocdOffset + 16)
  const totalEntries = tail.readUInt16LE(eocdOffset + 10)

  if (cdSize === MAX_UINT32 || cdOffset === MAX_UINT32 || totalEntries === MAX_UINT16) {
    const locatorOffset = eocdOffset - 20
    if (locatorOffset < 0 || tail.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new Error('ZIP64 End of Central Directory locator is missing')
    }
    const zip64EocdOffset = Number(tail.readBigUInt64LE(locatorOffset + 8))
    const zip64 = await fetchRange(zip64EocdOffset, zip64EocdOffset + 55)
    if (zip64.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error('Invalid ZIP64 End of Central Directory record')
    }
    cdSize = Number(zip64.readBigUInt64LE(40))
    cdOffset = Number(zip64.readBigUInt64LE(48))
  }

  const cdBuffer = await fetchRange(cdOffset, cdOffset + cdSize - 1)
  const entries = parseCentralDirectory(cdBuffer)

  async function readEntry(name) {
    const entry = entries.get(name)
    if (!entry) {
      throw new Error(`ZIP entry not found: ${name}`)
    }
    const headerEstimate = 30 + Buffer.byteLength(name) + LOCAL_HEADER_SLACK_BYTES
    const raw = await fetchRange(
      entry.localHeaderOffset,
      entry.localHeaderOffset + headerEstimate + entry.compressedSize - 1
    )
    if (raw.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Invalid ZIP local header for ${name}`)
    }
    const localNameLen = raw.readUInt16LE(26)
    const localExtraLen = raw.readUInt16LE(28)
    const dataOffset = 30 + localNameLen + localExtraLen
    const neededLength = dataOffset + entry.compressedSize
    const full =
      raw.length >= neededLength
        ? raw
        : await fetchRange(entry.localHeaderOffset, entry.localHeaderOffset + neededLength - 1)
    const compressed = full.subarray(dataOffset, neededLength)
    if (entry.compressionMethod === 0) {
      return Buffer.from(compressed)
    }
    if (entry.compressionMethod === 8) {
      return inflateRawSync(compressed)
    }
    throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${name}`)
  }

  return {
    size,
    entries,
    readEntry,
    downloadedBytes: () => downloadedBytes
  }
}
