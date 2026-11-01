<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\EventListener;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\FinishRequestEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\EventListener\ResetAssetsEventListener;
use Symfony\Reprise\Tests\BuildCollectionTrait;

final class ResetAssetsEventListenerTest extends TestCase
{
    use BuildCollectionTrait;

    private function lookup(string $fixture = 'build'): EntrypointsLookup
    {
        return new EntrypointsLookup(__DIR__.'/../fixtures/'.$fixture.'/entrypoints.json');
    }

    private function rendererFor(EntrypointsLookupInterface $lookup): TagRenderer
    {
        return new TagRenderer(
            $this->collection(['_default' => $lookup]),
            new Packages(new PathPackage('/', new EmptyVersionStrategy())),
        );
    }

    private function finishRequest(int $requestType): FinishRequestEvent
    {
        return new FinishRequestEvent($this->createStub(HttpKernelInterface::class), Request::create('/'), $requestType);
    }

    private function exceptionEvent(int $requestType): ExceptionEvent
    {
        return new ExceptionEvent($this->createStub(HttpKernelInterface::class), Request::create('/'), $requestType, new \RuntimeException('boom'));
    }

    public function testResetsDeduplicationWhenTheMainRequestFinishes(): void
    {
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app'); // marks the shared chunk as already returned

        new ResetAssetsEventListener([$lookup, $this->rendererFor($lookup)])->onFinishRequest($this->finishRequest(HttpKernelInterface::MAIN_REQUEST));

        // After the reset the shared chunk is offered again to the next request.
        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testIgnoresSubRequestsOnFinishRequest(): void
    {
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app');

        new ResetAssetsEventListener([$lookup, $this->rendererFor($lookup)])->onFinishRequest($this->finishRequest(HttpKernelInterface::SUB_REQUEST));

        // A sub-request finishing must NOT reset -- the shared chunk stays deduplicated.
        $this->assertSame([], $lookup->getPreloadFiles('admin'));
    }

    public function testResetsDeduplicationWhenAnExceptionIsHandled(): void
    {
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app');

        new ResetAssetsEventListener([$lookup, $this->rendererFor($lookup)])->onException($this->exceptionEvent(HttpKernelInterface::MAIN_REQUEST));

        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testResetsDeduplicationEvenForSubRequestExceptions(): void
    {
        // An exception at any level abandons the render, so even a sub-request one resets (unlike FINISH_REQUEST).
        $lookup = $this->lookup();
        $lookup->getPreloadFiles('app');

        new ResetAssetsEventListener([$lookup, $this->rendererFor($lookup)])->onException($this->exceptionEvent(HttpKernelInterface::SUB_REQUEST));

        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testResetsTheRendererWhenAnExceptionIsHandled(): void
    {
        $lookup = $this->lookup('dev');
        $renderer = $this->rendererFor($lookup);
        $renderer->renderScriptTags('app');
        $this->assertStringNotContainsString('@vite/client', $renderer->renderScriptTags('app'), 'sanity: not re-injected within the same request');

        new ResetAssetsEventListener([$lookup, $renderer])->onException($this->exceptionEvent(HttpKernelInterface::MAIN_REQUEST));

        $this->assertStringContainsString('@vite/client', $renderer->renderScriptTags('app'));
    }

    public function testResetsBeforeTheErrorPageIsRendered(): void
    {
        $lookup = $this->lookup();
        $renderer = $this->rendererFor($lookup);

        $dispatcher = new EventDispatcher();
        $dispatcher->addSubscriber(new ResetAssetsEventListener([$lookup, $renderer]));

        // Symfony's ErrorListener renders the error page at priority -128; capture what it would emit.
        $errorPageTags = null;
        $dispatcher->addListener(KernelEvents::EXCEPTION, static function () use (&$errorPageTags, $renderer) {
            $errorPageTags = $renderer->renderScriptTags('app');
        }, -128);

        $full = $renderer->renderScriptTags('app');
        $dispatcher->dispatch($this->exceptionEvent(HttpKernelInterface::MAIN_REQUEST), KernelEvents::EXCEPTION);

        // Reprise's reset (default priority 0) runs before -128, so the error page gets the full tag set.
        $this->assertSame($full, $errorPageTags);
        $this->assertStringContainsString('build/app-a1b2.js', $errorPageTags);
    }
}
