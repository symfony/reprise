<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Asset;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\UrlPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
use Symfony\Component\WebLink\HttpHeaderSerializer;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Symfony\Reprise\Asset\DevServer;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Event\RenderAssetTagEvent;
use Symfony\Reprise\Exception\UndefinedBuildException;
use Symfony\Reprise\Tests\BuildCollectionTrait;

final class TagRendererTest extends TestCase
{
    use BuildCollectionTrait;

    private function renderer(
        array $js = [],
        array $css = [],
        array $preload = [],
        array $integrity = [],
        ?DevServer $devServer = null,
        string|false $crossorigin = false,
        array $scriptAttributes = [],
        array $linkAttributes = [],
        ?RequestStack $requestStack = null,
        bool $preloadEnabled = true,
        ?Packages $packages = null,
        ?EventDispatcherInterface $eventDispatcher = null,
    ): TagRenderer {
        $packages ??= new Packages(new PathPackage('/', new EmptyVersionStrategy()));

        return new TagRenderer(
            $this->collection(['_default' => $this->lookup($js, $css, $preload, $integrity, $devServer)]),
            $packages,
            $requestStack,
            null,
            $crossorigin,
            $preloadEnabled,
            $scriptAttributes,
            $linkAttributes,
            $eventDispatcher,
        );
    }

    private function lookup(
        array $js = [],
        array $css = [],
        array $preload = [],
        array $integrity = [],
        ?DevServer $devServer = null,
    ): EntrypointsLookupInterface {
        return new class($js, $css, $preload, $integrity, $devServer) implements EntrypointsLookupInterface {
            public function __construct(
                private array $js,
                private array $css,
                private array $preload,
                private array $integrity,
                private ?DevServer $devServer,
            ) {
            }

            public function getJavaScriptFiles(string $entryName): array
            {
                return $this->js;
            }

            public function getCssFiles(string $entryName): array
            {
                return $this->css;
            }

            public function getPreloadFiles(string $entryName): array
            {
                return $this->preload;
            }

            public function getDynamicFiles(string $entryName): array
            {
                return [];
            }

            public function entryExists(string $entryName): bool
            {
                return true;
            }

            public function getIntegrityData(): array
            {
                return $this->integrity;
            }

            public function isProd(): bool
            {
                return null === $this->devServer;
            }

            public function getDevServer(): ?DevServer
            {
                return $this->devServer;
            }

            public function reset(): void
            {
            }
        };
    }

