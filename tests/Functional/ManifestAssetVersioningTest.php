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
use Symfony\Component\Asset\Packages;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class ManifestAssetVersioningTest extends TestCase
{
    /**
     * Not mirrored per bundler on purpose: the manifest.json shape is identical for Vite and
     * Rsbuild, and consuming it is pure PHP with no bundler branch, so one test covers both.
     */
    public function testManifestResolvesLooseAssetsAndPassesEntryReferencesThrough(): void
    {
        $buildDir = __DIR__.'/../fixtures/build';
        $kernel = new FunctionalAppKernel(
            $buildDir,
            [],
            ['assets' => ['json_manifest_path' => $buildDir.'/manifest.json']],
        );
        $kernel->boot();

        /** @var Packages $packages */
        $packages = $kernel->getContainer()->get('assets.packages');

        // A copied/loose asset, referenced by its logical name, resolves to the hashed URL.
        $this->assertSame('/build/logo-77.png', $packages->getUrl('build/images/logo.png'));

        // An entry-style reference is absent from the manifest, so the non-strict strategy leaves
        // it untouched: the relative ref only gets the package base path, keeping its hash and never
        // being remapped - entry tag rendering is undisturbed.
        $this->assertSame('/build/app-a1b2.js', $packages->getUrl('build/app-a1b2.js'));
    }
}
