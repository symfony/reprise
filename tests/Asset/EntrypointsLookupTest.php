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
use Symfony\Component\Cache\Adapter\ArrayAdapter;
use Symfony\Reprise\Asset\Entrypoints;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Exception\EntrypointNotFoundException;
use Symfony\Reprise\Exception\EntrypointsFileNotFoundException;
use Symfony\Reprise\Exception\InvalidEntrypointsException;

final class EntrypointsLookupTest extends TestCase
{
    private function lookup(bool $strictMode = true, string $file = 'build/entrypoints.json'): EntrypointsLookup
    {
        return new EntrypointsLookup(__DIR__.'/../fixtures/'.$file, $strictMode);
    }

    public function testResolvesAnEntrysFilesByType(): void
    {
        $lookup = $this->lookup();

        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
        $this->assertSame(['build/app-c3d4.css'], $lookup->getCssFiles('app'));
        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('app'));
        $this->assertSame(['build/lazy-x.js'], $lookup->getDynamicFiles('app'));
    }

    public function testDeduplicatesSharedFilesAcrossCalls(): void
    {
        $lookup = $this->lookup();

        // app pulls the shared preload chunk...
        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('app'));
        // ...admin references the same chunk, but it must not be emitted twice on one page.
        $this->assertSame([], $lookup->getPreloadFiles('admin'));
        $this->assertSame(['build/admin-99.js'], $lookup->getJavaScriptFiles('admin'));
    }

    public function testResetClearsDeduplicationState(): void
    {
        $lookup = $this->lookup();

        $lookup->getPreloadFiles('app');
        $lookup->reset();

        $this->assertSame(['build/shared-e5f6.js'], $lookup->getPreloadFiles('admin'));
    }

    public function testEntryExists(): void
    {
        $lookup = $this->lookup();

        $this->assertTrue($lookup->entryExists('app'));
        $this->assertFalse($lookup->entryExists('nope'));
    }

    public function testExposesModeAndIntegrity(): void
    {
        $lookup = $this->lookup();

        $this->assertTrue($lookup->isProd());
        $this->assertNull($lookup->getDevServer());
        $this->assertSame('sha384-app', $lookup->getIntegrityData()['build/app-a1b2.js']);
    }

    public function testExposesTheDevServerAndDevModeForAServeFlavouredFile(): void
    {
        $lookup = $this->lookup(file: 'dev/entrypoints.json');

        $this->assertFalse($lookup->isProd());
        $this->assertSame([], $lookup->getIntegrityData());
        $this->assertSame(['http://127.0.0.1:5173/build/app.js'], $lookup->getJavaScriptFiles('app'));

        $devServer = $lookup->getDevServer();
        $this->assertNotNull($devServer);
        $this->assertSame('http://127.0.0.1:5173', $devServer->origin);
        $this->assertSame('http://127.0.0.1:5173/build/@vite/client', $devServer->client);
    }

    public function testThrowsWhenTheFileIsNotAJsonObject(): void
    {
        $this->expectException(InvalidEntrypointsException::class);

        $this->lookup(file: 'malformed/entrypoints.json')->getJavaScriptFiles('app');
    }

    public function testStrictModeThrowsOnUnknownEntry(): void
    {
        $this->expectException(EntrypointNotFoundException::class);

        $this->lookup()->getJavaScriptFiles('nope');
    }

    public function testNonStrictModeReturnsEmptyForUnknownEntry(): void
    {
        $this->assertSame([], $this->lookup(strictMode: false)->getJavaScriptFiles('nope'));
    }

    public function testStrictModeThrowsOnMissingFile(): void
    {
        $this->expectException(EntrypointsFileNotFoundException::class);

        $this->lookup(file: 'does-not-exist/entrypoints.json')->getJavaScriptFiles('app');
    }

    public function testNonStrictModeIsQuietOnMissingFile(): void
    {
        $lookup = $this->lookup(strictMode: false, file: 'does-not-exist/entrypoints.json');

        $this->assertSame([], $lookup->getJavaScriptFiles('app'));
        $this->assertFalse($lookup->entryExists('app'));
    }

    public function testACacheHitResolvesWithoutTouchingTheFile(): void
    {
        $cache = new ArrayAdapter();
        $entrypoints = Entrypoints::fromArray([
            'isProd' => true,
            'devServer' => null,
            'publicPath' => '/build/',
            'entryPoints' => ['app' => ['js' => ['build/app.js']]],
            'integrity' => [],
        ]);
        $cache->save($cache->getItem('reprise.entrypoints')->set($entrypoints));

        // The path does not exist: a hit must serve from the cache, never the file (which would
        // throw in strict mode).
        $lookup = new EntrypointsLookup('/does/not/exist/entrypoints.json', true, $cache, 'reprise.entrypoints');

        $this->assertSame(['build/app.js'], $lookup->getJavaScriptFiles('app'));
    }

    public function testACacheMissReadsTheFileAndPopulatesThePool(): void
    {
        $cache = new ArrayAdapter();
        $lookup = new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json', true, $cache, 'reprise.entrypoints');

        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));

        $item = $cache->getItem('reprise.entrypoints');
        $this->assertTrue($item->isHit());
        $this->assertInstanceOf(Entrypoints::class, $item->get());
    }

    public function testAMissingFileIsNotCached(): void
    {
        $cache = new ArrayAdapter();

        $this->assertSame([], new EntrypointsLookup('/does/not/exist/entrypoints.json', false, $cache)->getJavaScriptFiles('app'));
        $this->assertFalse($cache->getItem('reprise.entrypoints')->isHit());
    }

    public function testACachedNullIsIgnoredAndTheFileRead(): void
    {
        $cache = new ArrayAdapter();
        $cache->save($cache->getItem('reprise.entrypoints')->set(null));

        $lookup = new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json', true, $cache);

        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
    }

    public function testResetForgetsAMissingFileSoALaterBuildIsPickedUp(): void
    {
        $path = sys_get_temp_dir().'/reprise_entrypoints_'.uniqid('', true).'.json';
        $lookup = new EntrypointsLookup($path, false);

        try {
            $this->assertSame([], $lookup->getJavaScriptFiles('app'));

            copy(__DIR__.'/../fixtures/build/entrypoints.json', $path);
            $lookup->reset();

            $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
        } finally {
            @unlink($path);
        }
    }
}
