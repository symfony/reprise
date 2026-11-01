<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Functional;

use PHPUnit\Framework\TestCase;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Exception\EntrypointNotFoundException;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class AssetTagsTest extends TestCase
{
    private function renderer(): TagRenderer
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();

        return $kernel->getContainer()->get('reprise.tag_renderer');
    }

    public function testScriptTagsRenderTheEntryWithResolvedUrlAndIntegrity(): void
    {
        // `app.js` is a relative entrypoints reference (`build/app-a1b2.js`) resolved through the
        // framework asset package (version-less) to an absolute path, and it carries an SRI hash in
        // the fixture's `integrity` map, so the tag also gets `integrity` + `crossorigin`.
        $expected = <<<'HTML'
            <link rel="modulepreload" href="/build/shared-e5f6.js" integrity="sha384-shared" crossorigin="anonymous"><script src="/build/app-a1b2.js" type="module" integrity="sha384-app" crossorigin="anonymous"></script>
            HTML;

        $this->assertSame($expected, $this->renderer()->renderScriptTags('app'));
    }

    public function testLinkTagsRenderTheEntryStylesheet(): void
    {
        // `app.css` (`build/app-c3d4.css`) has no SRI hash in the fixture, so no integrity/crossorigin.
        $expected = <<<'HTML'
            <link rel="stylesheet" href="/build/app-c3d4.css">
            HTML;

        $this->assertSame($expected, $this->renderer()->renderLinkTags('app'));
    }

    public function testStrictModeThrowsWhenRenderingAnUnknownEntry(): void
    {
        // strict_mode defaults to true, so a missing entry surfaces as a clear exception end-to-end
        // (through the booted kernel and the real EntrypointsLookup), rather than silent empty output.
        $this->expectException(EntrypointNotFoundException::class);

        $this->renderer()->renderScriptTags('does-not-exist');
    }
}
