/**
 * Decoder for Figma's local file format (`.fig`).
 *
 * A `.fig` is a zip holding `canvas.fig`, `meta.json`, `thumbnail.png` and
 * `images/<sha1>`. `canvas.fig` is "fig-kiwi" + uint32 version + length-prefixed
 * chunks: chunk 0 is the compressed kiwi schema, chunk 1 the compressed message
 * encoded with it. The schema travels with the file, so no hard-coded field
 * table is needed and new Figma versions keep decoding.
 */
import zlib from 'node:zlib'

class Reader {
  constructor(buf) { this.b = buf; this.i = 0 }
  byte() { if (this.i >= this.b.length) throw new Error('kiwi: unexpected end of data'); return this.b[this.i++] }
  bool() { return this.byte() !== 0 }
  uint() {
    let v = 0, shift = 0, b
    do { b = this.byte(); v |= (b & 127) << shift; shift += 7 } while (b & 128 && shift < 35)
    return v >>> 0
  }
  int() { const v = this.uint(); return v & 1 ? ~(v >>> 1) : v >>> 1 }
  uint64() {
    let v = 0n, shift = 0n, b
    do { b = this.byte(); v |= BigInt(b & 127) << shift; shift += 7n } while (b & 128 && shift < 70n)
    return v
  }
  int64() { const v = this.uint64(); return v & 1n ? ~(v >> 1n) : v >> 1n }
  float() {
    // kiwi stores floats with the exponent rotated into the low byte so 0 fits in one byte
    const first = this.byte()
    if (first === 0) return 0
    let bits = first | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)
    bits = (bits << 23) | (bits >>> 9)
    const dv = new DataView(new ArrayBuffer(4))
    dv.setInt32(0, bits)
    return dv.getFloat32(0)
  }
  string() {
    const start = this.i
    while (this.b[this.i] !== 0) { if (this.i >= this.b.length) throw new Error('kiwi: unterminated string'); this.i++ }
    const s = this.b.toString('utf8', start, this.i)
    this.i++
    return s
  }
  bytes() { const n = this.uint(); const out = this.b.subarray(this.i, this.i + n); this.i += n; return out }
}

const BUILTIN = { '-1': 'bool', '-2': 'byte', '-3': 'int', '-4': 'uint', '-5': 'float', '-6': 'string', '-7': 'int64', '-8': 'uint64' }
const KIND = ['ENUM', 'STRUCT', 'MESSAGE']

export function decodeSchema(buf) {
  const r = new Reader(buf)
  const defs = []
  const count = r.uint()
  for (let d = 0; d < count; d++) {
    const name = r.string()
    const kind = KIND[r.byte()]
    const fields = []
    const fc = r.uint()
    for (let f = 0; f < fc; f++) fields.push({ name: r.string(), type: r.int(), isArray: r.bool(), value: r.uint() })
    defs.push({ name, kind, fields })
  }
  for (const d of defs) for (const f of d.fields) f.type = f.type < 0 ? BUILTIN[f.type] : defs[f.type].name
  return Object.fromEntries(defs.map(d => [d.name, d]))
}

export function decodeMessage(schema, buf, rootType = 'Message') {
  const r = new Reader(buf)
  const enums = {}
  const byId = {}
  for (const d of Object.values(schema)) {
    if (d.kind === 'ENUM') enums[d.name] = Object.fromEntries(d.fields.map(f => [f.value, f.name]))
    if (d.kind === 'MESSAGE') byId[d.name] = Object.fromEntries(d.fields.map(f => [f.value, f]))
  }

  function value(type) {
    switch (type) {
      case 'bool': return r.bool()
      case 'byte': return r.byte()
      case 'int': return r.int()
      case 'uint': return r.uint()
      case 'float': return r.float()
      case 'string': return r.string()
      case 'int64': return Number(r.int64())
      case 'uint64': return Number(r.uint64())
    }
    const def = schema[type]
    if (def.kind === 'ENUM') { const v = r.uint(); return enums[type][v] ?? v }
    return def.kind === 'STRUCT' ? struct(def) : message(def)
  }
  function field(f) {
    if (!f.isArray) return value(f.type)
    if (f.type === 'byte') return r.bytes()
    const n = r.uint(), arr = new Array(n)
    for (let i = 0; i < n; i++) arr[i] = value(f.type)
    return arr
  }
  function struct(def) {
    const o = {}
    for (const f of def.fields) o[f.name] = field(f)
    return o
  }
  function message(def) {
    const fields = byId[def.name]
    const o = {}
    for (;;) {
      const id = r.uint()
      if (id === 0) return o
      const f = fields[id]
      if (!f) throw new Error(`kiwi: unknown field ${id} in ${def.name}`)
      o[f.name] = field(f)
    }
  }
  return value(rootType)
}

function decompress(buf) {
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
    if (!zlib.zstdDecompressSync) throw new Error('this .fig uses zstd compression: Node 22.15+ required')
    return zlib.zstdDecompressSync(buf)
  }
  try { return zlib.inflateRawSync(buf) } catch { return zlib.inflateSync(buf) }
}

export function decodeCanvas(buf) {
  const magic = buf.toString('latin1', 0, 8)
  if (magic !== 'fig-kiwi' && magic !== 'fig-jam.') throw new Error(`not a Figma canvas (header "${magic}")`)
  const version = buf.readUInt32LE(8)
  const chunks = []
  for (let i = 12; i + 4 <= buf.length;) {
    const len = buf.readUInt32LE(i)
    chunks.push(buf.subarray(i + 4, i + 4 + len))
    i += 4 + len
  }
  const schema = decodeSchema(decompress(chunks[0]))
  const message = decodeMessage(schema, decompress(chunks[1]))
  return { version, schema, message }
}

/* ---------------------------------------------------------------- zip -- */

/** Minimal zip reader (stored + deflate) so the script stays dependency-free. */
export function readZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + csize)
      if (method === 0) return data
      if (method === 8) return zlib.inflateRawSync(data)
      throw new Error(`zip: unsupported compression method ${method} for ${name}`)
    })
  }
  return entries
}