    public function testRendersModuleScriptTagsWithPackagesResolvedSrc(): void
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertSame('<script src="/build/app-a1b2.js" type="module"></script>', $html);
    }

    public function testRendersStylesheetLinkTags(): void
    {
        $html = $this->renderer(css: ['build/app-c3.css'])->renderLinkTags('app');
        $this->assertSame('<link rel="stylesheet" href="/build/app-c3.css">', $html);
    }

    public function testAddsIntegrityAndCrossoriginWhenPresent(): void
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            integrity: ['build/app-a1b2.js' => 'sha384-XYZ'],
        )->renderScriptTags('app');
        $this->assertStringContainsString('integrity="sha384-XYZ"', $html);
        $this->assertStringContainsString('crossorigin="anonymous"', $html);
    }

    public function testNoCrossoriginWithoutIntegrity(): void
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');
        $this->assertStringNotContainsString('crossorigin', $html);
    }

    public function testGetJsFilesReturnsResolvedUrlsWithoutTags(): void
    {
        $urls = $this->renderer(js: ['build/app-a1b2.js', 'build/vendor-e5.js'])->getJsFiles('app');
        $this->assertSame(['/build/app-a1b2.js', '/build/vendor-e5.js'], $urls);
    }

    public function testScriptAndLinkDefaultAttributesAreApplied(): void
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true])->renderScriptTags('app');
        $this->assertStringContainsString(' defer', $html);
    }

    public function testInjectsViteHmrClientOncePerRequestInDev(): void
    {
        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        );

        $first = $renderer->renderScriptTags('app');
        $this->assertSame(
            '<script type="module" src="http://127.0.0.1:5173/build/@vite/client"></script>'
            .'<script src="http://127.0.0.1:5173/build/app.js" type="module"></script>',
            $first,
        );

        // Same request, second call (e.g. a second entry): the client is not injected again.
        $second = $renderer->renderScriptTags('app');
        $this->assertStringNotContainsString('@vite/client', $second);

        // A new request resets the flag and the client is injected again.
        $renderer->reset();
        $this->assertStringContainsString('@vite/client', $renderer->renderScriptTags('app'));
    }

    public function testDoesNotInjectHmrClientWhenDevServerClientIsNull(): void
    {
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', null),
        )->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function testDoesNotInjectHmrClientInProd(): void
    {
        $html = $this->renderer(js: ['build/app-a1b2.js'])->renderScriptTags('app');

        $this->assertStringNotContainsString('@vite/client', $html);
    }

    public function testInjectsReactRefreshPreambleAfterTheClientAndBeforeTheEntryInDev(): void
    {
        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer(
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5173/build/@vite/client',
                'http://127.0.0.1:5173/build/@react-refresh',
            ),
        );

        $html = $renderer->renderScriptTags('app');

        $this->assertStringContainsString('import RefreshRuntime from "http://127.0.0.1:5173/build/@react-refresh"', $html);
        $this->assertStringContainsString('window.__vite_plugin_react_preamble_installed__ = true', $html);

        $this->assertStringContainsString(
            <<<'HTML'
                <script type="module">
                import RefreshRuntime from "http://127.0.0.1:5173/build/@react-refresh";
                RefreshRuntime.injectIntoGlobalHook(window);
                window.$RefreshReg$ = () => {};
                window.$RefreshSig$ = () => (type) => type;
                window.__vite_plugin_react_preamble_installed__ = true;
                </script>
                HTML,
            $html,
        );

        // Order matters: the HMR client, then the preamble, then the entry that imports the components.
        $clientPos = strpos($html, '@vite/client');
        $preamblePos = strpos($html, '@react-refresh');
        $entryPos = strpos($html, 'build/app.js');
        $this->assertLessThan($preamblePos, $clientPos);
        $this->assertLessThan($entryPos, $preamblePos);
    }

    public function testDoesNotInjectReactRefreshPreambleWhenNotAReactApp(): void
    {
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        )->renderScriptTags('app');

        $this->assertStringNotContainsString('@react-refresh', $html);
        $this->assertStringNotContainsString('__vite_plugin_react_preamble_installed__', $html);
    }

    public function testRendersModulepreloadLinksWithIntegrityBeforeScripts(): void
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            preload: ['build/shared-e5.js'],
            integrity: ['build/shared-e5.js' => 'sha384-shared'],
        )->renderScriptTags('app');

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared-e5.js" integrity="sha384-shared" crossorigin="anonymous">'
            .'<script src="/build/app-a1b2.js" type="module"></script>',
            $html,
        );
    }

    public function testRegistersPreloadLinksOnTheRequestWhenWebLinkIsAvailable(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $renderer = $this->renderer(
            js: ['build/app-a1b2.js'],
            css: ['build/app-c3.css'],
            preload: ['build/shared-e5.js'],
            requestStack: $stack,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $links = $request->attributes->get('_links');
        $this->assertInstanceOf(GenericLinkProvider::class, $links);

        $byHref = [];
        foreach ($links->getLinks() as $link) {
            $byHref[$link->getHref()] = ['rels' => $link->getRels(), 'as' => $link->getAttributes()['as'] ?? null];
        }

        $this->assertSame(['modulepreload'], $byHref['/build/shared-e5.js']['rels']);
        // The <script type=module> entry is preloaded as modulepreload, not `preload as=script` (whose
        // classic-script fetch mode mismatches the module and gets discarded by the browser).
        $this->assertSame(['modulepreload'], $byHref['/build/app-a1b2.js']['rels']);
        $this->assertNull($byHref['/build/app-a1b2.js']['as']);
        $this->assertSame(['preload'], $byHref['/build/app-c3.css']['rels']);
        $this->assertSame('style', $byHref['/build/app-c3.css']['as']);
    }

    public function testPreloadLinksCarryIntegrityAndCrossoriginWhenPresent(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $renderer = $this->renderer(
            js: ['build/app-a1b2.js'],
            css: ['build/app-c3.css'],
            preload: ['build/shared-e5.js'],
            integrity: [
                'build/app-a1b2.js' => 'sha384-JS',
                'build/app-c3.css' => 'sha384-CSS',
                'build/shared-e5.js' => 'sha384-SHARED',
            ],
            requestStack: $stack,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $byHref = [];
        foreach ($request->attributes->get('_links')->getLinks() as $link) {
            $byHref[$link->getHref()] = $link->getAttributes();
        }

        $this->assertSame('sha384-SHARED', $byHref['/build/shared-e5.js']['integrity']);
        $this->assertSame('anonymous', $byHref['/build/shared-e5.js']['crossorigin']);
        $this->assertSame('sha384-JS', $byHref['/build/app-a1b2.js']['integrity']);
        $this->assertSame('anonymous', $byHref['/build/app-a1b2.js']['crossorigin']);
        $this->assertSame('sha384-CSS', $byHref['/build/app-c3.css']['integrity']);
        $this->assertSame('anonymous', $byHref['/build/app-c3.css']['crossorigin']);
    }

    public function testPreloadLinksHaveNoIntegrityWhenTheAssetIsNotHashed(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(js: ['build/app-a1b2.js'], requestStack: $stack)->renderScriptTags('app');

        foreach ($request->attributes->get('_links')->getLinks() as $link) {
            $this->assertArrayNotHasKey('integrity', $link->getAttributes());
            $this->assertArrayNotHasKey('crossorigin', $link->getAttributes());
        }
    }

    public function testPreloadLinksUseTheConfiguredCrossorigin(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(
            js: ['build/app-a1b2.js'],
            integrity: ['build/app-a1b2.js' => 'sha384-JS'],
            crossorigin: 'use-credentials',
            requestStack: $stack,
        )->renderScriptTags('app');

        foreach ($request->attributes->get('_links')->getLinks() as $link) {
            $this->assertSame('use-credentials', $link->getAttributes()['crossorigin']);
        }
    }

    public function testDoesNotRegisterLinksWithoutACurrentRequest(): void
    {
        $renderer = $this->renderer(js: ['build/app-a1b2.js'], requestStack: new RequestStack());

        // No current request pushed: rendering must not throw and returns the tags as usual.
        $this->assertStringContainsString('<script', $renderer->renderScriptTags('app'));
    }

    public function testPreloadToggleDisablesLinkRegistration(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(js: ['build/app-a1b2.js'], requestStack: $stack, preloadEnabled: false)
            ->renderScriptTags('app');

        $this->assertNull($request->attributes->get('_links'));
    }

    public function testConfiguredCrossoriginOverridesTheAnonymousDefault(): void
    {
        $html = $this->renderer(
            js: ['build/app.js'],
            integrity: ['build/app.js' => 'sha384-XYZ'],
            crossorigin: 'use-credentials',
        )->renderScriptTags('app');

        $this->assertSame(
            '<script src="/build/app.js" type="module" integrity="sha384-XYZ" crossorigin="use-credentials"></script>',
            $html,
        );
    }

    public function testLinkTagsGetIntegrityAndCrossoriginWhenPresent(): void
    {
        $html = $this->renderer(
            css: ['build/app.css'],
            integrity: ['build/app.css' => 'sha384-CSS'],
        )->renderLinkTags('app');

        $this->assertSame(
            '<link rel="stylesheet" href="/build/app.css" integrity="sha384-CSS" crossorigin="anonymous">',
            $html,
        );
    }

    public function testResolvesReferencesThroughAnExplicitPackage(): void
    {
        $packages = new Packages(
            new PathPackage('/', new EmptyVersionStrategy()),
            ['cdn' => new UrlPackage('https://cdn.example.com/', new EmptyVersionStrategy())],
        );

        $html = $this->renderer(js: ['build/app.js'], packages: $packages)->renderScriptTags('app', 'cdn');

        $this->assertSame('<script src="https://cdn.example.com/build/app.js" type="module"></script>', $html);
    }

    public function testGetCssFilesReturnsResolvedUrlsWithoutTags(): void
    {
        $urls = $this->renderer(css: ['build/a.css', 'build/b.css'])->getCssFiles('app');

        $this->assertSame(['/build/a.css', '/build/b.css'], $urls);
    }

    public function testLinkAttributesAreApplied(): void
    {
        $html = $this->renderer(css: ['build/app.css'], linkAttributes: ['media' => 'print'])->renderLinkTags('app');

        $this->assertSame('<link rel="stylesheet" href="/build/app.css" media="print">', $html);
    }

    public function testFalseValuedAttributeIsDropped(): void
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['nomodule' => false])->renderScriptTags('app');

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testAttributeValuesAreHtmlEscaped(): void
    {
        $html = $this->renderer(
            js: ['build/app.js'],
            scriptAttributes: ['data-payload' => '"><script>alert(1)</script>'],
        )->renderScriptTags('app');

        // Exact match: the raw payload is fully escaped (no attribute-injection XSS) and nothing else
        // leaks into the tag.
        $this->assertSame(
            '<script src="/build/app.js" type="module" data-payload="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"></script>',
            $html,
        );
    }

    public function testAnEntryWithNoFilesRendersAnEmptyString(): void
    {
        $renderer = $this->renderer();

        $this->assertSame('', $renderer->renderScriptTags('app'));
        $this->assertSame('', $renderer->renderLinkTags('app'));
    }

    public function testRendersEveryScriptInFileOrder(): void
    {
        // Load order is the whole point of entrypoints.json: the runtime chunk must precede the app
        // chunk, in the exact order the file lists them.
        $html = $this->renderer(js: ['build/runtime.js', 'build/app.js'])->renderScriptTags('app');

        $this->assertSame(
            '<script src="/build/runtime.js" type="module"></script>'
            .'<script src="/build/app.js" type="module"></script>',
            $html,
        );
    }

    public function testRendersEveryStylesheetInFileOrder(): void
    {
        $html = $this->renderer(css: ['build/a.css', 'build/b.css'])->renderLinkTags('app');

        $this->assertSame(
            '<link rel="stylesheet" href="/build/a.css">'
            .'<link rel="stylesheet" href="/build/b.css">',
            $html,
        );
    }

    public function testEntryExistsDelegatesToTheLookup(): void
    {
        $renderer = new TagRenderer(
            $this->collection(['_default' => new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json')]),
            new Packages(new PathPackage('/', new EmptyVersionStrategy())),
        );

        $this->assertTrue($renderer->entryExists('app'));
        $this->assertFalse($renderer->entryExists('does-not-exist'));
    }

    public function testModulepreloadHasNoIntegrityWhenTheChunkIsNotHashed(): void
    {
        // A preload chunk without an SRI entry (e.g. in dev) gets a bare modulepreload link.
        $html = $this->renderer(js: ['build/app.js'], preload: ['build/shared.js'])->renderScriptTags('app');

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared.js">'
            .'<script src="/build/app.js" type="module"></script>',
            $html,
        );
    }

    public function testPerCallAttributesAreAppliedToScriptTags(): void
    {
        $html = $this->renderer(js: ['build/app.js'])
            ->renderScriptTags('app', attributes: ['defer' => true, 'data-turbo-track' => 'reload']);

        $this->assertSame('<script src="/build/app.js" type="module" defer data-turbo-track="reload"></script>', $html);
    }

    public function testPerCallAttributesAreAppliedToLinkTags(): void
    {
        $html = $this->renderer(css: ['build/app.css'])->renderLinkTags('app', attributes: ['media' => 'print']);

        $this->assertSame('<link rel="stylesheet" href="/build/app.css" media="print">', $html);
    }

    public function testPerCallAttributesWinOverDefaultAttributes(): void
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['data-turbo-track' => 'reload'])
            ->renderScriptTags('app', attributes: ['data-turbo-track' => 'reload-only-on-this-page']);

        $this->assertStringContainsString('data-turbo-track="reload-only-on-this-page"', $html);
        $this->assertStringNotContainsString('data-turbo-track="reload"', $html);
    }

    public function testPerCallFalseValueDropsADefaultAttribute(): void
    {
        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true])
            ->renderScriptTags('app', attributes: ['defer' => false]);

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testPerCallAttributesApplyToScriptsNotToModulepreloadLinks(): void
    {
        $html = $this->renderer(js: ['build/app.js'], preload: ['build/shared.js'])
            ->renderScriptTags('app', attributes: ['data-turbo-track' => 'reload']);

        // The per-call attribute rides on the <script>, never on the modulepreload <link>.
        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared.js">'
            .'<script src="/build/app.js" type="module" data-turbo-track="reload"></script>',
            $html,
        );
    }

    public function testPerCallAttributesApplyToTheHmrClient(): void
    {
        // Unified path: per-call attributes now seed the injected client too (issue #71).
        $html = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client'),
        )->renderScriptTags('app', attributes: ['defer' => true]);

        $this->assertStringContainsString('<script type="module" src="http://127.0.0.1:5173/build/@vite/client" defer></script>', $html);
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" defer></script>', $html);
    }

    public function testAListenerCanAddAnAttributeToEveryRenderedTag(): void
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            $event->attributes['nonce'] = 'r4nd0m';
        });

        $renderer = $this->renderer(
            js: ['http://127.0.0.1:5173/build/app.js'],
            css: ['build/app.css'],
            preload: ['build/shared.js'],
            devServer: new DevServer(
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5173/build/@vite/client',
                'http://127.0.0.1:5173/build/@react-refresh',
            ),
            eventDispatcher: $dispatcher,
        );

        $scripts = $renderer->renderScriptTags('app');
        $links = $renderer->renderLinkTags('app');

        $this->assertStringContainsString('<script type="module" src="http://127.0.0.1:5173/build/@vite/client" nonce="r4nd0m"></script>', $scripts);
        $this->assertStringContainsString('<script type="module" nonce="r4nd0m">', $scripts); // the preamble
        $this->assertStringContainsString('<link rel="modulepreload" href="/build/shared.js" nonce="r4nd0m">', $scripts);
        $this->assertStringContainsString('src="http://127.0.0.1:5173/build/app.js" type="module" nonce="r4nd0m"></script>', $scripts);
        $this->assertStringContainsString('<link rel="stylesheet" href="/build/app.css" nonce="r4nd0m">', $links);
    }

    public function testTheEventReportsTheTagTypeToTheListener(): void
    {
        $types = [];
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event) use (&$types): void {
            $types[] = $event->isScript() ? 'script' : ($event->isLink() ? 'link' : ($event->isModulepreload() ? 'modulepreload' : 'other'));
        });

        $renderer = $this->renderer(js: ['build/app.js'], css: ['build/app.css'], preload: ['build/shared.js'], eventDispatcher: $dispatcher);
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $this->assertSame(['modulepreload', 'script', 'link'], $types);
    }

    public function testAListenerCanRemoveAConfiguredAttribute(): void
    {
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            unset($event->attributes['defer']);
        });

        $html = $this->renderer(js: ['build/app.js'], scriptAttributes: ['defer' => true], eventDispatcher: $dispatcher)
            ->renderScriptTags('app');

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testModulepreloadLinksTakeTheNonceGivenToTheScripts(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $html = $this->renderer(js: ['build/app.js'], preload: ['build/shared.js'], requestStack: $stack)
            ->renderScriptTags('app', attributes: ['nonce' => 'r4nd0m', 'data-turbo-track' => 'reload']);

        $this->assertSame(
            '<link rel="modulepreload" href="/build/shared.js" nonce="r4nd0m">'
            .'<script src="/build/app.js" type="module" nonce="r4nd0m" data-turbo-track="reload"></script>',
            $html,
        );
        $this->assertSame(
            '</build/shared.js>; rel="modulepreload"; nonce="r4nd0m",</build/app.js>; rel="modulepreload"; nonce="r4nd0m"',
            new HttpHeaderSerializer()->serialize($request->attributes->get('_links')->getLinks()),
        );
    }

    public function testPreloadHeadersCarryTheNonceAListenerSetOnTheirTag(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            if (!$event->isLink()) {
                $event->attributes['nonce'] = 'r4nd0m';
            }
        });

        $renderer = $this->renderer(
            js: ['build/app.js'],
            css: ['build/app.css'],
            preload: ['build/shared.js'],
            requestStack: $stack,
            eventDispatcher: $dispatcher,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $this->assertSame(
            '</build/shared.js>; rel="modulepreload"; nonce="r4nd0m",'
            .'</build/app.js>; rel="modulepreload"; nonce="r4nd0m",'
            .'</build/app.css>; rel="preload"; as="style"',
            new HttpHeaderSerializer()->serialize($request->attributes->get('_links')->getLinks()),
        );
    }

    public function testPreloadHeadersFollowTheIntegrityAndCrossoriginAListenerSetOnTheirTag(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());
        $dispatcher = new EventDispatcher();
        $dispatcher->addListener(RenderAssetTagEvent::class, static function (RenderAssetTagEvent $event): void {
            if ($event->isLink()) {
                unset($event->attributes['integrity'], $event->attributes['crossorigin']);
            } else {
                $event->attributes['integrity'] = 'sha384-REWRITTEN';
                $event->attributes['crossorigin'] = 'use-credentials';
            }
        });

        $renderer = $this->renderer(
            js: ['build/app.js'],
            css: ['build/app.css'],
            preload: ['build/shared.js'],
            integrity: ['build/app.js' => 'sha384-JS', 'build/app.css' => 'sha384-CSS', 'build/shared.js' => 'sha384-SHARED'],
            requestStack: $stack,
            eventDispatcher: $dispatcher,
        );
        $renderer->renderScriptTags('app');
        $renderer->renderLinkTags('app');

        $this->assertSame(
            '</build/shared.js>; rel="modulepreload"; integrity="sha384-REWRITTEN"; crossorigin="use-credentials",'
            .'</build/app.js>; rel="modulepreload"; integrity="sha384-REWRITTEN"; crossorigin="use-credentials",'
            .'</build/app.css>; rel="preload"; as="style"',
            new HttpHeaderSerializer()->serialize($request->attributes->get('_links')->getLinks()),
        );
    }

    public function testPreloadHeadersCarryACrossoriginConfiguredOnTheTagWithoutIntegrity(): void
    {
        $stack = new RequestStack();
        $stack->push($request = new Request());

        $this->renderer(js: ['build/app.js'], scriptAttributes: ['crossorigin' => 'anonymous'], requestStack: $stack)
            ->renderScriptTags('app');

        $this->assertSame(
            '</build/app.js>; rel="modulepreload"; crossorigin="anonymous"',
            new HttpHeaderSerializer()->serialize($request->attributes->get('_links')->getLinks()),
        );
    }

    public function testPerCallAttributesCannotSpoofIntegrity(): void
    {
        $html = $this->renderer(
            js: ['build/app-a1b2.js'],
            integrity: ['build/app-a1b2.js' => 'sha384-REAL'],
        )->renderScriptTags('app', attributes: ['integrity' => 'sha384-FAKE']);

        $this->assertStringContainsString('integrity="sha384-REAL"', $html);
        $this->assertStringNotContainsString('sha384-FAKE', $html);
    }

    public function testRenderingScriptTagsForAnUnknownBuildThrows(): void
    {
        $this->expectException(UndefinedBuildException::class);

        $this->renderer(js: ['build/app.js'])->renderScriptTags('app', build: 'admin');
    }

    public function testRenderingLinkTagsForAnUnknownBuildThrows(): void
    {
        $this->expectException(UndefinedBuildException::class);

        $this->renderer(css: ['build/app.css'])->renderLinkTags('app', build: 'admin');
    }

    public function testRendersTheRequestedBuild(): void
    {
        $renderer = new TagRenderer(
            $this->collection([
                '_default' => $this->lookup(js: ['build/app.js']),
                'admin' => $this->lookup(js: ['admin/dashboard.js']),
            ]),
            new Packages(new PathPackage('/', new EmptyVersionStrategy())),
        );

        $this->assertSame('<script src="/build/app.js" type="module"></script>', $renderer->renderScriptTags('app'));
        $this->assertSame('<script src="/admin/dashboard.js" type="module"></script>', $renderer->renderScriptTags('dashboard', build: 'admin'));
    }

    public function testInjectsEachBuildsHmrClientOncePerRequest(): void
    {
        $renderer = new TagRenderer(
            $this->collection([
                '_default' => $this->lookup(js: ['http://127.0.0.1:5173/build/app.js'], devServer: new DevServer('http://127.0.0.1:5173', 'http://127.0.0.1:5173/build/@vite/client')),
                'admin' => $this->lookup(js: ['http://127.0.0.1:3000/admin/app.js'], devServer: new DevServer('http://127.0.0.1:3000', 'http://127.0.0.1:3000/admin/@vite/client')),
            ]),
            new Packages(new PathPackage('/', new EmptyVersionStrategy())),
        );

        // Each build's dev server injects its own client exactly once, even on the same page.
        $default = $renderer->renderScriptTags('app');
        $admin = $renderer->renderScriptTags('app', build: 'admin');
        $this->assertStringContainsString('http://127.0.0.1:5173/build/@vite/client', $default);
        $this->assertStringContainsString('http://127.0.0.1:3000/admin/@vite/client', $admin);

        // A second render of either build no longer re-injects its client.
        $this->assertStringNotContainsString('@vite/client', $renderer->renderScriptTags('app'));
        $this->assertStringNotContainsString('@vite/client', $renderer->renderScriptTags('app', build: 'admin'));
    }
}
