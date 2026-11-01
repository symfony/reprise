<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Twig;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Asset\Packages;
use Symfony\Component\Asset\PathPackage;
use Symfony\Component\Asset\VersionStrategy\EmptyVersionStrategy;
use Symfony\Reprise\Asset\DevServer;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Asset\TagRenderer;
use Symfony\Reprise\Tests\BuildCollectionTrait;
use Symfony\Reprise\Twig\AssetExtension;
use Twig\Environment;
use Twig\Loader\ArrayLoader;
use Twig\RuntimeLoader\FactoryRuntimeLoader;

final class AssetExtensionTest extends TestCase
{
    use BuildCollectionTrait;

    public function testFunctionsRenderThroughALazilyBuiltRuntime(): void
    {
        $built = 0;
        $twig = new Environment(new ArrayLoader([
            'plain' => 'Hello {{ name }}',
            'page' => "{{ reprise_entry_script_tags('app') }}",
        ]));
        $twig->addExtension(new AssetExtension());
        $twig->addRuntimeLoader(new FactoryRuntimeLoader([
            TagRenderer::class => function () use (&$built): TagRenderer {
                ++$built;

                return $this->tagRenderer(['build/app.js']);
            },
        ]));

        // Registering the extension, or rendering a template without Reprise functions, must not build the TagRenderer.
        $this->assertSame('Hello World', $twig->render('plain', ['name' => 'World']));
        $this->assertSame(0, $built);

        $html = $twig->render('page');

        // The runtime is built exactly once, on first use, and its output flows through unescaped
        // (the functions are declared is_safe: html).
        $this->assertSame(1, $built);
        $this->assertSame('<script src="/build/app.js" type="module"></script>', $html);
    }

    public function testAllFourFunctionsDelegateThroughTheRuntime(): void
    {
        $twig = new Environment(new ArrayLoader([
            'page' => "{{ reprise_entry_script_tags('app') }}|{{ reprise_entry_link_tags('app') }}"
                ."|{{ reprise_entry_js_files('app')|join(',') }}|{{ reprise_entry_css_files('app')|join(',') }}",
        ]));
        $twig->addExtension(new AssetExtension());
        $twig->addRuntimeLoader(new FactoryRuntimeLoader([
            TagRenderer::class => fn (): TagRenderer => $this->tagRenderer(['build/app.js'], ['build/app.css']),
        ]));

        $this->assertSame(
            '<script src="/build/app.js" type="module"></script>'
            .'|<link rel="stylesheet" href="/build/app.css">'
            .'|/build/app.js|/build/app.css',
            $twig->render('page'),
        );
    }

    public function testScriptTagsAcceptPerCallAttributesViaNamedArgument(): void
    {
        $twig = new Environment(new ArrayLoader([
            'page' => "{{ reprise_entry_script_tags('app', attributes={'defer': true, 'data-turbo-track': 'reload'}) }}",
        ]));
        $twig->addExtension(new AssetExtension());
        $twig->addRuntimeLoader(new FactoryRuntimeLoader([
            TagRenderer::class => fn (): TagRenderer => $this->tagRenderer(['build/app.js']),
        ]));

        $this->assertSame(
            '<script src="/build/app.js" type="module" defer data-turbo-track="reload"></script>',
            $twig->render('page'),
        );
    }

    public function testEntryExistsFunctionReflectsTheLookup(): void
    {
        $collection = $this->collection(['_default' => new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json')]);
        $twig = new Environment(new ArrayLoader([
            'page' => "{{ reprise_entry_exists('app') ? 'yes' : 'no' }}|{{ reprise_entry_exists('missing') ? 'yes' : 'no' }}",
        ]));
        $twig->addExtension(new AssetExtension());
        $twig->addRuntimeLoader(new FactoryRuntimeLoader([
            TagRenderer::class => static fn (): TagRenderer => new TagRenderer(
                $collection,
                new Packages(new PathPackage('/', new EmptyVersionStrategy())),
            ),
        ]));

        $this->assertSame('yes|no', $twig->render('page'));
    }

    /**
     * @param list<string> $js
     * @param list<string> $css
     */
    private function tagRenderer(array $js = [], array $css = []): TagRenderer
    {
        $lookup = new class($js, $css) implements EntrypointsLookupInterface {
            /**
             * @param list<string> $js
             * @param list<string> $css
             */
            public function __construct(private array $js, private array $css)
            {
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
                return [];
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
                return [];
            }

            public function isProd(): bool
            {
                return true;
            }

            public function getDevServer(): ?DevServer
            {
                return null;
            }

            public function reset(): void
            {
            }
        };

        return new TagRenderer(
            $this->collection(['_default' => $lookup]),
            new Packages(new PathPackage('/', new EmptyVersionStrategy())),
        );
    }
}
