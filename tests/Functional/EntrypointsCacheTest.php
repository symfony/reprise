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
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;

final class EntrypointsCacheTest extends TestCase
{
    public function testCacheEnabledWiresThePoolAndResolvesAnEntry(): void
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build', ['cache' => true]);
        $kernel->boot();
        $container = $kernel->getContainer();

        // The whole cache stack compiled (pool + warmer + guard) and the lookup resolves.
        $this->assertTrue($container->has('reprise.entrypoints_cache_warmer'));

        $lookup = $container->get(EntrypointsLookupInterface::class);
        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
    }
}
