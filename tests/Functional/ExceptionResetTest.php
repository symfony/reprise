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
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class ExceptionResetTest extends TestCase
{
    public function testTheErrorPageGetsTheFullTagsAfterAPartialRenderThrows(): void
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();
        $container = $kernel->getContainer();

        /** @var TagRenderer $renderer */
        $renderer = $container->get('reprise.tag_renderer');
        /** @var ResetAssetsEventListener $listener */
        $listener = $container->get('reprise.reset_assets_listener');

        // Stand in for a controller that renders the entry, then throws.
        $full = $renderer->renderScriptTags('app');
        $this->assertStringContainsString('build/app-a1b2.js', $full);
        $this->assertSame('', $renderer->renderScriptTags('app'), 'sanity: the deduplicated re-render is empty');

        // The container-wired listener shares that lookup, so its reset clears the dedup set before the error page.
        $listener->onException(new ExceptionEvent($kernel, Request::create('/'), HttpKernelInterface::MAIN_REQUEST, new \RuntimeException('boom')));

        $this->assertSame($full, $renderer->renderScriptTags('app'));
    }
}
