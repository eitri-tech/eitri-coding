import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

// The add-ons' JSX is copied into every app as is: a prop Luminus does not read fails silently on the phone.
const ADDONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addons")

function jsxFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) jsxFiles(path, out)
        else if (/\.(jsx|tsx)$/.test(name)) out.push(path)
    }
    return out
}

test("add-ons: every Luminus <Video> gets its file through `source` (or a YouTube/Vimeo id) — Luminus ignores `src`", () => {
    const wrong = []
    for (const file of jsxFiles(ADDONS)) {
        const code = readFileSync(file, "utf8")
        if (!/from ['"]eitri-luminus['"]/.test(code)) continue
        for (const m of code.matchAll(/<Video\b([^>]*?)\/?>/gs)) {
            const props = m[1]
            if (/\ssrc=/.test(props) || !/\s(source|youTubeId|vimeoId)=/.test(props)) wrong.push(`${relative(ADDONS, file)}: <Video${props.replace(/\s+/g, " ")}>`)
        }
    }
    assert.deepEqual(wrong, [])
})
