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
use Symfony\Reprise\Exception\UndefinedBuildException;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class MultipleBuildsTest extends TestCase
{
    private function renderer(): TagRenderer
    {
        // Two builds with distinct dev servers -- the default injects an HMR client, the "widget" one does not --
        // to exercise per-build routing and independent client injection through the real container wiring.
        $kernel = new FunctionalAppKernel(
            __DIR__.'/../fixtures/dev',
            ['builds' => ['widget' => __DIR__.'/../fixtures/dev-rspack']],
        );
        $kernel->boot();

        return $kernel->getContainer()->get('reprise.tag_renderer');
    }

    public function testEachBuildRendersFromItsOwnEntrypointsAndDevServer(): void
    {
        $renderer = $this->renderer();

        // The default build serves from :5173 and injects its HMR client once.
        $this->assertSame(
            '<script type="module" src="http://127.0.0.1:5173/build/@vite/client"></script>'
            .'<script src="http://127.0.0.1:5173/build/app.js" type="module"></script>',
            $renderer->renderScriptTags('app'),
        );

        // The widget build serves from :3000; its client is compiled in, so nothing is injected.
        $this->assertSame(
            '<script src="http://127.0.0.1:3000/build/app.js" type="module"></script>',
            $renderer->renderScriptTags('app', build: 'widget'),
        );
    }

    public function testEntryExistsIsResolvedPerBuild(): void
    {
        $renderer = $this->renderer();

        $this->assertTrue($renderer->entryExists('app'));
        $this->assertTrue($renderer->entryExists('app', build: 'widget'));
    }

    public function testRenderingAnUnconfiguredBuildThrows(): void
    {
        $this->expectException(UndefinedBuildException::class);

        $this->renderer()->renderScriptTags('app', build: 'mobile');
    }
}
