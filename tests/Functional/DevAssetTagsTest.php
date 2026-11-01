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
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Event\RenderAssetTagEvent;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class DevAssetTagsTest extends TestCase
{
    private function container(string $fixture): ContainerInterface
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/'.$fixture);
        $kernel->boot();

        return $kernel->getContainer();
    }

    private function renderer(string $fixture): TagRenderer
    {
        return $this->container($fixture)->get('reprise.tag_renderer');
    }

    public function testViteDevInjectsTheHmrClientAndServesFromTheOrigin(): void
    {
        // Vite dev emits the HMR client URL (served under `base`, so `/build/@vite/client`); it is
        // injected once, before the entry script, whose src is the dev-server origin URL passed
        // through by Packages unchanged.
        $expected = <<<'HTML'
            <script type="module" src="http://127.0.0.1:5173/build/@vite/client"></script><script src="http://127.0.0.1:5173/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev')->renderScriptTags('app'));
    }

    public function testRsbuildDevServesFromTheOriginWithNoClientInjection(): void
    {
        // Rsbuild dev emits `client: null` (its HMR client is compiled into the bundle), so nothing
        // is injected; the entry script still loads from the dev-server origin.
        $expected = <<<'HTML'
            <script src="http://127.0.0.1:3000/build/app.js" type="module"></script>
            HTML;

        $this->assertSame($expected, $this->renderer('dev-rspack')->renderScriptTags('app'));
    }

    public function testARenderAssetTagListenerCanNonceTheInjectedClientAndScripts(): void
    {
        $container = $this->container('dev');

        $container->get('event_dispatcher')->addListener(
            RenderAssetTagEvent::class,
            static function (RenderAssetTagEvent $event): void {
                $event->attributes['nonce'] = 'test-nonce';
            },
        );

        $html = $container->get('reprise.tag_renderer')->renderScriptTags('app');

        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/@vite/client" nonce="test-nonce">', $html);
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" nonce="test-nonce">', $html);
    }
}
