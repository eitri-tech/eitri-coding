import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "remote-config.mjs")

test("builds the config from the repo's template, the profile and the wire plan, with --set overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-"))
    writeFileSync(
        join(dir, "remoteConfig.json"),
        JSON.stringify({
            providerInfo: { ecommerceProvider: "SHOPIFY", host: "www.sample.com", storefrontAccessToken: "", clientId: "", callbackUrl: "", cmsUrl: "https://sample/cms" },
            appConfigs: { headerLogo: "https://sample/logo.png" },
            eitriConfig: { mainApp: "home" },
        }),
    )
    writeFileSync(join(dir, "profile.json"), JSON.stringify({ platform: "SHOPIFY", host: "https://www.lojas.com.br" }))
    writeFileSync(
        join(dir, "plan.json"),
        JSON.stringify({
            apps: [
                { alias: "shared", slug: "lojas-shared", shared: true },
                { alias: "home", slug: "lojas-home", shared: false },
            ],
        }),
    )
    writeFileSync(join(dir, "secrets.json"), JSON.stringify({ storefrontAccessToken: "sf", clientId: "cid", callbackUrl: "lojas://cb" }))

    const res = spawnSync(
        process.execPath,
        [script, "--repo", dir, "--profile", join(dir, "profile.json"), "--plan", join(dir, "plan.json"), "--secrets", join(dir, "secrets.json"), "--set", "appConfigs.headerLogo=https://www.lojas.com.br/logo.png", "--set", "appConfigs.statusBarTextColor=black"],
        { encoding: "utf8" },
    )
    assert.equal(res.status, 0, res.stderr)
    const out = JSON.parse(res.stdout)
    assert.equal(out.config.eitriConfig.mainApp, "lojas-home")
    assert.equal(out.config.providerInfo.host, "https://www.lojas.com.br")
    assert.equal(out.config.providerInfo.storefrontAccessToken, "sf")
    assert.equal(out.config.appConfigs.headerLogo, "https://www.lojas.com.br/logo.png")
    assert.equal(out.config.appConfigs.statusBarTextColor, "black")
    assert.deepEqual(out.needs, [])
})
