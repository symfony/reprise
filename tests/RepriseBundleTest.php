<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Tests\Kernel\EmptyAppKernel;
use Symfony\Reprise\Tests\Kernel\FrameworkAppKernel;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;
use Twig\Environment;

final class RepriseBundleTest extends TestCase
{
    /**
     * @return iterable<string, array{Kernel}>
     */
    public static function provideKernels(): iterable
    {
        yield 'empty' => [new EmptyAppKernel('test', true)];
        yield 'framework' => [new FrameworkAppKernel('test', true)];
    }

    #[DataProvider('provideKernels')]
    public function testBundleBootsInAKernel(Kernel $kernel): void
    {
        $kernel->boot();

        $this->assertArrayHasKey('RepriseBundle', $kernel->getBundles());
    }

    public function testTwigFunctionsRenderThroughALazilyBuiltTagRenderer(): void
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/fixtures/build');
        $kernel->boot();
        $container = $kernel->getContainer();
        $twig = $container->get('twig');
        $this->assertInstanceOf(Environment::class, $twig);

        $this->assertSame('Hello', $twig->createTemplate('Hello')->render());
        $this->assertFalse($container->initialized('reprise.tag_renderer'));

        $tags = $twig->createTemplate("{{ reprise_entry_script_tags('app') }}{{ reprise_entry_link_tags('app') }}")->render();
        $this->assertTrue($container->initialized('reprise.tag_renderer'));
        $this->assertStringContainsString('<script src="/build/app-a1b2.js" type="module"', $tags);
        $this->assertStringContainsString('<link rel="stylesheet" href="/build/app-c3d4.css">', $tags);

        // Files already rendered in a request are not returned again; start a new one.
        $container->get(EntrypointsLookupInterface::class)->reset();
        $this->assertSame('/build/app-a1b2.js|/build/app-c3d4.css|yes|no', $twig->createTemplate(
            "{{ reprise_entry_js_files('app')|join(',') }}|{{ reprise_entry_css_files('app')|join(',') }}|"
            ."{{ reprise_entry_exists('app') ? 'yes' : 'no' }}|{{ reprise_entry_exists('missing') ? 'yes' : 'no' }}"
        )->render());
    }

    public function testRejectsAnInvalidCrossoriginValue(): void
    {
        // crossorigin is an enum: any value other than false/anonymous/use-credentials is a config
        // error surfaced at container-compile time, not silently rendered onto the tags.
        $this->expectException(InvalidConfigurationException::class);

        new FunctionalAppKernel(__DIR__.'/fixtures/build', ['crossorigin' => 'not-valid'])->boot();
    }

    public function testRejectsTheReservedDefaultBuildName(): void
    {
        // "_default" is reserved for the output_path build, so it cannot be used as a named build.
        $this->expectException(InvalidConfigurationException::class);

        new FunctionalAppKernel(__DIR__.'/fixtures/build', ['builds' => ['_default' => __DIR__.'/fixtures/build']])->boot();
    }

    public function testRequiresAtLeastOneBuild(): void
    {
        // output_path: false with no named builds leaves nothing to look up.
        $this->expectException(\LogicException::class);

        new FunctionalAppKernel(__DIR__.'/fixtures/build', ['output_path' => false])->boot();
    }
}
