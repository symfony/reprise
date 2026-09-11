import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { expectNoErrors, withPage } from './support'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

describe('stylesheet plumbing on /feature/scss-typescript', () => {
  test('the theme style entry renders a <link> and no <script>', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/feature/scss-typescript', { waitUntil: 'load' })

      const hrefs = await page.locator('link[rel=stylesheet]').evaluateAll((links) =>
        links.map((link) => (link as HTMLLinkElement).href),
      )
      expect(hrefs.filter((href) => href.includes('theme'))).toHaveLength(1)

      const sources = await page.locator('script[src]').evaluateAll((scripts) =>
        scripts.map((script) => (script as HTMLScriptElement).src),
      )
      expect(sources.filter((src) => src.includes('theme'))).toEqual([])

      // #7c3aed, straight from theme.scss: the entry's CSS really landed.
      const colour = await page.locator('.theme-card').evaluate((el) => getComputedStyle(el).color)
      expect(colour).toBe('rgb(124, 58, 237)')

      expectNoErrors(errors)
    })
  })

  test('a CSS Module class is hashed and applied by its controller', async () => {
    await withPage(browser, async ({ page, errors }) => {
      await page.goto('/feature/scss-typescript', { waitUntil: 'load' })

      // The class attribute only appears once the Stimulus controller has applied the generated name.
      const badge = page.locator('[data-controller="card-module"][class]')
      await badge.waitFor({ state: 'visible', timeout: 5_000 })

      const className = (await badge.getAttribute('class')) ?? ''
      expect(className).not.toBe('badge')
      expect(className).not.toBe('')

      // #0f766e, from card.module.scss.
      const background = await badge.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(background).toBe('rgb(15, 118, 110)')

      expectNoErrors(errors)
    })
  })
})
