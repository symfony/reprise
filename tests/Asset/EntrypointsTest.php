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

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Reprise\Asset\Entrypoints;
use Symfony\Reprise\Exception\InvalidEntrypointsException;

final class EntrypointsTest extends TestCase
{
    public function testFromArrayParsesEveryField(): void
    {
        $entrypoints = Entrypoints::fromArray([
            'isProd' => true,
            'devServer' => null,
            'publicPath' => '/build/',
            'entryPoints' => [
                'app' => [
                    'js' => ['/build/app.js'],
                    'css' => ['/build/app.css'],
                    'preload' => ['/build/shared.js'],
                    'dynamic' => ['/build/lazy.js'],
                ],
            ],
            'integrity' => ['/build/app.js' => 'sha384-xxx'],
        ]);

        $this->assertTrue($entrypoints->isProd);
        $this->assertNull($entrypoints->devServer);
        $this->assertSame('/build/', $entrypoints->publicPath);
        $this->assertSame(['/build/app.js' => 'sha384-xxx'], $entrypoints->integrity);

        $app = $entrypoints->entryPoints['app'];
        $this->assertSame(['/build/app.js'], $app->js);
        $this->assertSame(['/build/app.css'], $app->css);
        $this->assertSame(['/build/shared.js'], $app->preload);
        $this->assertSame(['/build/lazy.js'], $app->dynamic);
    }

    public function testFromArrayParsesTheDevServer(): void
    {
        $devServer = Entrypoints::fromArray([
            'isProd' => false,
            'devServer' => ['origin' => 'http://localhost:5173', 'client' => 'http://localhost:5173/build/@vite/client'],
            'publicPath' => '/build/',
            'entryPoints' => [],
            'integrity' => [],
        ])->devServer;

        $this->assertNotNull($devServer);
        $this->assertSame('http://localhost:5173', $devServer->origin);
        $this->assertSame('http://localhost:5173/build/@vite/client', $devServer->client);
    }

    public function testFromArrayDefaultsMissingOptionalSections(): void
    {
        // A dev-flavoured file may omit `integrity`; entries may omit css/preload/dynamic.
        $entrypoints = Entrypoints::fromArray([
            'isProd' => false,
            'devServer' => ['origin' => 'http://localhost:5173', 'client' => null],
            'publicPath' => '/build/',
            'entryPoints' => ['app' => ['js' => ['http://localhost:5173/build/app.js']]],
        ]);

        $this->assertSame([], $entrypoints->integrity);
        $this->assertNotNull($entrypoints->devServer);
        $this->assertNull($entrypoints->devServer->client);
        $this->assertSame([], $entrypoints->entryPoints['app']->css);
        $this->assertSame([], $entrypoints->entryPoints['app']->preload);
        $this->assertSame([], $entrypoints->entryPoints['app']->dynamic);
    }

    /**
     * @param array<string, mixed> $data
     */
    #[DataProvider('provideMalformedData')]
    public function testFromArrayRejectsMalformedData(array $data): void
    {
        $this->expectException(InvalidEntrypointsException::class);

        Entrypoints::fromArray($data);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function provideMalformedData(): iterable
    {
        $valid = ['isProd' => true, 'publicPath' => '/build/', 'entryPoints' => []];

        yield 'isProd not a boolean' => [['publicPath' => '/build/', 'entryPoints' => []]];
        yield 'publicPath not a string' => [['isProd' => true, 'publicPath' => 42, 'entryPoints' => []]];
        yield 'entryPoints not an object' => [['isProd' => true, 'publicPath' => '/build/', 'entryPoints' => 'nope']];
        yield 'entry not an object' => [[...$valid, 'entryPoints' => ['app' => 'nope']]];
        yield 'entry js not a list' => [[...$valid, 'entryPoints' => ['app' => ['js' => ['key' => 'value']]]]];
        yield 'entry js with a non-string' => [[...$valid, 'entryPoints' => ['app' => ['js' => [123]]]]];
        yield 'entry css with a non-string' => [[...$valid, 'entryPoints' => ['app' => ['css' => [true]]]]];
        yield 'devServer not an object' => [[...$valid, 'isProd' => false, 'devServer' => 'nope']];
        yield 'devServer origin not a string' => [[...$valid, 'isProd' => false, 'devServer' => ['origin' => 42]]];
        yield 'devServer client not a string' => [[...$valid, 'isProd' => false, 'devServer' => ['origin' => 'http://x', 'client' => 42]]];
        yield 'integrity not an object' => [[...$valid, 'integrity' => 'nope']];
        yield 'integrity value not a string' => [[...$valid, 'integrity' => ['/build/app.js' => 123]]];
    }
}
