<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\CacheWarmer;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Component\Cache\Adapter\PhpArrayAdapter;
use Symfony\Reprise\Asset\DevServer;
use Symfony\Reprise\Asset\Entrypoints;
use Symfony\Reprise\CacheWarmer\EntrypointsCacheWarmer;

final class EntrypointsCacheWarmerTest extends TestCase
{
    private string $file;

    protected function setUp(): void
    {
        $this->file = sys_get_temp_dir().'/reprise_warm_'.uniqid('', true).'.cache.php';
    }

    protected function tearDown(): void
    {
        @unlink($this->file);
    }

    public function testWarmsThePoolFromTheEntrypointsFile(): void
    {
        $warmer = new EntrypointsCacheWarmer(
            ['_default' => __DIR__.'/../fixtures/build/entrypoints.json'],
            new PhpArrayAdapter($this->file, new ArrayAdapter()),
        );

        $this->assertTrue($warmer->isOptional());
        $this->assertSame([], $warmer->warmUp(sys_get_temp_dir()));

        // A fresh adapter reading the compiled file must hit and hold a built Entrypoints object.
        $item = new PhpArrayAdapter($this->file, new ArrayAdapter())->getItem('reprise.entrypoints._default');
        $this->assertTrue($item->isHit());
        $this->assertInstanceOf(Entrypoints::class, $item->get());
        $this->assertSame(['build/app-a1b2.js'], $item->get()->entryPoints['app']->js);
    }

    public function testWarmsEveryBuildUnderItsOwnKey(): void
    {
        $warmer = new EntrypointsCacheWarmer(
            [
                '_default' => __DIR__.'/../fixtures/build/entrypoints.json',
                'admin' => __DIR__.'/../fixtures/build/entrypoints.json',
            ],
            new PhpArrayAdapter($this->file, new ArrayAdapter()),
        );
        $warmer->warmUp(sys_get_temp_dir());

        $cache = new PhpArrayAdapter($this->file, new ArrayAdapter());
        $this->assertTrue($cache->getItem('reprise.entrypoints._default')->isHit());
        $this->assertTrue($cache->getItem('reprise.entrypoints.admin')->isHit());
    }

    public function testSkipsAMissingFileWithoutThrowing(): void
    {
        $cache = new PhpArrayAdapter($this->file, new ArrayAdapter());
        $warmer = new EntrypointsCacheWarmer(['_default' => '/does/not/exist/entrypoints.json'], $cache);

        $this->assertSame([], $warmer->warmUp(sys_get_temp_dir()));
        $this->assertFalse($cache->getItem('reprise.entrypoints._default')->isHit());
    }

    public function testTheFullEntrypointsGraphSurvivesTheCompiledFileRoundTrip(): void
    {
        // A maximally-populated graph: prod flag, a non-null DevServer DTO, publicPath, several
        // entries exercising all four file lists, and an integrity map. If VarExporter dropped or
        // mangled any property or nested DTO, the deep assertEquals below would fail.
        $entrypoints = Entrypoints::fromArray([
            'isProd' => false,
            'devServer' => ['origin' => 'http://127.0.0.1:5173', 'client' => 'http://127.0.0.1:5173/build/@vite/client'],
            'publicPath' => '/build/',
            'entryPoints' => [
                'app' => [
                    'js' => ['build/runtime.js', 'build/app.js'],
                    'css' => ['build/app.css'],
                    'preload' => ['build/shared.js'],
                    'dynamic' => ['build/lazy.js'],
                ],
                'admin' => [
                    'js' => ['build/admin.js'],
                    'css' => [],
                    'preload' => [],
                    'dynamic' => [],
                ],
            ],
            'integrity' => ['build/app.js' => 'sha384-app', 'build/app.css' => 'sha384-css'],
        ]);

        $cache = new PhpArrayAdapter($this->file, new ArrayAdapter());
        $cache->warmUp(['reprise.entrypoints' => $entrypoints]);

        $restored = new PhpArrayAdapter($this->file, new ArrayAdapter())->getItem('reprise.entrypoints')->get();

        // A genuinely re-hydrated instance, deeply equal to the original across every property, the
        // DevServer DTO and the nested Entry DTOs.
        $this->assertInstanceOf(Entrypoints::class, $restored);
        $this->assertNotSame($entrypoints, $restored);
        $this->assertEquals($entrypoints, $restored);

        // Explicit spot-checks so a regression points straight at the culprit property/DTO.
        $this->assertFalse($restored->isProd);
        $this->assertSame('/build/', $restored->publicPath);
        $this->assertInstanceOf(DevServer::class, $restored->devServer);
        $this->assertSame('http://127.0.0.1:5173', $restored->devServer->origin);
        $this->assertSame('http://127.0.0.1:5173/build/@vite/client', $restored->devServer->client);
        $this->assertSame(['build/runtime.js', 'build/app.js'], $restored->entryPoints['app']->js);
        $this->assertSame(['build/app.css'], $restored->entryPoints['app']->css);
        $this->assertSame(['build/shared.js'], $restored->entryPoints['app']->preload);
        $this->assertSame(['build/lazy.js'], $restored->entryPoints['app']->dynamic);
        $this->assertSame([], $restored->entryPoints['admin']->css);
        $this->assertSame(['build/app.js' => 'sha384-app', 'build/app.css' => 'sha384-css'], $restored->integrity);
    }
}
